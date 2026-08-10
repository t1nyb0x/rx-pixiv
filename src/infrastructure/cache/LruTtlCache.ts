interface CacheEntry<V> {
  readonly value: V;
  readonly expiresAt: number;
}

export interface LruTtlCacheOptions {
  readonly maxSize: number;
  readonly ttlMs: number;
  readonly now?: () => number;
}

export class LruTtlCache<K, V> {
  readonly #entries = new Map<K, CacheEntry<V>>();
  readonly #maxSize: number;
  readonly #ttlMs: number;
  readonly #now: () => number;

  public constructor(options: LruTtlCacheOptions) {
    validatePositiveInteger("maxSize", options.maxSize);
    validatePositiveNumber("ttlMs", options.ttlMs);
    this.#maxSize = options.maxSize;
    this.#ttlMs = options.ttlMs;
    this.#now = options.now ?? Date.now;
  }

  public get size(): number {
    this.#purgeExpired();
    return this.#entries.size;
  }

  public get(key: K): V | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;

    if (entry.expiresAt <= this.#now()) {
      this.#entries.delete(key);
      return undefined;
    }

    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }

  public set(key: K, value: V, ttlMs = this.#ttlMs): void {
    validatePositiveNumber("ttlMs", ttlMs);
    this.#entries.delete(key);
    this.#purgeExpired();

    while (this.#entries.size >= this.#maxSize) {
      const oldestKey = this.#entries.keys().next().value as K | undefined;
      if (oldestKey === undefined) break;
      this.#entries.delete(oldestKey);
    }

    this.#entries.set(key, { value, expiresAt: this.#now() + ttlMs });
  }

  public delete(key: K): boolean {
    return this.#entries.delete(key);
  }

  public clear(): void {
    this.#entries.clear();
  }

  #purgeExpired(): void {
    const now = this.#now();
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(key);
    }
  }
}

function validatePositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} must be positive`);
}

function validatePositiveNumber(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive`);
}
