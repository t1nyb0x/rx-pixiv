import { describe, expect, it, vi } from "vitest";

import { isSufficient, PixivSourceChain } from "#adapters/pixiv/PixivSourceChain";
import type { ContentRating } from "#core/models/ContentRating";
import type { FetchError } from "#core/models/errors";
import type { PixivRef } from "#core/models/PixivRef";
import type { IllustWork, PixivWork, SourceName } from "#core/models/PixivWork";
import { err, ok, type Result } from "#core/models/Result";
import type { FetchContext, IPixivSource, SourceCapabilities } from "#core/ports/IPixivSource";

const artwork: PixivRef = {
  kind: "artwork",
  id: "1",
  canonicalUrl: "https://www.pixiv.net/artworks/1",
};

const rating = (over: Partial<ContentRating> = {}): ContentRating => ({
  level: "all",
  sensitive: false,
  ai: "unknown",
  confidence: "authoritative",
  ...over,
});

function illust(over: Partial<IllustWork> = {}): IllustWork {
  return {
    kind: "illust",
    id: "1",
    canonicalUrl: "https://www.pixiv.net/artworks/1",
    title: "t",
    author: { id: "9", name: "a", url: "u" },
    rating: rating(),
    source: "ajax",
    fetchedAt: 0,
    partial: false,
    illustType: "illust",
    pageCount: 1,
    pages: [{ page: 0, urls: { regular: "https://i.pximg.net/a.jpg" } }],
    pagesTruncated: false,
    tags: [{ name: "tag" }],
    ...over,
  };
}

class StubSource implements IPixivSource {
  public calls = 0;

  public constructor(
    public readonly name: SourceName,
    private readonly result: Result<PixivWork, FetchError>,
    public readonly capabilities: SourceCapabilities = {
      supportedKinds: ["artwork"],
      ratingAuthority: "inferred",
      multiPage: false,
    },
  ) {}

  public supports(ref: PixivRef): boolean {
    return this.capabilities.supportedKinds.includes(ref.kind);
  }

  public fetch(_ref: PixivRef, _context: FetchContext): Promise<Result<PixivWork, FetchError>> {
    this.calls += 1;
    return Promise.resolve(this.result);
  }
}

const context = (): FetchContext => ({ signal: new AbortController().signal });

describe("PixivSourceChain", () => {
  it("stops at the first source when the result is already sufficient", async () => {
    const ajax = new StubSource("ajax", ok(illust()));
    const phixiv = new StubSource("phixiv", ok(illust({ source: "phixiv" })));
    const chain = new PixivSourceChain({ sources: [ajax, phixiv] });

    const result = await chain.fetch(artwork, context());

    expect(result.ok).toBe(true);
    expect(ajax.calls).toBe(1);
    expect(phixiv.calls).toBe(0);
  });

  it("fills missing images from a later source — the R-18 case", async () => {
    // Ajax は権威ある年齢区分を持つが画像を持たない（/pages が 404）。
    // phixiv は画像を持つが年齢区分は推定でしかない。両方が要る（ADR 0003）。
    const ajax = new StubSource(
      "ajax",
      ok(
        illust({
          rating: rating({ level: "r18" }),
          pages: [],
          pageCount: 8,
          pagesTruncated: true,
          partial: true,
        }),
      ),
    );
    const phixiv = new StubSource(
      "phixiv",
      ok(
        illust({
          source: "phixiv",
          rating: rating({ level: "r18", confidence: "inferred" }),
          pages: [{ page: 0, urls: { regular: "https://phixiv.net/i/x.jpg" } }],
          pageCount: 1,
        }),
      ),
    );
    const chain = new PixivSourceChain({ sources: [ajax, phixiv] });

    const result = await chain.fetch(artwork, context());

    expect(result.ok).toBe(true);
    const work = (result as { value: IllustWork }).value;
    expect(phixiv.calls).toBe(1);
    expect(work.pages).toHaveLength(1);
    expect(work.pages[0]?.urls.regular).toContain("phixiv.net");
    // 権威ある年齢区分は保たれる。
    expect(work.rating).toMatchObject({ level: "r18", confidence: "authoritative" });
    // 8ページ中1枚しか出せていないことは伝える。
    expect(work.pageCount).toBe(8);
    expect(work.pagesTruncated).toBe(true);
  });

  it("preserves the larger page count when a later source supplies metadata", async () => {
    const phixiv = new StubSource(
      "phixiv",
      ok(
        illust({
          source: "phixiv",
          rating: rating({ confidence: "inferred" }),
          pages: [{ page: 0, urls: { regular: "https://phixiv.net/i/x.jpg" } }],
          pageCount: 1,
        }),
      ),
    );
    const ajax = new StubSource(
      "ajax",
      ok(illust({ pages: [], pageCount: 5, pagesTruncated: true, partial: true })),
    );

    const result = await new PixivSourceChain({ sources: [phixiv, ajax] }).fetch(
      artwork,
      context(),
    );
    const work = (result as { value: IllustWork }).value;

    expect(work.pageCount).toBe(5);
    expect(work.pagesTruncated).toBe(true);
    expect(work.partial).toBe(true);
  });

  it("never lets a later source loosen the rating", async () => {
    const ajax = new StubSource(
      "ajax",
      ok(illust({ rating: rating({ level: "r18" }), pages: [] })),
    );
    const phixiv = new StubSource(
      "phixiv",
      ok(illust({ source: "phixiv", rating: rating({ level: "all", confidence: "inferred" }) })),
    );
    const chain = new PixivSourceChain({ sources: [ajax, phixiv] });

    const work = ((await chain.fetch(artwork, context())) as { value: IllustWork }).value;
    expect(work.rating.level).toBe("r18");
  });

  it("stops the whole chain on not_found", async () => {
    // 権威ある不在。後段のキャッシュ的なプロキシは古いカードを出すだけ。
    const ajax = new StubSource("ajax", err({ kind: "not_found" }));
    const phixiv = new StubSource("phixiv", ok(illust()));
    const chain = new PixivSourceChain({ sources: [ajax, phixiv] });

    expect(await chain.fetch(artwork, context())).toEqual(err({ kind: "not_found" }));
    expect(phixiv.calls).toBe(0);
  });

  it("continues past other failures and returns the last one when all fail", async () => {
    const ajax = new StubSource("ajax", err({ kind: "rate_limited" }));
    const phixiv = new StubSource("phixiv", err({ kind: "timeout" }));
    const ogp = new StubSource("ogp", err({ kind: "parse_error" }));
    const chain = new PixivSourceChain({ sources: [ajax, phixiv, ogp] });

    expect(await chain.fetch(artwork, context())).toEqual(err({ kind: "parse_error" }));
    expect(phixiv.calls).toBe(1);
    expect(ogp.calls).toBe(1);
  });

  it("carries an auth_required failure forward as a rating hint", async () => {
    const ajax = new StubSource("ajax", err({ kind: "auth_required" }));
    const phixiv = new StubSource("phixiv", ok(illust({ source: "phixiv" })));
    const seen: (ContentRating | undefined)[] = [];
    vi.spyOn(phixiv, "fetch").mockImplementation((_ref, ctx) => {
      seen.push(ctx.ratingHint as ContentRating | undefined);
      return Promise.resolve(ok(illust({ source: "phixiv" })));
    });

    const chain = new PixivSourceChain({ sources: [ajax, phixiv] });
    const result = await chain.fetch(artwork, context());

    expect(seen[0]).toMatchObject({ level: "r18", confidence: "inferred" });
    expect(result).toMatchObject({
      ok: true,
      value: { rating: { level: "r18", confidence: "inferred" } },
    });
  });

  it("skips sources that do not support the ref", async () => {
    const novelOnly = new StubSource("ajax", ok(illust()), {
      supportedKinds: ["novel"],
      ratingAuthority: "authoritative",
      multiPage: true,
    });
    const chain = new PixivSourceChain({ sources: [novelOnly] });

    expect(chain.supports(artwork)).toBe(false);
    const result = await chain.fetch(artwork, context());
    expect(result).toEqual(err({ kind: "unsupported", reason: "capability" }));
    expect(novelOnly.calls).toBe(0);
  });

  it("does not start another source once the budget is spent", async () => {
    const controller = new AbortController();
    const ajax = new StubSource("ajax", err({ kind: "timeout" }));
    const phixiv = new StubSource("phixiv", ok(illust()));
    vi.spyOn(ajax, "fetch").mockImplementation(() => {
      controller.abort();
      return Promise.resolve(err({ kind: "timeout" }));
    });

    const chain = new PixivSourceChain({ sources: [ajax, phixiv] });
    await chain.fetch(artwork, { signal: controller.signal });

    expect(phixiv.calls).toBe(0);
  });

  it("reports what each source did", async () => {
    const events: string[] = [];
    const chain = new PixivSourceChain({
      sources: [
        new StubSource("ajax", err({ kind: "timeout" })),
        new StubSource("phixiv", ok(illust({ source: "phixiv" }))),
      ],
      onSourceResult: (event) => events.push(`${event.source}:${event.outcome}`),
    });

    await chain.fetch(artwork, context());
    expect(events).toEqual(["ajax:failure", "phixiv:success"]);
  });

  it("aggregates capabilities from its sources", () => {
    const chain = new PixivSourceChain({
      sources: [
        new StubSource("ajax", ok(illust()), {
          supportedKinds: ["artwork", "novel"],
          ratingAuthority: "authoritative",
          multiPage: true,
        }),
        new StubSource("ogp", ok(illust())),
      ],
    });

    expect(chain.capabilities.ratingAuthority).toBe("authoritative");
    expect(chain.capabilities.multiPage).toBe(true);
    expect(chain.capabilities.supportedKinds).toEqual(["artwork", "novel"]);
  });
});

describe("isSufficient", () => {
  it("requires both an authoritative rating and at least one image for illusts", () => {
    expect(isSufficient(illust())).toBe(true);
    expect(isSufficient(illust({ pages: [] }))).toBe(false);
    expect(isSufficient(illust({ rating: rating({ confidence: "inferred" }) }))).toBe(false);
  });

  it("accepts the first success for every other kind", () => {
    const user: PixivWork = {
      kind: "user",
      id: "1",
      canonicalUrl: "u",
      title: "n",
      author: { id: "1", name: "n", url: "u" },
      rating: rating({ confidence: "inferred" }),
      source: "ajax",
      fetchedAt: 0,
      partial: true,
      recentWorks: [],
    };
    expect(isSufficient(user)).toBe(true);
  });
});
