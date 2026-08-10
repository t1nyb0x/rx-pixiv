import { describe, expect, it, vi } from "vitest";

import { ShortlinkResolver } from "#adapters/pixiv/shortlink";
import type { FetchError } from "#core/models/errors";
import type { PixivRef } from "#core/models/PixivRef";
import type { IllustWork, PixivWork } from "#core/models/PixivWork";
import { err, ok, type Result } from "#core/models/Result";
import type { HttpRequest, HttpResponse, IHttpClient } from "#core/ports/IHttpClient";
import type { FetchContext, IPixivSource, SourceCapabilities } from "#core/ports/IPixivSource";
import type { CachedWork, IWorkCache } from "#core/ports/IWorkCache";
import { WorkResolver } from "#core/services/WorkResolver";

const artwork: PixivRef = {
  kind: "artwork",
  id: "1",
  canonicalUrl: "https://www.pixiv.net/artworks/1",
};
const shortlink: PixivRef = {
  kind: "shortlink",
  name: "someone",
  canonicalUrl: "https://pixiv.me/someone",
};

const work: IllustWork = {
  kind: "illust",
  id: "1",
  canonicalUrl: "https://www.pixiv.net/artworks/1",
  title: "t",
  author: { id: "9", name: "a", url: "u" },
  rating: { level: "all", sensitive: false, ai: "unknown", confidence: "authoritative" },
  source: "ajax",
  fetchedAt: 0,
  partial: false,
  illustType: "illust",
  pageCount: 1,
  pages: [{ page: 0, urls: { regular: "https://i.pximg.net/a.jpg" } }],
  pagesTruncated: false,
  tags: [],
};

class StubSource implements IPixivSource {
  public calls = 0;
  public readonly name = "ajax" as const;
  public readonly capabilities: SourceCapabilities = {
    supportedKinds: ["artwork", "novel", "user"],
    ratingAuthority: "authoritative",
    multiPage: true,
  };

  public constructor(private readonly result: Result<PixivWork, FetchError>) {}

  public supports(): boolean {
    return true;
  }

  public fetch(_ref: PixivRef, _context: FetchContext): Promise<Result<PixivWork, FetchError>> {
    this.calls += 1;
    return Promise.resolve(this.result);
  }
}

class MemoryCache implements IWorkCache {
  public readonly entries = new Map<string, CachedWork>();

  public get(ref: PixivRef): Promise<CachedWork | undefined> {
    return Promise.resolve(this.entries.get(key(ref)));
  }

  public set(ref: PixivRef, value: CachedWork): Promise<void> {
    this.entries.set(key(ref), value);
    return Promise.resolve();
  }

  public delete(ref: PixivRef): Promise<void> {
    this.entries.delete(key(ref));
    return Promise.resolve();
  }
}

function key(ref: PixivRef): string {
  return ref.kind === "shortlink" ? `shortlink:${ref.name}` : `${ref.kind}:${ref.id}`;
}

const signal = (): AbortSignal => new AbortController().signal;

describe("WorkResolver", () => {
  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, 2_147_483_648])(
    "rejects an invalid total budget: %s",
    (totalBudgetMs) => {
      expect(
        () =>
          new WorkResolver({
            source: new StubSource(ok(work)),
            cache: new MemoryCache(),
            totalBudgetMs,
          }),
      ).toThrow(RangeError);
    },
  );

  it("returns a cached work without touching the source", async () => {
    const source = new StubSource(ok(work));
    const cache = new MemoryCache();
    await cache.set(artwork, ok(work));

    const resolver = new WorkResolver({ source, cache });
    const result = await resolver.resolve(artwork, signal());

    expect(result).toEqual(ok(work));
    expect(source.calls).toBe(0);
  });

  it("caches a successful fetch", async () => {
    const source = new StubSource(ok(work));
    const cache = new MemoryCache();
    const resolver = new WorkResolver({ source, cache });

    await resolver.resolve(artwork, signal());
    expect(await cache.get(artwork)).toEqual(ok(work));
  });

  it("caches not_found so a deleted work is not re-fetched", async () => {
    const source = new StubSource(err({ kind: "not_found" }));
    const cache = new MemoryCache();
    const resolver = new WorkResolver({ source, cache });

    await resolver.resolve(artwork, signal());
    expect(await cache.get(artwork)).toEqual(err({ kind: "not_found" }));
  });

  it.each([
    { kind: "rate_limited" },
    { kind: "timeout" },
    { kind: "parse_error" },
    { kind: "upstream_5xx", status: 500 },
  ] satisfies FetchError[])("does not cache a transient $kind failure", async (failure) => {
    // レート制限やタイムアウトを焼き付けると、復旧しても出せなくなる。
    const cache = new MemoryCache();
    const resolver = new WorkResolver({ source: new StubSource(err(failure)), cache });
    await resolver.resolve(artwork, signal());
    expect(await cache.get(artwork)).toBeUndefined();
  });

  it("resolves a shortlink before fetching and caches under the resolved ref", async () => {
    const source = new StubSource(ok(work));
    const cache = new MemoryCache();
    const resolver = new WorkResolver({
      source,
      cache,
      shortlinkResolver: { resolve: () => Promise.resolve(ok(artwork)) },
    });

    const result = await resolver.resolve(shortlink, signal());

    expect(result.ok).toBe(true);
    expect(await cache.get(artwork)).toEqual(ok(work));
    expect(await cache.get(shortlink)).toBeUndefined();
  });

  it("applies the block gate after shortlink resolution but before fetching", async () => {
    const source = new StubSource(ok(work));
    const beforeFetch = vi.fn<(ref: PixivRef) => Promise<boolean>>(() => Promise.resolve(false));
    const resolver = new WorkResolver({
      source,
      cache: new MemoryCache(),
      shortlinkResolver: { resolve: () => Promise.resolve(ok(artwork)) },
      beforeFetch,
    });

    await expect(resolver.resolve(shortlink, signal())).resolves.toEqual(err({ kind: "blocked" }));
    expect(beforeFetch).toHaveBeenCalledWith(artwork);
    expect(source.calls).toBe(0);
  });

  it("propagates a shortlink resolution failure without fetching", async () => {
    const source = new StubSource(ok(work));
    const resolver = new WorkResolver({
      source,
      cache: new MemoryCache(),
      shortlinkResolver: { resolve: () => Promise.resolve(err({ kind: "not_found" })) },
    });

    expect(await resolver.resolve(shortlink, signal())).toEqual(err({ kind: "not_found" }));
    expect(source.calls).toBe(0);
  });

  it("reports shortlinks as unsupported when no resolver is wired", async () => {
    const resolver = new WorkResolver({
      source: new StubSource(ok(work)),
      cache: new MemoryCache(),
    });
    expect(await resolver.resolve(shortlink, signal())).toEqual(
      err({ kind: "unsupported", reason: "capability" }),
    );
  });
});

class RedirectingHttpClient implements IHttpClient {
  public readonly urls: string[] = [];

  public constructor(private readonly hops: ReadonlyMap<string, string | FetchError>) {}

  public request(request: HttpRequest): Promise<Result<HttpResponse, FetchError>> {
    this.urls.push(request.url);
    const hop = this.hops.get(request.url);
    if (hop === undefined) {
      return Promise.resolve(ok({ status: 200, headers: {}, body: "" }));
    }
    if (typeof hop !== "string") return Promise.resolve(err(hop));
    return Promise.resolve(ok({ status: 302, headers: { location: hop }, body: "" }));
  }
}

describe("ShortlinkResolver", () => {
  it("follows a redirect and re-runs the pure detector on the destination", async () => {
    const http = new RedirectingHttpClient(
      new Map([["https://pixiv.me/someone", "https://www.pixiv.net/users/12345"]]),
    );
    const resolver = new ShortlinkResolver({ httpClient: http });

    const result = await resolver.resolve(
      shortlink as Extract<PixivRef, { kind: "shortlink" }>,
      signal(),
    );

    expect(result).toEqual(ok({ kind: "user", id: "12345", canonicalUrl: expect.any(String) }));
  });

  it("gives up after the hop limit", async () => {
    const http = new RedirectingHttpClient(
      new Map([
        ["https://pixiv.me/someone", "https://pixiv.me/a"],
        ["https://pixiv.me/a", "https://pixiv.me/b"],
        ["https://pixiv.me/b", "https://pixiv.me/c"],
        ["https://pixiv.me/c", "https://pixiv.me/d"],
      ]),
    );
    const resolver = new ShortlinkResolver({ httpClient: http, maxHops: 2 });

    const result = await resolver.resolve(
      shortlink as Extract<PixivRef, { kind: "shortlink" }>,
      signal(),
    );

    expect(result.ok).toBe(false);
    expect(http.urls).toHaveLength(2);
  });

  it("refuses a redirect that points at itself", async () => {
    const http = new RedirectingHttpClient(
      new Map([["https://pixiv.me/someone", "https://pixiv.me/someone"]]),
    );
    const resolver = new ShortlinkResolver({ httpClient: http });

    const result = await resolver.resolve(
      shortlink as Extract<PixivRef, { kind: "shortlink" }>,
      signal(),
    );
    expect((result as { error: FetchError }).error.kind).toBe("parse_error");
    expect(http.urls).toEqual(["https://pixiv.me/someone"]);
  });

  it("does not follow an unsupported pixiv route as another HTTP hop", async () => {
    const http = new RedirectingHttpClient(
      new Map([["https://pixiv.me/someone", "https://www.pixiv.net/settings"]]),
    );
    const resolver = new ShortlinkResolver({ httpClient: http });

    const result = await resolver.resolve(
      shortlink as Extract<PixivRef, { kind: "shortlink" }>,
      signal(),
    );

    expect((result as { error: FetchError }).error.kind).toBe("parse_error");
    expect(http.urls).toEqual(["https://pixiv.me/someone"]);
  });

  it("fails when the destination is not a pixiv work", async () => {
    const http = new RedirectingHttpClient(
      new Map([["https://pixiv.me/someone", "https://example.com/"]]),
    );
    const resolver = new ShortlinkResolver({ httpClient: http });

    const result = await resolver.resolve(
      shortlink as Extract<PixivRef, { kind: "shortlink" }>,
      signal(),
    );
    expect((result as { error: FetchError }).error.kind).toBe("parse_error");
  });

  it("propagates transport failures", async () => {
    const http = new RedirectingHttpClient(
      new Map<string, string | FetchError>([["https://pixiv.me/someone", { kind: "not_found" }]]),
    );
    const resolver = new ShortlinkResolver({ httpClient: http });

    expect(
      await resolver.resolve(shortlink as Extract<PixivRef, { kind: "shortlink" }>, signal()),
    ).toEqual(err({ kind: "not_found" }));
  });
});
