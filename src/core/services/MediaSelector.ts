import type { PixivImage, PixivImageUrls } from "#core/models/PixivWork";

/** 表示に使える変種。**`original` は含めない**（ADR 0014）。 */
export type ImageVariant = "regular" | "small" | "thumb";

export const DEFAULT_VARIANT_PREFERENCE: readonly ImageVariant[] = ["regular", "small", "thumb"];

export interface MediaSelectorOptions {
  readonly maxPages?: number;
  /** Discord の MediaGallery の item 上限。これを超えることはできない。 */
  readonly hardLimit?: number;
  readonly variantPreference?: readonly ImageVariant[];
}

export interface SelectedMedia {
  readonly urls: readonly string[];
  /** 表示できなかった枚数（作品全体に対する不足分）。 */
  readonly omitted: number;
  readonly totalPages: number;
}

export interface UrlRewriter {
  rewrite(url: string): string | undefined;
}

/**
 * 表示する画像を選ぶ（ADR 0014）。
 *
 * - `original` は選ばない
 * - 既定4枚・上限10枚
 * - **部分失敗を捨てない**。書き換えられなかったページは飛ばし、
 *   取れた分だけ表示して不足枚数を伝える
 */
export function selectMedia(
  pages: readonly PixivImage[],
  totalPages: number,
  rewriter: UrlRewriter,
  options: MediaSelectorOptions = {},
): SelectedMedia {
  const hardLimit = options.hardLimit ?? 10;
  const maxPages = Math.min(options.maxPages ?? 4, hardLimit);
  const preference = options.variantPreference ?? DEFAULT_VARIANT_PREFERENCE;

  const urls: string[] = [];
  for (const page of pages) {
    if (urls.length >= maxPages) break;
    const candidate = pickVariant(page.urls, preference);
    if (candidate === undefined) continue;
    const rewritten = rewriter.rewrite(candidate);
    if (rewritten !== undefined) urls.push(rewritten);
  }

  const total = Math.max(totalPages, pages.length);
  return { urls, omitted: Math.max(0, total - urls.length), totalPages: total };
}

/** 選好順に最初に見つかった変種を返す。`original` は候補に入れない。 */
export function pickVariant(
  urls: PixivImageUrls,
  preference: readonly ImageVariant[] = DEFAULT_VARIANT_PREFERENCE,
): string | undefined {
  for (const variant of preference) {
    const url = urls[variant];
    if (url !== undefined && url !== "") return url;
  }
  return undefined;
}
