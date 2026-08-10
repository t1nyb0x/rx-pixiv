import { describe, expect, it } from "vitest";

import { NODE_TIMER_MAX_MS } from "#config/constants";
import { EnvValidationError, parseEnv } from "#config/env";

const required = {
  DISCORD_TOKEN: "discord-token",
  OWNER_USER_ID: "123456789012345678",
};

describe("parseEnv", () => {
  it("applies safe defaults", () => {
    const env = parseEnv(required);

    expect(env.PXIMG_PROXY_BASE_URL).toBe("https://phixiv.net/i");
    expect(env.REDIS_DOWN_FALLBACK).toBe("deny");
    expect(env.SOURCE_CHAIN).toEqual(["ajax", "phixiv", "ogp"]);
    expect(env.ALLOWED_GUILD_IDS).toEqual([]);
    expect(env.ALLOWED_CHANNEL_IDS).toEqual([]);
    expect(env.SOURCE_TIMEOUT_MS).toBe(3_000);
    expect(env.PIXIV_RPS).toBe(1);
    expect(env.CIRCUIT_FAILURE_THRESHOLD).toBe(5);
    expect(env.CIRCUIT_OPEN_MS).toBe(120_000);
    expect(env.SPOILER_IN_NSFW).toBe(true);
    expect(env.ALLOW_NSFW_IN_DM).toBe(false);
  });

  it("parses comma-separated allowlists and explicit booleans", () => {
    const env = parseEnv({
      ...required,
      ALLOWED_GUILD_IDS: "123456789012345678, 223456789012345678",
      ALLOWED_CHANNEL_IDS: "323456789012345678",
      SPOILER_IN_NSFW: "false",
      ALLOW_NSFW_IN_DM: "true",
    });

    expect(env.ALLOWED_GUILD_IDS).toEqual(["123456789012345678", "223456789012345678"]);
    expect(env.ALLOWED_CHANNEL_IDS).toEqual(["323456789012345678"]);
    expect(env.SPOILER_IN_NSFW).toBe(false);
    expect(env.ALLOW_NSFW_IN_DM).toBe(true);
  });

  it("aggregates missing and invalid variables without exposing values", () => {
    const error = captureError(() =>
      parseEnv({ DISCORD_TOKEN: "", OWNER_USER_ID: "secret-invalid-owner", HEALTH_PORT: "70000" }),
    );

    expect(error).toBeInstanceOf(EnvValidationError);
    expect(error.message).toContain("DISCORD_TOKEN");
    expect(error.message).toContain("OWNER_USER_ID");
    expect(error.message).not.toContain("secret-invalid-owner");
  });

  it("rejects malformed URLs and enum values", () => {
    expect(() =>
      parseEnv({ ...required, PXIMG_PROXY_BASE_URL: "not-a-url", REDIS_DOWN_FALLBACK: "maybe" }),
    ).toThrow(EnvValidationError);
  });

  it("restricts URL protocols and fixed processing limits", () => {
    expect(() => parseEnv({ ...required, PXIMG_PROXY_BASE_URL: "ftp://proxy.example/i" })).toThrow(
      EnvValidationError,
    );
    expect(() => parseEnv({ ...required, REDIS_URL: "https://redis.example" })).toThrow(
      EnvValidationError,
    );
    expect(() =>
      parseEnv({ ...required, PXIMG_PROXY_BASE_URL: "https://user:secret@proxy.example/i" }),
    ).toThrow(EnvValidationError);
    expect(() =>
      parseEnv({ ...required, PXIMG_PROXY_BASE_URL: "https://proxy.example/i?token=secret" }),
    ).toThrow(EnvValidationError);
    expect(() => parseEnv({ ...required, MAX_URLS_PER_MESSAGE: "4" })).toThrow(EnvValidationError);
    expect(() => parseEnv({ ...required, MAX_PAGES_HARD: "11" })).toThrow(EnvValidationError);
    expect(() => parseEnv({ ...required, MAX_PAGES_DEFAULT: "5", MAX_PAGES_HARD: "4" })).toThrow(
      EnvValidationError,
    );
  });

  it.each([
    { PIXIV_RPS: "0" },
    { PIXIV_RPS: "Infinity" },
    { SOURCE_TIMEOUT_MS: "0" },
    { CIRCUIT_FAILURE_THRESHOLD: "1.5" },
    { CIRCUIT_OPEN_MS: "-1" },
  ])("rejects invalid upstream protection settings: %o", (invalid) => {
    expect(() => parseEnv({ ...required, ...invalid })).toThrow(EnvValidationError);
  });

  it("accepts Node's timer boundary and rejects one millisecond beyond it", () => {
    expect(
      parseEnv({ ...required, SOURCE_TIMEOUT_MS: String(NODE_TIMER_MAX_MS) }).SOURCE_TIMEOUT_MS,
    ).toBe(NODE_TIMER_MAX_MS);
    expect(() =>
      parseEnv({ ...required, SOURCE_TIMEOUT_MS: String(NODE_TIMER_MAX_MS + 1) }),
    ).toThrow(EnvValidationError);
  });

  it("accepts processing limits at their exact boundaries", () => {
    const env = parseEnv({
      ...required,
      PXIMG_PROXY_BASE_URL: "http://proxy.internal/i",
      REDIS_URL: "rediss://redis.example:6380",
      MAX_URLS_PER_MESSAGE: "3",
      MAX_PAGES_DEFAULT: "10",
      MAX_PAGES_HARD: "10",
    });

    expect(env.MAX_URLS_PER_MESSAGE).toBe(3);
    expect(env.MAX_PAGES_DEFAULT).toBe(10);
    expect(env.MAX_PAGES_HARD).toBe(10);
  });
});

function captureError(action: () => unknown): Error {
  try {
    action();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("Expected action to throw");
}
