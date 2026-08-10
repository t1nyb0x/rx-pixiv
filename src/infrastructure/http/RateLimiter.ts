export interface RateLimitRule {
  readonly requestsPerSecond: number;
  readonly burst: number;
}

interface TokenBucket extends RateLimitRule {
  tokens: number;
  lastRefillAt: number;
}

export class RateLimiter {
  readonly #buckets = new Map<string, TokenBucket>();
  readonly #now: () => number;

  public constructor(rules: Readonly<Record<string, RateLimitRule>>, now: () => number = Date.now) {
    this.#now = now;
    const createdAt = now();

    for (const [host, rule] of Object.entries(rules)) {
      validateRule(host, rule);
      this.#buckets.set(host.toLowerCase(), {
        ...rule,
        tokens: rule.burst,
        lastRefillAt: createdAt,
      });
    }
  }

  public static forPixiv(requestsPerSecond = 1, now: () => number = Date.now): RateLimiter {
    return new RateLimiter({ "www.pixiv.net": { requestsPerSecond, burst: 3 } }, now);
  }

  public async acquire(host: string, signal?: AbortSignal): Promise<void> {
    const bucket = this.#buckets.get(host.toLowerCase());
    if (bucket === undefined) return;

    await this.#acquireBucket(bucket, signal);
  }

  async #acquireBucket(bucket: TokenBucket, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true) throw abortReason(signal);

    const waitMs = this.#takeOrWait(bucket);
    if (waitMs === 0) return;
    await abortableDelay(waitMs, signal);
    await this.#acquireBucket(bucket, signal);
  }

  #takeOrWait(bucket: TokenBucket): number {
    const now = this.#now();
    const elapsedMs = Math.max(0, now - bucket.lastRefillAt);
    bucket.tokens = Math.min(
      bucket.burst,
      bucket.tokens + (elapsedMs * bucket.requestsPerSecond) / 1_000,
    );
    bucket.lastRefillAt = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return 0;
    }

    return Math.ceil(((1 - bucket.tokens) / bucket.requestsPerSecond) * 1_000);
  }
}

function validateRule(host: string, rule: RateLimitRule): void {
  if (!Number.isFinite(rule.requestsPerSecond) || rule.requestsPerSecond <= 0) {
    throw new RangeError(`Rate for ${host} must be a positive finite number`);
  }
  if (!Number.isInteger(rule.burst) || rule.burst <= 0) {
    throw new RangeError(`Burst for ${host} must be a positive integer`);
  }
}

function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortReason(signal));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException("The operation was aborted", "AbortError");
}
