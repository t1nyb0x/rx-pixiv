import { describe, expect, it } from "vitest";

import type { PixivImage } from "#core/models/PixivWork";
import { pickVariant, selectMedia } from "#core/services/MediaSelector";

const identity = { rewrite: (url: string) => url };
const rejectAll = { rewrite: () => undefined };

const page = (n: number, urls: Partial<Record<string, string>> = {}): PixivImage => ({
  page: n,
  urls: {
    regular: `https://i.pximg.net/regular/${n}.jpg`,
    small: `https://i.pximg.net/small/${n}.jpg`,
    thumb: `https://i.pximg.net/thumb/${n}.jpg`,
    original: `https://i.pximg.net/original/${n}.jpg`,
    ...urls,
  },
});

describe("pickVariant", () => {
  it("prefers regular and never picks original", () => {
    expect(pickVariant(page(0).urls)).toContain("/regular/");
  });

  it("falls back down the ladder", () => {
    expect(pickVariant({ small: "s", thumb: "t", original: "o" })).toBe("s");
    expect(pickVariant({ thumb: "t", original: "o" })).toBe("t");
  });

  it("returns undefined rather than falling back to original", () => {
    // 原寸の再配信は恒久的に行わない（ADR 0014）。
    expect(pickVariant({ original: "https://i.pximg.net/original/0.jpg" })).toBeUndefined();
    expect(pickVariant({})).toBeUndefined();
  });

  it("honours a custom preference order", () => {
    expect(pickVariant(page(0).urls, ["thumb", "regular"])).toContain("/thumb/");
  });
});

describe("selectMedia", () => {
  const pages = [page(0), page(1), page(2), page(3), page(4), page(5)];

  it("shows four pages by default and reports the rest", () => {
    const result = selectMedia(pages, 200, identity);
    expect(result.urls).toHaveLength(4);
    expect(result.totalPages).toBe(200);
    expect(result.omitted).toBe(196);
  });

  it("never exceeds the hard limit even when asked to", () => {
    // MediaGallery の item 上限を超えると送信時に例外になる。
    const result = selectMedia(pages, 6, identity, { maxPages: 50, hardLimit: 10 });
    expect(result.urls.length).toBeLessThanOrEqual(10);
  });

  it.each([11, Number.POSITIVE_INFINITY, Number.NaN])(
    "clamps an invalid public hard limit (%s) to Discord's limit",
    (hardLimit) => {
      const manyPages = Array.from({ length: 20 }, (_, index) => page(index));
      expect(selectMedia(manyPages, 20, identity, { maxPages: 20, hardLimit }).urls).toHaveLength(
        10,
      );
    },
  );

  it("keeps what it could resolve when some pages fail to rewrite", () => {
    // 部分失敗を捨てない（ADR 0003 と同じ方針）。
    const mixed = {
      rewrite: (url: string) => (url.includes("/1.jpg") ? undefined : url),
    };
    const result = selectMedia([page(0), page(1), page(2)], 3, mixed);
    expect(result.urls).toHaveLength(2);
    expect(result.omitted).toBe(1);
  });

  it("returns nothing but stays consistent when every page is rejected", () => {
    const result = selectMedia(pages, 6, rejectAll);
    expect(result.urls).toEqual([]);
    expect(result.omitted).toBe(6);
  });

  it("handles a work with no pages at all — the R-18 ajax case", () => {
    const result = selectMedia([], 8, identity);
    expect(result.urls).toEqual([]);
    expect(result.totalPages).toBe(8);
    expect(result.omitted).toBe(8);
  });

  it("skips pages that only offer the original variant", () => {
    const originalOnly: PixivImage = {
      page: 0,
      urls: { original: "https://i.pximg.net/original/0.jpg" },
    };
    expect(selectMedia([originalOnly], 1, identity).urls).toEqual([]);
  });

  it("uses the actual page count when it exceeds the declared total", () => {
    const result = selectMedia([page(0), page(1)], 1, identity);
    expect(result.totalPages).toBe(2);
  });
});
