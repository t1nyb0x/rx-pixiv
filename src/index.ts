import { Client, Events, GatewayIntentBits } from "discord.js";

import { EnvValidationError, parseEnv } from "#config/env";
import { HealthServer, type HealthState } from "#infrastructure/http/HealthServer";
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
    GatewayIntentBits.MessageContent,
  ],
});

const healthState = (): HealthState => ({
  discord: {
    connected: client.isReady(),
    guildCount: client.guilds.cache.size,
    wsPing: client.isReady() ? client.ws.ping : null,
  },
  // v1 does not accept or send a Pixiv session credential (ADR 0007).
  authenticated: false,
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
    await healthServer.stop();
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

healthServer.start();

try {
  await client.login(env.DISCORD_TOKEN);
} catch (error) {
  logger.fatal({ err: error }, "Discord login failed");
  await healthServer.stop();
  process.exit(1);
}
