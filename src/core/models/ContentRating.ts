export type RatingLevel = "all" | "r18" | "r18g";
export type RatingConfidence = "authoritative" | "inferred" | "unknown";
export type AiUsage = "no" | "yes" | "unknown";

export interface ContentRating {
  readonly level: RatingLevel;
  readonly sensitive: boolean;
  readonly ai: AiUsage;
  readonly confidence: RatingConfidence;
}

/** 制限の強さの序列。数値が大きいほど制限が強い。 */
const LEVEL_ORDER: Record<RatingLevel, number> = { all: 0, r18: 1, r18g: 2 };

/** 確信度の序列。数値が大きいほど確度が高い。 */
const CONFIDENCE_ORDER: Record<RatingConfidence, number> = {
  unknown: 0,
  inferred: 1,
  authoritative: 2,
};

/**
 * 年齢区分を**制限を強める方向にのみ**更新する（ADR 0003 / ADR 0006）。
 *
 * 取得経路の連鎖では、前段が得たヒント（例: `auth_required` から推定した r18）を
 * 後段が上書きする。このとき後段が `all` を返しても**制限を緩めてはならない**。
 * 緩める更新を許すと、フォールバックが年齢ゲートの抜け道になる。
 *
 * 確信度は**採用した level の根拠**に対応させる。異なる level を主張する情報の
 * 確信度だけを流用すると、推定した R-18 を authoritative と誤表示してしまう。
 */
export function escalateRating(
  current: ContentRating,
  incoming: Partial<ContentRating>,
): ContentRating {
  const incomingLevel = incoming.level;
  const stricter =
    incomingLevel !== undefined && LEVEL_ORDER[incomingLevel] > LEVEL_ORDER[current.level];
  const level = stricter ? incomingLevel : current.level;

  const sameLevel = incomingLevel === current.level;
  const confidence = stricter
    ? (incoming.confidence ?? "inferred")
    : sameLevel &&
        incoming.confidence !== undefined &&
        CONFIDENCE_ORDER[incoming.confidence] > CONFIDENCE_ORDER[current.confidence]
      ? incoming.confidence
      : current.confidence;

  return {
    level,
    // 制限方向は真に倒す（false へ戻さない）。
    sensitive: current.sensitive || (incoming.sensitive ?? false),
    ai: current.ai === "unknown" ? (incoming.ai ?? "unknown") : current.ai,
    confidence,
  };
}
