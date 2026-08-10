export interface GuildSummary {
  readonly id: string;
  readonly name: string;
  readonly memberCount?: number;
}

/**
 * 管理コマンドが必要とする Discord 側の操作。
 *
 * これをポートにしておくことで、コマンドの実行結果を
 * discord.js 抜きでテストできる（ADR 0015 の「薄い層にする」）。
 */
export interface IGuildAdmin {
  listGuilds(): Promise<readonly GuildSummary[]>;
  /** 離脱できたら true。該当ギルドが無ければ false。 */
  leaveGuild(guildId: string): Promise<boolean>;
}
