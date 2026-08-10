import type { BanRecord, BanSubject, IBanRepository } from "#core/ports/IBanRepository";
import type { BlockRecord, BlockTarget, IBlockRepository } from "#core/ports/IBlockRepository";
import type { CooldownSubject, ICooldownStore } from "#core/ports/ICooldownStore";

/**
 * 永続ストアが無い環境向けの実装。
 *
 * **再起動で消えるため、本番の禁止・展開拒否には使わない**（ADR 0016）。
 * テストと、Redis を用意しない開発環境のためのもの。
 */
export class MemoryBanRepository implements IBanRepository {
  readonly #records = new Map<string, BanRecord>();

  public find(subject: BanSubject): Promise<BanRecord | undefined> {
    return Promise.resolve(this.#records.get(banKey(subject)));
  }

  public list(): Promise<readonly BanRecord[]> {
    return Promise.resolve([...this.#records.values()]);
  }

  public save(record: BanRecord): Promise<void> {
    this.#records.set(banKey(record.subject), record);
    return Promise.resolve();
  }

  public delete(subject: BanSubject): Promise<boolean> {
    return Promise.resolve(this.#records.delete(banKey(subject)));
  }
}

export class MemoryBlockRepository implements IBlockRepository {
  readonly #records = new Map<string, BlockRecord>();

  public find(target: BlockTarget): Promise<BlockRecord | undefined> {
    return Promise.resolve(this.#records.get(blockKey(target)));
  }

  public list(): Promise<readonly BlockRecord[]> {
    return Promise.resolve([...this.#records.values()]);
  }

  public save(record: BlockRecord): Promise<void> {
    this.#records.set(blockKey(record.target), record);
    return Promise.resolve();
  }

  public delete(target: BlockTarget): Promise<boolean> {
    return Promise.resolve(this.#records.delete(blockKey(target)));
  }
}

export interface MemoryCooldownStoreOptions {
  readonly now?: () => number;
  /** 保持する上限。到達したら期限切れを掃除する。 */
  readonly maxEntries?: number;
}

export class MemoryCooldownStore implements ICooldownStore {
  readonly #expiries = new Map<string, number>();
  readonly #now: () => number;
  readonly #maxEntries: number;

  public constructor(options: MemoryCooldownStoreOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#maxEntries = options.maxEntries ?? 10_000;
  }

  public consume(subject: CooldownSubject, windowMs: number): Promise<boolean> {
    const key = `${subject.kind}:${subject.id}`;
    const now = this.#now();
    const expiry = this.#expiries.get(key);

    if (expiry !== undefined && expiry > now) return Promise.resolve(false);

    if (this.#expiries.size >= this.#maxEntries) this.#evictExpired(now);
    this.#expiries.set(key, now + windowMs);
    return Promise.resolve(true);
  }

  #evictExpired(now: number): void {
    for (const [key, expiry] of this.#expiries) {
      if (expiry <= now) this.#expiries.delete(key);
    }
  }
}

function banKey(subject: BanSubject): string {
  return `${subject.kind}:${subject.id}`;
}

function blockKey(target: BlockTarget): string {
  return `${target.kind}:${target.id}`;
}
