import type { PixivTag } from "#core/models/PixivWork";

const META_PATTERN =
  /<meta[^>]*?(?:property|name)="((?:og|twitter):[^"]+)"[^>]*?content="([^"]*)"/gi;
const META_PATTERN_REVERSED =
  /<meta[^>]*?content="([^"]*)"[^>]*?(?:property|name)="((?:og|twitter):[^"]+)"/gi;

/**
 * OGP / Twitter Card のメタタグを読む。
 *
 * 対象（phixiv・pixiv 作品ページ）はいずれも機械生成の小さな head なので、
 * 専用の HTML パーサを持ち込まず正規表現で読む。属性順が入れ替わる実装もあるため
 * 両方の並びを試す。構造が変われば必要なキーが取れず `parse_error` として後段へ落ちる。
 */
export function parseMetaTags(html: string): Map<string, string> {
  const meta = new Map<string, string>();
  const add = (key: string | undefined, value: string | undefined): void => {
    if (key !== undefined && value !== undefined && !meta.has(key)) {
      meta.set(key, decodeEntities(value));
    }
  };

  for (const match of html.matchAll(META_PATTERN)) add(match[1], match[2]);
  for (const match of html.matchAll(META_PATTERN_REVERSED)) add(match[2], match[1]);
  return meta;
}

/** `#tag1, #tag2, ...` 形式のタグ列挙を読む（phixiv の `og:image:alt`）。 */
export function parseHashTagList(value: string | undefined): PixivTag[] {
  if (value === undefined) return [];
  return value
    .split(",")
    .map((part) => part.trim().replace(/^#/, ""))
    .filter((name) => name !== "")
    .map((name) => ({ name }));
}

export function decodeEntities(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}
