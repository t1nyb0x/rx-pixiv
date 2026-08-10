import { ChannelType } from "discord.js";

import type { ChannelContext } from "#core/services/NsfwPolicy";

/**
 * 判定に必要な最小限の形。
 *
 * discord.js の巨大な `Channel` 型を要求しないことで、
 * 全 `ChannelType` を網羅するテーブルテストが素直に書ける。
 */
export interface ChannelLike {
  readonly type: ChannelType;
  readonly nsfw?: boolean | null;
  readonly parent?: { readonly nsfw?: boolean | null } | null;
}

/** `.nsfw` を自分で持つチャンネル型。 */
const SELF_RATED_TYPES: ReadonlySet<ChannelType> = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
]);

/**
 * `.nsfw` を持たず、**親から継承する**型。
 *
 * ここが沈黙する偽陰性の温床である。スレッドの `nsfw` は常に `undefined` なので、
 * そのまま読むと「年齢制限チャンネル内のスレッド」が通常チャンネル扱いになる。
 */
const INHERITING_TYPES: ReadonlySet<ChannelType> = new Set([
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
]);

const DM_TYPES: ReadonlySet<ChannelType> = new Set([ChannelType.DM, ChannelType.GroupDM]);

export function isDmChannel(channel: ChannelLike): boolean {
  return DM_TYPES.has(channel.type);
}

/**
 * チャンネルが年齢制限チャンネルか（ADR 0006）。
 *
 * **判定できない型はすべて「年齢制限チャンネルではない」に倒す。**
 * 未知の型・将来追加される型で誤って展開しないため。
 */
export function isAgeRestricted(channel: ChannelLike): boolean {
  if (SELF_RATED_TYPES.has(channel.type)) return channel.nsfw === true;
  if (INHERITING_TYPES.has(channel.type)) return channel.parent?.nsfw === true;
  // DM・カテゴリ・ディレクトリ・未知の型。
  return false;
}

export function toChannelContext(channel: ChannelLike): ChannelContext {
  return { channelIsNsfw: isAgeRestricted(channel), isDm: isDmChannel(channel) };
}
