import type { IBanRepository } from "#core/ports/IBanRepository";
import type { IBlockRepository } from "#core/ports/IBlockRepository";
import type { IGuildAdmin } from "#core/ports/IGuildAdmin";
import { chunkForDiscord, parseOwnerCommand, type OwnerCommand } from "#core/services/ownerCommand";

export interface StatusSnapshot {
  readonly redisReady: boolean;
  readonly authenticated: boolean;
  readonly guildCount: number;
  readonly cacheSize: number;
}

export interface OwnerCommandServiceOptions {
  readonly ownerUserId: string;
  readonly banRepository: IBanRepository;
  readonly blockRepository: IBlockRepository;
  readonly guildAdmin: IGuildAdmin;
  readonly status?: () => Promise<StatusSnapshot> | StatusSnapshot;
  readonly now?: () => Date;
}

const HELP = [
  "**管理コマンド**（オーナーとの DM でのみ動作）",
  "`!owner/guilds` 導入サーバー一覧",
  "`!owner/leave <guildId>` サーバーから離脱",
  "`!owner/ban <userId> [理由]` / `!owner/unban <userId>`",
  "`!owner/ban-guild <guildId> [理由]` / `!owner/unban-guild <guildId>`",
  "`!owner/list-bans` 禁止一覧",
  "`!owner/block <作品ID|user:<pixivユーザーID>> [理由]` 展開拒否（削除要請の受け皿）",
  "`!owner/unblock <同上>` / `!owner/list-blocks`",
  "`!owner/status` 稼働状況",
].join("\n");

/**
 * 管理コマンドを実行し、返信本文を作る（ADR 0015）。
 *
 * **discord.js に依存しない。** 実行者の確認・DM 判定・実際の送信は
 * アダプタ層が行い、ここは「何をして何を返すか」だけを持つ。
 */
export class OwnerCommandService {
  readonly #ownerUserId: string;
  readonly #bans: IBanRepository;
  readonly #blocks: IBlockRepository;
  readonly #guilds: IGuildAdmin;
  readonly #status: (() => Promise<StatusSnapshot> | StatusSnapshot) | undefined;
  readonly #now: () => Date;

  public constructor(options: OwnerCommandServiceOptions) {
    this.#ownerUserId = options.ownerUserId;
    this.#bans = options.banRepository;
    this.#blocks = options.blockRepository;
    this.#guilds = options.guildAdmin;
    this.#status = options.status;
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * 実行して返信本文を返す。
   *
   * - コマンドでない → `undefined`（**無反応**）
   * - 実行者がオーナーでない → `undefined`（**無反応**。存在も明かさない）
   */
  public async handle(input: {
    readonly authorId: string;
    readonly isDm: boolean;
    readonly content: string;
  }): Promise<readonly string[] | undefined> {
    if (!input.isDm) return undefined;
    if (input.authorId !== this.#ownerUserId) return undefined;

    const parsed = parseOwnerCommand(input.content);
    if (parsed === undefined) return undefined;
    if (!parsed.ok) return chunkForDiscord(`エラー: ${parsed.error}\n\n${HELP}`);

    return chunkForDiscord(await this.#execute(parsed.command));
  }

  async #execute(command: OwnerCommand): Promise<string> {
    const createdAt = this.#now().toISOString();

    switch (command.name) {
      case "help":
        return HELP;

      case "guilds": {
        const guilds = await this.#guilds.listGuilds();
        if (guilds.length === 0) return "導入サーバーはありません。";
        return [
          `導入サーバー: ${guilds.length}`,
          ...guilds.map((g) => `- ${g.name} (${g.id})${memberSuffix(g.memberCount)}`),
        ].join("\n");
      }

      case "leave": {
        const left = await this.#guilds.leaveGuild(command.guildId);
        return left
          ? `サーバー ${command.guildId} から離脱しました。`
          : `サーバー ${command.guildId} が見つかりません。`;
      }

      case "ban":
        await this.#bans.save({
          subject: { kind: "user", id: command.userId },
          ...(command.reason === undefined ? {} : { reason: command.reason }),
          createdAt,
          actorId: this.#ownerUserId,
        });
        return `利用者 ${command.userId} を禁止しました。`;

      case "ban-guild":
        await this.#bans.save({
          subject: { kind: "guild", id: command.guildId },
          ...(command.reason === undefined ? {} : { reason: command.reason }),
          createdAt,
          actorId: this.#ownerUserId,
        });
        return `サーバー ${command.guildId} を禁止しました。`;

      case "unban":
        return (await this.#bans.delete({ kind: "user", id: command.userId }))
          ? `利用者 ${command.userId} の禁止を解除しました。`
          : `利用者 ${command.userId} は禁止されていません。`;

      case "unban-guild":
        return (await this.#bans.delete({ kind: "guild", id: command.guildId }))
          ? `サーバー ${command.guildId} の禁止を解除しました。`
          : `サーバー ${command.guildId} は禁止されていません。`;

      case "list-bans": {
        const bans = await this.#bans.list();
        if (bans.length === 0) return "禁止はありません。";
        return [
          `禁止: ${bans.length}`,
          ...bans.map(
            (b) => `- ${b.subject.kind}:${b.subject.id}${reasonSuffix(b.reason)} (${b.createdAt})`,
          ),
        ].join("\n");
      }

      case "block":
        await this.#blocks.save({
          target: command.target,
          ...(command.reason === undefined ? {} : { reason: command.reason }),
          createdAt,
        });
        return `${describeTarget(command.target)} の展開を拒否します。`;

      case "unblock":
        return (await this.#blocks.delete(command.target))
          ? `${describeTarget(command.target)} の展開拒否を解除しました。`
          : `${describeTarget(command.target)} は拒否されていません。`;

      case "list-blocks": {
        const blocks = await this.#blocks.list();
        if (blocks.length === 0) return "展開拒否はありません。";
        return [
          `展開拒否: ${blocks.length}`,
          ...blocks.map(
            (b) => `- ${describeTarget(b.target)}${reasonSuffix(b.reason)} (${b.createdAt})`,
          ),
        ].join("\n");
      }

      case "status": {
        if (this.#status === undefined) return "状態を取得できません。";
        const snapshot = await this.#status();
        return [
          `Redis: ${snapshot.redisReady ? "接続中" : "未接続"}`,
          // 値そのものは出さない（NFR-5）。
          `pixiv 認証: ${snapshot.authenticated ? "あり" : "なし"}`,
          `導入サーバー数: ${snapshot.guildCount}`,
          `キャッシュ件数: ${snapshot.cacheSize}`,
        ].join("\n");
      }
    }
  }
}

function describeTarget(target: { kind: "artwork" | "user"; id: string }): string {
  return target.kind === "artwork" ? `作品 ${target.id}` : `pixiv ユーザー ${target.id}`;
}

function reasonSuffix(reason: string | undefined): string {
  return reason === undefined ? "" : ` — ${reason}`;
}

function memberSuffix(memberCount: number | undefined): string {
  return memberCount === undefined ? "" : ` / ${memberCount}人`;
}
