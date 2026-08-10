import { describe, expect, it } from "vitest";

import type { IllustWork, NovelWork } from "#core/models/PixivWork";
import { composeMessage, excerptNovel, formatCount } from "#core/services/MessageComposer";

const base = {
  id: "1",
  canonicalUrl: "https://www.pixiv.net/artworks/1",
  title: "作品名",
  author: { id: "2", name: "作者", url: "https://www.pixiv.net/users/2" },
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

const illust: IllustWork = {
  ...base,
  kind: "illust",
  illustType: "ugoira",
  pageCount: 6,
  pages: [],
  pagesTruncated: true,
  tags: [{ name: "風景" }],
  stats: { views: 12_345, bookmarks: 999 },
  createdAt: "2026-08-10T15:30:00Z",
};

describe("composeMessage", () => {
  it("returns an empty plan for skip", () => {
    expect(composeMessage(illust, { decision: "skip" })).toEqual({ items: [] });
  });

  it("does not leak metadata for link_only", () => {
    const plan = composeMessage(illust, { decision: "link_only" });
    expect(plan.items).toEqual([]);
    expect(plan.content).toContain(illust.canonicalUrl);
    expect(JSON.stringify(plan)).not.toContain(illust.title);
    expect(JSON.stringify(plan)).not.toContain("風景");
  });

  it("builds a spoiler plan with media, page notice and ugoira label", () => {
    const plan = composeMessage(illust, {
      decision: "expand_spoiler",
      media: { urls: ["https://proxy/1.jpg"], sourceIndexes: [0], omitted: 5, totalPages: 6 },
    });
    expect(plan.items[0]).toMatchObject({
      spoiler: true,
      title: "作品名",
      media: [{ url: "https://proxy/1.jpg", spoiler: true }],
    });
    expect(plan.items[0]?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "うごイラ（静止画のみ表示）" }),
        expect.objectContaining({ value: "全6ページ中1ページを表示" }),
      ]),
    );
  });

  it("preserves per-media spoiler decisions for mixed user thumbnails", () => {
    const plan = composeMessage(illust, {
      decision: "expand_plain",
      media: {
        urls: ["https://proxy/plain.jpg", "https://proxy/sensitive.jpg"],
        sourceIndexes: [0, 1],
        omitted: 0,
        totalPages: 2,
      },
      mediaSpoilers: [false, true],
    });
    expect(plan.items[0]?.media.map((item) => item.spoiler)).toEqual([false, true]);
  });

  it("removes html and pixiv notation before truncating a novel excerpt", () => {
    const novel: NovelWork = {
      ...base,
      kind: "novel",
      canonicalUrl: "https://www.pixiv.net/novel/show.php?id=1",
      tags: [],
      excerpt: `<b>冒頭</b>[newpage]${"あ".repeat(400)}`,
    };
    const plan = composeMessage(novel, { decision: "expand_plain" });
    expect(plan.items[0]?.description).not.toContain("<b>");
    expect(plan.items[0]?.description).not.toContain("newpage");
    expect(Array.from(plan.items[0]?.description ?? "")).toHaveLength(301);
    expect(excerptNovel("[[jumpuri:URL > https://example.com]]本文")).toBe("本文");
  });
});

describe("formatCount", () => {
  it.each([
    [999, "999"],
    [12_345, "1.2万"],
    [123_456, "12万"],
  ])("formats %i as %s", (value, expected) => {
    expect(formatCount(value)).toBe(expected);
  });
});
