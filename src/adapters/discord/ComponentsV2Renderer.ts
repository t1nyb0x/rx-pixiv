import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  TextDisplayBuilder,
  type MessageReplyOptions,
} from "discord.js";

import { DISCORD_LIMITS } from "#config/constants";
import type { RenderItem, RenderPlan } from "#core/models/RenderPlan";

export class ComponentsV2Renderer {
  public render(plan: RenderPlan): MessageReplyOptions {
    const components: ContainerBuilder[] = [];
    if (plan.content !== undefined) {
      components.push(
        new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(plan.content),
        ),
      );
    }

    for (const item of plan.items) components.push(renderItem(item));
    return {
      components,
      flags:
        MessageFlags.IsComponentsV2 |
        (plan.suppressLinkPreviews === true ? MessageFlags.SuppressEmbeds : 0),
      allowedMentions: { parse: [], repliedUser: false },
    };
  }
}

function renderItem(item: RenderItem): ContainerBuilder {
  if (item.media.length > DISCORD_LIMITS.galleryItemsPerMessage) {
    throw new RangeError(`gallery items must not exceed ${DISCORD_LIMITS.galleryItemsPerMessage}`);
  }

  const container = new ContainerBuilder()
    .setSpoiler(item.spoiler)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(itemText(item)));

  if (item.media.length > 0) {
    const gallery = new MediaGalleryBuilder().addItems(
      item.media.map((media) => {
        const builder = new MediaGalleryItemBuilder().setURL(media.url).setSpoiler(media.spoiler);
        return media.description === undefined
          ? builder
          : builder.setDescription(media.description.slice(0, 1_024));
      }),
    );
    container.addMediaGalleryComponents(gallery);
  }
  return container;
}

function itemText(item: RenderItem): string {
  const parts = [
    item.title === undefined ? item.url : `## [${item.title}](${item.url})`,
    item.author === undefined ? undefined : `by [${item.author.name}](${item.author.url})`,
    item.description,
    ...item.fields.map((field) => `**${field.name}**\n${field.value}`),
  ].filter((value): value is string => value !== undefined && value !== "");
  return parts.join("\n\n").slice(0, 4_000);
}
