import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  mapAjaxIllust,
  mapAjaxNovel,
  mapAjaxUser,
  NOVEL_EXCERPT_LENGTH,
  toContentRating,
  toNovelExcerpt,
} from "#adapters/pixiv/mappers/ajaxMapper";
import {
  ajaxIllustBodySchema,
  ajaxIllustPagesBodySchema,
  ajaxNovelBodySchema,
  ajaxUserBodySchema,
  ajaxUserProfileTopBodySchema,
} from "#adapters/pixiv/schemas/ajax";
import type { PixivTag } from "#core/models/PixivWork";

const FETCHED_AT = 1_700_000_000_000;

function body(name: string): unknown {
  const url = new URL(`../../fixtures/ajax/${name}.json`, import.meta.url);
  return (JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as { body: unknown }).body;
}

const illust = (name: string) => ajaxIllustBodySchema.parse(body(name));
const pages = () => ajaxIllustPagesBodySchema.parse(body("illust-pages"));

const tag = (name: string): PixivTag => ({ name });

describe("toContentRating", () => {
  it("maps xRestrict to the rating level authoritatively", () => {
    expect(toContentRating(0, [], 0)).toMatchObject({ level: "all", confidence: "authoritative" });
    expect(toContentRating(1, [], 0)).toMatchObject({ level: "r18", confidence: "authoritative" });
    expect(toContentRating(2, [], 0)).toMatchObject({ level: "r18g", confidence: "authoritative" });
  });

  it("uses tags as a second, redundant signal", () => {
    // xRestrict が壊れてもタグ側で拾える（ADR 0006 の冗長判定）。
    expect(toContentRating(0, [tag("R-18")], 0).level).toBe("r18");
    expect(toContentRating(0, [tag("R-18G")], 0).level).toBe("r18g");
  });

  it("takes the stricter of the two signals", () => {
    expect(toContentRating(1, [tag("R-18G")], 0).level).toBe("r18g");
    expect(toContentRating(2, [tag("R-18")], 0).level).toBe("r18g");
  });

  it("never marks anything sensitive in v1", () => {
    // sl が全年齢作品でも 6 を返すため、この軸は使わない（ADR 0006）。
    for (const x of [0, 1, 2, undefined]) {
      expect(toContentRating(x, [tag("R-18")], 2).sensitive).toBe(false);
    }
  });

  it("degrades confidence when xRestrict is missing", () => {
    expect(toContentRating(undefined, [], undefined)).toMatchObject({
      level: "all",
      confidence: "inferred",
      ai: "unknown",
    });
  });

  it("maps aiType", () => {
    expect(toContentRating(0, [], 2).ai).toBe("yes");
    expect(toContentRating(0, [], 0).ai).toBe("no");
    expect(toContentRating(0, [], undefined).ai).toBe("unknown");
  });
});

describe("mapAjaxIllust", () => {
  it("maps a single-page illust with images from the pages endpoint", () => {
    const work = mapAjaxIllust(illust("illust-single"), pages(), FETCHED_AT);

    expect(work.kind).toBe("illust");
    expect(work.illustType).toBe("illust");
    expect(work.canonicalUrl).toBe(`https://www.pixiv.net/artworks/${work.id}`);
    expect(work.pages).toHaveLength(1);
    expect(work.pages[0]?.urls.regular).toMatch(/^https:\/\/i\.pximg\.net\//);
    expect(work.pagesTruncated).toBe(false);
    expect(work.partial).toBe(false);
    expect(work.source).toBe("ajax");
  });

  it("never sources images from body.urls", () => {
    // body.urls は無認証では常に null。pages を渡さなければ画像はゼロ枚になる。
    const work = mapAjaxIllust(illust("illust-single"), undefined, FETCHED_AT);
    expect(work.pages).toEqual([]);
  });

  it("returns metadata with zero images when the pages endpoint failed", () => {
    // R-18 では /pages が 404。作品は実在するのでメタデータは返す（ADR 0003）。
    const work = mapAjaxIllust(illust("illust-r18"), undefined, FETCHED_AT);

    expect(work.pages).toEqual([]);
    expect(work.pagesTruncated).toBe(true);
    expect(work.partial).toBe(true);
    expect(work.pageCount).toBe(8);
    expect(work.rating).toMatchObject({ level: "r18", confidence: "authoritative", ai: "yes" });
  });

  it("flags truncation when fewer pages arrive than pageCount", () => {
    const work = mapAjaxIllust(illust("illust-manga"), pages(), FETCHED_AT);
    expect(work.illustType).toBe("manga");
    expect(work.pageCount).toBe(3);
    expect(work.pages).toHaveLength(1);
    expect(work.pagesTruncated).toBe(true);
  });

  it("recognises ugoira so it can be labelled rather than silently frozen", () => {
    // ADR 0012: v1 は静止画のみ。ただし「うごイラである」ことは伝える。
    expect(mapAjaxIllust(illust("illust-ugoira"), pages(), FETCHED_AT).illustType).toBe("ugoira");
  });

  it("falls back to illust for unknown illustType values", () => {
    const raw = { ...illust("illust-single"), illustType: 99 };
    expect(mapAjaxIllust(raw, pages(), FETCHED_AT).illustType).toBe("illust");
  });
});

describe("toNovelExcerpt", () => {
  it("strips pixiv markup and keeps ruby base text", () => {
    expect(toNovelExcerpt("[[rb:漢字 > かんじ]]です")).toBe("漢字です");
    expect(toNovelExcerpt("[[jumpuri:ここ > https://example.com]]へ")).toBe("ここへ");
  });

  it("drops unknown bracket notation wholesale", () => {
    expect(toNovelExcerpt("前[newpage]後")).toBe("前後");
    expect(toNovelExcerpt("前[chapter:第一章]後")).toBe("前後");
    expect(toNovelExcerpt("前[unknownfuture:xyz]後")).toBe("前後");
  });

  it("caps the excerpt and marks the cut", () => {
    const excerpt = toNovelExcerpt("あ".repeat(1000));
    expect(excerpt).toHaveLength(NOVEL_EXCERPT_LENGTH + 1);
    expect(excerpt?.endsWith("…")).toBe(true);
  });

  it("returns undefined for empty or markup-only content", () => {
    expect(toNovelExcerpt(undefined)).toBeUndefined();
    expect(toNovelExcerpt("")).toBeUndefined();
    expect(toNovelExcerpt("[newpage]")).toBeUndefined();
  });
});

describe("mapAjaxNovel", () => {
  it("keeps only the excerpt — the full text never enters the domain model", () => {
    // ADR 0013: 全文は転載しない。ドメインに入れないことで構造的に漏洩を塞ぐ。
    const raw = ajaxNovelBodySchema.parse(body("novel"));
    const work = mapAjaxNovel(raw, FETCHED_AT);

    expect(work.kind).toBe("novel");
    expect(work.excerpt).toBeDefined();
    expect(work.excerpt!.length).toBeLessThanOrEqual(NOVEL_EXCERPT_LENGTH + 1);
    expect(JSON.stringify(work)).not.toContain(raw.content!.slice(0, 350));
  });

  it("maps the cover image and canonical url", () => {
    const work = mapAjaxNovel(ajaxNovelBodySchema.parse(body("novel")), FETCHED_AT);
    expect(work.canonicalUrl).toBe(`https://www.pixiv.net/novel/show.php?id=${work.id}`);
    expect(work.coverImage?.urls.regular).toBeDefined();
  });
});

describe("mapAjaxUser", () => {
  const user = () => ajaxUserBodySchema.parse(body("user"));
  const top = () => ajaxUserProfileTopBodySchema.parse(body("user-profile-top"));

  it("rates each recent work individually", () => {
    // ADR 0006: プロフィールが全年齢でも最近作に R-18 が混ざりうる。
    const work = mapAjaxUser(user(), top(), FETCHED_AT);
    expect(work.kind).toBe("user");
    for (const recent of work.recentWorks) {
      expect(recent.rating.level).toBeDefined();
      expect(recent.canonicalUrl).toBe(`https://www.pixiv.net/artworks/${recent.id}`);
    }
  });

  it("caps the number of recent works", () => {
    expect(mapAjaxUser(user(), top(), FETCHED_AT, 2).recentWorks.length).toBeLessThanOrEqual(2);
  });

  it("is partial when the profile-top payload is unavailable", () => {
    const work = mapAjaxUser(user(), undefined, FETCHED_AT);
    expect(work.recentWorks).toEqual([]);
    expect(work.partial).toBe(true);
  });
});
