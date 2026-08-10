import { ChannelType } from "discord.js";
import { describe, expect, it } from "vitest";

import {
  isAgeRestricted,
  isDmChannel,
  toChannelContext,
  type ChannelLike,
} from "#adapters/discord/channelRating";

/** discord.js が公開する全チャンネル型（別名を畳んだ実体）。 */
const ALL_TYPES = [
  ...new Set(Object.values(ChannelType).filter((v): v is ChannelType => typeof v === "number")),
];

const SELF_RATED = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
];

const INHERITING = [
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
];

const DM = [ChannelType.DM, ChannelType.GroupDM];

describe("isAgeRestricted — 全 ChannelType", () => {
  it("defaults every type to not age-restricted when nothing is set", () => {
    // 未知の型・将来の型で誤って展開しないこと。
    for (const type of ALL_TYPES) {
      expect(isAgeRestricted({ type })).toBe(false);
    }
  });

  it.each(SELF_RATED)("reads .nsfw for type %i", (type) => {
    expect(isAgeRestricted({ type, nsfw: true })).toBe(true);
    expect(isAgeRestricted({ type, nsfw: false })).toBe(false);
    expect(isAgeRestricted({ type, nsfw: null })).toBe(false);
    expect(isAgeRestricted({ type })).toBe(false);
  });

  it.each(INHERITING)("inherits the parent's .nsfw for thread type %i", (type) => {
    // スレッド自身は nsfw を持たない。ここを読み違えると
    // 「年齢制限チャンネル内のスレッド」が通常チャンネル扱いになる。
    expect(isAgeRestricted({ type, parent: { nsfw: true } })).toBe(true);
    expect(isAgeRestricted({ type, parent: { nsfw: false } })).toBe(false);
    expect(isAgeRestricted({ type, parent: null })).toBe(false);
    expect(isAgeRestricted({ type })).toBe(false);
  });

  it.each(INHERITING)("ignores a thread's own nsfw field for type %i", (type) => {
    expect(isAgeRestricted({ type, nsfw: true, parent: { nsfw: false } })).toBe(false);
  });

  it.each(DM)("treats dm type %i as not age-restricted", (type) => {
    expect(isAgeRestricted({ type })).toBe(false);
    expect(isAgeRestricted({ type, nsfw: true })).toBe(false);
  });

  it("treats categories and directories as not age-restricted", () => {
    for (const type of [ChannelType.GuildCategory, ChannelType.GuildDirectory]) {
      expect(isAgeRestricted({ type, nsfw: true })).toBe(false);
    }
  });

  it("treats an unknown future type as not age-restricted", () => {
    const future = 9_999 as ChannelType;
    expect(isAgeRestricted({ type: future, nsfw: true })).toBe(false);
  });
});

describe("isDmChannel", () => {
  it.each(DM)("recognises dm type %i", (type) => {
    expect(isDmChannel({ type })).toBe(true);
  });

  it("does not treat guild channels as dm", () => {
    for (const type of ALL_TYPES.filter((t) => !DM.includes(t))) {
      expect(isDmChannel({ type })).toBe(false);
    }
  });
});

describe("toChannelContext", () => {
  it("builds the context consumed by the policy", () => {
    const nsfwThread: ChannelLike = { type: ChannelType.PublicThread, parent: { nsfw: true } };
    expect(toChannelContext(nsfwThread)).toEqual({ channelIsNsfw: true, isDm: false });
    expect(toChannelContext({ type: ChannelType.DM })).toEqual({
      channelIsNsfw: false,
      isDm: true,
    });
  });
});
