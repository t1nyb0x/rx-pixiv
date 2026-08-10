import { ChannelType, type Message, type MessageReplyOptions } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import { MessageHandler, type Renderer } from "#adapters/discord/MessageHandler";
import { OwnerCommandHandler } from "#adapters/discord/OwnerCommandHandler";
import { ReplyTracker } from "#adapters/discord/replyTracker";
import { ImageUrlRewriter } from "#adapters/pixiv/ImageUrlRewriter";
import type { ContentRating } from "#core/models/ContentRating";
import type { FetchError } from "#core/models/errors";
import type { PixivRef } from "#core/models/PixivRef";
import type { IllustWork } from "#core/models/PixivWork";
import type { PixivWork } from "#core/models/PixivWork";
import type { RenderPlan } from "#core/models/RenderPlan";
import { ok, type Result } from "#core/models/Result";
import type { IGuildAdmin } from "#core/ports/IGuildAdmin";
import type { IReplyRepository } from "#core/ports/IReplyRepository";
import { AccessGate } from "#core/services/AccessGate";
import { OwnerCommandService } from "#core/services/OwnerCommandService";
import {
  MemoryBanRepository,
  MemoryBlockRepository,
  MemoryCooldownStore,
} from "#infrastructure/memory/MemoryRepositories";
import { createLogger } from "#utils/logger";

const allRating: ContentRating = {
  level: "all",
  sensitive: false,
  ai: "no",
  confidence: "authoritative",
};

const work = (rating: ContentRating = allRating): IllustWork => ({
  kind: "illust",
  id: "1",
  canonicalUrl: "https://www.pixiv.net/artworks/1",
  title: "作品名",
  author: { id: "9", name: "作者", url: "https://www.pixiv.net/users/9" },
  rating,
  source: "ajax",
  fetchedAt: 0,
  partial: false,
  illustType: "illust",
  pageCount: 1,
  pages: [{ page: 0, urls: { regular: "https://i.pximg.net/a.jpg" } }],
  pagesTruncated: false,
  tags: [{ name: "tag" }],
});

class CapturingRenderer implements Renderer {
  public readonly plans: RenderPlan[] = [];
  public render(plan: RenderPlan): MessageReplyOptions {
    this.plans.push(plan);
    return { content: JSON.stringify(plan), allowedMentions: { parse: [], repliedUser: false } };
  }
}

function setup(
  options: {
    rating?: ContentRating;
    bans?: MemoryBanRepository;
    blocks?: MemoryBlockRepository;
    detectUrls?: typeof import("#core/services/UrlDetector").detect;
    replyTracker?: ReplyTracker;
    resolvedWork?: PixivWork;
    imageRewriter?: { rewrite(url: string): string | undefined };
  } = {},
) {
  const bans = options.bans ?? new MemoryBanRepository();
  const blocks = options.blocks ?? new MemoryBlockRepository();
  const renderer = new CapturingRenderer();
  const resolve = vi.fn<
    (ref: PixivRef, signal: AbortSignal) => Promise<Result<PixivWork, FetchError>>
  >(() => Promise.resolve(ok(options.resolvedWork ?? work(options.rating))));
  const ownerService = new OwnerCommandService({
    ownerUserId: "owner",
    banRepository: bans,
    blockRepository: blocks,
    guildAdmin: {
      listGuilds: () => Promise.resolve([]),
      leaveGuild: () => Promise.resolve(false),
    } satisfies IGuildAdmin,
  });
  const handler = new MessageHandler({
    accessGate: new AccessGate({
      banRepository: bans,
      blockRepository: blocks,
      cooldowns: new MemoryCooldownStore(),
      ownerUserId: "owner",
    }),
    ownerCommands: new OwnerCommandHandler(ownerService),
    workResolver: { resolve },
    imageRewriter:
      options.imageRewriter ?? new ImageUrlRewriter({ proxyBaseUrl: "https://proxy.example/i" }),
    renderer,
    logger: createLogger({ level: "silent" }),
    ...(options.replyTracker === undefined ? {} : { replyTracker: options.replyTracker }),
    ...(options.detectUrls === undefined ? {} : { detectUrls: options.detectUrls }),
  });
  return { handler, resolve, renderer };
}

function message(
  over: {
    content?: string;
    authorId?: string;
    bot?: boolean;
    nsfw?: boolean;
    suppressReject?: boolean;
    channelType?: ChannelType;
  } = {},
) {
  const reply = vi.fn<(options: MessageReplyOptions) => Promise<{ id: string }>>(() =>
    Promise.resolve({ id: "reply-1" }),
  );
  const suppressEmbeds = over.suppressReject
    ? vi.fn<() => Promise<void>>(() => Promise.reject(new Error("missing permission")))
    : vi.fn<() => Promise<void>>(() => Promise.resolve());
  return {
    value: {
      id: "message-1",
      content: over.content ?? "https://www.pixiv.net/artworks/1",
      author: { id: over.authorId ?? "user", bot: over.bot ?? false },
      guildId: over.channelType === ChannelType.DM ? null : "guild",
      channelId: "channel",
      channel: {
        type: over.channelType ?? ChannelType.GuildText,
        nsfw: over.nsfw ?? false,
        isSendable: () => true,
      },
      reply,
      suppressEmbeds,
    } as unknown as Message,
    reply,
    suppressEmbeds,
  };
}

describe("MessageHandler", () => {
  it("expands an all-ages work and suppresses the original embed", async () => {
    const app = setup();
    const input = message();
    await app.handler.handle(input.value);

    expect(input.reply).toHaveBeenCalledOnce();
    expect(input.suppressEmbeds).toHaveBeenCalledWith(true);
    expect(app.renderer.plans[0]?.items[0]?.media[0]?.url).toBe("https://proxy.example/i/a.jpg");
  });

  it("renders R-18 as link_only in a normal channel without leaking metadata", async () => {
    const app = setup({ rating: { ...allRating, level: "r18" } });
    const input = message();
    await app.handler.handle(input.value);

    const serialized = JSON.stringify(app.renderer.plans[0]);
    expect(serialized).toContain("https://www.pixiv.net/artworks/1");
    expect(serialized).not.toContain("作品名");
    expect(serialized).not.toContain("tag");
  });

  it("does not require usable media to send a link_only response", async () => {
    const restricted = work({ ...allRating, level: "r18" });
    const app = setup({
      resolvedWork: {
        ...restricted,
        pages: [{ page: 0, urls: { regular: "https://unexpected.example/secret.jpg" } }],
      },
      imageRewriter: {
        rewrite: () => {
          throw new Error("must not rewrite link-only media");
        },
      },
    });
    const input = message();

    await app.handler.handle(input.value);
    expect(input.reply).toHaveBeenCalledOnce();
    expect(JSON.stringify(app.renderer.plans[0])).not.toContain("secret.jpg");
  });

  it("stays silent for an unknown rating in a normal channel", async () => {
    const app = setup({ rating: { ...allRating, confidence: "unknown" } });
    const input = message();
    await app.handler.handle(input.value);
    expect(input.reply).not.toHaveBeenCalled();
  });

  it("keeps the per-work spoiler decision for user profile thumbnails", async () => {
    const app = setup({
      resolvedWork: {
        kind: "user",
        id: "9",
        canonicalUrl: "https://www.pixiv.net/users/9",
        title: "作者",
        author: { id: "9", name: "作者", url: "https://www.pixiv.net/users/9" },
        rating: allRating,
        source: "ajax",
        fetchedAt: 0,
        partial: false,
        recentWorks: [
          {
            id: "1",
            canonicalUrl: "https://www.pixiv.net/artworks/1",
            image: { page: 0, urls: { regular: "https://i.pximg.net/sensitive.jpg" } },
            rating: { ...allRating, sensitive: true },
          },
        ],
      },
    });

    await app.handler.handle(message().value);
    expect(app.renderer.plans[0]?.items[0]?.spoiler).toBe(false);
    expect(app.renderer.plans[0]?.items[0]?.media[0]?.spoiler).toBe(true);
  });

  it("does not detect URLs for a banned user", async () => {
    const bans = new MemoryBanRepository();
    await bans.save({ subject: { kind: "user", id: "user" }, createdAt: "now", actorId: "owner" });
    const detectUrls = vi.fn<typeof import("#core/services/UrlDetector").detect>(() => []);
    const app = setup({ bans, detectUrls });
    await app.handler.handle(message().value);

    expect(detectUrls).not.toHaveBeenCalled();
    expect(app.resolve).not.toHaveBeenCalled();
  });

  it("does not fetch a blocked artwork", async () => {
    const blocks = new MemoryBlockRepository();
    await blocks.save({ target: { kind: "artwork", id: "1" }, createdAt: "now" });
    const app = setup({ blocks });
    await app.handler.handle(message().value);
    expect(app.resolve).not.toHaveBeenCalled();
  });

  it("handles an owner command before URL processing", async () => {
    const app = setup();
    const input = message({
      authorId: "owner",
      content: "!owner/help",
      channelType: ChannelType.DM,
    });
    await app.handler.handle(input.value);
    expect(input.reply).toHaveBeenCalled();
    expect(app.resolve).not.toHaveBeenCalled();
  });

  it("consumes an unauthorized owner command without expanding an attached URL", async () => {
    const app = setup();
    const input = message({ content: "!owner/help https://www.pixiv.net/artworks/1" });
    await app.handler.handle(input.value);
    expect(input.reply).not.toHaveBeenCalled();
    expect(app.resolve).not.toHaveBeenCalled();
  });

  it("continues after suppressEmbeds fails", async () => {
    const app = setup();
    const input = message({ suppressReject: true });
    await expect(app.handler.handle(input.value)).resolves.toBeUndefined();
    expect(input.reply).toHaveBeenCalledOnce();
  });

  it("continues after saving the reply mapping fails", async () => {
    const repository: IReplyRepository = {
      add: () => Promise.reject(new Error("redis unavailable")),
      find: () => Promise.resolve(undefined),
      markDeleted: () => Promise.resolve(),
      remove: () => Promise.resolve(false),
    };
    const app = setup({ replyTracker: new ReplyTracker(repository) });
    const input = message();

    await expect(app.handler.handle(input.value)).resolves.toBeUndefined();
    expect(input.reply).toHaveBeenCalledOnce();
    expect(input.suppressEmbeds).toHaveBeenCalledWith(true);
  });

  it("ignores bot authors", async () => {
    const app = setup();
    await app.handler.handle(message({ bot: true }).value);
    expect(app.resolve).not.toHaveBeenCalled();
  });
});
