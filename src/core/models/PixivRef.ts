interface RefBase {
  readonly canonicalUrl: string;
}

export interface ArtworkRef extends RefBase {
  readonly kind: "artwork";
  readonly id: string;
}

export interface NovelRef extends RefBase {
  readonly kind: "novel";
  readonly id: string;
}

export interface NovelSeriesRef extends RefBase {
  readonly kind: "novel_series";
  readonly id: string;
}

export interface UserRef extends RefBase {
  readonly kind: "user";
  readonly id: string;
}

export interface ShortlinkRef extends RefBase {
  readonly kind: "shortlink";
  readonly name: string;
}

export type PixivRef = ArtworkRef | NovelRef | NovelSeriesRef | UserRef | ShortlinkRef;

export function pixivRefKey(ref: PixivRef): string {
  return ref.kind === "shortlink" ? `${ref.kind}:${ref.name}` : `${ref.kind}:${ref.id}`;
}
