import { z } from "zod";

import { NODE_TIMER_MAX_MS, PROCESSING_LIMITS } from "#config/constants";

const snowflake = z.string().regex(/^\d{17,20}$/, "must be a Discord snowflake");

const csv = z.string().transform((value) =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),
);

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");

const positiveInteger = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const timerDuration = positiveInteger.max(NODE_TIMER_MAX_MS);
const positiveNumber = z.coerce.number().positive().finite();

const urlWithProtocol = (protocols: readonly string[]) =>
  z.url().refine(
    (value) => {
      try {
        return protocols.includes(new URL(value).protocol);
      } catch {
        return false;
      }
    },
    { message: `must use ${protocols.join(" or ")}` },
  );

const outputBaseUrl = urlWithProtocol(["http:", "https:"]).refine(
  (value) => {
    try {
      const url = new URL(value);
      return url.username === "" && url.password === "" && url.search === "" && url.hash === "";
    } catch {
      return false;
    }
  },
  { message: "must not contain credentials, query, or fragment" },
);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    DISCORD_TOKEN: z.string().trim().min(1, "is required"),
    OWNER_USER_ID: snowflake,
    ALLOWED_GUILD_IDS: csv.pipe(z.array(snowflake)).default([]),
    ALLOWED_CHANNEL_IDS: csv.pipe(z.array(snowflake)).default([]),
    PXIMG_PROXY_BASE_URL: outputBaseUrl.default("https://phixiv.net/i"),
    REDIS_URL: urlWithProtocol(["redis:", "rediss:"]).default("redis://localhost:6379"),
    REDIS_DOWN_FALLBACK: z.enum(["deny", "allow"]).default("deny"),
    SOURCE_CHAIN: csv
      .pipe(z.array(z.enum(["ajax", "phixiv", "ogp"])).min(1))
      .default(["ajax", "phixiv", "ogp"]),
    RENDERER: z.enum(["components_v2", "embed"]).default("components_v2"),
    HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(9090),
    MAX_URLS_PER_MESSAGE: positiveInteger.max(PROCESSING_LIMITS.urlsPerMessage).default(3),
    MAX_PAGES_DEFAULT: positiveInteger.max(PROCESSING_LIMITS.pagesPerWork).default(4),
    MAX_PAGES_HARD: positiveInteger.max(PROCESSING_LIMITS.pagesPerWork).default(10),
    SOURCE_TIMEOUT_MS: timerDuration.default(3_000),
    PIXIV_RPS: positiveNumber.default(1),
    CIRCUIT_FAILURE_THRESHOLD: positiveInteger.default(5),
    CIRCUIT_OPEN_MS: timerDuration.default(120_000),
    USER_COOLDOWN_MS: positiveInteger.default(10_000),
    CHANNEL_COOLDOWN_MS: positiveInteger.default(5_000),
    SPOILER_IN_NSFW: booleanString.default(true),
    ALLOW_NSFW_IN_DM: booleanString.default(false),
    SENSITIVE_IN_SFW: z.enum(["spoiler", "link_only", "skip"]).default("spoiler"),
    UNKNOWN_RATING_SFW: z.enum(["skip", "link_only"]).default("skip"),
    IMAGE_VARIANT_PREFERENCE: csv
      .pipe(z.array(z.enum(["regular", "small", "thumb"])).min(1))
      .default(["regular", "small", "thumb"]),
    FETCH_TOTAL_BUDGET_MS: timerDuration.default(8_000),
    PHIXIV_BASE_URL: urlWithProtocol(["http:", "https:"]).default("https://phixiv.net"),
  })
  .superRefine((env, context) => {
    if (env.MAX_PAGES_DEFAULT > env.MAX_PAGES_HARD) {
      context.addIssue({
        code: "custom",
        path: ["MAX_PAGES_DEFAULT"],
        message: "must not exceed MAX_PAGES_HARD",
      });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  public constructor(public readonly issues: z.core.$ZodIssue[]) {
    const details = issues.map((issue) => `- ${issue.path.join(".")}: ${issue.message}`).join("\n");
    super(`Invalid environment variables:\n${details}`);
    this.name = "EnvValidationError";
  }
}

export function parseEnv(input: NodeJS.ProcessEnv | Record<string, string | undefined>): AppEnv {
  const result = envSchema.safeParse(input);
  if (!result.success) {
    throw new EnvValidationError(result.error.issues);
  }
  return result.data;
}
