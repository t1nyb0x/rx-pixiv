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
  /** `urls` の各要素に対応する入力 `pages` のindex。個別ポリシーを失わないために使う。 */
  readonly sourceIndexes: readonly number[];
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
  const hardLimit = normalizeLimit(options.hardLimit, 10, 10);
  const maxPages = Math.min(normalizeLimit(options.maxPages, 4, hardLimit), hardLimit);
  const preference = options.variantPreference ?? DEFAULT_VARIANT_PREFERENCE;

  const urls: string[] = [];
  const sourceIndexes: number[] = [];
  for (const [index, page] of pages.entries()) {
    if (urls.length >= maxPages) break;
    const candidate = pickVariant(page.urls, preference);
    if (candidate === undefined) continue;
    const rewritten = rewriter.rewrite(candidate);
    if (rewritten !== undefined) {
      urls.push(rewritten);
      sourceIndexes.push(index);
    }
  }

  const total = Math.max(totalPages, pages.length);
  return { urls, sourceIndexes, omitted: Math.max(0, total - urls.length), totalPages: total };
}

function normalizeLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), maximum);
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
