import type { ContentRating } from "#core/models/ContentRating";
import type {
  IllustWork,
  NovelSeriesWork,
  NovelWork,
  PixivImage,
  PixivTag,
  UserRecentWork,
  UserWork,
  WorkStatistics,
} from "#core/models/PixivWork";
import type {
  AjaxIllustBody,
  AjaxIllustPagesBody,
  AjaxNovelBody,
  AjaxNovelSeriesBody,
  AjaxUserBody,
  AjaxUserProfileTopBody,
} from "#adapters/pixiv/schemas/ajax";

/**
 * `undefined` のキーを落とす。
 *
 * `exactOptionalPropertyTypes` の下では `{ x: undefined }` と `{}` は別物であり、
 * 前者は省略可能プロパティに代入できない。上流の欠損値をそのまま流すために使う。
 */
function compact<T extends object>(obj: T): { [K in keyof T]?: NonNullable<T[K]> } {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out as { [K in keyof T]?: NonNullable<T[K]> };
}

/** 小説の抜粋として保持する最大文字数（ADR 0013）。 */
export const NOVEL_EXCERPT_LENGTH = 300;

const R18_TAGS = new Set(["R-18", "R18"]);
const R18G_TAGS = new Set(["R-18G", "R18G"]);

function artworkUrl(id: string): string {
  return `https://www.pixiv.net/artworks/${id}`;
}

function userUrl(id: string): string {
  return `https://www.pixiv.net/users/${id}`;
}

/**
 * 年齢区分を組み立てる。
 *
 * **`xRestrict` と タグの2経路**で冗長に判定する（ADR 0006）。
 * 片方が壊れても、より制限の強いほうが採用される。
 *
 * **`sl`（sanity level）は使わない。** 全年齢作品でも 6 を返すことが実測で
 * 判明しており、判定に使うと全作品がセンシティブ扱いになる（ADR 0007 の実測結果）。
 * そのため v1 では `sensitive` を常に false とする。
 */
export function toContentRating(
  xRestrict: number | undefined,
  tags: readonly PixivTag[],
  aiType: number | undefined,
): ContentRating {
  const byRestrict = xRestrict === 2 ? "r18g" : xRestrict === 1 ? "r18" : "all";

  let byTag: ContentRating["level"] = "all";
  for (const tag of tags) {
    if (R18G_TAGS.has(tag.name)) {
      byTag = "r18g";
      break;
    }
    if (R18_TAGS.has(tag.name)) {
      byTag = "r18";
    }
  }

  // 2経路のうち制限の強いほうを採る。
  const order = { all: 0, r18: 1, r18g: 2 } as const;
  const level = order[byTag] > order[byRestrict] ? byTag : byRestrict;

  return {
    level,
    // v1 では判定手段が無い。判定表とフィールドは将来のために残す（ADR 0006）。
    sensitive: false,
    // pixiv の aiType は 0=未設定 / 1=AI 不使用 / 2=AI 使用。
    // 0 を「不使用」と断定しない（実測でシリーズに 1 が来ることを確認している）。
    ai: aiType === 2 ? "yes" : aiType === 1 ? "no" : "unknown",
    // xRestrict が読めた時点で権威ある情報である。
    confidence: xRestrict === undefined ? "inferred" : "authoritative",
  };
}

function toTags(tags: AjaxIllustBody["tags"]): PixivTag[] {
  return tags.map((t) => {
    const translatedName = t.translation?.en;
    return translatedName === undefined ? { name: t.tag } : { name: t.tag, translatedName };
  });
}

function toStatistics(body: {
  viewCount?: number | undefined;
  bookmarkCount?: number | undefined;
  commentCount?: number | undefined;
  likeCount?: number | undefined;
}): WorkStatistics | undefined {
  const stats = compact({
    views: body.viewCount,
    bookmarks: body.bookmarkCount,
    comments: body.commentCount,
    likes: body.likeCount,
  }) satisfies WorkStatistics;
  return Object.keys(stats).length > 0 ? stats : undefined;
}

const ILLUST_TYPES = { 0: "illust", 1: "manga", 2: "ugoira" } as const;

function toIllustType(illustType: number): IllustWork["illustType"] {
  return ILLUST_TYPES[illustType as keyof typeof ILLUST_TYPES] ?? "illust";
}

/**
 * `/ajax/illust/{id}/pages` のレスポンスを画像一覧へ写像する。
 *
 * **`/ajax/illust/{id}` の `body.urls` は使わない。** 無認証では全年齢作品でも
 * 全キーが null になるため、画像 URL はここからしか得られない（ADR 0003）。
 */
export function toPixivImages(pages: AjaxIllustPagesBody): PixivImage[] {
  return pages.map((page, index) => ({
    page: index,
    urls: compact({
      thumb: page.urls.thumb_mini,
      small: page.urls.small,
      regular: page.urls.regular,
      original: page.urls.original,
    }),
    ...compact({ width: page.width, height: page.height }),
  }));
}

/**
 * イラスト・マンガ・うごイラを `IllustWork` へ写像する。
 *
 * `pages` は省略可能。省略された場合（`/pages` が失敗した場合）は
 * **画像ゼロ枚のメタデータのみ**として返し、`pagesTruncated` を立てる。
 * R-18 作品では `/pages` が 404 になるため、これが通常の経路になる（ADR 0003）。
 */
export function mapAjaxIllust(
  body: AjaxIllustBody,
  pages: AjaxIllustPagesBody | undefined,
  fetchedAt: number,
): IllustWork {
  const tags = toTags(body.tags);
  const images = pages === undefined ? [] : toPixivImages(pages);
  const pagesTruncated = images.length < body.pageCount;

  return {
    kind: "illust",
    id: body.illustId,
    canonicalUrl: artworkUrl(body.illustId),
    title: body.illustTitle,
    author: {
      id: body.userId,
      name: body.userName,
      url: userUrl(body.userId),
    },
    rating: toContentRating(body.xRestrict, tags, body.aiType),
    source: "ajax",
    fetchedAt,
    partial: pagesTruncated,
    illustType: toIllustType(body.illustType),
    pageCount: body.pageCount,
    pages: images,
    pagesTruncated,
    tags,
    ...compact({
      description: body.description ?? body.illustComment,
      stats: toStatistics(body),
      createdAt: body.createDate ?? body.uploadDate,
    }),
  };
}

/**
 * 小説の本文から冒頭抜粋を切り出す。
 *
 * pixiv 独自記法（`[newpage]` `[chapter:...]` `[[rb:...]]` 等）と改行を
 * 保守的に除去してから切る。想定外の角括弧記法は丸ごと落とす。
 */
export function toNovelExcerpt(content: string | undefined): string | undefined {
  if (content === undefined) return undefined;

  const stripped = content
    // ルビは親文字だけ残す: [[rb:親 > ルビ]]
    .replace(/\[\[rb:\s*([^>\]]+?)\s*>\s*[^\]]*?\]\]/g, "$1")
    // リンクは表示文字だけ残す: [[jumpuri:表示 > URL]]
    .replace(/\[\[jumpuri:\s*([^>\]]+?)\s*>\s*[^\]]*?\]\]/g, "$1")
    // 残りの角括弧記法は丸ごと落とす（未知の記法もここで消える）
    .replace(/\[\[?[a-z]+[^\]]*\]?\]/gi, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

  if (stripped === "") return undefined;
  return stripped.length <= NOVEL_EXCERPT_LENGTH
    ? stripped
    : `${stripped.slice(0, NOVEL_EXCERPT_LENGTH)}…`;
}

/**
 * 小説を `NovelWork` へ写像する。
 *
 * **本文全文をドメインモデルに入れない。** 抜粋だけを保持することで、
 * 全文が描画層へ漏れる経路を構造的に塞ぐ（ADR 0013）。
 */
export function mapAjaxNovel(body: AjaxNovelBody, fetchedAt: number): NovelWork {
  const tags = toTags(body.tags);
  const series = body.seriesNavData;

  return {
    kind: "novel",
    id: body.id,
    canonicalUrl: `https://www.pixiv.net/novel/show.php?id=${body.id}`,
    title: body.title,
    author: {
      id: body.userId,
      name: body.userName,
      url: userUrl(body.userId),
    },
    rating: toContentRating(body.xRestrict, tags, body.aiType),
    source: "ajax",
    fetchedAt,
    partial: false,
    tags,
    ...compact({
      textCount: body.characterCount ?? body.wordCount,
      coverImage:
        body.coverUrl === undefined ? undefined : { page: 0, urls: { regular: body.coverUrl } },
      series:
        series?.seriesId !== undefined && series.title !== undefined
          ? { id: series.seriesId, title: series.title }
          : undefined,
      excerpt: toNovelExcerpt(body.content),
      createdAt: body.createDate ?? body.uploadDate,
    }),
  };
}

/**
 * 小説シリーズを `NovelSeriesWork` へ写像する。
 *
 * **`xRestrict` と `maxXRestrict` の強いほうを採る。**
 * シリーズ自体が全年齢でも配下に R-18 の話数を含みうるため、
 * シリーズの区分だけで判断すると R-18 を含むシリーズが通常チャンネルで
 * 展開されてしまう（ADR 0006 のフェイルクローズ）。
 */
export function mapAjaxNovelSeries(body: AjaxNovelSeriesBody, fetchedAt: number): NovelSeriesWork {
  const restrict = Math.max(body.xRestrict, body.maxXRestrict ?? 0);
  const tags: PixivTag[] = body.tags.map((name) => ({ name }));
  const coverUrls = body.cover?.urls;

  const coverImage: PixivImage | undefined =
    coverUrls === undefined
      ? undefined
      : {
          page: 0,
          urls: compact({
            thumb: coverUrls["128x128"],
            small: coverUrls["240mw"],
            regular: coverUrls["1200x1200"] ?? coverUrls["480mw"],
            original: coverUrls.original,
          }),
        };

  return {
    kind: "novel_series",
    id: body.id,
    canonicalUrl: `https://www.pixiv.net/novel/series/${body.id}`,
    title: body.title,
    author: {
      id: body.userId,
      name: body.userName,
      url: userUrl(body.userId),
    },
    rating: toContentRating(restrict, tags, body.aiType),
    source: "ajax",
    fetchedAt,
    partial: false,
    ...compact({
      description: body.caption,
      coverImage:
        coverImage !== undefined && Object.keys(coverImage.urls).length > 0
          ? coverImage
          : undefined,
      novelCount: body.publishedContentCount ?? body.total ?? body.displaySeriesContentCount,
    }),
  };
}

/**
 * ユーザープロフィールを `UserWork` へ写像する。
 *
 * 最近作は**1件ずつ年齢区分を持つ**。通常チャンネルでは
 * サムネイル単位でゲートをかけるため（ADR 0006）。
 */
export function mapAjaxUser(
  body: AjaxUserBody,
  profileTop: AjaxUserProfileTopBody | undefined,
  fetchedAt: number,
  recentLimit = 4,
): UserWork {
  const entries = [...(profileTop?.illusts ?? []), ...(profileTop?.manga ?? [])];

  const recentWorks: UserRecentWork[] = entries
    .filter((entry) => entry.url !== undefined)
    .slice(0, recentLimit)
    .map((entry) => ({
      id: entry.id,
      canonicalUrl: artworkUrl(entry.id),
      image: { page: 0, urls: compact({ thumb: entry.url, small: entry.url }) },
      rating: toContentRating(entry.xRestrict, [], entry.aiType),
    }));

  return {
    kind: "user",
    id: body.userId,
    canonicalUrl: userUrl(body.userId),
    title: body.name,
    author: {
      id: body.userId,
      name: body.name,
      url: userUrl(body.userId),
      ...compact({ avatarUrl: body.imageBig ?? body.image }),
    },
    // プロフィール自体には年齢区分が無い。個々の最近作で判定する。
    rating: { level: "all", sensitive: false, ai: "unknown", confidence: "authoritative" },
    source: "ajax",
    fetchedAt,
    partial: profileTop === undefined,
    ...compact({ bio: body.comment }),
    counts: compact({ followers: body.following }),
    recentWorks,
  };
}
