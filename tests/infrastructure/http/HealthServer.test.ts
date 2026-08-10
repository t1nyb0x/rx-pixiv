import { describe, expect, it } from "vitest";

import {
  createHealthApp,
  defaultMetrics,
  isReady,
  type HealthState,
} from "#infrastructure/http/HealthServer";

const readyState: HealthState = {
  discord: { connected: true, guildCount: 2, wsPing: 42 },
  authenticated: false,
};

describe("HealthServer", () => {
  it("always reports liveness", async () => {
    const app = createHealthApp(() => ({
      ...readyState,
      discord: { ...readyState.discord, connected: false },
    }));
    const response = await app.request("/healthz");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("reports readiness from injected Discord and Redis state", async () => {
    let state = readyState;
    const app = createHealthApp(() => state);

    expect((await app.request("/readyz")).status).toBe(200);
    state = { ...readyState, redis: { connected: false } };
    const response = await app.request("/readyz");
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "not_ready" });
  });

  it("returns detailed health without secrets", async () => {
    const app = createHealthApp(() => readyState);
    const response = await app.request("/health");
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.status).toBe("ready");
    expect(body.discord).toEqual(readyState.discord);
    expect(body).not.toHaveProperty("token");
  });

  it("serves Prometheus text from the metrics provider", async () => {
    const app = createHealthApp(() => readyState);
    const response = await app.request("/metrics");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toContain("rx_pixiv_ready 1");
  });

  it("treats Redis as optional until Plan 0011 injects it", () => {
    expect(isReady(readyState)).toBe(true);
    expect(isReady({ ...readyState, redis: { connected: true } })).toBe(true);
    expect(isReady({ ...readyState, redis: { connected: false } })).toBe(false);
    expect(defaultMetrics(readyState)).toContain("rx_pixiv_discord_connected 1");
  });
});
