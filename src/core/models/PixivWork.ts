import type { ContentRating } from "#core/models/ContentRating";

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
