import type { Client } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import { DiscordGuildAdmin } from "#adapters/discord/DiscordGuildAdmin";

function clientWithGuilds() {
  const leave = vi.fn<() => Promise<unknown>>(() => Promise.resolve({}));
  const guild = { id: "guild-1", name: "テストギルド", memberCount: 42, leave };
  const cache = new Map([[guild.id, guild]]);
  Object.defineProperty(cache, "map", {
    value: <T>(mapper: (value: typeof guild) => T) => [...cache.values()].map(mapper),
  });
  return { client: { guilds: { cache } } as unknown as Client, leave };
}

describe("DiscordGuildAdmin", () => {
  it("lists the guild summaries from the client cache", async () => {
    const { client } = clientWithGuilds();
    await expect(new DiscordGuildAdmin(client).listGuilds()).resolves.toEqual([
      { id: "guild-1", name: "テストギルド", memberCount: 42 },
    ]);
  });

  it("leaves a cached guild and reports a missing guild", async () => {
    const { client, leave } = clientWithGuilds();
    const admin = new DiscordGuildAdmin(client);

    await expect(admin.leaveGuild("guild-1")).resolves.toBe(true);
    expect(leave).toHaveBeenCalledOnce();
    await expect(admin.leaveGuild("missing")).resolves.toBe(false);
  });
});
