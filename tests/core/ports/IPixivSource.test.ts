import { describe, expect, expectTypeOf, it } from "vitest";

import type { SourceCapabilities } from "#core/ports/IPixivSource";

describe("SourceCapabilities", () => {
  it("declares supported kinds, rating authority, and multi-page support", () => {
    expectTypeOf<SourceCapabilities["ratingAuthority"]>().toEqualTypeOf<
      "authoritative" | "inferred" | "unknown"
    >();
    expectTypeOf<SourceCapabilities["multiPage"]>().toEqualTypeOf<boolean>();

    const capabilities = {
      supportedKinds: ["artwork", "novel"],
      ratingAuthority: "authoritative",
      multiPage: true,
    } as const satisfies SourceCapabilities;

    expect(capabilities.supportedKinds).toEqual(["artwork", "novel"]);
    expectTypeOf(capabilities.ratingAuthority).toEqualTypeOf<"authoritative">();
    expect(capabilities.multiPage).toBe(true);
  });
});
