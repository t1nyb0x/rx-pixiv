import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RateLimiter } from "#infrastructure/http/RateLimiter";

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => vi.useRealTimers());

  it("allows the initial burst and then sustains the configured rate", async () => {
    const limiter = RateLimiter.forPixiv(1);
    await Promise.all([
      limiter.acquire("www.pixiv.net"),
      limiter.acquire("www.pixiv.net"),
      limiter.acquire("www.pixiv.net"),
    ]);

    let fourthReleased = false;
    const fourth = limiter.acquire("www.pixiv.net").then(() => {
      fourthReleased = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(fourthReleased).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await fourth;
    expect(fourthReleased).toBe(true);

    let fifthReleased = false;
    const fifth = limiter.acquire("www.pixiv.net").then(() => {
      fifthReleased = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(fifthReleased).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await fifth;
    expect(fifthReleased).toBe(true);
  });

  it("does not limit hosts without a configured bucket", async () => {
    const limiter = RateLimiter.forPixiv();
    await expect(limiter.acquire("phixiv.net")).resolves.toBeUndefined();
  });

  it("cancels a queued acquisition through AbortSignal", async () => {
    const limiter = new RateLimiter({ "www.pixiv.net": { requestsPerSecond: 1, burst: 1 } });
    await limiter.acquire("www.pixiv.net");
    const controller = new AbortController();
    const pending = limiter.acquire("www.pixiv.net", controller.signal);

    controller.abort(new Error("cancelled"));

    await expect(pending).rejects.toThrow("cancelled");
  });

  it("serializes multiple waiters at the sustained rate", async () => {
    const limiter = new RateLimiter({ "www.pixiv.net": { requestsPerSecond: 2, burst: 1 } });
    await limiter.acquire("www.pixiv.net");
    const released: number[] = [];
    const waiters = [1, 2].map((id) =>
      limiter.acquire("www.pixiv.net").then(() => {
        released.push(id);
      }),
    );

    await vi.advanceTimersByTimeAsync(500);
    expect(released).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);
    await Promise.all(waiters);
    expect(released).toHaveLength(2);
  });

  it("rejects invalid bucket rules", () => {
    expect(() => new RateLimiter({ host: { requestsPerSecond: 0, burst: 1 } })).toThrow(RangeError);
    expect(() => new RateLimiter({ host: { requestsPerSecond: 1, burst: 0 } })).toThrow(RangeError);
  });
});
