import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";

import { HEALTH_ENDPOINTS } from "#config/constants";

export interface DependencyHealth {
  connected: boolean;
}

export interface DiscordHealth extends DependencyHealth {
  guildCount: number;
  wsPing: number | null;
}

export interface HealthState {
  discord: DiscordHealth;
  redis?: DependencyHealth;
  authenticated: boolean;
  cacheSize?: number;
  circuits?: Readonly<Record<string, string>>;
}

export type HealthStateProvider = () => HealthState;
export type MetricsProvider = (state: HealthState) => string;

export function isReady(state: HealthState): boolean {
  return state.discord.connected && (state.redis?.connected ?? true);
}

export function defaultMetrics(state: HealthState): string {
  const ready = isReady(state) ? 1 : 0;
  const discordConnected = state.discord.connected ? 1 : 0;
  return [
    "# HELP rx_pixiv_ready Whether all required dependencies are ready.",
    "# TYPE rx_pixiv_ready gauge",
    `rx_pixiv_ready ${ready}`,
    "# HELP rx_pixiv_discord_connected Whether the Discord gateway is connected.",
    "# TYPE rx_pixiv_discord_connected gauge",
    `rx_pixiv_discord_connected ${discordConnected}`,
    "",
  ].join("\n");
}

export function createHealthApp(
  stateProvider: HealthStateProvider,
  metricsProvider: MetricsProvider = defaultMetrics,
): Hono {
  const app = new Hono();

  app.get(HEALTH_ENDPOINTS.liveness, (context) => context.json({ status: "ok" }));

  app.get(HEALTH_ENDPOINTS.readiness, (context) => {
    const ready = isReady(stateProvider());
    return context.json({ status: ready ? "ready" : "not_ready" }, ready ? 200 : 503);
  });

  app.get(HEALTH_ENDPOINTS.details, (context) => {
    const state = stateProvider();
    return context.json({
      status: isReady(state) ? "ready" : "degraded",
      uptimeSeconds: process.uptime(),
      ...state,
    });
  });

  app.get(HEALTH_ENDPOINTS.metrics, (context) => {
    return context.text(metricsProvider(stateProvider()), 200, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
    });
  });

  return app;
}

export class HealthServer {
  readonly app: Hono;
  #server: ServerType | undefined;

  public constructor(
    stateProvider: HealthStateProvider,
    private readonly port: number,
    metricsProvider: MetricsProvider = defaultMetrics,
  ) {
    this.app = createHealthApp(stateProvider, metricsProvider);
  }

  public start(): void {
    if (this.#server !== undefined) return;
    this.#server = serve({ fetch: this.app.fetch, hostname: "0.0.0.0", port: this.port });
  }

  public async stop(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    if (server === undefined) return;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      });
    });
  }
}
