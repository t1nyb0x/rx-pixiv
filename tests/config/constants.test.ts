import { describe, expect, it } from "vitest";

import { DISCORD_LIMITS, HEALTH_ENDPOINTS, NODE_TIMER_MAX_MS } from "#config/constants";

describe("constants", () => {
  it("keeps Discord hard limits separate from environment configuration", () => {
    expect(DISCORD_LIMITS).toEqual({ embedsPerMessage: 10, galleryItemsPerMessage: 10 });
    expect(HEALTH_ENDPOINTS.liveness).toBe("/healthz");
    expect(NODE_TIMER_MAX_MS).toBe(2_147_483_647);
  });
});
