import { z } from "zod";

import { PROCESSING_LIMITS } from "#config/constants";

const snowflake = z.string().regex(/^\d{17,20}$/, "must be a Discord snowflake");

const csv = z.string().transform((value) =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),
);

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");

const positiveInteger = z.coerce.number().int().positive();

const optionalSecret = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

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
    PXIMG_PROXY_BASE_URL: urlWithProtocol(["http:", "https:"]).default("https://phixiv.net/i"),
    REDIS_URL: urlWithProtocol(["redis:", "rediss:"]).default("redis://localhost:6379"),
    REDIS_DOWN_FALLBACK: z.enum(["deny", "allow"]).default("deny"),
    SOURCE_CHAIN: csv
      .pipe(z.array(z.enum(["ajax", "phixiv", "ogp"])).min(1))
      .default(["ajax", "phixiv", "ogp"]),
    RENDERER: z.enum(["components_v2", "embed"]).default("components_v2"),
    PIXIV_PHPSESSID: optionalSecret,
    HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(9090),
    MAX_URLS_PER_MESSAGE: positiveInteger.max(PROCESSING_LIMITS.urlsPerMessage).default(3),
    MAX_PAGES_DEFAULT: positiveInteger.max(PROCESSING_LIMITS.pagesPerWork).default(4),
    MAX_PAGES_HARD: positiveInteger.max(PROCESSING_LIMITS.pagesPerWork).default(10),
    USER_COOLDOWN_MS: positiveInteger.default(10_000),
    CHANNEL_COOLDOWN_MS: positiveInteger.default(5_000),
    SPOILER_IN_NSFW: booleanString.default(true),
    ALLOW_NSFW_IN_DM: booleanString.default(false),
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
