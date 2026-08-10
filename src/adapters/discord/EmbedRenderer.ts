import { EmbedBuilder, MessageFlags, type MessageReplyOptions } from "discord.js";

import { DISCORD_LIMITS } from "#config/constants";
import type { RenderItem, RenderPlan } from "#core/models/RenderPlan";

export class EmbedRenderer {
  public render(plan: RenderPlan): MessageReplyOptions {
    const embeds = plan.items.flatMap(renderItem);
    if (embeds.length > DISCORD_LIMITS.embedsPerMessage) {
      throw new RangeError(`embeds must not exceed ${DISCORD_LIMITS.embedsPerMessage}`);
    }
    return {
      ...(plan.content === undefined ? {} : { content: plan.content }),
      embeds,
      ...(plan.suppressLinkPreviews === true ? { flags: MessageFlags.SuppressEmbeds } : {}),
      allowedMentions: { parse: [], repliedUser: false },
    };
  }
}

function renderItem(item: RenderItem): EmbedBuilder[] {
  if (item.spoiler) {
    // classic embedは外部画像をspoiler化できない。安全側にメディアを省略し、
    // 本文全体をspoiler記法のリンクへ縮退する。
    return [
      new EmbedBuilder()
        .setURL(item.url)
        .setDescription(`||[スポイラー付きpixiv作品を開く](${item.url})||`),
    ];
  }

  const first = new EmbedBuilder().setURL(item.url);
  if (item.title !== undefined) first.setTitle(item.title.slice(0, 256));
  if (item.description !== undefined) first.setDescription(item.description.slice(0, 4_096));
  if (item.author !== undefined) {
    first.setAuthor({
      name: item.author.name.slice(0, 256),
      url: item.author.url,
      ...(item.author.iconUrl === undefined ? {} : { iconURL: item.author.iconUrl }),
    });
  }
  if (item.fields.length > 0) {
    first.addFields(
      item.fields.map((field) => ({
        name: field.name.slice(0, 256),
        value: field.value.slice(0, 1_024),
        inline: field.inline ?? false,
      })),
    );
  }
  // classic embedは個別画像もspoiler化できない。プロフィール内の制限付き最近作など、
  // item全体はplainでも個別spoilerが必要な画像は安全側に省略する。
  const [firstMedia, ...rest] = item.media.filter((media) => !media.spoiler);
  if (firstMedia !== undefined) first.setImage(firstMedia.url);
  return [first, ...rest.map((media) => new EmbedBuilder().setURL(item.url).setImage(media.url))];
}
