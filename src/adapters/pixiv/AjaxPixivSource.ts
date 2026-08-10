import type { FetchError } from "#core/models/errors";
import type { ArtworkRef, NovelRef, PixivRef, UserRef } from "#core/models/PixivRef";
import type { PixivWork, SourceName } from "#core/models/PixivWork";
import { err, ok, type Result } from "#core/models/Result";
import type { FetchContext, SourceCapabilities } from "#core/ports/IPixivSource";
import { BasePixivSource, type BasePixivSourceOptions } from "#adapters/pixiv/BasePixivSource";
import { mapAjaxIllust, mapAjaxNovel, mapAjaxUser } from "#adapters/pixiv/mappers/ajaxMapper";
import {
  ajaxEnvelopeSchema,
  ajaxIllustBodySchema,
  ajaxIllustPagesBodySchema,
  ajaxNovelBodySchema,
  ajaxUserBodySchema,
  ajaxUserProfileTopBodySchema,
  type AjaxIllustPagesBody,
  type AjaxUserProfileTopBody,
} from "#adapters/pixiv/schemas/ajax";

const AJAX_BASE = "https://www.pixiv.net/ajax";

/**
 * エンベロープが `error: true` を返した、または `body` が欠けたときの失敗。
 *
 * HTTP は 200 なのに中身が無い状態であり、上流の仕様変更か想定外の応答である。
 * `not_found` ではなく `parse_error` として扱い、後段の経路へフォールバックさせる。
 */
function envelopeError(message: string | undefined): FetchError {
  return message === undefined ? { kind: "parse_error" } : { kind: "parse_error", sample: message };
}

const illustEnvelope = ajaxEnvelopeSchema(ajaxIllustBodySchema);
const pagesEnvelope = ajaxEnvelopeSchema(ajaxIllustPagesBodySchema);
const novelEnvelope = ajaxEnvelopeSchema(ajaxNovelBodySchema);
const userEnvelope = ajaxEnvelopeSchema(ajaxUserBodySchema);
const profileTopEnvelope = ajaxEnvelopeSchema(ajaxUserProfileTopBodySchema);

export interface AjaxPixivSourceOptions extends BasePixivSourceOptions {
  /** テストから時刻を固定するための注入点。 */
  readonly now?: () => number;
}

/**
 * 公式 Ajax API を叩く一次経路（ADR 0003）。
 *
 * 無認証でも `xRestrict` が取得できるため、**年齢区分を `authoritative` に確定できる**
 * 唯一の経路である（ADR 0007 の実測結果）。
 *
 * `novel_series` は未対応。`/ajax/novel/series/{id}` のレスポンス形を実データで
 * 確認できていないため、推測で実装しない。連鎖が後段の経路へ委ねる。
 */
export class AjaxPixivSource extends BasePixivSource {
  public readonly name: SourceName = "ajax";

  public readonly capabilities: SourceCapabilities = {
    supportedKinds: ["artwork", "novel", "user"],
    ratingAuthority: "authoritative",
    multiPage: true,
  };

  readonly #now: () => number;

  public constructor(options: AjaxPixivSourceOptions) {
    super(options);
    this.#now = options.now ?? Date.now;
  }

  public async fetch(ref: PixivRef, context: FetchContext): Promise<Result<PixivWork, FetchError>> {
    switch (ref.kind) {
      case "artwork":
        return this.#fetchArtwork(ref, context);
      case "novel":
        return this.#fetchNovel(ref, context);
      case "user":
        return this.#fetchUser(ref, context);
      default:
        return err({ kind: "unsupported", reason: "capability" });
    }
  }

  async #fetchArtwork(
    ref: ArtworkRef,
    context: FetchContext,
  ): Promise<Result<PixivWork, FetchError>> {
    const envelope = await this.getJson(`${AJAX_BASE}/illust/${ref.id}`, illustEnvelope, context);
    if (!envelope.ok) return envelope;

    const body = envelope.value.body;
    if (envelope.value.error || body === undefined) {
      return err(envelopeError(envelope.value.message));
    }

    const pages = await this.#fetchPages(ref, context);
    return ok(mapAjaxIllust(body, pages, this.#now()));
  }

  /**
   * 画像一覧を取得する。**失敗しても作品全体を失敗させない。**
   *
   * R-18 作品では `/pages` が **404 を返す**。作品自体は実在し、
   * `/ajax/illust/{id}` は 200 でメタデータを返している。
   * ここで `not_found` を上へ流すと、**実在する作品に「見つかりません」と誤報する**
   * （ADR 0003「404 の取り扱い」）。
   *
   * したがって、あらゆる失敗を `undefined`（＝画像ゼロ枚）へ潰す。
   * 呼び出し側の写像が `pagesTruncated` を立てる。
   */
  async #fetchPages(
    ref: ArtworkRef,
    context: FetchContext,
  ): Promise<AjaxIllustPagesBody | undefined> {
    const envelope = await this.getJson(
      `${AJAX_BASE}/illust/${ref.id}/pages`,
      pagesEnvelope,
      context,
    );
    if (!envelope.ok) return undefined;
    if (envelope.value.error) return undefined;
    return envelope.value.body;
  }

  async #fetchNovel(ref: NovelRef, context: FetchContext): Promise<Result<PixivWork, FetchError>> {
    const envelope = await this.getJson(`${AJAX_BASE}/novel/${ref.id}`, novelEnvelope, context);
    if (!envelope.ok) return envelope;

    const body = envelope.value.body;
    if (envelope.value.error || body === undefined) {
      return err(envelopeError(envelope.value.message));
    }

    return ok(mapAjaxNovel(body, this.#now()));
  }

  async #fetchUser(ref: UserRef, context: FetchContext): Promise<Result<PixivWork, FetchError>> {
    const envelope = await this.getJson(
      `${AJAX_BASE}/user/${ref.id}?full=1`,
      userEnvelope,
      context,
    );
    if (!envelope.ok) return envelope;

    const body = envelope.value.body;
    if (envelope.value.error || body === undefined) {
      return err(envelopeError(envelope.value.message));
    }

    const profileTop = await this.#fetchProfileTop(ref, context);
    return ok(mapAjaxUser(body, profileTop, this.#now()));
  }

  /** 最近作は付加情報。取得に失敗してもプロフィール自体は返す。 */
  async #fetchProfileTop(
    ref: UserRef,
    context: FetchContext,
  ): Promise<AjaxUserProfileTopBody | undefined> {
    const envelope = await this.getJson(
      `${AJAX_BASE}/user/${ref.id}/profile/top`,
      profileTopEnvelope,
      context,
    );
    if (!envelope.ok) return undefined;
    if (envelope.value.error) return undefined;
    return envelope.value.body;
  }
}
