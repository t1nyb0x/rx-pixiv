import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  parseTags,
  PhixivSource,
  PHIXIV_USER_AGENT,
  splitTitle,
} from "#adapters/pixiv/PhixivSource";
import { parseMetaTags } from "#adapters/pixiv/ogpMeta";
import type { FetchError } from "#core/models/errors";
import type { PixivRef } from "#core/models/PixivRef";
import type { IllustWork } from "#core/models/PixivWork";
import { err, ok, type Result } from "#core/models/Result";
import type { HttpRequest, HttpResponse, IHttpClient } from "#core/ports/IHttpClient";
import type { FetchContext } from "#core/ports/IPixivSource";

const FETCHED_AT = 1_700_000_000_000;

function fixture(name: string): string {
  const url = new URL(`../../fixtures/phixiv/${name}.html`, import.meta.url);
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

function sourceWith(response: string | FetchError, baseUrl?: string) {
  const http = new FakeHttpClient(response);
  return {
    http,
    source: new PhixivSource({
      httpClient: http,
      now: () => FETCHED_AT,
      ...(baseUrl === undefined ? {} : { baseUrl }),
    }),
  };
}

const context = (): FetchContext => ({ signal: new AbortController().signal });
const artwork = (id: string): PixivRef => ({
  kind: "artwork",
  id,
  canonicalUrl: `https://www.pixiv.net/artworks/${id}`,
});

describe("PhixivSource", () => {
  it("declares itself an inferred, single-image source", () => {
    const { source } = sourceWith("");
    expect(source.name).toBe("phixiv");
    expect(source.capabilities.ratingAuthority).toBe("inferred");
    expect(source.capabilities.multiPage).toBe(false);
    expect(source.capabilities.supportedKinds).toEqual(["artwork"]);
  });

  it("sends a bot user-agent — phixiv redirects anything else", async () => {
    // 実測: 通常の UA では 307 で pixiv へ転送され OGP が返らない。
    const { source, http } = sourceWith(fixture("artwork"));
    await source.fetch(artwork("100412238"), context());
    expect(http.requests[0]?.headers?.["user-agent"]).toBe(PHIXIV_USER_AGENT);
  });

  it("maps an artwork from OGP metadata", async () => {
    const { source } = sourceWith(fixture("artwork"));
    const result = await source.fetch(artwork("100412238"), context());

    expect(result.ok).toBe(true);
    const work = (result as { value: IllustWork }).value;
    expect(work.source).toBe("phixiv");
    expect(work.title).not.toContain(" by (@");
    expect(work.author.name).not.toBe("");
    expect(work.tags.length).toBeGreaterThan(0);
    expect(work.pages[0]?.urls.regular).toMatch(/^https:\/\/phixiv\.net\/i\//);
  });

  it("supplies R-18 images that the ajax route cannot reach", async () => {
    // Ajax の /pages は R-18 で 404 になる。phixiv は画像 URL を返せるため、
    // 無認証で R-18 の画像を出せる唯一の経路になる（ADR 0007）。
    const { source } = sourceWith(fixture("artwork-r18"));
    const result = await source.fetch(artwork("900000003"), context());

    expect(result.ok).toBe(true);
    const work = (result as { value: IllustWork }).value;
    expect(work.rating.level).toBe("r18");
    // タグ由来の推定なので権威は持たない。
    expect(work.rating.confidence).toBe("inferred");
    expect(work.pages[0]?.urls.regular).toMatch(/^https:\/\/phixiv\.net\/i\//);
  });

  it("always reports itself as partial — it never has the full page set", async () => {
    const { source } = sourceWith(fixture("artwork"));
    const work = ((await source.fetch(artwork("100412238"), context())) as { value: IllustWork })
      .value;
    expect(work.partial).toBe(true);
    expect(work.pagesTruncated).toBe(true);
  });

  it("reports parse_error when the response is not an OGP page", async () => {
    // 転送先の本文など、og:title が無いものは解釈しない。
    const { source } = sourceWith(fixture("redirect-body"));
    const result = await source.fetch(artwork("1"), context());
    expect((result as { error: FetchError }).error).toMatchObject({ kind: "parse_error" });
  });

  it("propagates transport failures", async () => {
    const { source } = sourceWith({ kind: "rate_limited" });
    expect(await source.fetch(artwork("1"), context())).toEqual(err({ kind: "rate_limited" }));
  });

  it("rejects non-artwork refs", async () => {
    const { source } = sourceWith("");
    const result = await source.fetch({ kind: "novel", id: "1", canonicalUrl: "x" }, context());
    expect(result).toEqual(err({ kind: "unsupported", reason: "capability" }));
  });

  it("honours a custom base url and trims trailing slashes", async () => {
    // PHIXIV_BASE_URL でフォーク移転や自前ホストへ切り替えられること（ADR 0014）。
    const { source, http } = sourceWith(fixture("artwork"), "https://example.test/");
    await source.fetch(artwork("42"), context());
    expect(http.requests[0]?.url).toBe("https://example.test/artworks/42");
  });
});

describe("OGP meta parsing", () => {
  it("reads the first occurrence of each og property", () => {
    const meta = parseMetaTags(
      '<meta property="og:title" content="A"><meta property="og:title" content="B">',
    );
    expect(meta.get("og:title")).toBe("A");
  });

  it("decodes html entities", () => {
    const meta = parseMetaTags('<meta property="og:title" content="a &amp; b &quot;c&quot;">');
    expect(meta.get("og:title")).toBe('a & b "c"');
  });

  it("splits the title from the author handle", () => {
    expect(splitTitle("ある作品 by (@someone)")).toEqual({
      title: "ある作品",
      authorName: "someone",
    });
  });

  it("keeps the whole string when the title has no author suffix", () => {
    expect(splitTitle("ただのタイトル")).toEqual({ title: "ただのタイトル" });
  });

  it("parses the comma separated hash tag list", () => {
    expect(parseTags("#R-18, #foo , #bar")).toEqual([
      { name: "R-18" },
      { name: "foo" },
      { name: "bar" },
    ]);
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags("")).toEqual([]);
  });
});
