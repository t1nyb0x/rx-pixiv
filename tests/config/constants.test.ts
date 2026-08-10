import { describe, expect, it } from "vitest";

import { DISCORD_LIMITS, HEALTH_ENDPOINTS } from "#config/constants";

describe("constants", () => {
  it("keeps Discord hard limits separate from environment configuration", () => {
    expect(DISCORD_LIMITS).toEqual({ embedsPerMessage: 10, galleryItemsPerMessage: 10 });
    expect(HEALTH_ENDPOINTS.liveness).toBe("/healthz");
  });
});
