import { describe, expect, it } from "vitest";

import { RedisConnection } from "#infrastructure/redis/client";

describe("RedisConnection", () => {
  it("does not throw when the server is unreachable — startup must continue", async () => {
    // ADR 0016: Redis に繋がらなくても Bot は起動する。
    // 繋がらないことはゲートのフェイルクローズと /readyz で表現する。
    const errors: unknown[] = [];
    const connection = new RedisConnection({
      url: "redis://127.0.0.1:1",
      connectTimeoutMs: 200,
      reconnectDelayMs: 60_000,
      onError: (error) => errors.push(error),
    });

    const connected = await connection.connect();

    expect(connected).toBe(false);
    expect(connection.isReady).toBe(false);
    await connection.close();
  }, 10_000);

  it("closes cleanly even when it never connected", async () => {
    const connection = new RedisConnection({
      url: "redis://127.0.0.1:1",
      connectTimeoutMs: 200,
      reconnectDelayMs: 60_000,
      onError: () => undefined,
    });
    await expect(connection.close()).resolves.toBeUndefined();
  }, 10_000);

  it("exposes the underlying client for the repositories", () => {
    const connection = new RedisConnection({
      url: "redis://127.0.0.1:1",
      onError: () => undefined,
    });
    expect(connection.client).toBeDefined();
  });
});
