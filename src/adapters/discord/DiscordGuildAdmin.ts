import type { Client } from "discord.js";

import type { GuildSummary, IGuildAdmin } from "#core/ports/IGuildAdmin";

export class DiscordGuildAdmin implements IGuildAdmin {
  public constructor(private readonly client: Client) {}

  public listGuilds(): Promise<readonly GuildSummary[]> {
    return Promise.resolve(
      this.client.guilds.cache.map((guild) => ({
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount,
      })),
    );
  }

  public async leaveGuild(guildId: string): Promise<boolean> {
    const guild = this.client.guilds.cache.get(guildId);
    if (guild === undefined) return false;
    await guild.leave();
    return true;
  }
}
