import { Client, Events, GatewayIntentBits, Partials, type Message } from "discord.js";

import { ComponentsV2Renderer } from "#adapters/discord/ComponentsV2Renderer";
import { DiscordGuildAdmin } from "#adapters/discord/DiscordGuildAdmin";
import { EmbedRenderer } from "#adapters/discord/EmbedRenderer";
import { MessageHandler } from "#adapters/discord/MessageHandler";
import { OwnerCommandHandler } from "#adapters/discord/OwnerCommandHandler";
import { ReplyTracker } from "#adapters/discord/replyTracker";
import { AjaxPixivSource } from "#adapters/pixiv/AjaxPixivSource";
import { ImageUrlRewriter } from "#adapters/pixiv/ImageUrlRewriter";
import { OgpScrapeSource } from "#adapters/pixiv/OgpScrapeSource";
import { PhixivSource } from "#adapters/pixiv/PhixivSource";
import { PixivSourceChain } from "#adapters/pixiv/PixivSourceChain";
import { ShortlinkResolver } from "#adapters/pixiv/shortlink";
import { EnvValidationError, parseEnv } from "#config/env";
import { AccessGate } from "#core/services/AccessGate";
import { OwnerCommandService } from "#core/services/OwnerCommandService";
import { WorkResolver } from "#core/services/WorkResolver";
import { WorkCache } from "#infrastructure/cache/WorkCache";
import { CircuitProtectedSource } from "#infrastructure/http/CircuitProtectedSource";
import { HealthServer, type HealthState } from "#infrastructure/http/HealthServer";
import { HttpClient } from "#infrastructure/http/HttpClient";
import {
  RedisBanRepository,
  RedisBlockRepository,
  RedisCooldownStore,
  RedisReplyRepository,
} from "#infrastructure/redis/RedisRepositories";
import { RedisConnection } from "#infrastructure/redis/client";
import { RedisPreloader } from "#infrastructure/redis/RedisPreloader";
import { createLogger } from "#utils/logger";

const env = (() => {
  try {
    return parseEnv(process.env);
  } catch (error) {
    const message =
      error instanceof EnvValidationError ? error.message : "Unable to read environment";
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
})();

const logger = createLogger({
  level: env.LOG_LEVEL,
  development: env.NODE_ENV === "development",
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const redis = new RedisConnection({
  url: env.REDIS_URL,
  onError: (error) => logger.warn({ err: error }, "Redis connection error"),
});
const bans = new RedisBanRepository(redis.client);
const blocks = new RedisBlockRepository(redis.client);
const cooldowns = new RedisCooldownStore(redis.client);
const replies = new RedisReplyRepository(redis.client);
const redisPreloader = new RedisPreloader({
  repositories: [bans, blocks],
  onSuccess: () => logger.info("Redis ban/block state preloaded"),
  onError: (error) =>
    logger.error({ err: error }, "Redis preload failed; access gate remains closed"),
});

redis.client.on("ready", () => void redisPreloader.preload());
redis.client.on("reconnecting", () => redisPreloader.markDisconnected());
redis.client.on("end", () => redisPreloader.markDisconnected());

const workCache = new WorkCache();
const accessGate = new AccessGate({
  banRepository: bans,
  blockRepository: blocks,
  cooldowns,
  allowedGuildIds: env.ALLOWED_GUILD_IDS,
  allowedChannelIds: env.ALLOWED_CHANNEL_IDS,
  userCooldownMs: env.USER_COOLDOWN_MS,
  channelCooldownMs: env.CHANNEL_COOLDOWN_MS,
  allowWhenStoreUnavailable: env.REDIS_DOWN_FALLBACK === "allow",
  ownerUserId: env.OWNER_USER_ID,
  storeAvailable: () => redis.isReady && redisPreloader.isReady,
});

const httpClient = HttpClient.fromEnv(env);
const protectedSources = {
  ajax: CircuitProtectedSource.fromEnv(new AjaxPixivSource({ httpClient }), env),
  phixiv: CircuitProtectedSource.fromEnv(
    new PhixivSource({ httpClient, baseUrl: env.PHIXIV_BASE_URL }),
    env,
  ),
  ogp: CircuitProtectedSource.fromEnv(new OgpScrapeSource({ httpClient }), env),
};
const sourceChain = new PixivSourceChain({
  sources: env.SOURCE_CHAIN.map((name) => protectedSources[name]),
  sourceTimeoutMs: {
    ajax: env.SOURCE_TIMEOUT_MS,
    phixiv: env.SOURCE_TIMEOUT_MS,
    ogp: Math.min(env.SOURCE_TIMEOUT_MS, 2_500),
  },
});
const workResolver = new WorkResolver({
  source: sourceChain,
  cache: workCache,
  shortlinkResolver: new ShortlinkResolver({ httpClient }),
  totalBudgetMs: env.FETCH_TOTAL_BUDGET_MS,
  beforeFetch: async (ref) => !(await accessGate.isBlocked(ref)),
});
const imageRewriter = new ImageUrlRewriter({ proxyBaseUrl: env.PXIMG_PROXY_BASE_URL });
const renderer =
  env.RENDERER === "components_v2" ? new ComponentsV2Renderer() : new EmbedRenderer();
const replyTracker = new ReplyTracker(replies);
const ownerCommands = new OwnerCommandHandler(
  new OwnerCommandService({
    ownerUserId: env.OWNER_USER_ID,
    banRepository: bans,
    blockRepository: blocks,
    guildAdmin: new DiscordGuildAdmin(client),
    status: () => ({
      redisReady: redis.isReady && redisPreloader.isReady,
      authenticated: false,
      guildCount: client.guilds.cache.size,
      cacheSize: workCache.size,
    }),
  }),
  replyTracker,
);
const messageHandler = new MessageHandler({
  accessGate,
  ownerCommands,
  workResolver,
  imageRewriter,
  renderer,
  logger,
  replyTracker,
  nsfwPolicy: {
    spoilerInNsfw: env.SPOILER_IN_NSFW,
    sensitiveInSfw: env.SENSITIVE_IN_SFW,
    unknownRatingInSfw: env.UNKNOWN_RATING_SFW,
    allowNsfwInDm: env.ALLOW_NSFW_IN_DM,
  },
  maxUrls: env.MAX_URLS_PER_MESSAGE,
  maxPages: env.MAX_PAGES_DEFAULT,
  hardPageLimit: env.MAX_PAGES_HARD,
  variantPreference: env.IMAGE_VARIANT_PREFERENCE,
});

const healthState = (): HealthState => ({
  discord: {
    connected: client.isReady(),
    guildCount: client.guilds.cache.size,
    wsPing: client.isReady() ? client.ws.ping : null,
  },
  redis: { connected: redis.isReady && redisPreloader.isReady },
  authenticated: false,
  cacheSize: workCache.size,
  circuits: Object.fromEntries(
    Object.entries(protectedSources).map(([name, source]) => [name, source.breaker.state]),
  ),
});

const healthServer = new HealthServer(healthState, env.HEALTH_PORT);
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down");
  const forceExitTimer = setTimeout(() => {
    logger.fatal({ signal }, "Graceful shutdown timed out");
    process.exit(1);
  }, 5_000);
  forceExitTimer.unref();

  try {
    client.destroy();
    await Promise.all([healthServer.stop(), httpClient.close(), redis.close()]);
    clearTimeout(forceExitTimer);
    process.exit(0);
  } catch (error) {
    clearTimeout(forceExitTimer);
    logger.fatal({ err: error, signal }, "Graceful shutdown failed");
    process.exit(1);
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (error) => {
  logger.fatal({ err: error }, "Unhandled promise rejection");
});
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception");
  process.exit(1);
});

client.once(Events.ClientReady, (readyClient) => {
  logger.info(
    { userId: readyClient.user.id, guildCount: readyClient.guilds.cache.size },
    "Discord client ready",
  );
});
client.on(Events.MessageCreate, (message) => void messageHandler.handle(message));
client.on(Events.MessageDelete, (message) => void handleMessageDelete(message));

async function handleMessageDelete(message: Message | { id: string; channel: Message["channel"] }) {
  const channel = message.channel;
  if (!channel.isTextBased()) return;
  try {
    await replyTracker.handleDelete(message.id, async (replyId) => {
      await channel.messages.delete(replyId);
    });
  } catch (error) {
    logger.warn({ err: error, messageId: message.id }, "Unable to delete tracked reply");
  }
}

healthServer.start();
await redis.connect();
if (redis.isReady) await redisPreloader.preload();

try {
  await client.login(env.DISCORD_TOKEN);
} catch (error) {
  logger.fatal({ err: error }, "Discord login failed");
  await Promise.all([healthServer.stop(), httpClient.close(), redis.close()]);
  process.exit(1);
}
