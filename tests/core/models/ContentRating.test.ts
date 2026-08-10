import { describe, expect, it } from "vitest";

import type { ContentRating } from "#core/models/ContentRating";
import { escalateRating } from "#core/models/ContentRating";

const rating = (over: Partial<ContentRating> = {}): ContentRating => ({
  level: "all",
  sensitive: false,
  ai: "unknown",
  confidence: "unknown",
  ...over,
});

describe("escalateRating", () => {
  it("raises the level when the incoming rating is stricter", () => {
    expect(escalateRating(rating(), { level: "r18", confidence: "inferred" }).level).toBe("r18");
    expect(escalateRating(rating({ level: "r18" }), { level: "r18g" }).level).toBe("r18g");
  });

  it("never loosens the level — this is the fallback chain's safety property", () => {
    // ADR 0003 / ADR 0006: 後段が all を返しても前段の r18 を覆せない。
    // これを許すとフォールバックが年齢ゲートの抜け道になる。
    const current = rating({ level: "r18", confidence: "inferred" });
    expect(escalateRating(current, { level: "all", confidence: "authoritative" }).level).toBe(
      "r18",
    );
    expect(escalateRating(rating({ level: "r18g" }), { level: "r18" }).level).toBe("r18g");
  });

  it("keeps the better confidence available", () => {
    const promoted = escalateRating(rating({ level: "r18", confidence: "inferred" }), {
      level: "all",
      confidence: "authoritative",
    });
    expect(promoted.confidence).toBe("authoritative");

    const stricter = escalateRating(rating({ confidence: "authoritative" }), {
      level: "r18",
      confidence: "inferred",
    });
    expect(stricter).toMatchObject({ level: "r18", confidence: "authoritative" });
  });

  it("never turns sensitive back off", () => {
    expect(escalateRating(rating({ sensitive: true }), { sensitive: false }).sensitive).toBe(true);
    expect(escalateRating(rating(), { sensitive: true }).sensitive).toBe(true);
  });

  it("fills ai only when currently unknown", () => {
    expect(escalateRating(rating({ ai: "unknown" }), { ai: "yes" }).ai).toBe("yes");
    expect(escalateRating(rating({ ai: "no" }), { ai: "yes" }).ai).toBe("no");
  });

  it("is a no-op for an empty incoming rating", () => {
    const current = rating({ level: "r18", confidence: "authoritative", ai: "yes" });
    expect(escalateRating(current, {})).toEqual(current);
  });
});
