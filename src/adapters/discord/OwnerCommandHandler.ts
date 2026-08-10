import { ChannelType, type Message } from "discord.js";

import type { OwnerCommandService } from "#core/services/OwnerCommandService";
import { OWNER_COMMAND_PREFIX } from "#core/services/ownerCommand";
import type { ReplyTracker } from "#adapters/discord/replyTracker";

export class OwnerCommandHandler {
  public constructor(
    private readonly service: OwnerCommandService,
    private readonly replyTracker?: ReplyTracker,
  ) {}

  /** コマンドとして処理した場合だけ true。非ownerには存在も明かさない。 */
  public async handle(message: Message): Promise<boolean> {
    const isCommand = message.content.trim().startsWith(OWNER_COMMAND_PREFIX);
    if (!isCommand) return false;

    const replies = await this.service.handle({
      authorId: message.author.id,
      isDm: message.channel.type === ChannelType.DM,
      content: message.content,
    });
    // 権限外・ギルド内でもコマンド候補は消費し、通常URL展開へfall-throughさせない。
    if (replies === undefined) return true;

    for (const content of replies) {
      // 返信順序を維持する。管理出力は複数チャンクでも並べ替えられない。
      // eslint-disable-next-line no-await-in-loop
      const reply = await message.reply({
        content,
        allowedMentions: { parse: [], repliedUser: false },
      });
      if (this.replyTracker !== undefined) {
        try {
          // 返信送信と追跡を1組として順序どおり確定する。
          // eslint-disable-next-line no-await-in-loop
          await this.replyTracker.track(message.id, reply.id, async () => {
            await reply.delete();
          });
        } catch {
          // 追跡は補助機能。コマンド実行と既送信の返信は取り消さない。
        }
      }
    }
    return true;
  }
}
