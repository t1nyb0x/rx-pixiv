import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockAgent } from "undici";

import { HttpClient } from "#infrastructure/http/HttpClient";
import { RateLimiter } from "#infrastructure/http/RateLimiter";

describe("HttpClient", () => {
  let mockAgent: MockAgent;

  beforeEach(() => {
    vi.useFakeTimers();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await mockAgent.close();
  });

  it("sets the User-Agent and returns response data", async () => {
    const pool = mockAgent.get("https://example.test");
    pool
      .intercept({
        path: "/work",
        method: "GET",
        headers: { "user-agent": "rx-pixiv/test", accept: "application/json" },
      })
      .reply(200, '{"ok":true}', { headers: { "content-type": "application/json" } });
    const client = createClient();

    const result = await client.request(
      request("https://example.test/work", { accept: "application/json" }),
    );

    expect(result).toEqual({
      ok: true,
      value: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: '{"ok":true}',
      },
    });
  });

  it("aborts a slow request at the configured timeout without retrying", async () => {
    const pool = mockAgent.get("https://example.test");
    pool.intercept({ path: "/slow" }).reply(200, "late").delay(1_000);
    const client = createClient({ timeoutMs: 50 });

    const pending = client.request(request("https://example.test/slow"));
    await vi.advanceTimersByTimeAsync(50);

    await expect(pending).resolves.toEqual({ ok: false, error: { kind: "timeout" } });
  });

  it.each(["network", "upstream_5xx"] as const)(
    "retries %s exactly once after the configured delay",
    async (failure) => {
      const pool = mockAgent.get("https://example.test");
      const first = pool.intercept({ path: `/retry-${failure}` });
      if (failure === "network") first.replyWithError(new Error("socket reset"));
      else first.reply(503, "down");
      pool.intercept({ path: `/retry-${failure}` }).reply(200, "recovered");
      const client = createClient({ retryDelayMs: 250 });

      const pending = client.request(request(`https://example.test/retry-${failure}`));
      await vi.advanceTimersByTimeAsync(249);
      expect(mockAgent.pendingInterceptors()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);

      await expect(pending).resolves.toMatchObject({ ok: true, value: { body: "recovered" } });
      expect(mockAgent.pendingInterceptors()).toHaveLength(0);
    },
  );

  it("returns the second retryable failure after exactly two attempts", async () => {
    const pool = mockAgent.get("https://example.test");
    pool.intercept({ path: "/twice" }).reply(500, "first");
    pool.intercept({ path: "/twice" }).reply(502, "second");
    const client = createClient({ retryDelayMs: 250 });

    const pending = client.request(request("https://example.test/twice"));
    await vi.advanceTimersByTimeAsync(250);

    await expect(pending).resolves.toEqual({
      ok: false,
      error: { kind: "upstream_5xx", status: 502 },
    });
  });

  it("does not retry 429 and parses Retry-After", async () => {
    const pool = mockAgent.get("https://example.test");
    pool.intercept({ path: "/limited" }).reply(429, "slow down", {
      headers: { "retry-after": "2" },
    });
    const client = createClient();

    await expect(client.request(request("https://example.test/limited"))).resolves.toEqual({
      ok: false,
      error: { kind: "rate_limited", retryAfterMs: 2_000 },
    });
  });

  it("rate limits every physical retry attempt", async () => {
    const pool = mockAgent.get("https://www.pixiv.net");
    pool.intercept({ path: "/ajax/illust/1" }).reply(503, "down");
    pool.intercept({ path: "/ajax/illust/1" }).reply(200, "recovered");
    const client = new HttpClient({
      dispatcher: mockAgent,
      timeoutMs: 3_000,
      retryDelayMs: 0,
      jitterMs: () => 0,
      rateLimiter: new RateLimiter({
        "www.pixiv.net": { requestsPerSecond: 1, burst: 1 },
      }),
    });

    const pending = client.request(request("https://www.pixiv.net/ajax/illust/1"));
    await vi.advanceTimersByTimeAsync(999);
    expect(mockAgent.pendingInterceptors()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toMatchObject({ ok: true, value: { body: "recovered" } });
  });

  it("constructs timeout and protection settings from parsed environment", async () => {
    const pool = mockAgent.get("https://example.test");
    pool.intercept({ path: "/env-timeout" }).reply(200, "late").delay(100);
    const client = HttpClient.fromEnv(
      {
        SOURCE_TIMEOUT_MS: 10,
        PIXIV_RPS: 1,
      },
      { dispatcher: mockAgent, jitterMs: () => 0 },
    );

    const pending = client.request(request("https://example.test/env-timeout"));
    await vi.advanceTimersByTimeAsync(10);

    await expect(pending).resolves.toEqual({ ok: false, error: { kind: "timeout" } });
  });

  it("does not retry 404 or source-specific 4xx responses", async () => {
    const pool = mockAgent.get("https://example.test");
    pool.intercept({ path: "/missing" }).reply(404, "missing");
    pool.intercept({ path: "/auth-shape" }).reply(403, '{"error":"restricted"}');
    const client = createClient();

    await expect(client.request(request("https://example.test/missing"))).resolves.toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
    await expect(client.request(request("https://example.test/auth-shape"))).resolves.toMatchObject(
      {
        ok: true,
        value: { status: 403, body: "" },
      },
    );
  });

  it("preserves an auth-required status even when the declared body is oversized", async () => {
    const pool = mockAgent.get("https://example.test");
    pool.intercept({ path: "/auth-large" }).reply(403, "restricted", {
      headers: { "content-length": "999" },
    });
    const client = createClient({ maxBodyBytes: 5 });

    await expect(client.request(request("https://example.test/auth-large"))).resolves.toMatchObject(
      {
        ok: true,
        value: { status: 403, body: "" },
      },
    );
  });

  it("rejects response bodies that exceed the configured byte limit", async () => {
    const pool = mockAgent.get("https://example.test");
    pool.intercept({ path: "/too-large" }).reply(200, "123456");
    const client = createClient({ maxBodyBytes: 5 });

    await expect(client.request(request("https://example.test/too-large"))).resolves.toEqual({
      ok: false,
      error: { kind: "parse_error", sample: "response body exceeds size limit" },
    });
  });

  it("rejects an oversized Content-Length before buffering the body", async () => {
    const pool = mockAgent.get("https://example.test");
    pool.intercept({ path: "/declared-large" }).reply(200, "x", {
      headers: { "content-length": "999" },
    });
    const client = createClient({ maxBodyBytes: 5 });

    await expect(client.request(request("https://example.test/declared-large"))).resolves.toEqual({
      ok: false,
      error: { kind: "parse_error", sample: "response body exceeds size limit" },
    });
  });

  it("returns an error Result for an invalid request URL", async () => {
    const client = createClient();

    await expect(client.request(request("not a URL"))).resolves.toEqual({
      ok: false,
      error: { kind: "network", cause: "invalid request URL" },
    });
  });

  it("stops a retry delay when the caller aborts", async () => {
    const pool = mockAgent.get("https://example.test");
    pool.intercept({ path: "/abort-retry" }).replyWithError(new Error("offline"));
    const controller = new AbortController();
    const client = createClient();

    const pending = client.request({
      ...request("https://example.test/abort-retry"),
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();

    await expect(pending).resolves.toEqual({ ok: false, error: { kind: "timeout" } });
  });

  function createClient(
    overrides: { timeoutMs?: number; retryDelayMs?: number; maxBodyBytes?: number } = {},
  ): HttpClient {
    return new HttpClient({
      dispatcher: mockAgent,
      userAgent: "rx-pixiv/test",
      timeoutMs: overrides.timeoutMs ?? 3_000,
      retryDelayMs: overrides.retryDelayMs ?? 250,
      jitterMs: () => 0,
      ...(overrides.maxBodyBytes === undefined ? {} : { maxBodyBytes: overrides.maxBodyBytes }),
    });
  }
});

function request(url: string, headers?: Readonly<Record<string, string>>) {
  const base = { url, signal: new AbortController().signal } as const;
  return headers === undefined ? base : { ...base, headers };
}
