import type { ContentRating } from "#core/models/ContentRating";

/**
 * 展開の可否と見せ方。
 *
 * - `expand_plain`: そのまま展開する
 * - `expand_spoiler`: スポイラー付きで展開する
 * - `link_only`: **定型文と正規 URL のみ**。タイトルもタグもサムネイルも出さない
 * - `skip`: 何も投稿しない
 */
export type ExpansionDecision = "expand_plain" | "expand_spoiler" | "link_only" | "skip";

/** 全年齢だがセンシティブな作品を通常チャンネルでどう扱うか。 */
export type SensitiveInSfw = "spoiler" | "link_only" | "skip";

/** 年齢区分を確定できなかった作品を通常チャンネルでどう扱うか。 */
export type UnknownRatingInSfw = "skip" | "link_only";

export interface NsfwPolicyOptions {
  /** 年齢制限チャンネルでも R-18 をスポイラー化するか（既定 true）。 */
  readonly spoilerInNsfw?: boolean;
  readonly sensitiveInSfw?: SensitiveInSfw;
  readonly unknownRatingInSfw?: UnknownRatingInSfw;
  /** DM を年齢制限チャンネルとして扱うか（既定 false）。 */
  readonly allowNsfwInDm?: boolean;
}

export interface ChannelContext {
  /** チャンネル自体（スレッドなら親）が年齢制限チャンネルか。 */
  readonly channelIsNsfw: boolean;
  readonly isDm: boolean;
}

/**
 * 年齢区分とチャンネル種別から展開の可否を決める（ADR 0006）。
 *
 * **この関数がこの Bot でいちばん壊れてはいけない部分である。**
 * discord.js に依存しない純粋関数として書き、全直積のテーブルテストで担保する。
 *
 * 設計の核は非対称性:
 * **偽陽性（出るべきものが出ない）は許容し、偽陰性（出てはならないものが出る）は許容しない。**
 */
export function decideExpansion(
  rating: ContentRating,
  channel: ChannelContext,
  options: NsfwPolicyOptions = {},
): ExpansionDecision {
  const allowNsfwInDm = options.allowNsfwInDm ?? false;
  const spoilerInNsfw = options.spoilerInNsfw ?? true;
  const sensitiveInSfw = options.sensitiveInSfw ?? "spoiler";
  const unknownRatingInSfw = options.unknownRatingInSfw ?? "skip";

  // DM には年齢制限チャンネルという概念が無い。既定では非 NSFW として扱う。
  const ageRestricted = channel.isDm ? allowNsfwInDm : channel.channelIsNsfw;

  // 確信度が最優先。区分が読めていないなら、その区分を信じて展開してはならない。
  if (rating.confidence === "unknown") {
    if (ageRestricted) return "link_only";
    return unknownRatingInSfw === "link_only" ? "link_only" : "skip";
  }

  if (rating.level === "r18" || rating.level === "r18g") {
    if (!ageRestricted) return "link_only";
    return spoilerInNsfw ? "expand_spoiler" : "expand_plain";
  }

  if (rating.sensitive) {
    if (ageRestricted) return "expand_spoiler";
    switch (sensitiveInSfw) {
      case "link_only":
        return "link_only";
      case "skip":
        return "skip";
      default:
        return "expand_spoiler";
    }
  }

  return "expand_plain";
}

/**
 * 年齢区分を持つ要素を**1件ずつ**ゲートに通し、見せてよいものだけ残す。
 *
 * ユーザープロフィールの最近作に使う。プロフィール自体が全年齢でも、
 * 最近作に R-18 が混ざりうるため、カード全体ではなく**サムネイル単位**で判定する
 * （ADR 0006）。落とすのは該当のサムネイルだけで、カードは残す。
 */
export function filterByRating<T extends { readonly rating: ContentRating }>(
  items: readonly T[],
  channel: ChannelContext,
  options: NsfwPolicyOptions = {},
): readonly T[] {
  return items.filter((item) => showsMedia(decideExpansion(item.rating, channel, options)));
}

/** 判定結果がメディアを伴うか。`link_only` / `skip` では画像を組み立てない。 */
export function showsMedia(decision: ExpansionDecision): boolean {
  return decision === "expand_plain" || decision === "expand_spoiler";
}

/** 判定結果がスポイラーを要求するか。 */
export function requiresSpoiler(decision: ExpansionDecision): boolean {
  return decision === "expand_spoiler";
}
