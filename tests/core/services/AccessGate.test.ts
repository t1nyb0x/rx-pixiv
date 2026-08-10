import { describe, expect, it } from "vitest";

import type { PixivRef } from "#core/models/PixivRef";
import type { IBanRepository } from "#core/ports/IBanRepository";
import type { IBlockRepository } from "#core/ports/IBlockRepository";
import type { ICooldownStore } from "#core/ports/ICooldownStore";
import { AccessGate, type MessageOrigin } from "#core/services/AccessGate";
import {
  MemoryBanRepository,
  MemoryBlockRepository,
  MemoryCooldownStore,
} from "#infrastructure/memory/MemoryRepositories";

const origin: MessageOrigin = { userId: "u1", guildId: "g1", channelId: "c1" };

const artwork: PixivRef = { kind: "artwork", id: "42", canonicalUrl: "x" };

function gateWith(over: Partial<ConstructorParameters<typeof AccessGate>[0]> = {}) {
  return new AccessGate({
    banRepository: new MemoryBanRepository(),
    blockRepository: new MemoryBlockRepository(),
    cooldowns: new MemoryCooldownStore(),
    ...over,
  });
}

const failing = <T extends object>(): T =>
  new Proxy({} as T, {
    get: () => () => Promise.reject(new Error("store down")),
  });

describe("AccessGate.check", () => {
  it("allows an ordinary message", async () => {
    expect(await gateWith().check(origin)).toEqual({ allowed: true });
  });

  it("rejects a banned user", async () => {
    const bans = new MemoryBanRepository();
    await bans.save({
      subject: { kind: "user", id: "u1" },
      createdAt: "now",
      actorId: "owner",
    });
    expect(await gateWith({ banRepository: bans }).check(origin)).toEqual({
      allowed: false,
      reason: "banned_user",
    });
  });

  it("rejects a banned guild", async () => {
    const bans = new MemoryBanRepository();
    await bans.save({ subject: { kind: "guild", id: "g1" }, createdAt: "now", actorId: "owner" });
    expect(await gateWith({ banRepository: bans }).check(origin)).toEqual({
      allowed: false,
      reason: "banned_guild",
    });
  });

  it("treats empty allow lists as allow-all", async () => {
    expect(await gateWith({ allowedGuildIds: [], allowedChannelIds: [] }).check(origin)).toEqual({
      allowed: true,
    });
  });

  it("enforces the guild and channel allow lists", async () => {
    expect(await gateWith({ allowedGuildIds: ["other"] }).check(origin)).toEqual({
      allowed: false,
      reason: "channel_not_allowed",
    });
    expect(await gateWith({ allowedChannelIds: ["other"] }).check(origin)).toEqual({
      allowed: false,
      reason: "channel_not_allowed",
    });
    expect(
      await gateWith({ allowedGuildIds: ["g1"], allowedChannelIds: ["c1"] }).check(origin),
    ).toEqual({ allowed: true });
  });

  it("rejects a guildless message when a guild allow list is set", async () => {
    const dm: MessageOrigin = { userId: "u1", channelId: "c1" };
    expect(await gateWith({ allowedGuildIds: ["g1"] }).check(dm)).toEqual({
      allowed: false,
      reason: "channel_not_allowed",
    });
  });

  it("applies the cooldown on the second message", async () => {
    let clock = 0;
    const gate = gateWith({ cooldowns: new MemoryCooldownStore({ now: () => clock }) });

    expect(await gate.check(origin)).toEqual({ allowed: true });
    expect(await gate.check(origin)).toEqual({ allowed: false, reason: "cooldown" });

    clock = 20_000;
    expect(await gate.check(origin)).toEqual({ allowed: true });
  });

  it("exempts the owner from the cooldown", async () => {
    const gate = gateWith({ ownerUserId: "u1" });
    expect(await gate.check(origin)).toEqual({ allowed: true });
    expect(await gate.check(origin)).toEqual({ allowed: true });
  });

  it("fails closed when the ban store cannot be read", async () => {
    // ban が効いているか分からない状態で動き続けない（ADR 0016）。
    const gate = gateWith({ banRepository: failing<IBanRepository>() });
    expect(await gate.check(origin)).toEqual({ allowed: false, reason: "store_unavailable" });
  });

  it("can be configured to stay open when the store is down", async () => {
    const gate = gateWith({
      banRepository: failing<IBanRepository>(),
      allowWhenStoreUnavailable: true,
    });
    expect(await gate.check(origin)).toEqual({ allowed: true });
  });

  it("still passes when only the cooldown store is unavailable", async () => {
    // クールダウンは安全側の判定に影響しない。
    const gate = gateWith({ cooldowns: failing<ICooldownStore>() });
    expect(await gate.check(origin)).toEqual({ allowed: true });
  });
});

describe("AccessGate.isBlocked", () => {
  it("blocks an artwork by id", async () => {
    const blocks = new MemoryBlockRepository();
    await blocks.save({ target: { kind: "artwork", id: "42" }, createdAt: "now" });
    expect(await gateWith({ blockRepository: blocks }).isBlocked(artwork)).toBe(true);
  });

  it("blocks every work by a pixiv author", async () => {
    const blocks = new MemoryBlockRepository();
    await blocks.save({ target: { kind: "user", id: "777" }, createdAt: "now" });
    const gate = gateWith({ blockRepository: blocks });

    expect(await gate.isBlocked(artwork, "777")).toBe(true);
    expect(await gate.isBlocked(artwork, "778")).toBe(false);
  });

  it("blocks a user page by the same user block", async () => {
    const blocks = new MemoryBlockRepository();
    await blocks.save({ target: { kind: "user", id: "777" }, createdAt: "now" });
    const userRef: PixivRef = { kind: "user", id: "777", canonicalUrl: "x" };
    expect(await gateWith({ blockRepository: blocks }).isBlocked(userRef)).toBe(true);
  });

  it("allows anything not on the list", async () => {
    expect(await gateWith().isBlocked(artwork)).toBe(false);
  });

  it("fails closed when the block store cannot be read", async () => {
    // 削除要請に応じられているか分からない状態で展開しない。
    const gate = gateWith({ blockRepository: failing<IBlockRepository>() });
    expect(await gate.isBlocked(artwork)).toBe(true);
  });

  it("can be configured to stay open when the block store is down", async () => {
    const gate = gateWith({
      blockRepository: failing<IBlockRepository>(),
      allowWhenStoreUnavailable: true,
    });
    expect(await gate.isBlocked(artwork)).toBe(false);
  });
});
