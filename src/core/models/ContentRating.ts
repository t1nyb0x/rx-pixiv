export type RatingLevel = "all" | "r18" | "r18g";
export type RatingConfidence = "authoritative" | "inferred" | "unknown";
export type AiUsage = "no" | "yes" | "unknown";

export interface ContentRating {
  readonly level: RatingLevel;
  readonly sensitive: boolean;
  readonly ai: AiUsage;
  readonly confidence: RatingConfidence;
}
