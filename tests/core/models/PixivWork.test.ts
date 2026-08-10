import { describe, expect, expectTypeOf, it } from "vitest";

import type { RatingConfidence } from "#core/models/ContentRating";
import { pixivRefKey, type PixivRef } from "#core/models/PixivRef";
import type { PixivWork } from "#core/models/PixivWork";

describe("domain model unions", () => {
  it("defines exactly three rating confidence values", () => {
    expectTypeOf<RatingConfidence>().toEqualTypeOf<"authoritative" | "inferred" | "unknown">();
  });

  it.each([
    [{ kind: "artwork", id: "1", canonicalUrl: "https://www.pixiv.net/artworks/1" }, "artwork:1"],
    [
      { kind: "shortlink", name: "alice", canonicalUrl: "https://pixiv.me/alice" },
      "shortlink:alice",
    ],
  ] satisfies ReadonlyArray<readonly [PixivRef, string]>)(
    "creates a stable key for $0.kind",
    (ref, expected) => {
      expect(pixivRefKey(ref)).toBe(expected);
    },
  );

  it("keeps work and illustration variants exhaustively distinguishable", () => {
    const variants: ReadonlyArray<readonly [PixivWork, string]> = [
      [work({ kind: "illust", illustType: "illust" }), "illust"],
      [work({ kind: "illust", illustType: "manga" }), "manga"],
      [work({ kind: "illust", illustType: "ugoira" }), "ugoira"],
      [work({ kind: "novel" }), "novel"],
      [work({ kind: "novel_series" }), "novel_series"],
      [work({ kind: "user" }), "user"],
    ];

    expect(variants.map(([value]) => classify(value))).toEqual(variants.map(([, label]) => label));
  });
});

function classify(value: PixivWork): string {
  switch (value.kind) {
    case "illust":
      switch (value.illustType) {
        case "illust":
        case "manga":
        case "ugoira":
          return value.illustType;
        default:
          return assertNever(value.illustType);
      }
    case "novel":
      return "novel";
    case "novel_series":
      return "novel_series";
    case "user":
      return "user";
    default:
      return assertNever(value);
  }
}

function work(
  variant:
    | { readonly kind: "illust"; readonly illustType: "illust" | "manga" | "ugoira" }
    | { readonly kind: "novel" }
    | { readonly kind: "novel_series" }
    | { readonly kind: "user" },
): PixivWork {
  const base = {
    id: "1",
    canonicalUrl: "https://www.pixiv.net/artworks/1",
    title: "title",
    author: { id: "2", name: "author", url: "https://www.pixiv.net/users/2" },
    rating: {
      level: "all" as const,
      sensitive: false,
      ai: "no" as const,
      confidence: "authoritative" as const,
    },
    source: "ajax" as const,
    fetchedAt: 0,
    partial: false,
  };

  switch (variant.kind) {
    case "illust":
      return {
        ...base,
        kind: "illust",
        illustType: variant.illustType,
        pageCount: 1,
        pages: [],
        pagesTruncated: false,
        tags: [],
      };
    case "novel":
      return { ...base, kind: "novel", tags: [] };
    case "novel_series":
      return { ...base, kind: "novel_series" };
    case "user":
      return { ...base, kind: "user", recentWorks: [] };
    default:
      return assertNever(variant);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected variant: ${String(value)}`);
}
