import type { FetchError } from "#core/models/errors";
import type { PixivRef } from "#core/models/PixivRef";
import { err, ok, type Result } from "#core/models/Result";
import type { IHttpClient } from "#core/ports/IHttpClient";
import { detect } from "#core/services/UrlDetector";

/** リダイレクトを追う上限。ループや連鎖に付き合わない。 */
export const MAX_REDIRECT_HOPS = 3;

export interface ShortlinkResolverOptions {
  readonly httpClient: IHttpClient;
  readonly maxHops?: number;
}

/**
 * `pixiv.me/{name}` を実体の URL へ解決する。
 *
 * `UrlDetector` は I/O を持たない純粋関数に保ちたいので、短縮 URL は
 * `{ kind: "shortlink" }` として検出だけされ、解決はここで行う。
 * 解決後の URL を**同じ純粋関数へ通し直す**ことで、
 * 対応 URL 形の判定ロジックが1箇所に留まる。
 */
export class ShortlinkResolver {
  readonly #httpClient: IHttpClient;
  readonly #maxHops: number;

  public constructor(options: ShortlinkResolverOptions) {
    this.#httpClient = options.httpClient;
    this.#maxHops = options.maxHops ?? MAX_REDIRECT_HOPS;
  }

  public async resolve(
    ref: Extract<PixivRef, { kind: "shortlink" }>,
    signal: AbortSignal,
  ): Promise<Result<PixivRef, FetchError>> {
    let url = ref.canonicalUrl;

    for (let hop = 0; hop < this.#maxHops; hop += 1) {
      // 転送先は前のホップの応答からしか分からないため、逐次にしかできない。
      // eslint-disable-next-line no-await-in-loop
      const response = await this.#httpClient.request({ url, method: "GET", signal });
      if (!response.ok) return response;

      const location = response.value.headers["location"];
      if (location === undefined) {
        // 転送が終わった。本文ではなく最終 URL だけを見る。
        return this.#detectOne(url);
      }

      let next: string;
      try {
        next = new URL(location, url).toString();
      } catch {
        return err({ kind: "parse_error", sample: location });
      }
      if (next === url) return err({ kind: "parse_error", sample: location });
      url = next;

      const resolved = this.#detectOne(url);
      if (resolved.ok) return resolved;
    }

    return err({ kind: "parse_error", sample: url });
  }

  #detectOne(url: string): Result<PixivRef, FetchError> {
    const [first] = detect(url);
    // 短縮 URL が短縮 URL に解決されたら、それは解決できていない。
    if (first === undefined || first.kind === "shortlink") {
      return err({ kind: "parse_error", sample: url });
    }
    return ok(first);
  }
}
