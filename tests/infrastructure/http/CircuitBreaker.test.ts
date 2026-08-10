import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FetchError } from "#core/models/errors";
import { err, ok, type Result } from "#core/models/Result";
import { CircuitBreaker } from "#infrastructure/http/CircuitBreaker";

describe("CircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => vi.useRealTimers());

  it("opens at the failure threshold and rejects without invoking the operation", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2 });
    const failure = vi.fn<() => Promise<Result<never, FetchError>>>(async () =>
      err({ kind: "network", cause: "failed" }),
    );

    await breaker.execute(failure);
    await breaker.execute(failure);
    const blocked = await breaker.execute(failure);

    expect(breaker.state).toBe("open");
    expect(failure).toHaveBeenCalledTimes(2);
    expect(blocked).toEqual({
      ok: false,
      error: { kind: "unsupported", reason: "circuit_open" },
    });
  });

  it("allows only one half-open probe and closes after success", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, openMs: 120_000 });
    await breaker.execute(async () => err({ kind: "network", cause: "failed" }));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(breaker.state).toBe("half_open");

    const probe = deferred<Result<string, FetchError>>();
    const first = breaker.execute(() => probe.promise);
    const second = await breaker.execute(async () => ok("must not run"));
    expect(second).toMatchObject({ ok: false, error: { reason: "circuit_open" } });

    probe.resolve(ok("recovered"));
    await expect(first).resolves.toEqual(ok("recovered"));
    expect(breaker.state).toBe("closed");
  });

  it("reopens when the half-open probe fails", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, openMs: 10 });
    await breaker.execute(async () => err({ kind: "network", cause: "failed" }));
    await vi.advanceTimersByTimeAsync(10);

    await breaker.execute(async () => err({ kind: "network", cause: "still failed" }));

    expect(breaker.state).toBe("open");
  });

  it("resets the consecutive count outside the failure window and on success", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, failureWindowMs: 60_000 });
    await breaker.execute(async () => err({ kind: "network", cause: "first" }));
    await vi.advanceTimersByTimeAsync(60_001);
    await breaker.execute(async () => err({ kind: "network", cause: "new first" }));
    expect(breaker.state).toBe("closed");

    await breaker.execute(async () => ok("reset"));
    await breaker.execute(async () => err({ kind: "network", cause: "first again" }));
    expect(breaker.state).toBe("closed");
  });

  it("measures the failure window from the first failure, not between adjacent failures", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, failureWindowMs: 60_000 });
    const fail = () => breaker.execute(async () => err({ kind: "network", cause: "failed" }));

    await fail();
    await vi.advanceTimersByTimeAsync(50_000);
    await fail();
    await vi.advanceTimersByTimeAsync(50_000);
    await fail();

    expect(breaker.state).toBe("closed");
  });

  it("can trip immediately for rate limiting", () => {
    const breaker = new CircuitBreaker();
    breaker.trip();
    expect(breaker.state).toBe("open");
  });

  it("trips immediately on rate limiting and treats not-found as a healthy response", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2 });
    await breaker.execute(async () => err({ kind: "network", cause: "first" }));
    await breaker.execute(async () => err({ kind: "not_found" }));
    expect(breaker.state).toBe("closed");

    await breaker.execute(async () => err({ kind: "rate_limited" }));
    expect(breaker.state).toBe("open");
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
