import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AjaxPixivSource } from "#adapters/pixiv/AjaxPixivSource";
import type { FetchError } from "#core/models/errors";
import type { PixivRef } from "#core/models/PixivRef";
import type { IllustWork, NovelWork, UserWork } from "#core/models/PixivWork";
import { err, ok, type Result } from "#core/models/Result";
import type { HttpRequest, HttpResponse, IHttpClient } from "#core/ports/IHttpClient";
import type { FetchContext } from "#core/ports/IPixivSource";

const FETCHED_AT = 1_700_000_000_000;

function fixtureText(name: string): string {
  const url = new URL(`../../fixtures/ajax/${name}.json`, import.meta.url);
  return readFileSync(fileURLToPath(url), "utf8");
}

type Route = string | FetchError;

/**
 * `IHttpClient` ポートに対するフェイク（Plan 0005 テスト方針）。
 * `vi.mock("undici")` はしない —— モックはモジュールではなくポートに当てる。
 */
class FakeHttpClient implements IHttpClient {
  public readonly calls: string[] = [];

  public constructor(private readonly routes: ReadonlyMap<string, Route>) {}

  public request(request: HttpRequest): Promise<Result<HttpResponse, FetchError>> {
    this.calls.push(request.url);
    const match = [...this.routes.entries()].find(([key]) => request.url.includes(key));
    if (match === undefined) return Promise.resolve(err({ kind: "network", cause: "no route" }));

    const [, route] = match;
    if (typeof route !== "string") return Promise.resolve(err(route));
    return Promise.resolve(ok({ status: 200, headers: {}, body: route }));
  }
}

function sourceWith(routes: Record<string, Route>): {
  source: AjaxPixivSource;
  http: FakeHttpClient;
} {
  const http = new FakeHttpClient(new Map(Object.entries(routes)));
  return { source: new AjaxPixivSource({ httpClient: http, now: () => FETCHED_AT }), http };
}

const context = (): FetchContext => ({ signal: new AbortController().signal });

const artwork = (id: string): PixivRef => ({
  kind: "artwork",
  id,
  canonicalUrl: `https://www.pixiv.net/artworks/${id}`,
});

describe("AjaxPixivSource", () => {
  it("declares itself the authoritative rating source", () => {
    const { source } = sourceWith({});
    expect(source.name).toBe("ajax");
    expect(source.capabilities.ratingAuthority).toBe("authoritative");
    expect(source.supports(artwork("1"))).toBe(true);
  });

  it("fetches an artwork with images from the pages endpoint", async () => {
    const { source, http } = sourceWith({
      "/illust/100412238/pages": fixtureText("illust-pages"),
      "/illust/100412238": fixtureText("illust-single"),
    });

    const result = await source.fetch(artwork("100412238"), context());

    expect(result.ok).toBe(true);
    const work = (result as { value: IllustWork }).value;
    expect(work.kind).toBe("illust");
    expect(work.pages).toHaveLength(1);
    expect(work.pagesTruncated).toBe(false);
    expect(work.fetchedAt).toBe(FETCHED_AT);
    expect(http.calls.some((c) => c.endsWith("/pages"))).toBe(true);
  });

  it("always calls the pages endpoint, even for single-page works", async () => {
    // body.urls は無認証では常に null。/pages を省略すると画像がゼロ枚になる。
    const { source, http } = sourceWith({
      "/illust/100412238/pages": fixtureText("illust-pages"),
      "/illust/100412238": fixtureText("illust-single"),
    });

    await source.fetch(artwork("100412238"), context());
    expect(http.calls.filter((c) => c.endsWith("/pages"))).toHaveLength(1);
  });

  it("does NOT surface not_found when only the pages endpoint 404s", async () => {
    // ADR 0003「404 の取り扱い」: R-18 では作品が実在するのに /pages だけ 404 になる。
    // ここで not_found を上げると「作品が見つかりません」と誤報する。
    const { source } = sourceWith({
      "/illust/900000003/pages": { kind: "not_found" },
      "/illust/900000003": fixtureText("illust-r18"),
    });

    const result = await source.fetch(artwork("900000003"), context());

    expect(result.ok).toBe(true);
    const work = (result as { value: IllustWork }).value;
    expect(work.pages).toEqual([]);
    expect(work.pagesTruncated).toBe(true);
    expect(work.partial).toBe(true);
    expect(work.pageCount).toBe(8);
    expect(work.rating).toMatchObject({ level: "r18", confidence: "authoritative" });
  });

  it.each([
    { kind: "not_found" },
    { kind: "rate_limited" },
    { kind: "timeout" },
    { kind: "upstream_5xx", status: 503 },
    { kind: "parse_error" },
    { kind: "network", cause: "reset" },
  ] satisfies FetchError[])("swallows a $kind failure from the pages endpoint", async (failure) => {
    const { source } = sourceWith({
      "/illust/100412238/pages": failure,
      "/illust/100412238": fixtureText("illust-single"),
    });

    const result = await source.fetch(artwork("100412238"), context());
    expect(result.ok).toBe(true);
    expect((result as { value: IllustWork }).value.pages).toEqual([]);
  });

  it("treats an error envelope from the pages endpoint as zero images", async () => {
    const { source } = sourceWith({
      "/illust/900000003/pages": fixtureText("illust-pages-r18-404"),
      "/illust/900000003": fixtureText("illust-r18"),
    });

    const result = await source.fetch(artwork("900000003"), context());
    expect(result.ok).toBe(true);
    expect((result as { value: IllustWork }).value.pages).toEqual([]);
  });

  it("propagates not_found from the illust endpoint itself", async () => {
    // こちらの 404 は権威ある不在。連鎖を打ち切らせる。
    const { source, http } = sourceWith({ "/illust/1": { kind: "not_found" } });

    const result = await source.fetch(artwork("1"), context());

    expect(result).toEqual(err({ kind: "not_found" }));
    // 作品が無いと分かった時点で /pages を叩かない。
    expect(http.calls.some((c) => c.endsWith("/pages"))).toBe(false);
  });

  it.each([
    { kind: "rate_limited" },
    { kind: "timeout" },
    { kind: "upstream_5xx", status: 500 },
    { kind: "network", cause: "reset" },
  ] satisfies FetchError[])(
    "propagates a $kind failure from the illust endpoint",
    async (failure) => {
      const { source } = sourceWith({ "/illust/7": failure });
      const result = await source.fetch(artwork("7"), context());
      expect(result).toEqual(err(failure));
    },
  );

  it("reports parse_error for an error envelope on the illust endpoint", async () => {
    const { source } = sourceWith({ "/illust/8": fixtureText("error-notfound") });
    const result = await source.fetch(artwork("8"), context());
    expect(result.ok).toBe(false);
    expect((result as { error: FetchError }).error.kind).toBe("parse_error");
  });

  it("reports parse_error without a sample when the envelope carries no message", async () => {
    const { source } = sourceWith({ "/illust/10": '{"error":true}' });
    const result = await source.fetch(artwork("10"), context());
    expect((result as { error: FetchError }).error).toEqual({ kind: "parse_error" });
  });

  it("reports parse_error when the envelope succeeds but the body is missing", async () => {
    const { source } = sourceWith({ "/illust/11": '{"error":false,"message":"empty"}' });
    const result = await source.fetch(artwork("11"), context());
    expect((result as { error: FetchError }).error).toEqual({
      kind: "parse_error",
      sample: "empty",
    });
  });

  it("propagates failures from the novel and user endpoints", async () => {
    const novel = sourceWith({ "/novel/5": { kind: "not_found" } });
    expect(
      await novel.source.fetch({ kind: "novel", id: "5", canonicalUrl: "x" }, context()),
    ).toEqual(err({ kind: "not_found" }));

    const user = sourceWith({ "/user/5": { kind: "not_found" } });
    expect(
      await user.source.fetch({ kind: "user", id: "5", canonicalUrl: "x" }, context()),
    ).toEqual(err({ kind: "not_found" }));
  });

  it("reports parse_error for an error envelope on the novel endpoint", async () => {
    const { source } = sourceWith({ "/novel/6": fixtureText("error-notfound") });
    const result = await source.fetch({ kind: "novel", id: "6", canonicalUrl: "x" }, context());
    expect((result as { error: FetchError }).error.kind).toBe("parse_error");
  });

  it("reports parse_error for an error envelope on the user endpoint", async () => {
    const { source } = sourceWith({ "/user/6": fixtureText("error-notfound") });
    const result = await source.fetch({ kind: "user", id: "6", canonicalUrl: "x" }, context());
    expect((result as { error: FetchError }).error.kind).toBe("parse_error");
  });

  it("ignores an error envelope from profile/top", async () => {
    const { source } = sourceWith({
      "/user/11/profile/top": fixtureText("error-notfound"),
      "/user/11": fixtureText("user"),
    });
    const result = await source.fetch({ kind: "user", id: "11", canonicalUrl: "x" }, context());
    expect(result.ok).toBe(true);
    expect((result as { value: UserWork }).value.recentWorks).toEqual([]);
  });

  it("rejects a shortlink ref — resolution happens before the source is reached", async () => {
    const { source } = sourceWith({});
    const result = await source.fetch(
      { kind: "shortlink", name: "someone", canonicalUrl: "x" },
      context(),
    );
    expect(result).toEqual(err({ kind: "unsupported", reason: "capability" }));
  });

  it("reports parse_error for malformed json", async () => {
    const { source } = sourceWith({ "/illust/9": "not json at all" });
    const result = await source.fetch(artwork("9"), context());
    expect((result as { error: FetchError }).error).toMatchObject({ kind: "parse_error" });
  });

  it("fetches a novel", async () => {
    const { source } = sourceWith({ "/novel/12438689": fixtureText("novel") });
    const result = await source.fetch(
      { kind: "novel", id: "12438689", canonicalUrl: "x" },
      context(),
    );

    expect(result.ok).toBe(true);
    const work = (result as { value: NovelWork }).value;
    expect(work.kind).toBe("novel");
    expect(work.excerpt).toBeDefined();
  });

  it("fetches a user together with their recent works", async () => {
    const { source } = sourceWith({
      "/user/11/profile/top": fixtureText("user-profile-top"),
      "/user/11": fixtureText("user"),
    });

    const result = await source.fetch({ kind: "user", id: "11", canonicalUrl: "x" }, context());

    expect(result.ok).toBe(true);
    const work = (result as { value: UserWork }).value;
    expect(work.kind).toBe("user");
    expect(work.partial).toBe(false);
  });

  it("still returns the profile when recent works cannot be fetched", async () => {
    const { source } = sourceWith({
      "/user/11/profile/top": { kind: "upstream_5xx", status: 502 },
      "/user/11": fixtureText("user"),
    });

    const result = await source.fetch({ kind: "user", id: "11", canonicalUrl: "x" }, context());

    expect(result.ok).toBe(true);
    const work = (result as { value: UserWork }).value;
    expect(work.recentWorks).toEqual([]);
    expect(work.partial).toBe(true);
  });

  it("declares unsupported kinds instead of guessing", async () => {
    // novel_series は /ajax/novel/series/{id} の形を実データで確認できていない。
    // 推測で実装せず、連鎖に後段を試させる。
    const { source } = sourceWith({});
    expect(source.supports({ kind: "novel_series", id: "1", canonicalUrl: "x" })).toBe(false);

    const result = await source.fetch(
      { kind: "novel_series", id: "1", canonicalUrl: "x" },
      context(),
    );
    expect(result).toEqual(err({ kind: "unsupported", reason: "capability" }));
  });
});
