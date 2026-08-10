import { ChannelType, type Message } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import { OwnerCommandHandler } from "#adapters/discord/OwnerCommandHandler";
import { ReplyTracker } from "#adapters/discord/replyTracker";
import type { IGuildAdmin } from "#core/ports/IGuildAdmin";
import type { IReplyRepository } from "#core/ports/IReplyRepository";
import { OwnerCommandService } from "#core/services/OwnerCommandService";
import {
  MemoryBanRepository,
  MemoryBlockRepository,
} from "#infrastructure/memory/MemoryRepositories";

const service = () =>
  new OwnerCommandService({
    ownerUserId: "owner",
    banRepository: new MemoryBanRepository(),
    blockRepository: new MemoryBlockRepository(),
    guildAdmin: {
      listGuilds: () => Promise.resolve([]),
      leaveGuild: () => Promise.resolve(false),
    } satisfies IGuildAdmin,
  });

function message(over: { authorId?: string; type?: ChannelType; content?: string } = {}) {
  let replyNumber = 0;
  const reply = vi.fn<(options: unknown) => Promise<{ id: string; delete(): Promise<void> }>>(() =>
    Promise.resolve({
      id: `reply-${++replyNumber}`,
      delete: () => Promise.resolve(),
    }),
  );
  return {
    value: {
      id: "original",
      author: { id: over.authorId ?? "owner" },
      channel: { type: over.type ?? ChannelType.DM },
      content: over.content ?? "!owner/help",
      reply,
    } as unknown as Message,
    reply,
  };
}

describe("OwnerCommandHandler", () => {
  it("replies to an owner command in DM", async () => {
    const input = message();
    expect(await new OwnerCommandHandler(service()).handle(input.value)).toBe(true);
    expect(input.reply).toHaveBeenCalled();
  });

  it.each([
    { authorId: "other", type: ChannelType.DM },
    { authorId: "owner", type: ChannelType.GuildText },
  ])("stays silent for $authorId in channel $type", async (over) => {
    const input = message(over);
    expect(await new OwnerCommandHandler(service()).handle(input.value)).toBe(true);
    expect(input.reply).not.toHaveBeenCalled();
  });

  it("returns false only for a normal message", async () => {
    const input = message({ content: "通常の会話" });
    expect(await new OwnerCommandHandler(service()).handle(input.value)).toBe(false);
  });

  it("tracks every chunked command reply", async () => {
    const bans = new MemoryBanRepository();
    for (let index = 0; index < 100; index += 1) {
      // テストデータを順に作るための直列処理。
      // eslint-disable-next-line no-await-in-loop
      await bans.save({
        subject: { kind: "user", id: String(index) },
        reason: "長い理由".repeat(10),
        createdAt: "2026-08-11T00:00:00Z",
        actorId: "owner",
      });
    }
    const add = vi.fn<IReplyRepository["add"]>(() => Promise.resolve(true));
    const tracker = new ReplyTracker({
      add,
      find: () => Promise.resolve(undefined),
      markDeleted: () => Promise.resolve(),
      remove: () => Promise.resolve(false),
    });
    const commandService = new OwnerCommandService({
      ownerUserId: "owner",
      banRepository: bans,
      blockRepository: new MemoryBlockRepository(),
      guildAdmin: {
        listGuilds: () => Promise.resolve([]),
        leaveGuild: () => Promise.resolve(false),
      },
    });
    const input = message({ content: "!owner/list-bans" });

    await new OwnerCommandHandler(commandService, tracker).handle(input.value);
    expect(input.reply.mock.calls.length).toBeGreaterThan(1);
    expect(add).toHaveBeenCalledTimes(input.reply.mock.calls.length);
  });
});
