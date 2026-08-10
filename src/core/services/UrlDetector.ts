import { PROCESSING_LIMITS } from "#config/constants";
import type { PixivRef } from "#core/models/PixivRef";
import { pixivRefKey } from "#core/models/PixivRef";

const URL_CANDIDATE = /https?:\/\/[^\s<>"'`]+/giu;
const TRAILING_PUNCTUATION = /[.,!?;:)\]}。、！？；：）】」』]+$/u;
const PIXIV_HOSTS = new Set(["pixiv.net", "www.pixiv.net"]);
const LOCALE_SEGMENT = /^[a-z]{2}(?:-[a-z]{2})?$/iu;
const DECIMAL_ID = /^\d+$/u;

export function detect(
  content: string,
  limit: number = PROCESSING_LIMITS.urlsPerMessage,
): PixivRef[] {
  const maximum = Number.isFinite(limit)
    ? Math.max(0, Math.min(Math.floor(limit), PROCESSING_LIMITS.urlsPerMessage))
    : 0;
  if (maximum === 0) return [];

  const visibleContent = maskSuppressedRanges(content);
  const refs: PixivRef[] = [];
  const seen = new Set<string>();

  for (const match of visibleContent.matchAll(URL_CANDIDATE)) {
    const candidate = match[0].replace(TRAILING_PUNCTUATION, "");
    const ref = parsePixivRef(candidate);
    if (ref === undefined) continue;

    const key = pixivRefKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
    if (refs.length === maximum) break;
  }

  return refs;
}

function maskSuppressedRanges(content: string): string {
  return [
    /```[\s\S]*?(?:```|$)/gu,
    /(`+)[\s\S]*?\1/gu,
    /`+[^`\r\n]*$/gmu,
    /<https?:\/\/[^>\r\n]+>/giu,
    /\|\|[\s\S]*?(?:\|\||$)/gu,
  ].reduce((result, pattern) => result.replace(pattern, mask), content);
}

function mask(value: string): string {
  return value.replace(/[^\r\n]/gu, " ");
}

function parsePixivRef(candidate: string): PixivRef | undefined {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (hostname === "pixiv.me") return parseShortlink(url);
  if (!PIXIV_HOSTS.has(hostname)) return undefined;

  const segments = url.pathname.split("/").filter(Boolean);
  const localized = segments.length === 3 && LOCALE_SEGMENT.test(segments[0] as string);
  const routeOffset = localized ? 1 : 0;
  const route = segments[routeOffset];
  const id = segments[routeOffset + 1];

  if (segments.length === routeOffset + 2 && route === "artworks" && isId(id)) {
    return artworkRef(id);
  }
  if (segments.length === 2 && route === "i" && isId(id)) return artworkRef(id);
  if (segments.length === routeOffset + 2 && route === "users" && isId(id)) return userRef(id);

  if (segments.length === 3 && segments[0] === "novel" && segments[1] === "series") {
    const seriesId = segments[2];
    if (isId(seriesId)) {
      return {
        kind: "novel_series",
        id: seriesId,
        canonicalUrl: `https://www.pixiv.net/novel/series/${seriesId}`,
      };
    }
  }

  if (segments.length === 1 && segments[0] === "member_illust.php") {
    const artworkId = url.searchParams.get("illust_id");
    if (isId(artworkId)) return artworkRef(artworkId);
  }
  if (segments.length === 2 && segments[0] === "novel" && segments[1] === "show.php") {
    const novelId = url.searchParams.get("id");
    if (isId(novelId)) return novelRef(novelId);
  }
  if (segments.length === 1 && segments[0] === "member.php") {
    const userId = url.searchParams.get("id");
    if (isId(userId)) return userRef(userId);
  }

  return undefined;
}

function parseShortlink(url: URL): PixivRef | undefined {
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return undefined;
  const name = segments[0] as string;
  return { kind: "shortlink", name, canonicalUrl: `https://pixiv.me/${name}` };
}

function isId(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && DECIMAL_ID.test(value);
}

function artworkRef(id: string): PixivRef {
  return { kind: "artwork", id, canonicalUrl: `https://www.pixiv.net/artworks/${id}` };
}

function novelRef(id: string): PixivRef {
  return {
    kind: "novel",
    id,
    canonicalUrl: `https://www.pixiv.net/novel/show.php?id=${id}`,
  };
}

function userRef(id: string): PixivRef {
  return { kind: "user", id, canonicalUrl: `https://www.pixiv.net/users/${id}` };
}
