import { escalateRating, type ContentRating } from "#core/models/ContentRating";

export type SourceName = "ajax" | "phixiv" | "ogp";

export interface PixivAuthor {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly avatarUrl?: string;
}

export interface PixivTag {
  readonly name: string;
  readonly translatedName?: string;
}

export interface PixivImageUrls {
  readonly thumb?: string;
  readonly small?: string;
  readonly regular?: string;
  readonly original?: string;
}

export interface PixivImage {
  readonly page: number;
  readonly urls: PixivImageUrls;
  readonly width?: number;
  readonly height?: number;
}

export interface WorkStatistics {
  readonly views?: number;
  readonly bookmarks?: number;
  readonly comments?: number;
  readonly likes?: number;
}

export interface WorkBase {
  readonly id: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly author: PixivAuthor;
  readonly rating: ContentRating;
  readonly source: SourceName;
  readonly fetchedAt: number;
  readonly partial: boolean;
}

export interface IllustWork extends WorkBase {
  readonly kind: "illust";
  readonly illustType: "illust" | "manga" | "ugoira";
  readonly pageCount: number;
  readonly pages: readonly PixivImage[];
  readonly pagesTruncated: boolean;
  readonly tags: readonly PixivTag[];
  readonly description?: string;
  readonly stats?: WorkStatistics;
  readonly createdAt?: string;
}

export interface NovelWork extends WorkBase {
  readonly kind: "novel";
  readonly textCount?: number;
  readonly coverImage?: PixivImage;
  readonly series?: { readonly id: string; readonly title: string };
  readonly tags: readonly PixivTag[];
  readonly excerpt?: string;
  readonly createdAt?: string;
}

export interface NovelSeriesWork extends WorkBase {
  readonly kind: "novel_series";
  readonly description?: string;
  readonly coverImage?: PixivImage;
  readonly novelCount?: number;
}

export interface UserRecentWork {
  readonly id: string;
  readonly canonicalUrl: string;
  readonly image: PixivImage;
  readonly rating: ContentRating;
}

export interface UserWork extends WorkBase {
  readonly kind: "user";
  readonly bio?: string;
  readonly counts?: {
    readonly artworks?: number;
    readonly novels?: number;
    readonly followers?: number;
  };
  readonly recentWorks: readonly UserRecentWork[];
}

export type PixivWork = IllustWork | NovelWork | NovelSeriesWork | UserWork;

/**
 * 蓄積した作品に後段の経路の結果を**補完マージ**する（ADR 0003）。
 *
 * 経路ごとに持っている情報が違うため、「最初に成功した経路を採用」では足りない。
 * とくに R-18 では Ajax が権威ある年齢区分を持つ一方で画像を持たず、
 * phixiv が画像を持つ一方で年齢区分の権威を持たない。
 *
 * 規則:
 * - 年齢区分は `escalateRating` で**制限を強める方向にのみ**畳む
 * - 画像は蓄積側が空のときだけ後段で埋める
 * - その他のメタデータは**先に取れたものを優先**し、欠けている項目だけ埋める
 * - 種別が食い違う場合は蓄積側を採り、年齢区分だけ畳む
 */
export function mergeWorks(base: PixivWork, incoming: PixivWork): PixivWork {
  const rating = escalateRating(base.rating, incoming.rating);

  if (base.kind !== incoming.kind) return { ...base, rating };
  if (base.kind !== "illust" || incoming.kind !== "illust") return { ...base, rating };

  const pages = base.pages.length > 0 ? base.pages : incoming.pages;
  const pageCount = Math.max(base.pageCount, incoming.pageCount, pages.length);
  const tags = base.tags.length > 0 ? base.tags : incoming.tags;
  const author = base.author.id === "" && incoming.author.id !== "" ? incoming.author : base.author;

  const merged: IllustWork = {
    ...base,
    rating,
    author,
    pages,
    pageCount,
    pagesTruncated: pages.length < pageCount,
    partial: pages.length < pageCount,
    tags,
    ...pickDefined("description", base.description, incoming.description),
    ...pickDefined("stats", base.stats, incoming.stats),
    ...pickDefined("createdAt", base.createdAt, incoming.createdAt),
  };
  return merged;
}

function pickDefined<K extends string, V>(
  key: K,
  base: V | undefined,
  incoming: V | undefined,
): Record<K, V> | Record<string, never> {
  const value = base ?? incoming;
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}
