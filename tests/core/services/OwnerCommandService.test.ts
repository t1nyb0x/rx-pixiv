import { describe, expect, it } from "vitest";

import type { GuildSummary, IGuildAdmin } from "#core/ports/IGuildAdmin";
import { OwnerCommandService, type StatusSnapshot } from "#core/services/OwnerCommandService";
import {
  MemoryBanRepository,
  MemoryBlockRepository,
} from "#infrastructure/memory/MemoryRepositories";

const OWNER = "owner-1";

class FakeGuildAdmin implements IGuildAdmin {
  public readonly left: string[] = [];

  public constructor(private readonly guilds: readonly GuildSummary[] = []) {}

  public listGuilds(): Promise<readonly GuildSummary[]> {
    return Promise.resolve(this.guilds);
  }

  public leaveGuild(guildId: string): Promise<boolean> {
    const exists = this.guilds.some((g) => g.id === guildId);
    if (exists) this.left.push(guildId);
    return Promise.resolve(exists);
  }
}

function serviceWith(
  over: Partial<ConstructorParameters<typeof OwnerCommandService>[0]> = {},
  guildAdmin = new FakeGuildAdmin(),
) {
  const banRepository = new MemoryBanRepository();
  const blockRepository = new MemoryBlockRepository();
  const service = new OwnerCommandService({
    ownerUserId: OWNER,
    banRepository,
    blockRepository,
    guildAdmin,
    now: () => new Date("2026-08-11T00:00:00Z"),
    ...over,
  });
  return { service, banRepository, blockRepository, guildAdmin };
}

const dm = (content: string, authorId = OWNER) => ({ authorId, isDm: true, content });

describe("OwnerCommandService — 受け付ける条件", () => {
  it("stays silent for anyone who is not the owner", async () => {
    // 存在も明かさない。エラーも返さない。
    const { service } = serviceWith();
    expect(await service.handle(dm("!owner/guilds", "someone-else"))).toBeUndefined();
  });

  it("stays silent outside dms", async () => {
    const { service } = serviceWith();
    expect(
      await service.handle({ authorId: OWNER, isDm: false, content: "!owner/guilds" }),
    ).toBeUndefined();
  });

  it("stays silent for ordinary conversation", async () => {
    const { service } = serviceWith();
    expect(await service.handle(dm("こんにちは"))).toBeUndefined();
  });

  it("explains itself when the command is malformed", async () => {
    const { service } = serviceWith();
    const reply = await service.handle(dm("!owner/leave"));
    expect(reply?.join("\n")).toContain("guildId is required");
  });
});

describe("OwnerCommandService — 実行", () => {
  it("lists guilds with their member counts", async () => {
    const guildAdmin = new FakeGuildAdmin([{ id: "123", name: "テスト鯖", memberCount: 3 }]);
    const { service } = serviceWith({}, guildAdmin);

    const reply = (await service.handle(dm("!owner/guilds")))?.join("\n") ?? "";
    expect(reply).toContain("テスト鯖");
    expect(reply).toContain("3人");
  });

  it("says so when there are no guilds", async () => {
    const { service } = serviceWith({}, new FakeGuildAdmin());
    expect((await service.handle(dm("!owner/guilds")))?.join("")).toContain("ありません");
  });

  it("leaves a guild by id", async () => {
    const guildAdmin = new FakeGuildAdmin([{ id: "123", name: "x" }]);
    const { service } = serviceWith({}, guildAdmin);

    const reply = await service.handle(dm("!owner/leave 123"));
    expect(reply?.join("")).toContain("離脱");
    expect(guildAdmin.left).toEqual(["123"]);
  });

  it("reports when the guild to leave is unknown", async () => {
    const { service } = serviceWith({}, new FakeGuildAdmin());
    expect((await service.handle(dm("!owner/leave 999")))?.join("")).toContain("見つかりません");
  });

  it("bans and unbans a user, persisting through the repository", async () => {
    const { service, banRepository } = serviceWith();

    await service.handle(dm("!owner/ban 456 荒らし"));
    expect(await banRepository.find({ kind: "user", id: "456" })).toMatchObject({
      reason: "荒らし",
      actorId: OWNER,
    });

    expect((await service.handle(dm("!owner/unban 456")))?.join("")).toContain("解除");
    expect(await banRepository.find({ kind: "user", id: "456" })).toBeUndefined();
  });

  it("reports unbanning something that was not banned", async () => {
    const { service } = serviceWith();
    expect((await service.handle(dm("!owner/unban 456")))?.join("")).toContain(
      "禁止されていません",
    );
  });

  it("bans a guild", async () => {
    const { service, banRepository } = serviceWith();
    await service.handle(dm("!owner/ban-guild 789"));
    expect(await banRepository.find({ kind: "guild", id: "789" })).toBeDefined();
    await service.handle(dm("!owner/unban-guild 789"));
    expect(await banRepository.find({ kind: "guild", id: "789" })).toBeUndefined();
  });

  it("lists bans and says so when there are none", async () => {
    const { service } = serviceWith();
    expect((await service.handle(dm("!owner/list-bans")))?.join("")).toContain("ありません");
    await service.handle(dm("!owner/ban 1 理由"));
    const listed = (await service.handle(dm("!owner/list-bans")))?.join("\n") ?? "";
    expect(listed).toContain("user:1");
    expect(listed).toContain("理由");
  });

  it("blocks an artwork and a pixiv author at both granularities", async () => {
    const { service, blockRepository } = serviceWith();

    await service.handle(dm("!owner/block 100412238 削除要請"));
    expect(await blockRepository.find({ kind: "artwork", id: "100412238" })).toMatchObject({
      reason: "削除要請",
    });

    await service.handle(dm("!owner/block user:777"));
    expect(await blockRepository.find({ kind: "user", id: "777" })).toBeDefined();

    const listed = (await service.handle(dm("!owner/list-blocks")))?.join("\n") ?? "";
    expect(listed).toContain("作品 100412238");
    expect(listed).toContain("pixiv ユーザー 777");
  });

  it("unblocks", async () => {
    const { service, blockRepository } = serviceWith();
    await service.handle(dm("!owner/block 42"));
    expect((await service.handle(dm("!owner/unblock 42")))?.join("")).toContain("解除");
    expect(await blockRepository.find({ kind: "artwork", id: "42" })).toBeUndefined();
  });

  it("reports status without leaking the session value", async () => {
    const snapshot: StatusSnapshot = {
      redisReady: true,
      authenticated: true,
      guildCount: 2,
      cacheSize: 10,
    };
    const { service } = serviceWith({ status: () => snapshot });

    const reply = (await service.handle(dm("!owner/status")))?.join("\n") ?? "";
    expect(reply).toContain("Redis: 接続中");
    // NFR-5: 真偽だけを出し、PHPSESSID の値そのものは出さない。
    expect(reply).toContain("pixiv 認証: あり");
    expect(reply).not.toMatch(/PHPSESSID/i);
  });

  it("says so when no status source is wired", async () => {
    const { service } = serviceWith();
    expect((await service.handle(dm("!owner/status")))?.join("")).toContain("取得できません");
  });

  it("chunks long output", async () => {
    const { service } = serviceWith();
    await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        service.handle(dm(`!owner/ban ${i} とても長い理由の説明テキストをここに置く`)),
      ),
    );
    const reply = await service.handle(dm("!owner/list-bans"));
    expect((reply?.length ?? 0) > 1).toBe(true);
    for (const chunk of reply ?? []) expect(chunk.length).toBeLessThanOrEqual(1_900);
  });

  it("shows help for the bare prefix", async () => {
    const { service } = serviceWith();
    expect((await service.handle(dm("!owner/")))?.join("\n")).toContain("管理コマンド");
  });
});
