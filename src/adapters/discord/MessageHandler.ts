import { randomUUID } from "node:crypto";

import type { Logger } from "pino";
import type { Message, MessageReplyOptions } from "discord.js";

import type { ChannelLike } from "#adapters/discord/channelRating";
import { toChannelContext } from "#adapters/discord/channelRating";
import type { OwnerCommandHandler } from "#adapters/discord/OwnerCommandHandler";
import type { ReplyTracker } from "#adapters/discord/replyTracker";
import type { PixivRef } from "#core/models/PixivRef";
import type { PixivImage, PixivWork } from "#core/models/PixivWork";
import type { RenderPlan } from "#core/models/RenderPlan";
import type { Result } from "#core/models/Result";
import type { FetchError } from "#core/models/errors";
import type { AccessGate, MessageOrigin } from "#core/services/AccessGate";
import { composeMessage } from "#core/services/MessageComposer";
import {
  selectMedia,
  type ImageVariant,
  type SelectedMedia,
  type UrlRewriter,
} from "#core/services/MediaSelector";
import {
  decideExpansion,
  requiresSpoiler,
  showsMedia,
  type NsfwPolicyOptions,
} from "#core/services/NsfwPolicy";
import { detect } from "#core/services/UrlDetector";
import { pLimit } from "#utils/concurrency";

export interface Renderer {
  render(plan: RenderPlan): MessageReplyOptions;
}

export interface WorkResolverLike {
  resolve(ref: PixivRef, signal: AbortSignal): Promise<Result<PixivWork, FetchError>>;
}

export interface MessageHandlerOptions {
  readonly accessGate: AccessGate;
  readonly ownerCommands: OwnerCommandHandler;
  readonly workResolver: WorkResolverLike;
  readonly imageRewriter: UrlRewriter;
  readonly renderer: Renderer;
  readonly logger: Logger;
  readonly replyTracker?: ReplyTracker;
  readonly nsfwPolicy?: NsfwPolicyOptions;
  readonly maxUrls?: number;
  readonly maxPages?: number;
  readonly hardPageLimit?: number;
  readonly variantPreference?: readonly ImageVariant[];
  readonly detectUrls?: typeof detect;
}

/** Discord messageを安全ゲートから描画まで通す薄いオーケストレータ。 */
export class MessageHandler {
  readonly #options: MessageHandlerOptions;

  public constructor(options: MessageHandlerOptions) {
    this.#options = options;
  }

  public async handle(message: Message): Promise<void> {
    if (message.author.bot) return;

    const logger = this.#options.logger.child({
      traceId: randomUUID(),
      guildId: message.guildId ?? undefined,
      channelId: message.channelId,
    });

    try {
      if (await this.#options.ownerCommands.handle(message)) return;
      if (!message.channel.isSendable()) return;

      const origin = messageOrigin(message);
      const gate = await this.#options.accessGate.check(origin);
      if (!gate.allowed) {
        logger.debug({ reason: gate.reason }, "Message rejected by access gate");
        return;
      }

      const refs = (this.#options.detectUrls ?? detect)(message.content, this.#options.maxUrls);
      if (refs.length === 0) return;

      const limit = pLimit(2);
      const results = await Promise.all(
        refs.map((ref) => limit(() => this.#expandOne(message, ref, logger))),
      );
      if (!results.some(Boolean)) return;

      try {
        await message.suppressEmbeds(true);
      } catch (error) {
        logger.warn({ err: error }, "Unable to suppress original embeds");
      }
    } catch (error) {
      // Discord clientへ例外を漏らさない。別メッセージの処理は続ける。
      logger.error({ err: error }, "Message handler failed");
    }
  }

  async #expandOne(message: Message, ref: PixivRef, logger: Logger): Promise<boolean> {
    try {
      // direct artwork/userは上流へ触る前に拒否できる。shortlinkは解決後にも再判定する。
      if (await this.#options.accessGate.isBlocked(ref)) return false;

      const result = await this.#options.workResolver.resolve(ref, new AbortController().signal);
      if (!result.ok) {
        logger.warn({ workId: refId(ref), error: result.error.kind }, "Pixiv work fetch failed");
        return false;
      }

      const work = result.value;
      if (await this.#options.accessGate.isBlocked(workRef(work), work.author.id)) return false;

      const channel = toChannelContext(message.channel as ChannelLike);
      const decision = decideExpansion(work.rating, channel, this.#options.nsfwPolicy);
      const selected = showsMedia(decision)
        ? selectWorkMedia(work, channel, this.#options)
        : undefined;
      const plan = composeMessage(work, {
        decision,
        ...(selected === undefined ? {} : selected),
      });
      if (plan.items.length === 0 && plan.content === undefined) return false;

      const reply = await message.reply(this.#options.renderer.render(plan));
      if (this.#options.replyTracker !== undefined) {
        try {
          await this.#options.replyTracker.track(message.id, reply.id, async () => {
            await reply.delete();
          });
        } catch (error) {
          // 返信追跡は補助機能。保存失敗で展開を取り消さない。
          logger.warn({ err: error }, "Unable to track reply");
        }
      }
      return true;
    } catch (error) {
      logger.error({ err: error, workId: refId(ref) }, "Unable to expand pixiv work");
      return false;
    }
  }
}

function selectWorkMedia(
  work: PixivWork,
  channel: ReturnType<typeof toChannelContext>,
  options: MessageHandlerOptions,
): { readonly media: SelectedMedia; readonly mediaSpoilers?: readonly boolean[] } {
  const { pages, totalPages, spoilers } = mediaPages(work, channel, options.nsfwPolicy);
  const media = selectMedia(pages, totalPages, options.imageRewriter, {
    ...(options.maxPages === undefined ? {} : { maxPages: options.maxPages }),
    ...(options.hardPageLimit === undefined ? {} : { hardLimit: options.hardPageLimit }),
    ...(options.variantPreference === undefined
      ? {}
      : { variantPreference: options.variantPreference }),
  });
  return spoilers === undefined
    ? { media }
    : { media, mediaSpoilers: media.sourceIndexes.map((index) => spoilers[index] ?? true) };
}

function messageOrigin(message: Message): MessageOrigin {
  return message.guildId === null
    ? { userId: message.author.id, channelId: message.channelId }
    : { userId: message.author.id, guildId: message.guildId, channelId: message.channelId };
}

function mediaPages(
  work: PixivWork,
  channel: ReturnType<typeof toChannelContext>,
  policy: NsfwPolicyOptions | undefined,
): {
  readonly pages: readonly PixivImage[];
  readonly totalPages: number;
  readonly spoilers?: readonly boolean[];
} {
  switch (work.kind) {
    case "illust":
      return { pages: work.pages, totalPages: work.pageCount };
    case "novel":
      return work.coverImage === undefined
        ? { pages: [], totalPages: 0 }
        : { pages: [work.coverImage], totalPages: 1 };
    case "novel_series":
      return work.coverImage === undefined
        ? { pages: [], totalPages: 0 }
        : { pages: [work.coverImage], totalPages: 1 };
    case "user": {
      const visible = work.recentWorks.flatMap((recent) => {
        const decision = decideExpansion(recent.rating, channel, policy);
        return showsMedia(decision)
          ? [{ image: recent.image, spoiler: requiresSpoiler(decision) }]
          : [];
      });
      return {
        pages: visible.map((recent) => recent.image),
        totalPages: visible.length,
        spoilers: visible.map((recent) => recent.spoiler),
      };
    }
  }
}

function workRef(work: PixivWork): PixivRef {
  switch (work.kind) {
    case "illust":
      return { kind: "artwork", id: work.id, canonicalUrl: work.canonicalUrl };
    case "novel":
      return { kind: "novel", id: work.id, canonicalUrl: work.canonicalUrl };
    case "novel_series":
      return { kind: "novel_series", id: work.id, canonicalUrl: work.canonicalUrl };
    case "user":
      return { kind: "user", id: work.id, canonicalUrl: work.canonicalUrl };
  }
}

function refId(ref: PixivRef): string {
  return ref.kind === "shortlink" ? ref.name : ref.id;
}
