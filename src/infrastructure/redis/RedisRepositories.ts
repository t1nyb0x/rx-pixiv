import type { RedisClientType } from "redis";
import { z } from "zod";

import type { BanRecord, BanSubject, IBanRepository } from "#core/ports/IBanRepository";
import type { BlockRecord, BlockTarget, IBlockRepository } from "#core/ports/IBlockRepository";
import type { CooldownSubject, ICooldownStore } from "#core/ports/ICooldownStore";
import type { IReplyRepository, ReplyRecord } from "#core/ports/IReplyRepository";

const BAN_INDEX = "app:ban:list";
const BLOCK_INDEX = "app:block:list";

const ADD_REPLY_IF_ACTIVE = `
redis.call('SADD', KEYS[1], ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
if redis.call('EXISTS', KEYS[2]) == 1 then
  return 0
end
return 1
`;

const banRecordSchema = z.object({
  subject: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("user"), id: z.string().min(1) }),
    z.object({ kind: z.literal("guild"), id: z.string().min(1) }),
  ]),
  reason: z.string().optional(),
  createdAt: z.string().min(1),
  actorId: z.string().min(1),
});

const blockRecordSchema = z.object({
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("artwork"), id: z.string().min(1) }),
    z.object({ kind: z.literal("user"), id: z.string().min(1) }),
  ]),
  reason: z.string().optional(),
  createdAt: z.string().min(1),
});

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
  readonly #operations = new SerialQueue();

  public constructor(client: RedisClientType) {
    this.#client = client;
  }

  /** 起動時に一度だけ呼ぶ。読めなければ例外を投げ、呼び出し側が縮退を決める。 */
  public async preload(): Promise<void> {
    await this.#operations.run(async () => {
      // 再読込に失敗したとき古いcacheを「最新」として使わせない。
      this.#loaded = false;
      const keys = await this.#client.sMembers(BAN_INDEX);
      // 起動時の一度きり。各キーは独立なので並列に取る。
      const entries = await Promise.all(
        keys.map(
          async (key) =>
            [key, parseBanRecord(await this.#client.get(`app:ban:${key}`), key)] as const,
        ),
      );

      this.#cache.clear();
      for (const [key, record] of entries) this.#cache.set(key, record);
      this.#loaded = true;
    });
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
    await this.#operations.run(async () => {
      const key = banKey(record.subject);
      try {
        await this.#client
          .multi()
          .set(`app:ban:${key}`, JSON.stringify(record))
          .sAdd(BAN_INDEX, key)
          .exec();
      } catch (error) {
        // commit済みか不明な応答喪失時に古いcacheで判定させない。
        this.#loaded = false;
        throw error;
      }
      this.#cache.set(key, record);
    });
  }

  public async delete(subject: BanSubject): Promise<boolean> {
    return await this.#operations.run(async () => {
      const key = banKey(subject);
      try {
        await this.#client.multi().del(`app:ban:${key}`).sRem(BAN_INDEX, key).exec();
      } catch (error) {
        this.#loaded = false;
        throw error;
      }
      return this.#cache.delete(key);
    });
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
  readonly #operations = new SerialQueue();

  public constructor(client: RedisClientType) {
    this.#client = client;
  }

  public async preload(): Promise<void> {
    await this.#operations.run(async () => {
      // 再読込に失敗したとき古いcacheを「最新」として使わせない。
      this.#loaded = false;
      const keys = await this.#client.sMembers(BLOCK_INDEX);
      const entries = await Promise.all(
        keys.map(
          async (key) =>
            [key, parseBlockRecord(await this.#client.get(`app:block:${key}`), key)] as const,
        ),
      );

      this.#cache.clear();
      for (const [key, record] of entries) this.#cache.set(key, record);
      this.#loaded = true;
    });
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
    await this.#operations.run(async () => {
      const key = blockKey(record.target);
      try {
        await this.#client
          .multi()
          .set(`app:block:${key}`, JSON.stringify(record))
          .sAdd(BLOCK_INDEX, key)
          .exec();
      } catch (error) {
        this.#loaded = false;
        throw error;
      }
      this.#cache.set(key, record);
    });
  }

  public async delete(target: BlockTarget): Promise<boolean> {
    return await this.#operations.run(async () => {
      const key = blockKey(target);
      try {
        await this.#client.multi().del(`app:block:${key}`).sRem(BLOCK_INDEX, key).exec();
      } catch (error) {
        this.#loaded = false;
        throw error;
      }
      return this.#cache.delete(key);
    });
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

export class RedisReplyRepository implements IReplyRepository {
  public constructor(private readonly client: RedisClientType) {}

  public async find(originalMessageId: string): Promise<ReplyRecord | undefined> {
    const replyMessageIds = await this.client.sMembers(replyKey(originalMessageId));
    return replyMessageIds.length === 0 ? undefined : { originalMessageId, replyMessageIds };
  }

  public async add(
    originalMessageId: string,
    replyMessageId: string,
    ttlMs: number,
  ): Promise<boolean> {
    validateReplyTtl(ttlMs);
    const result = await this.client.eval(ADD_REPLY_IF_ACTIVE, {
      keys: [replyKey(originalMessageId), replyTombstoneKey(originalMessageId)],
      arguments: [replyMessageId, String(ttlMs)],
    });
    return result === 1;
  }

  public async markDeleted(originalMessageId: string, ttlMs: number): Promise<void> {
    validateReplyTtl(ttlMs);
    await this.client.set(replyTombstoneKey(originalMessageId), "1", {
      expiration: { type: "PX", value: ttlMs },
    });
  }

  public async remove(originalMessageId: string, replyMessageId: string): Promise<boolean> {
    return (await this.client.sRem(replyKey(originalMessageId), replyMessageId)) > 0;
  }
}

function parseStored<T>(raw: string | null, schema: z.ZodType<T>, key: string): T {
  if (raw === null) throw new Error(`indexed Redis record is missing: ${key}`);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new Error(`indexed Redis record is malformed: ${key}`);
  }

  const parsed = schema.safeParse(parsedJson);
  if (!parsed.success) throw new Error(`indexed Redis record has an invalid shape: ${key}`);
  return parsed.data;
}

function parseBanRecord(raw: string | null, key: string): BanRecord {
  const value = parseStored(raw, banRecordSchema, key);
  if (banKey(value.subject) !== key) {
    throw new Error(`indexed Redis record identity does not match its key: ${key}`);
  }
  return value.reason === undefined
    ? { subject: value.subject, createdAt: value.createdAt, actorId: value.actorId }
    : {
        subject: value.subject,
        reason: value.reason,
        createdAt: value.createdAt,
        actorId: value.actorId,
      };
}

function parseBlockRecord(raw: string | null, key: string): BlockRecord {
  const value = parseStored(raw, blockRecordSchema, key);
  if (blockKey(value.target) !== key) {
    throw new Error(`indexed Redis record identity does not match its key: ${key}`);
  }
  return value.reason === undefined
    ? { target: value.target, createdAt: value.createdAt }
    : { target: value.target, reason: value.reason, createdAt: value.createdAt };
}

function banKey(subject: BanSubject): string {
  return `${subject.kind}:${subject.id}`;
}

function blockKey(target: BlockTarget): string {
  return `${target.kind}:${target.id}`;
}

function replyKey(originalMessageId: string): string {
  return `app:reply:${originalMessageId}`;
}

function replyTombstoneKey(originalMessageId: string): string {
  return `app:reply-deleted:${originalMessageId}`;
}

function validateReplyTtl(ttlMs: number): void {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new RangeError("ttlMs must be a positive safe integer");
  }
}

/** preloadと管理更新がcacheを上書きし合わないためのリポジトリ内直列化。 */
class SerialQueue {
  #tail: Promise<void> = Promise.resolve();

  public run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
