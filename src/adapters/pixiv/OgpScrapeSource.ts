import type { FetchError } from "#core/models/errors";
import type { ArtworkRef, PixivRef } from "#core/models/PixivRef";
import type { ContentRating } from "#core/models/ContentRating";
import type { IllustWork, PixivWork, SourceName } from "#core/models/PixivWork";
import { err, ok, type Result } from "#core/models/Result";
import type { FetchContext, SourceCapabilities } from "#core/ports/IPixivSource";
import { BasePixivSource, type BasePixivSourceOptions } from "#adapters/pixiv/BasePixivSource";
import { parseMetaTags } from "#adapters/pixiv/ogpMeta";

const PIXIV_BASE_URL = "https://www.pixiv.net";

/** pixiv がプレビューを出さない作品に差し替えるロゴ画像のホスト。 */
const PLACEHOLDER_IMAGE_HOST = "s.pximg.net";

/** プレビューカードを配信するホスト。`Referer` 不要で画像バイトを返す（実測）。 */
const PREVIEW_IMAGE_HOST = "embed.pixiv.net";

export interface OgpScrapeSourceOptions extends Omit<BasePixivSourceOptions, "headers"> {
  readonly baseUrl?: string;
  readonly now?: () => number;
}

/**
 * pixiv の作品ページの OGP を読む三次経路（ADR 0003）。
 *
 * 最後の砦であり、得られる情報は最も少ない。
 * 年齢区分は**プレビューの有無から推定する**しかないため `inferred` に留まる。
 */
export class OgpScrapeSource extends BasePixivSource {
  public readonly name: SourceName = "ogp";

  public readonly capabilities: SourceCapabilities = {
    supportedKinds: ["artwork"],
    ratingAuthority: "inferred",
    multiPage: false,
  };

  readonly #baseUrl: string;
  readonly #now: () => number;

  public constructor(options: OgpScrapeSourceOptions) {
    super({ httpClient: options.httpClient });
    this.#baseUrl = (options.baseUrl ?? PIXIV_BASE_URL).replace(/\/+$/, "");
    this.#now = options.now ?? Date.now;
  }

  public async fetch(ref: PixivRef, context: FetchContext): Promise<Result<PixivWork, FetchError>> {
    if (ref.kind !== "artwork") return err({ kind: "unsupported", reason: "capability" });
    return this.#fetchArtwork(ref, context);
  }

  async #fetchArtwork(
    ref: ArtworkRef,
    context: FetchContext,
  ): Promise<Result<PixivWork, FetchError>> {
    const html = await this.getText(`${this.#baseUrl}/artworks/${ref.id}`, context);
    if (!html.ok) return html;

    const meta = parseMetaTags(html.value);
    const ogTitle = meta.get("og:title");
    const title = meta.get("twitter:title") ?? (ogTitle === undefined ? undefined : ogTitle);
    if (title === undefined) {
      return err({ kind: "parse_error", sample: html.value.slice(0, 200) });
    }

    const previewUrl = usablePreviewUrl(meta.get("og:image") ?? meta.get("twitter:image"));
    const rating = inferRating(meta, previewUrl);

    const work: IllustWork = {
      kind: "illust",
      id: ref.id,
      canonicalUrl: `https://www.pixiv.net/artworks/${ref.id}`,
      title: stripPixivTitleSuffix(title),
      author: {
        id: "",
        name: parseAuthorName(ogTitle) ?? "",
        url: `https://www.pixiv.net/artworks/${ref.id}`,
      },
      rating,
      source: "ogp",
      fetchedAt: this.#now(),
      partial: true,
      illustType: "illust",
      pageCount: previewUrl === undefined ? 0 : 1,
      pages: previewUrl === undefined ? [] : [{ page: 0, urls: { regular: previewUrl } }],
      pagesTruncated: true,
      tags: [],
      ...descriptionOf(meta),
    };

    return ok(work);
  }
}

function descriptionOf(meta: Map<string, string>): { description?: string } {
  const description = meta.get("twitter:description") ?? meta.get("og:description");
  return description === undefined || description === "" ? {} : { description };
}

/**
 * 表示に使えるプレビュー URL だけを返す。
 *
 * pixiv は**プレビューを出せない作品に対し `og:image` を自社ロゴに差し替える**（実測）。
 * ロゴをそのまま画像として埋め込むと、作品ではなく pixiv のロゴが表示される。
 */
export function usablePreviewUrl(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return undefined;
  }
  return host === PREVIEW_IMAGE_HOST ? url : undefined;
}

/**
 * 年齢区分を推定する。
 *
 * **実測した2つの独立したシグナル**を使う（ADR 0006 の冗長判定）:
 * 1. `og:image` がロゴに差し替えられている（＝プレビューが出せない作品）
 * 2. `twitter:card` が `summary`（全年齢作品は `summary_large_image`）
 *
 * どちらかが立てば `r18` と推定する。
 *
 * **この経路の推定は最も弱い。** 「プレビューがある＝全年齢」は
 * 観測されたサンプル数が少なく、pixiv の仕様変更で崩れうる。
 * したがって `confidence` は常に `inferred` に留め、`authoritative` を名乗らない。
 * 一次経路（Ajax）が生きている限り、この推定が最終判断になることはない。
 */
export function inferRating(
  meta: Map<string, string>,
  previewUrl: string | undefined,
): ContentRating {
  const imageUrl = meta.get("og:image") ?? meta.get("twitter:image");
  const placeholderShown = imageUrl !== undefined && imageUrl.includes(PLACEHOLDER_IMAGE_HOST);
  const smallCard = meta.get("twitter:card") === "summary";

  const restricted = placeholderShown || smallCard || previewUrl === undefined;

  return {
    level: restricted ? "r18" : "all",
    sensitive: false,
    ai: "unknown",
    confidence: "inferred",
  };
}

/** `og:title` は `#タグ タイトル - 作者のイラスト - pixiv` 形式。 */
export function parseAuthorName(ogTitle: string | undefined): string | undefined {
  if (ogTitle === undefined) return undefined;
  const match = /\s-\s(.+?)の(?:イラスト|漫画|マンガ|小説|作品)\s-\spixiv$/.exec(ogTitle);
  return match?.[1];
}

/** `twitter:title` は装飾が無いが、無い場合は `og:title` の装飾を落とす。 */
export function stripPixivTitleSuffix(title: string): string {
  return title.replace(/\s-\s.+?の(?:イラスト|漫画|マンガ|小説|作品)\s-\spixiv$/, "").trim();
}
