import { pixivRefKey, type PixivRef } from "#core/models/PixivRef";
import type { CachedWork, IWorkCache } from "#core/ports/IWorkCache";
import { LruTtlCache } from "#infrastructure/cache/LruTtlCache";

export interface WorkCacheOptions {
  readonly workCapacity?: number;
  readonly workTtlMs?: number;
  readonly userCapacity?: number;
  readonly userTtlMs?: number;
  readonly negativeCapacity?: number;
  readonly negativeTtlMs?: number;
  readonly now?: () => number;
}

export class WorkCache implements IWorkCache {
  readonly #works: LruTtlCache<string, CachedWork>;
  readonly #users: LruTtlCache<string, CachedWork>;
  readonly #negatives: LruTtlCache<string, CachedWork>;

  public constructor(options: WorkCacheOptions = {}) {
    const now = options.now ?? Date.now;
    this.#works = new LruTtlCache({
      maxSize: options.workCapacity ?? 2_000,
      ttlMs: options.workTtlMs ?? 6 * 60 * 60 * 1_000,
      now,
    });
    this.#users = new LruTtlCache({
      maxSize: options.userCapacity ?? 500,
      ttlMs: options.userTtlMs ?? 60 * 60 * 1_000,
      now,
    });
    this.#negatives = new LruTtlCache({
      maxSize: options.negativeCapacity ?? 1_000,
      ttlMs: options.negativeTtlMs ?? 10 * 60 * 1_000,
      now,
    });
  }

  public async get(ref: PixivRef): Promise<CachedWork | undefined> {
    const key = pixivRefKey(ref);
    return this.#negatives.get(key) ?? this.#users.get(key) ?? this.#works.get(key);
  }

  public async set(ref: PixivRef, value: CachedWork): Promise<void> {
    const key = pixivRefKey(ref);
    this.#deleteKey(key);

    if (!value.ok) {
      this.#negatives.set(key, value);
    } else if (value.value.kind === "user") {
      this.#users.set(key, value);
    } else {
      this.#works.set(key, value);
    }
  }

  public async delete(ref: PixivRef): Promise<void> {
    this.#deleteKey(pixivRefKey(ref));
  }

  #deleteKey(key: string): void {
    this.#works.delete(key);
    this.#users.delete(key);
    this.#negatives.delete(key);
  }
}
