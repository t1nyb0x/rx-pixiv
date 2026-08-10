import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  inferRating,
  OgpScrapeSource,
  parseAuthorName,
  stripPixivTitleSuffix,
  usablePreviewUrl,
} from "#adapters/pixiv/OgpScrapeSource";
import { parseMetaTags } from "#adapters/pixiv/ogpMeta";
import type { FetchError } from "#core/models/errors";
import type { PixivRef } from "#core/models/PixivRef";
import type { IllustWork } from "#core/models/PixivWork";
import { err, ok, type Result } from "#core/models/Result";
import type { HttpRequest, HttpResponse, IHttpClient } from "#core/ports/IHttpClient";
import type { FetchContext } from "#core/ports/IPixivSource";

const FETCHED_AT = 1_700_000_000_000;

function fixture(name: string): string {
  const url = new URL(`../../fixtures/ogp/${name}.html`, import.meta.url);
  return readFileSync(fileURLToPath(url), "utf8");
}

class FakeHttpClient implements IHttpClient {
  public readonly requests: HttpRequest[] = [];

  public constructor(private readonly response: string | FetchError) {}

  public request(request: HttpRequest): Promise<Result<HttpResponse, FetchError>> {
    this.requests.push(request);
    if (typeof this.response !== "string") return Promise.resolve(err(this.response));
    return Promise.resolve(ok({ status: 200, headers: {}, body: this.response }));
  }
}

function sourceWith(response: string | FetchError) {
  const http = new FakeHttpClient(response);
  return { http, source: new OgpScrapeSource({ httpClient: http, now: () => FETCHED_AT }) };
}

const context = (): FetchContext => ({ signal: new AbortController().signal });
const artwork = (id: string): PixivRef => ({
  kind: "artwork",
  id,
  canonicalUrl: `https://www.pixiv.net/artworks/${id}`,
});

describe("OgpScrapeSource", () => {
  it("declares itself the weakest source", () => {
    const { source } = sourceWith("");
    expect(source.name).toBe("ogp");
    expect(source.capabilities.ratingAuthority).toBe("inferred");
    expect(source.capabilities.multiPage).toBe(false);
  });

  it("maps an all-ages artwork with its preview card", async () => {
    const { source } = sourceWith(fixture("artwork-sfw"));
    const result = await source.fetch(artwork("100412238"), context());

    expect(result.ok).toBe(true);
    const work = (result as { value: IllustWork }).value;
    expect(work.source).toBe("ogp");
    // twitter:title は装飾が無い。og:title の「- 作者のイラスト - pixiv」は出さない。
    expect(work.title).not.toContain("pixiv");
    expect(work.author.name).not.toBe("");
    expect(work.pages[0]?.urls.regular).toContain("embed.pixiv.net");
    expect(work.rating.level).toBe("all");
    // 一次経路ではないので権威は名乗らない。
    expect(work.rating.confidence).toBe("inferred");
  });

  it("infers r18 when pixiv substitutes its logo for the preview", async () => {
    const { source } = sourceWith(fixture("artwork-r18"));
    const result = await source.fetch(artwork("148263791"), context());

    expect(result.ok).toBe(true);
    const work = (result as { value: IllustWork }).value;
    expect(work.rating.level).toBe("r18");
    expect(work.rating.confidence).toBe("inferred");
    // ロゴを作品画像として埋め込まない。
    expect(work.pages).toEqual([]);
  });

  it("is always partial — it can never enumerate pages", async () => {
    const { source } = sourceWith(fixture("artwork-sfw"));
    const work = ((await source.fetch(artwork("1"), context())) as { value: IllustWork }).value;
    expect(work.partial).toBe(true);
    expect(work.pagesTruncated).toBe(true);
    expect(work.tags).toEqual([]);
  });

  it("reports parse_error when no title metadata exists", async () => {
    const { source } = sourceWith(fixture("no-meta"));
    const result = await source.fetch(artwork("1"), context());
    expect((result as { error: FetchError }).error).toMatchObject({ kind: "parse_error" });
  });

  it("propagates transport failures", async () => {
    const { source } = sourceWith({ kind: "not_found" });
    expect(await source.fetch(artwork("1"), context())).toEqual(err({ kind: "not_found" }));
  });

  it("rejects non-artwork refs", async () => {
    const { source } = sourceWith("");
    const result = await source.fetch({ kind: "user", id: "1", canonicalUrl: "x" }, context());
    expect(result).toEqual(err({ kind: "unsupported", reason: "capability" }));
  });
});

describe("preview url filtering", () => {
  it("accepts only the preview host", () => {
    expect(usablePreviewUrl("https://embed.pixiv.net/decorate.php?illust_id=1")).toBeDefined();
  });

  it("rejects the placeholder logo, unknown hosts and malformed urls", () => {
    expect(usablePreviewUrl("https://s.pximg.net/www/images/pixiv_logo.png")).toBeUndefined();
    expect(usablePreviewUrl("https://i.pximg.net/img-master/x.jpg")).toBeUndefined();
    expect(usablePreviewUrl("not a url")).toBeUndefined();
    expect(usablePreviewUrl(undefined)).toBeUndefined();
  });
});

const meta = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe("rating inference", () => {
  it("uses the logo substitution as a signal", () => {
    const m = meta({ "og:image": "https://s.pximg.net/www/images/pixiv_logo.png" });
    expect(inferRating(m, undefined).level).toBe("r18");
  });

  it("uses the small twitter card as an independent signal", () => {
    // 画像判定が壊れても、こちらだけで R-18 を拾える（冗長判定）。
    const m = meta({
      "og:image": "https://embed.pixiv.net/decorate.php?illust_id=1",
      "twitter:card": "summary",
    });
    expect(inferRating(m, "https://embed.pixiv.net/decorate.php?illust_id=1").level).toBe("r18");
  });

  it("treats a missing preview as restricted", () => {
    expect(inferRating(meta({}), undefined).level).toBe("r18");
  });

  it("reports all-ages only when a real preview and a large card are present", () => {
    const m = meta({
      "og:image": "https://embed.pixiv.net/decorate.php?illust_id=1",
      "twitter:card": "summary_large_image",
    });
    const rating = inferRating(m, "https://embed.pixiv.net/decorate.php?illust_id=1");
    expect(rating.level).toBe("all");
    expect(rating.confidence).toBe("inferred");
  });

  it("never claims authority", () => {
    const m = meta({ "twitter:card": "summary_large_image" });
    expect(inferRating(m, "https://embed.pixiv.net/x").confidence).toBe("inferred");
  });
});

describe("pixiv title parsing", () => {
  it("extracts the author from the og:title suffix", () => {
    expect(parseAuthorName("#タグ 作品名 - さくしゃのイラスト - pixiv")).toBe("さくしゃ");
    expect(parseAuthorName("作品名 - さくしゃの漫画 - pixiv")).toBe("さくしゃ");
    expect(parseAuthorName("作品名 - さくしゃの小説 - pixiv")).toBe("さくしゃ");
  });

  it("returns undefined when the suffix is absent", () => {
    expect(parseAuthorName("ただのタイトル")).toBeUndefined();
    expect(parseAuthorName(undefined)).toBeUndefined();
  });

  it("strips the decoration when falling back to og:title", () => {
    expect(stripPixivTitleSuffix("#タグ 作品名 - さくしゃのイラスト - pixiv")).toBe("#タグ 作品名");
    expect(stripPixivTitleSuffix("装飾なし")).toBe("装飾なし");
  });

  it("shares the meta parser with the phixiv route", () => {
    const parsed = parseMetaTags(fixture("artwork-sfw"));
    expect(parsed.get("twitter:card")).toBe("summary_large_image");
    expect(parsed.get("og:image")).toContain("embed.pixiv.net");
  });
});
