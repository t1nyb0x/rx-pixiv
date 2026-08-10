const PXIMG_HOST = "i.pximg.net";

/**
 * `Referer` 無しでも直接埋め込めることが実測で確認できているホスト。
 *
 * - `embed.pixiv.net`: 作品ページの OGP が返すプレビューカード
 * - 画像プロキシ自身（`PXIMG_PROXY_BASE_URL` のホスト）: phixiv が返す URL がこれにあたる
 */
const DIRECTLY_EMBEDDABLE_HOSTS: ReadonlySet<string> = new Set(["embed.pixiv.net"]);

export interface ImageUrlRewriterOptions {
  /** 例: `https://phixiv.net/i`（ADR 0014）。 */
  readonly proxyBaseUrl: string;
}

/**
 * 画像 URL を Discord が取得できる形に整える（ADR 0014）。
 *
 * `i.pximg.net` は `Referer: https://www.pixiv.net/` を要求し、Discord の
 * メディアプロキシはそれを付けられない。そこで**ホスト名を書き換える**。
 * バイトはこちらを通らない。
 *
 * 一方、経路によっては**すでに埋め込める URL**が来る
 * （phixiv は `https://phixiv.net/i/...`、OGP は `https://embed.pixiv.net/...`）。
 * これらは書き換えず素通しする。
 *
 * それ以外のホストは**素通しも書き換えもしない**。
 * 想定外の URL を無検査で埋め込まないため。
 */
export class ImageUrlRewriter {
  readonly #proxyBase: string;
  readonly #proxyHost: string | undefined;

  public constructor(options: ImageUrlRewriterOptions) {
    this.#proxyBase = options.proxyBaseUrl.replace(/\/+$/, "");
    this.#proxyHost = safeHost(this.#proxyBase);
  }

  public rewrite(url: string): string | undefined {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return undefined;
    }

    if (parsed.protocol !== "https:") return undefined;

    if (parsed.hostname === PXIMG_HOST) {
      return `${this.#proxyBase}${parsed.pathname}${parsed.search}`;
    }

    if (DIRECTLY_EMBEDDABLE_HOSTS.has(parsed.hostname)) return url;
    if (this.#proxyHost !== undefined && parsed.hostname === this.#proxyHost) return url;

    return undefined;
  }
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
