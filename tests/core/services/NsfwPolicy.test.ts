import { describe, expect, it } from "vitest";

import type { ContentRating, RatingConfidence, RatingLevel } from "#core/models/ContentRating";
import {
  decideExpansion,
  filterByRating,
  requiresSpoiler,
  showsMedia,
  type ChannelContext,
  type ExpansionDecision,
} from "#core/services/NsfwPolicy";

type ChannelKind = "nsfw" | "sfw" | "dm";

const CHANNELS: Record<ChannelKind, ChannelContext> = {
  nsfw: { channelIsNsfw: true, isDm: false },
  sfw: { channelIsNsfw: false, isDm: false },
  // DM には年齢制限チャンネルという概念が無い。既定では非 NSFW 扱い。
  dm: { channelIsNsfw: false, isDm: true },
};

const LEVELS: RatingLevel[] = ["all", "r18", "r18g"];
const CONFIDENCES: RatingConfidence[] = ["authoritative", "inferred", "unknown"];
const SENSITIVES = [false, true];

const rating = (
  level: RatingLevel,
  sensitive: boolean,
  confidence: RatingConfidence,
): ContentRating => ({ level, sensitive, ai: "unknown", confidence });

/**
 * 期待値表。**実装から導かず、ADR 0006 の判定表を人手で書き写している。**
 * 実装と同じ計算をここで書いてしまうと、テストが実装の写経になって意味を失う。
 *
 * 既定オプション（`spoilerInNsfw: true` / `sensitiveInSfw: "spoiler"` /
 * `unknownRatingInSfw: "skip"` / `allowNsfwInDm: false`）での期待値。
 */
const EXPECTED: Record<string, ExpansionDecision> = {
  // 全年齢・非センシティブ: どこでもそのまま出す
  "all|false|authoritative|nsfw": "expand_plain",
  "all|false|authoritative|sfw": "expand_plain",
  "all|false|authoritative|dm": "expand_plain",
  "all|false|inferred|nsfw": "expand_plain",
  "all|false|inferred|sfw": "expand_plain",
  "all|false|inferred|dm": "expand_plain",

  // 全年齢・センシティブ: 既定ではどこでもスポイラー
  "all|true|authoritative|nsfw": "expand_spoiler",
  "all|true|authoritative|sfw": "expand_spoiler",
  "all|true|authoritative|dm": "expand_spoiler",
  "all|true|inferred|nsfw": "expand_spoiler",
  "all|true|inferred|sfw": "expand_spoiler",
  "all|true|inferred|dm": "expand_spoiler",

  // R-18: 年齢制限チャンネルでのみスポイラー展開。それ以外はリンクのみ
  "r18|false|authoritative|nsfw": "expand_spoiler",
  "r18|false|authoritative|sfw": "link_only",
  "r18|false|authoritative|dm": "link_only",
  "r18|true|authoritative|nsfw": "expand_spoiler",
  "r18|true|authoritative|sfw": "link_only",
  "r18|true|authoritative|dm": "link_only",
  "r18|false|inferred|nsfw": "expand_spoiler",
  "r18|false|inferred|sfw": "link_only",
  "r18|false|inferred|dm": "link_only",
  "r18|true|inferred|nsfw": "expand_spoiler",
  "r18|true|inferred|sfw": "link_only",
  "r18|true|inferred|dm": "link_only",

  // R-18G も同じ
  "r18g|false|authoritative|nsfw": "expand_spoiler",
  "r18g|false|authoritative|sfw": "link_only",
  "r18g|false|authoritative|dm": "link_only",
  "r18g|true|authoritative|nsfw": "expand_spoiler",
  "r18g|true|authoritative|sfw": "link_only",
  "r18g|true|authoritative|dm": "link_only",
  "r18g|false|inferred|nsfw": "expand_spoiler",
  "r18g|false|inferred|sfw": "link_only",
  "r18g|false|inferred|dm": "link_only",
  "r18g|true|inferred|nsfw": "expand_spoiler",
  "r18g|true|inferred|sfw": "link_only",
  "r18g|true|inferred|dm": "link_only",

  // 判定不能: 区分が何であれ信用しない。年齢制限チャンネルでもリンクのみ、
  // 通常チャンネルと DM では無反応
  "all|false|unknown|nsfw": "link_only",
  "all|false|unknown|sfw": "skip",
  "all|false|unknown|dm": "skip",
  "all|true|unknown|nsfw": "link_only",
  "all|true|unknown|sfw": "skip",
  "all|true|unknown|dm": "skip",
  "r18|false|unknown|nsfw": "link_only",
  "r18|false|unknown|sfw": "skip",
  "r18|false|unknown|dm": "skip",
  "r18|true|unknown|nsfw": "link_only",
  "r18|true|unknown|sfw": "skip",
  "r18|true|unknown|dm": "skip",
  "r18g|false|unknown|nsfw": "link_only",
  "r18g|false|unknown|sfw": "skip",
  "r18g|false|unknown|dm": "skip",
  "r18g|true|unknown|nsfw": "link_only",
  "r18g|true|unknown|sfw": "skip",
  "r18g|true|unknown|dm": "skip",
};

const cases = LEVELS.flatMap((level) =>
  SENSITIVES.flatMap((sensitive) =>
    CONFIDENCES.flatMap((confidence) =>
      (Object.keys(CHANNELS) as ChannelKind[]).map((channel) => ({
        key: `${level}|${String(sensitive)}|${confidence}|${channel}`,
        level,
        sensitive,
        confidence,
        channel,
      })),
    ),
  ),
);

describe("decideExpansion — 全直積", () => {
  it("covers every combination exactly once", () => {
    expect(cases).toHaveLength(54);
    expect(Object.keys(EXPECTED)).toHaveLength(54);
    expect(new Set(cases.map((c) => c.key)).size).toBe(54);
  });

  it.each(cases)("$key", ({ key, level, sensitive, confidence, channel }) => {
    expect(decideExpansion(rating(level, sensitive, confidence), CHANNELS[channel])).toBe(
      EXPECTED[key],
    );
  });

  it("never expands media in a normal channel for restricted works", () => {
    // 網羅表とは独立した不変条件として書く。表を書き間違えても、これが守る。
    const leaked = cases
      .filter(({ level, confidence }) => level !== "all" || confidence === "unknown")
      .filter(({ level, sensitive, confidence }) =>
        showsMedia(decideExpansion(rating(level, sensitive, confidence), CHANNELS.sfw)),
      )
      .map(({ key }) => key);

    expect(leaked).toEqual([]);
  });

  it("never expands media anywhere when the rating is unverifiable", () => {
    for (const channel of Object.values(CHANNELS)) {
      for (const level of LEVELS) {
        const decision = decideExpansion(rating(level, false, "unknown"), channel);
        expect(showsMedia(decision)).toBe(false);
      }
    }
  });
});

describe("decideExpansion — オプション", () => {
  const r18 = rating("r18", false, "authoritative");
  const sensitive = rating("all", true, "authoritative");
  const unknown = rating("all", false, "unknown");

  it("can drop the spoiler inside age-restricted channels", () => {
    expect(decideExpansion(r18, CHANNELS.nsfw, { spoilerInNsfw: false })).toBe("expand_plain");
  });

  it("keeps r18 out of normal channels regardless of the spoiler option", () => {
    // スポイラー設定は「年齢制限チャンネルでの見せ方」であって、ゲートを緩めない。
    expect(decideExpansion(r18, CHANNELS.sfw, { spoilerInNsfw: false })).toBe("link_only");
  });

  it("honours SENSITIVE_IN_SFW", () => {
    expect(decideExpansion(sensitive, CHANNELS.sfw, { sensitiveInSfw: "link_only" })).toBe(
      "link_only",
    );
    expect(decideExpansion(sensitive, CHANNELS.sfw, { sensitiveInSfw: "skip" })).toBe("skip");
    expect(decideExpansion(sensitive, CHANNELS.sfw, { sensitiveInSfw: "spoiler" })).toBe(
      "expand_spoiler",
    );
  });

  it("honours UNKNOWN_RATING_SFW but never opens it up to expansion", () => {
    expect(decideExpansion(unknown, CHANNELS.sfw, { unknownRatingInSfw: "link_only" })).toBe(
      "link_only",
    );
    expect(decideExpansion(unknown, CHANNELS.sfw, { unknownRatingInSfw: "skip" })).toBe("skip");
  });

  it("can opt DMs into age-restricted behaviour", () => {
    expect(decideExpansion(r18, CHANNELS.dm, { allowNsfwInDm: true })).toBe("expand_spoiler");
    expect(decideExpansion(r18, CHANNELS.dm, { allowNsfwInDm: false })).toBe("link_only");
  });

  it("still refuses unverifiable ratings in opted-in DMs", () => {
    expect(decideExpansion(unknown, CHANNELS.dm, { allowNsfwInDm: true })).toBe("link_only");
  });
});

describe("filterByRating — 最近作のサムネイル単位ゲート", () => {
  const item = (level: RatingLevel, confidence: RatingConfidence = "authoritative") => ({
    id: `${level}-${confidence}`,
    rating: rating(level, false, confidence),
  });

  it("drops only the restricted thumbnails, not the whole card", () => {
    // ADR 0006: プロフィールが全年齢でも最近作に R-18 が混ざりうる。
    const items = [item("all"), item("r18"), item("all"), item("r18g")];
    const kept = filterByRating(items, CHANNELS.sfw);
    expect(kept.map((i) => i.id)).toEqual(["all-authoritative", "all-authoritative"]);
  });

  it("keeps restricted thumbnails in an age-restricted channel", () => {
    const items = [item("all"), item("r18")];
    expect(filterByRating(items, CHANNELS.nsfw)).toHaveLength(2);
  });

  it("drops thumbnails whose rating could not be verified", () => {
    const items = [item("all", "unknown"), item("all")];
    expect(filterByRating(items, CHANNELS.nsfw).map((i) => i.id)).toEqual(["all-authoritative"]);
  });

  it("returns an empty list rather than throwing on empty input", () => {
    expect(filterByRating([], CHANNELS.sfw)).toEqual([]);
  });
});

describe("decision helpers", () => {
  it("reports which decisions carry media", () => {
    expect(showsMedia("expand_plain")).toBe(true);
    expect(showsMedia("expand_spoiler")).toBe(true);
    expect(showsMedia("link_only")).toBe(false);
    expect(showsMedia("skip")).toBe(false);
  });

  it("reports which decisions require a spoiler", () => {
    expect(requiresSpoiler("expand_spoiler")).toBe(true);
    expect(requiresSpoiler("expand_plain")).toBe(false);
  });
});
