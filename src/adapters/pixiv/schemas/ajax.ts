import { z } from "zod";

/**
 * pixiv の非公開 Ajax API のレスポンススキーマ。
 *
 * 方針:
 * - **実際に消費するフィールドだけ**を記述する。全フィールドを写経しない
 *   （Plan 0005 項目1）。未知のフィールドは zod が黙って落とす
 * - 上流は予告なく変わるため、消費するフィールドも**必須は最小限**に留める。
 *   欠けたら `parse_error` として経路を落とし、後段へフォールバックさせる
 *   （ADR 0003 / ADR 0004）
 * - `sl`（sanity level）は**あえて読まない**。全年齢作品でも 6 を返すため
 *   年齢判定に使えないことが実測で判明している（ADR 0006 / ADR 0007）
 */

/** 数値 ID が文字列でも数値でも来うるため吸収する。 */
const idLike = z.union([z.string(), z.number()]).transform((v) => String(v));

/** pixiv は「値なし」を null でも空文字でも返す。両方 undefined に寄せる。 */
const nullableText = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (v === null || v === undefined || v === "" ? undefined : v));

const nullableUrl = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (v === null || v === undefined || v === "" ? undefined : v));

const count = z.number().int().nonnegative().optional();

/** 年齢区分は未知値を全年齢へ倒さない。仕様変更時は parse_error で安全に停止する。 */
const xRestrict = z.union([z.literal(0), z.literal(1), z.literal(2)]);

/** pixiv は「該当なし」を欠落ではなく null で返すことがある（実測: `maxXRestrict`）。 */
const nullableXRestrict = z
  .union([xRestrict, z.null()])
  .optional()
  .transform((v) => (v === null ? undefined : v));

const tagEntry = z.object({
  tag: z.string(),
  translation: z.object({ en: z.string().optional() }).partial().optional(),
});

const tagContainer = z
  .object({ tags: z.array(tagEntry).optional() })
  .optional()
  .transform((v) => v?.tags ?? []);

/**
 * `/ajax/illust/{id}` の `body.urls`。
 *
 * **実測により、無認証では全年齢作品でも全キーが null になる。**
 * 画像 URL は `/ajax/illust/{id}/pages` からしか取得できない（ADR 0003）。
 * ここを画像の供給源として当てにしてはならない。
 */
const illustTopUrls = z
  .object({
    mini: nullableUrl,
    thumb: nullableUrl,
    small: nullableUrl,
    regular: nullableUrl,
    original: nullableUrl,
  })
  .partial()
  .optional();

export const ajaxIllustBodySchema = z.object({
  illustId: idLike,
  illustTitle: z.string(),
  description: nullableText,
  illustComment: nullableText,
  createDate: nullableText,
  uploadDate: nullableText,
  /** 0=イラスト / 1=マンガ / 2=うごイラ */
  illustType: z.number().int(),
  /** 0=全年齢 / 1=R-18 / 2=R-18G。年齢判定の一次情報 */
  xRestrict,
  /** 0=AI 不使用 / 2=AI 使用 */
  aiType: z.number().int().optional(),
  pageCount: z.number().int().positive(),
  userId: idLike,
  userName: z.string(),
  userAccount: nullableText,
  tags: tagContainer,
  urls: illustTopUrls,
  likeCount: count,
  bookmarkCount: count,
  viewCount: count,
  commentCount: count,
});

export type AjaxIllustBody = z.infer<typeof ajaxIllustBodySchema>;

const pageUrls = z.object({
  thumb_mini: nullableUrl,
  small: nullableUrl,
  regular: nullableUrl,
  original: nullableUrl,
});

export const ajaxIllustPagesBodySchema = z.array(
  z.object({
    urls: pageUrls,
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  }),
);

export type AjaxIllustPagesBody = z.infer<typeof ajaxIllustPagesBodySchema>;

export const ajaxNovelBodySchema = z.object({
  id: idLike,
  title: z.string(),
  userId: idLike,
  userName: z.string(),
  /** 本文全文。**冒頭抜粋のみを表示する**（ADR 0013）。全文を出力してはならない */
  content: nullableText,
  coverUrl: nullableUrl,
  description: nullableText,
  createDate: nullableText,
  uploadDate: nullableText,
  xRestrict,
  aiType: z.number().int().optional(),
  characterCount: count,
  wordCount: count,
  tags: tagContainer,
  likeCount: count,
  bookmarkCount: count,
  viewCount: count,
  commentCount: count,
  seriesNavData: z
    .union([z.object({ seriesId: idLike, title: z.string() }).partial(), z.null()])
    .optional()
    .transform((v) => (v === null ? undefined : v)),
});

export type AjaxNovelBody = z.infer<typeof ajaxNovelBodySchema>;

export const ajaxUserBodySchema = z.object({
  userId: idLike,
  name: z.string(),
  image: nullableUrl,
  imageBig: nullableUrl,
  comment: nullableText,
  webpage: nullableUrl,
  following: count,
  mypixivCount: count,
});

export type AjaxUserBody = z.infer<typeof ajaxUserBodySchema>;

/** `/ajax/user/{id}/profile/top` の作品エントリ（最近作サムネイル用）。 */
const profileWorkEntry = z.object({
  id: idLike,
  title: z.string(),
  url: nullableUrl,
  illustType: z.number().int().optional(),
  xRestrict: xRestrict.optional(),
  aiType: z.number().int().optional(),
  pageCount: z.number().int().positive().optional(),
});

const profileWorkMap = z
  .union([z.record(z.string(), profileWorkEntry), z.array(z.never())])
  .optional()
  .transform((v) => (Array.isArray(v) || v === undefined ? [] : Object.values(v)));

export const ajaxUserProfileTopBodySchema = z.object({
  illusts: profileWorkMap,
  manga: profileWorkMap,
});

export type AjaxUserProfileTopBody = z.infer<typeof ajaxUserProfileTopBodySchema>;

/**
 * `/ajax/novel/series/{id}`。
 *
 * **他のエンドポイントと形が違う**ので個別に書く:
 * - `tags` が `{tags:[{tag}]}` ではなく**素の文字列配列**
 * - 表紙は `cover.urls` にサイズ名キー（`128x128` / `240mw` / `480mw` /
 *   `1200x1200` / `original`）で入る
 * - **`maxXRestrict`** が配下エピソードの最も強い年齢制限を表す。
 *   シリーズ自体の `xRestrict` が 0 でも R-18 の話数を含みうるため、
 *   年齢判定では両者の**強いほう**を採る（ADR 0006 のフェイルクローズ）
 */
export const ajaxNovelSeriesBodySchema = z.object({
  id: idLike,
  title: z.string(),
  userId: idLike,
  userName: z.string(),
  caption: nullableText,
  xRestrict,
  /** 配下エピソードの最大制限。**該当なしのとき `null` が入る**（欠落ではない） */
  maxXRestrict: nullableXRestrict,
  aiType: z.number().int().optional(),
  publishedContentCount: count,
  displaySeriesContentCount: count,
  total: count,
  publishedTotalCharacterCount: count,
  createDate: nullableText,
  updateDate: nullableText,
  tags: z
    .array(z.string())
    .optional()
    .transform((v) => v ?? []),
  cover: z
    .object({
      urls: z
        .object({
          "128x128": nullableUrl,
          "240mw": nullableUrl,
          "480mw": nullableUrl,
          "1200x1200": nullableUrl,
          original: nullableUrl,
        })
        .partial()
        .optional(),
    })
    .optional(),
});

export type AjaxNovelSeriesBody = z.infer<typeof ajaxNovelSeriesBodySchema>;

/**
 * `{ error, message, body }` のエンベロープ。
 *
 * `error: true` は本文の検証まで進まずに失敗として扱う。
 * HTTP ステータスとの対応づけ（とくに **`/pages` の 404 を `not_found` に
 * 写像してはならない**こと）は呼び出し側の責務である（ADR 0003）。
 */
export function ajaxEnvelopeSchema<T extends z.ZodType>(body: T) {
  return z.object({
    error: z.boolean(),
    message: z.string().optional(),
    body: body.optional(),
  });
}
