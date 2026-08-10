import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LruTtlCache } from "#infrastructure/cache/LruTtlCache";

describe("LruTtlCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => vi.useRealTimers());

  it("expires entries at TTL", () => {
    const cache = new LruTtlCache<string, number>({ maxSize: 2, ttlMs: 1_000 });
    cache.set("a", 1);

    vi.setSystemTime(999);
    expect(cache.get("a")).toBe(1);
    vi.setSystemTime(1_000);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("promotes reads and evicts the least recently used entry", () => {
    const cache = new LruTtlCache<string, number>({ maxSize: 2, ttlMs: 10_000 });
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);

    cache.set("c", 3);

    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });

  it("replaces, deletes, and clears entries", () => {
    const cache = new LruTtlCache<string, number>({ maxSize: 2, ttlMs: 10_000 });
    cache.set("a", 1);
    cache.set("a", 2, 20_000);
    expect(cache.get("a")).toBe(2);
    expect(cache.delete("a")).toBe(true);
    cache.set("b", 3);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("rejects invalid limits", () => {
    expect(() => new LruTtlCache({ maxSize: 0, ttlMs: 1 })).toThrow(RangeError);
    expect(() => new LruTtlCache({ maxSize: 1, ttlMs: 0 })).toThrow(RangeError);
  });
});
