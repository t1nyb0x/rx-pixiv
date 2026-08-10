import type { RenderField, RenderItem, RenderPlan } from "#core/models/RenderPlan";
import type { PixivWork } from "#core/models/PixivWork";
import type { SelectedMedia } from "#core/services/MediaSelector";
import { requiresSpoiler, type ExpansionDecision } from "#core/services/NsfwPolicy";

const NOVEL_EXCERPT_LENGTH = 300;

export interface ComposeMessageOptions {
  readonly decision: ExpansionDecision;
  readonly media?: SelectedMedia;
  /** 選択後の各メディアに対する個別spoiler指定。未指定時は作品全体の判定に従う。 */
  readonly mediaSpoilers?: readonly boolean[];
}

/** `PixivWork` と安全判定から、Discord非依存の表示計画を作る。 */
export function composeMessage(work: PixivWork, options: ComposeMessageOptions): RenderPlan {
  if (options.decision === "skip") return { items: [] };
  if (options.decision === "link_only") {
    return {
      content: `このpixiv作品はこのチャンネルでは展開できません。\n${work.canonicalUrl}`,
      items: [],
      suppressLinkPreviews: true,
    };
  }

  const spoiler = requiresSpoiler(options.decision);
  const fields = fieldsFor(work, options.media);
  const item: RenderItem = {
    url: work.canonicalUrl,
    spoiler,
    title: work.title,
    author: {
      name: work.author.name,
      url: work.author.url,
      ...(work.author.avatarUrl === undefined ? {} : { iconUrl: work.author.avatarUrl }),
    },
    fields,
    media: (options.media?.urls ?? []).map((url, index) => ({
      url,
      description: `${work.title} (${index + 1}/${options.media?.totalPages ?? 1})`,
      spoiler: options.mediaSpoilers?.[index] ?? spoiler,
    })),
    ...descriptionFor(work),
  };

  return { items: [item] };
}

function descriptionFor(work: PixivWork): Pick<RenderItem, "description"> | Record<string, never> {
  const description =
    work.kind === "novel"
      ? excerptNovel(work.excerpt)
      : work.kind === "novel_series"
        ? normalizeText(work.description)
        : work.kind === "illust"
          ? normalizeText(work.description)
          : normalizeText(work.bio);
  return description === undefined ? {} : { description };
}

function fieldsFor(work: PixivWork, media: SelectedMedia | undefined): readonly RenderField[] {
  const fields: RenderField[] = [];

  if (work.kind === "illust" || work.kind === "novel") {
    if (work.tags.length > 0) {
      fields.push({ name: "タグ", value: work.tags.map((tag) => `#${tag.name}`).join(" ") });
    }
    if (work.createdAt !== undefined) {
      fields.push({ name: "投稿日", value: formatJst(work.createdAt), inline: true });
    }
  }

  if (work.kind === "illust") {
    const kind =
      work.illustType === "ugoira"
        ? "うごイラ（静止画のみ表示）"
        : work.illustType === "manga"
          ? "マンガ"
          : "イラスト";
    fields.push({ name: "種別", value: kind, inline: true });
    if (media !== undefined && media.omitted > 0) {
      fields.push({
        name: "ページ",
        value: `全${formatCount(media.totalPages)}ページ中${formatCount(media.urls.length)}ページを表示`,
      });
    }
    if (work.stats !== undefined) {
      const stats = [
        stat("閲覧", work.stats.views),
        stat("ブックマーク", work.stats.bookmarks),
        stat("いいね", work.stats.likes),
      ].filter((value): value is string => value !== undefined);
      if (stats.length > 0) fields.push({ name: "反応", value: stats.join(" / ") });
    }
  } else if (work.kind === "novel") {
    if (work.textCount !== undefined) {
      fields.push({ name: "文字数", value: `${formatCount(work.textCount)}字`, inline: true });
    }
    if (work.series !== undefined) fields.push({ name: "シリーズ", value: work.series.title });
  } else if (work.kind === "novel_series" && work.novelCount !== undefined) {
    fields.push({ name: "作品数", value: `${formatCount(work.novelCount)}話`, inline: true });
  } else if (work.kind === "user" && work.counts !== undefined) {
    const counts = [
      stat("作品", work.counts.artworks),
      stat("小説", work.counts.novels),
      stat("フォロワー", work.counts.followers),
    ].filter((value): value is string => value !== undefined);
    if (counts.length > 0) fields.push({ name: "プロフィール", value: counts.join(" / ") });
  }

  return fields;
}

function stat(label: string, value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${label} ${formatCount(value)}`;
}

export function excerptNovel(raw: string | undefined): string | undefined {
  const normalized = normalizeText(raw);
  if (normalized === undefined) return undefined;
  const characters = Array.from(normalized);
  return characters.length <= NOVEL_EXCERPT_LENGTH
    ? normalized
    : `${characters.slice(0, NOVEL_EXCERPT_LENGTH).join("")}…`;
}

function normalizeText(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const normalized = raw
    .replace(/<[^>]*>/gu, " ")
    .replace(/\[(?:newpage|chapter:[^\]]*|pixivimage:[^\]]*)\]/giu, " ")
    .replace(/\[\[jumpuri:[^\]]*\]\]/giu, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replace(/\s+/gu, " ")
    .trim();
  return normalized === "" ? undefined : normalized;
}

export function formatCount(value: number): string {
  if (value >= 10_000) {
    const scaled = value / 10_000;
    const digits = scaled >= 10 ? 0 : 1;
    return `${scaled.toFixed(digits).replace(/\.0$/u, "")}万`;
  }
  return new Intl.NumberFormat("ja-JP").format(value);
}

function formatJst(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
