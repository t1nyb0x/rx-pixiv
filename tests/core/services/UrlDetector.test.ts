import { describe, expect, it } from "vitest";

import type { PixivRef } from "#core/models/PixivRef";
import { detect } from "#core/services/UrlDetector";

interface Case {
  readonly name: string;
  readonly content: string;
  readonly expected: readonly PixivRef[];
}

const cases: readonly Case[] = [
  {
    name: "artwork",
    content: "https://www.pixiv.net/artworks/123",
    expected: [artwork("123")],
  },
  {
    name: "localized artwork",
    content: "https://www.pixiv.net/en/artworks/124",
    expected: [artwork("124")],
  },
  {
    name: "legacy artwork query",
    content: "http://www.pixiv.net/member_illust.php?mode=medium&illust_id=125",
    expected: [artwork("125")],
  },
  {
    name: "short artwork path",
    content: "https://pixiv.net/i/126",
    expected: [artwork("126")],
  },
  {
    name: "novel",
    content: "https://www.pixiv.net/novel/show.php?id=201",
    expected: [novel("201")],
  },
  {
    name: "novel series",
    content: "https://www.pixiv.net/novel/series/202",
    expected: [novelSeries("202")],
  },
  {
    name: "user",
    content: "https://www.pixiv.net/users/301",
    expected: [user("301")],
  },
  {
    name: "localized user",
    content: "https://www.pixiv.net/ja/users/302",
    expected: [user("302")],
  },
  {
    name: "legacy user query",
    content: "https://www.pixiv.net/member.php?id=303",
    expected: [user("303")],
  },
  {
    name: "shortlink remains unresolved",
    content: "https://pixiv.me/example_name",
    expected: [shortlink("example_name")],
  },
  {
    name: "different pixiv services",
    content: "https://pixivision.net/a/1 https://pixiv.help/hc/ja https://sketch.pixiv.net/items/1",
    expected: [],
  },
  {
    name: "fenced code",
    content: "before ```\nhttps://www.pixiv.net/artworks/401\n``` after",
    expected: [],
  },
  {
    name: "unterminated fenced code",
    content: "before ```\nhttps://www.pixiv.net/artworks/402",
    expected: [],
  },
  {
    name: "inline code",
    content: "`https://www.pixiv.net/artworks/403`",
    expected: [],
  },
  {
    name: "angle bracket suppression",
    content: "<https://www.pixiv.net/artworks/404>",
    expected: [],
  },
  {
    name: "spoiler suppression",
    content: "||https://www.pixiv.net/artworks/405||",
    expected: [],
  },
  {
    name: "unsupported routes and invalid ids",
    content:
      "https://www.pixiv.net/ranking.php https://www.pixiv.net/artworks/not-an-id https://www.pixiv.net/foo/artworks/1",
    expected: [],
  },
  {
    name: "malformed URL and invalid legacy queries",
    content:
      "http://% https://www.pixiv.net/member_illust.php?illust_id=nope https://www.pixiv.net/novel/show.php?id=nope https://www.pixiv.net/member.php?id=nope",
    expected: [],
  },
  {
    name: "invalid series and shortlink paths",
    content:
      "https://www.pixiv.net/novel/series/nope https://pixiv.me/ https://pixiv.me/alice/extra",
    expected: [],
  },
  {
    name: "duplicate legacy and canonical forms",
    content:
      "https://www.pixiv.net/artworks/501 https://www.pixiv.net/member_illust.php?illust_id=501",
    expected: [artwork("501")],
  },
  {
    name: "message order, limit, and trailing punctuation",
    content:
      "https://www.pixiv.net/users/601, https://www.pixiv.net/artworks/602。 https://www.pixiv.net/novel/show.php?id=603! https://www.pixiv.net/artworks/604",
    expected: [user("601"), artwork("602"), novel("603")],
  },
  {
    name: "visible URL around suppressed ranges",
    content:
      "`https://www.pixiv.net/artworks/701` https://www.pixiv.net/artworks/702 ||https://www.pixiv.net/artworks/703|| https://www.pixiv.net/users/704",
    expected: [artwork("702"), user("704")],
  },
];

describe("detect", () => {
  it.each(cases)("normalizes $name", ({ content, expected }) => {
    expect(detect(content)).toEqual(expected);
  });

  it("accepts a lower pure-function limit and clamps invalid ranges", () => {
    const content =
      "https://www.pixiv.net/artworks/1 https://www.pixiv.net/artworks/2 https://www.pixiv.net/artworks/3";

    expect(detect(content, 2)).toEqual([artwork("1"), artwork("2")]);
    expect(detect(content, 99)).toHaveLength(3);
    expect(detect(content, -1)).toEqual([]);
    expect(detect(content, Number.NaN)).toEqual([]);
  });
});

function artwork(id: string): PixivRef {
  return { kind: "artwork", id, canonicalUrl: `https://www.pixiv.net/artworks/${id}` };
}

function novel(id: string): PixivRef {
  return {
    kind: "novel",
    id,
    canonicalUrl: `https://www.pixiv.net/novel/show.php?id=${id}`,
  };
}

function novelSeries(id: string): PixivRef {
  return {
    kind: "novel_series",
    id,
    canonicalUrl: `https://www.pixiv.net/novel/series/${id}`,
  };
}

function user(id: string): PixivRef {
  return { kind: "user", id, canonicalUrl: `https://www.pixiv.net/users/${id}` };
}

function shortlink(name: string): PixivRef {
  return { kind: "shortlink", name, canonicalUrl: `https://pixiv.me/${name}` };
}
