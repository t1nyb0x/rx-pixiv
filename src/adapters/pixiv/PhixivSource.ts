import type { FetchError } from "#core/models/errors";
import type { ArtworkRef, PixivRef } from "#core/models/PixivRef";
import type { IllustWork, PixivTag, PixivWork, SourceName } from "#core/models/PixivWork";
import { err, ok, type Result } from "#core/models/Result";
import type { FetchContext, SourceCapabilities } from "#core/ports/IPixivSource";
import { BasePixivSource, type BasePixivSourceOptions } from "#adapters/pixiv/BasePixivSource";
import { toContentRating } from "#adapters/pixiv/mappers/ajaxMapper";

export const PHIXIV_DEFAULT_BASE_URL = "https://phixiv.net";

/**
 * phixiv は **bot の User-Agent でなければ OGP を返さず 307 で pixiv へ転送する**。
 * 埋め込み修正サービスとしての本来の用途がそれなので、こちらから名乗る必要がある。
 */
export const PHIXIV_USER_AGENT =
  "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)";

export interface PhixivSourceOptions extends Omit<BasePixivSourceOptions, "headers"> {
  readonly baseUrl?: string;
  readonly now?: () => number;
}

/**
 * phixiv を叩く二次経路（ADR 0003）。
 *
 * 一次経路（Ajax）に対する位置づけ:
 * - **年齢区分の権威は持たない。** タグからの推定に留まるため `inferred`
 * - **1リクエストにつき画像1枚**（`/artworks/{id}/{index}` で指定）。`multiPage: false`
 * - ただし **R-18 作品の画像 URL を返せる**。Ajax の `/pages` は R-18 で 404 になるため、
 *   **無認証で R-18 の画像を出せる唯一の経路**である（実測 2026-08-10）
 *
 * 本家 HazelTheWitch/phixiv は 2026-06 にアーカイブ済み。フォークの寿命も保証されない。
 * `PHIXIV_BASE_URL` で差し替え可能にし、`SOURCE_CHAIN` で経路ごと外せるようにしてある。
 */
export class PhixivSource extends BasePixivSource {
  public readonly name: SourceName = "phixiv";

  public readonly capabilities: SourceCapabilities = {
    supportedKinds: ["artwork"],
    ratingAuthority: "inferred",
    multiPage: false,
  };

  readonly #baseUrl: string;
  readonly #now: () => number;

  public constructor(options: PhixivSourceOptions) {
    super({ httpClient: options.httpClient, headers: { "user-agent": PHIXIV_USER_AGENT } });
    this.#baseUrl = (options.baseUrl ?? PHIXIV_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#now = options.now ?? Date.now;
  }

  public async fetch(ref: PixivRef, context: FetchContext): Promise<Result<PixivWork, FetchError>> {
    if (ref.kind !== "artwork") return err({ kind: "unsupported", reason: "capability" });
    return this.#fetchArtwork(ref, context);
  }

  async #fetchArtwork(
    ref: ArtworkRef,
    context: FetchContext,
  ): Promise<Result<PixivWork, FetchError>> {
    const html = await this.getText(`${this.#baseUrl}/artworks/${ref.id}`, context);
    if (!html.ok) return html;

    const meta = parseOgpMeta(html.value);
    const title = meta.get("og:title");
    const image = meta.get("og:image");

    // タイトルが取れない＝OGP ページではない（307 の転送先など）。
    if (title === undefined) return err({ kind: "parse_error", sample: html.value.slice(0, 200) });

    const tags = parseTags(meta.get("og:image:alt"));
    const { title: workTitle, authorName } = splitTitle(title);

    const work: IllustWork = {
      kind: "illust",
      id: ref.id,
      canonicalUrl: `https://www.pixiv.net/artworks/${ref.id}`,
      title: workTitle,
      author: { id: "", name: authorName ?? "", url: `https://www.pixiv.net/artworks/${ref.id}` },
      // タグ由来のみ。xRestrict が無いので confidence は inferred に落ちる。
      rating: toContentRating(undefined, tags, undefined),
      source: "phixiv",
      fetchedAt: this.#now(),
      partial: true,
      illustType: "illust",
      pageCount: image === undefined ? 0 : 1,
      pages: image === undefined ? [] : [{ page: 0, urls: { regular: image } }],
      pagesTruncated: true,
      tags,
      ...(meta.get("og:description") === undefined
        ? {}
        : { description: meta.get("og:description")! }),
    };

    return ok(work);
  }
}

const META_PATTERN = /<meta\s+(?:property|name)="(og:[^"]+)"\s+content="([^"]*)"/gi;

/**
 * phixiv の OGP メタタグを読む。
 *
 * 生成される HTML は機械的で小さいため、専用パーサを持ち込まず正規表現で読む。
 * 構造が変われば `og:title` が取れなくなり `parse_error` として後段へ落ちる。
 */
export function parseOgpMeta(html: string): Map<string, string> {
  const meta = new Map<string, string>();
  for (const match of html.matchAll(META_PATTERN)) {
    const [, key, value] = match;
    if (key !== undefined && value !== undefined && !meta.has(key)) {
      meta.set(key, decodeEntities(value));
    }
  }
  return meta;
}

/** `og:image:alt` は `#tag1, #tag2, ...` 形式でタグを列挙する。 */
export function parseTags(alt: string | undefined): PixivTag[] {
  if (alt === undefined) return [];
  return alt
    .split(",")
    .map((part) => part.trim().replace(/^#/, ""))
    .filter((name) => name !== "")
    .map((name) => ({ name }));
}

/** `og:title` は `作品タイトル by (@作者名)` 形式。 */
export function splitTitle(raw: string): { title: string; authorName?: string } {
  const match = /^(.*)\s+by\s+\(@(.*)\)$/s.exec(raw);
  if (match?.[1] === undefined || match[2] === undefined) return { title: raw };
  return { title: match[1], authorName: match[2] };
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}
