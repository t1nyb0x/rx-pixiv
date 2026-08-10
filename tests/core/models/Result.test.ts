import { describe, expect, it } from "vitest";

import { err, ok } from "#core/models/Result";

describe("Result", () => {
  it("constructs distinguishable success and failure values", () => {
    const success = ok({ id: "1" });
    const failure = err({ kind: "not_found" as const });

    expect(success).toEqual({ ok: true, value: { id: "1" } });
    expect(failure).toEqual({ ok: false, error: { kind: "not_found" } });
  });
});
