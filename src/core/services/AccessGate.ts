import type { PixivRef } from "#core/models/PixivRef";
import type { IBanRepository } from "#core/ports/IBanRepository";
import type { IBlockRepository } from "#core/ports/IBlockRepository";
import type { ICooldownStore } from "#core/ports/ICooldownStore";

export type GateDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: GateRejection };

export type GateRejection =
  | "banned_user"
  | "banned_guild"
  | "channel_not_allowed"
  | "cooldown"
  | "store_unavailable";

export interface MessageOrigin {
  readonly userId: string;
  readonly guildId?: string | undefined;
  readonly channelId: string;
}

export interface AccessGateOptions {
  readonly banRepository: IBanRepository;
  readonly cooldowns: ICooldownStore;
  readonly blockRepository: IBlockRepository;
  readonly allowedGuildIds?: readonly string[];
  readonly allowedChannelIds?: readonly string[];
  readonly userCooldownMs?: number;
  readonly channelCooldownMs?: number;
  /** 永続ストアを読めないときに通すか。既定は `false`（フェイルクローズ）。 */
  readonly allowWhenStoreUnavailable?: boolean;
  readonly ownerUserId?: string;
  /** 永続ストアの接続・preload状態。falseなら既定でフェイルクローズ。 */
  readonly storeAvailable?: () => boolean;
}

/**
 * メッセージを処理してよいかを、**安い順に**判定する（ADR 0015）。
 *
 * 順序が設計そのものである。禁止とクールダウンを URL 検出より**前**に置くことで、
 * 濫用時に本文解析すら行わせない。
 *
 * ストアを読めないときは既定でフェイルクローズする（ADR 0016）。
 * ban できていない状態で動き続けるより、止まるほうがよい。
 */
export class AccessGate {
  readonly #bans: IBanRepository;
  readonly #cooldowns: ICooldownStore;
  readonly #blocks: IBlockRepository;
  readonly #allowedGuildIds: ReadonlySet<string>;
  readonly #allowedChannelIds: ReadonlySet<string>;
  readonly #userCooldownMs: number;
  readonly #channelCooldownMs: number;
  readonly #allowWhenStoreUnavailable: boolean;
  readonly #ownerUserId: string | undefined;
  readonly #storeAvailable: () => boolean;

  public constructor(options: AccessGateOptions) {
    this.#bans = options.banRepository;
    this.#cooldowns = options.cooldowns;
    this.#blocks = options.blockRepository;
    this.#allowedGuildIds = new Set(options.allowedGuildIds ?? []);
    this.#allowedChannelIds = new Set(options.allowedChannelIds ?? []);
    this.#userCooldownMs = options.userCooldownMs ?? 10_000;
    this.#channelCooldownMs = options.channelCooldownMs ?? 5_000;
    this.#allowWhenStoreUnavailable = options.allowWhenStoreUnavailable ?? false;
    this.#ownerUserId = options.ownerUserId;
    this.#storeAvailable = options.storeAvailable ?? (() => true);
  }

  /** URL 検出より前に通す判定。 */
  public async check(origin: MessageOrigin): Promise<GateDecision> {
    const isOwner = this.#ownerUserId !== undefined && origin.userId === this.#ownerUserId;

    if (!this.#storeAvailable() && !this.#allowWhenStoreUnavailable) {
      return reject("store_unavailable");
    }

    // 1. 禁止（利用者・サーバー）
    try {
      if (await this.#bans.find({ kind: "user", id: origin.userId })) {
        return reject("banned_user");
      }
      if (
        origin.guildId !== undefined &&
        (await this.#bans.find({ kind: "guild", id: origin.guildId }))
      ) {
        return reject("banned_guild");
      }
    } catch {
      // 禁止を読めない＝ban が効いているか分からない。既定では止まる。
      if (!this.#allowWhenStoreUnavailable) return reject("store_unavailable");
    }

    // 2. 許可リスト（空なら全許可）
    if (!this.#isChannelAllowed(origin)) return reject("channel_not_allowed");

    // 3. クールダウン（オーナーは対象外）
    if (!isOwner && !(await this.#passesCooldown(origin))) return reject("cooldown");

    return { allowed: true };
  }

  /**
   * 展開拒否リストに載っているか。**取得の前**に呼ぶ（ADR 0015）。
   *
   * 拒否すると決めている作品に対して pixiv へリクエストを飛ばさない。
   */
  public async isBlocked(ref: PixivRef, authorPixivUserId?: string): Promise<boolean> {
    if (!this.#storeAvailable()) return !this.#allowWhenStoreUnavailable;
    try {
      if (ref.kind === "artwork") {
        if (await this.#blocks.find({ kind: "artwork", id: ref.id })) return true;
      } else if (ref.kind === "user") {
        if (await this.#blocks.find({ kind: "user", id: ref.id })) return true;
      }
      if (authorPixivUserId !== undefined) {
        if (await this.#blocks.find({ kind: "user", id: authorPixivUserId })) return true;
      }
      return false;
    } catch {
      // 展開拒否を読めない＝削除要請に応じられているか分からない。既定では展開しない。
      return !this.#allowWhenStoreUnavailable;
    }
  }

  #isChannelAllowed(origin: MessageOrigin): boolean {
    if (this.#allowedGuildIds.size > 0) {
      if (origin.guildId === undefined || !this.#allowedGuildIds.has(origin.guildId)) return false;
    }
    if (this.#allowedChannelIds.size > 0 && !this.#allowedChannelIds.has(origin.channelId)) {
      return false;
    }
    return true;
  }

  async #passesCooldown(origin: MessageOrigin): Promise<boolean> {
    try {
      // 利用者を先に消費する。チャンネル側だけ消費して弾く無駄を避ける。
      if (
        !(await this.#cooldowns.consume({ kind: "user", id: origin.userId }, this.#userCooldownMs))
      ) {
        return false;
      }
      return await this.#cooldowns.consume(
        { kind: "channel", id: origin.channelId },
        this.#channelCooldownMs,
      );
    } catch {
      // クールダウンは安全側の判定に影響しないため、読めなくても通す（ADR 0016）。
      return true;
    }
  }
}

function reject(reason: GateRejection): GateDecision {
  return { allowed: false, reason };
}
