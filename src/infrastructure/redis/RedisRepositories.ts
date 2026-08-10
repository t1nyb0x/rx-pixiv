import type { RedisClientType } from "redis";

import type { BanRecord, BanSubject, IBanRepository } from "#core/ports/IBanRepository";
import type { BlockRecord, BlockTarget, IBlockRepository } from "#core/ports/IBlockRepository";
import type { CooldownSubject, ICooldownStore } from "#core/ports/ICooldownStore";

const BAN_INDEX = "app:ban:list";
const BLOCK_INDEX = "app:block:list";

/**
 * 禁止リスト（ADR 0016）。
 *
 * **起動時に全件をプロセス内へ読み込み**、変更時に更新する。
 * 件数が小さく変更頻度も低いため、毎メッセージで Redis に往復しない
 * ——— Redis は永続層であって、ホットパスではない。
 */
export class RedisBanRepository implements IBanRepository {
  readonly #client: RedisClientType;
  readonly #cache = new Map<string, BanRecord>();
  #loaded = false;

  public constructor(client: RedisClientType) {
    this.#client = client;
  }

  /** 起動時に一度だけ呼ぶ。読めなければ例外を投げ、呼び出し側が縮退を決める。 */
  public async preload(): Promise<void> {
    const keys = await this.#client.sMembers(BAN_INDEX);
    // 起動時の一度きり。各キーは独立なので並列に取る。
    const entries = await Promise.all(
      keys.map(
        async (key) =>
          [key, parseJson<BanRecord>(await this.#client.get(`app:ban:${key}`))] as const,
      ),
    );

    this.#cache.clear();
    for (const [key, record] of entries) {
      if (record !== undefined) this.#cache.set(key, record);
    }
    this.#loaded = true;
  }

  // ポートが Promise を返すと宣言している以上、失敗も**拒否として**返す。
  // 同期 throw だと `.catch()` で受ける呼び出し側をすり抜ける。
  public async find(subject: BanSubject): Promise<BanRecord | undefined> {
    this.#assertLoaded();
    return await Promise.resolve(this.#cache.get(banKey(subject)));
  }

  public async list(): Promise<readonly BanRecord[]> {
    this.#assertLoaded();
    return await Promise.resolve([...this.#cache.values()]);
  }

  public async save(record: BanRecord): Promise<void> {
    const key = banKey(record.subject);
    await this.#client.set(`app:ban:${key}`, JSON.stringify(record));
    await this.#client.sAdd(BAN_INDEX, key);
    this.#cache.set(key, record);
  }

  public async delete(subject: BanSubject): Promise<boolean> {
    const key = banKey(subject);
    await this.#client.del(`app:ban:${key}`);
    await this.#client.sRem(BAN_INDEX, key);
    return this.#cache.delete(key);
  }

  /**
   * プリロード前の参照は**成功させない**。
   * 空の結果を返すと「禁止されていない」と誤読され、ゲートが素通しになる。
   */
  #assertLoaded(): void {
    if (!this.#loaded) throw new Error("ban repository is not loaded");
  }
}

/** 展開拒否リスト（削除要請の受け皿）。構造は禁止リストと同じ。 */
export class RedisBlockRepository implements IBlockRepository {
  readonly #client: RedisClientType;
  readonly #cache = new Map<string, BlockRecord>();
  #loaded = false;

  public constructor(client: RedisClientType) {
    this.#client = client;
  }

  public async preload(): Promise<void> {
    const keys = await this.#client.sMembers(BLOCK_INDEX);
    const entries = await Promise.all(
      keys.map(
        async (key) =>
          [key, parseJson<BlockRecord>(await this.#client.get(`app:block:${key}`))] as const,
      ),
    );

    this.#cache.clear();
    for (const [key, record] of entries) {
      if (record !== undefined) this.#cache.set(key, record);
    }
    this.#loaded = true;
  }

  public async find(target: BlockTarget): Promise<BlockRecord | undefined> {
    this.#assertLoaded();
    return await Promise.resolve(this.#cache.get(blockKey(target)));
  }

  public async list(): Promise<readonly BlockRecord[]> {
    this.#assertLoaded();
    return await Promise.resolve([...this.#cache.values()]);
  }

  public async save(record: BlockRecord): Promise<void> {
    const key = blockKey(record.target);
    await this.#client.set(`app:block:${key}`, JSON.stringify(record));
    await this.#client.sAdd(BLOCK_INDEX, key);
    this.#cache.set(key, record);
  }

  public async delete(target: BlockTarget): Promise<boolean> {
    const key = blockKey(target);
    await this.#client.del(`app:block:${key}`);
    await this.#client.sRem(BLOCK_INDEX, key);
    return this.#cache.delete(key);
  }

  #assertLoaded(): void {
    if (!this.#loaded) throw new Error("block repository is not loaded");
  }
}

/**
 * クールダウン（ADR 0016）。
 *
 * こちらは**プリロードしない**。件数が多く寿命も短いため、
 * Redis の `SET NX PX` に判定ごと任せる。判定と記録を1往復にまとめられる。
 */
export class RedisCooldownStore implements ICooldownStore {
  readonly #client: RedisClientType;

  public constructor(client: RedisClientType) {
    this.#client = client;
  }

  public async consume(subject: CooldownSubject, windowMs: number): Promise<boolean> {
    const key = `app:cooldown:${subject.kind}:${subject.id}`;
    const result = await this.#client.set(key, "1", {
      condition: "NX",
      expiration: { type: "PX", value: windowMs },
    });
    return result === "OK";
  }
}

function parseJson<T>(raw: string | null): T | undefined {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function banKey(subject: BanSubject): string {
  return `${subject.kind}:${subject.id}`;
}

function blockKey(target: BlockTarget): string {
  return `${target.kind}:${target.id}`;
}
