import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PixivRef } from "#core/models/PixivRef";
import type { PixivWork } from "#core/models/PixivWork";
import { err, ok } from "#core/models/Result";
import { WorkCache } from "#infrastructure/cache/WorkCache";

describe("WorkCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => vi.useRealTimers());

  it("implements the asynchronous IWorkCache contract", async () => {
    const cache = createCache();
    const ref = artworkRef("1");
    const value = ok(illustWork("1"));

    await cache.set(ref, value);
    await expect(cache.get(ref)).resolves.toEqual(value);
    await cache.delete(ref);
    await expect(cache.get(ref)).resolves.toBeUndefined();
  });

  it("uses shorter TTLs for user and negative entries", async () => {
    const cache = createCache();
    const workRef = artworkRef("1");
    const userRef: PixivRef = {
      kind: "user",
      id: "2",
      canonicalUrl: "https://www.pixiv.net/users/2",
    };
    const missingRef = artworkRef("3");
    await cache.set(workRef, ok(illustWork("1")));
    await cache.set(userRef, ok(userWork("2")));
    await cache.set(missingRef, err({ kind: "not_found" }));

    vi.setSystemTime(11);
    await expect(cache.get(missingRef)).resolves.toBeUndefined();
    await expect(cache.get(userRef)).resolves.toBeUndefined();
    await expect(cache.get(workRef)).resolves.toBeDefined();
  });

  it("replaces a negative entry with a recovered work", async () => {
    const cache = createCache();
    const ref = artworkRef("1");
    await cache.set(ref, err({ kind: "not_found" }));
    await cache.set(ref, ok(illustWork("1")));

    await expect(cache.get(ref)).resolves.toEqual(ok(illustWork("1")));
  });

  it("keeps use-case capacities independent and caches novel series as work metadata", async () => {
    const cache = new WorkCache({
      workCapacity: 1,
      workTtlMs: 100,
      userCapacity: 1,
      userTtlMs: 100,
      negativeCapacity: 1,
      negativeTtlMs: 100,
    });
    const firstWork = artworkRef("1");
    const seriesRef: PixivRef = {
      kind: "novel_series",
      id: "2",
      canonicalUrl: "https://www.pixiv.net/novel/series/2",
    };
    const userRef: PixivRef = {
      kind: "user",
      id: "3",
      canonicalUrl: "https://www.pixiv.net/users/3",
    };
    await cache.set(userRef, ok(userWork("3")));
    await cache.set(firstWork, ok(illustWork("1")));
    await cache.set(seriesRef, ok(novelSeriesWork("2")));

    await expect(cache.get(firstWork)).resolves.toBeUndefined();
    await expect(cache.get(seriesRef)).resolves.toEqual(ok(novelSeriesWork("2")));
    await expect(cache.get(userRef)).resolves.toEqual(ok(userWork("3")));
  });
});

function createCache(): WorkCache {
  return new WorkCache({
    workCapacity: 2,
    workTtlMs: 100,
    userCapacity: 2,
    userTtlMs: 10,
    negativeCapacity: 2,
    negativeTtlMs: 10,
  });
}

function artworkRef(id: string): PixivRef {
  return { kind: "artwork", id, canonicalUrl: `https://www.pixiv.net/artworks/${id}` };
}

function baseWork(id: string) {
  return {
    id,
    canonicalUrl: `https://www.pixiv.net/artworks/${id}`,
    title: "title",
    author: { id: "author", name: "author", url: "https://www.pixiv.net/users/author" },
    rating: {
      level: "all" as const,
      sensitive: false,
      ai: "no" as const,
      confidence: "authoritative" as const,
    },
    source: "ajax" as const,
    fetchedAt: 0,
    partial: false,
  };
}

function illustWork(id: string): PixivWork {
  return {
    ...baseWork(id),
    kind: "illust",
    illustType: "illust",
    pageCount: 1,
    pages: [],
    pagesTruncated: false,
    tags: [],
  };
}

function userWork(id: string): PixivWork {
  return { ...baseWork(id), kind: "user", recentWorks: [] };
}

function novelSeriesWork(id: string): PixivWork {
  return { ...baseWork(id), kind: "novel_series" };
}
