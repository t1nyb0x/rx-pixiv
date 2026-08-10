import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ajaxEnvelopeSchema,
  ajaxIllustBodySchema,
  ajaxIllustPagesBodySchema,
  ajaxNovelBodySchema,
  ajaxUserBodySchema,
  ajaxUserProfileTopBodySchema,
} from "#adapters/pixiv/schemas/ajax";

function fixture(name: string): unknown {
  const url = new URL(`../../fixtures/ajax/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}

describe("ajax schemas", () => {
  it("parses a single-page illust captured from the live API", () => {
    const parsed = ajaxEnvelopeSchema(ajaxIllustBodySchema).parse(fixture("illust-single"));
    expect(parsed.error).toBe(false);
    expect(parsed.body?.illustType).toBe(0);
    expect(parsed.body?.xRestrict).toBe(0);
    expect(parsed.body?.pageCount).toBe(1);
  });

  it("keeps body.urls null — the live API never fills it unauthenticated", () => {
    // ADR 0003: 画像 URL は /pages からしか取れない。この fixture は実測の記録である。
    const raw = fixture("illust-single") as { body: { urls: Record<string, unknown> } };
    expect(Object.values(raw.body.urls).every((v) => v === null)).toBe(true);

    const parsed = ajaxEnvelopeSchema(ajaxIllustBodySchema).parse(raw);
    // null は undefined に寄せられ、画像の供給源としては空になる。
    expect(parsed.body?.urls?.regular).toBeUndefined();
    expect(parsed.body?.urls?.original).toBeUndefined();
  });

  it("parses manga, ugoira and R-18 shapes", () => {
    const schema = ajaxEnvelopeSchema(ajaxIllustBodySchema);
    expect(schema.parse(fixture("illust-manga")).body?.illustType).toBe(1);
    expect(schema.parse(fixture("illust-ugoira")).body?.illustType).toBe(2);

    const r18 = schema.parse(fixture("illust-r18"));
    expect(r18.body?.xRestrict).toBe(1);
    expect(r18.body?.aiType).toBe(2);
    expect(r18.body?.pageCount).toBe(8);
  });

  it("parses the pages endpoint and finds real image urls there", () => {
    const parsed = ajaxEnvelopeSchema(ajaxIllustPagesBodySchema).parse(fixture("illust-pages"));
    const first = parsed.body?.[0];
    expect(first?.urls.regular).toMatch(/^https:\/\/i\.pximg\.net\//);
    expect(first?.urls.original).toMatch(/^https:\/\/i\.pximg\.net\//);
  });

  it("treats the R-18 pages response as an error envelope with an empty body", () => {
    // 実測: R-18 では /pages が 404 を返す。作品自体は実在する（ADR 0003）。
    const parsed = ajaxEnvelopeSchema(ajaxIllustPagesBodySchema).parse(
      fixture("illust-pages-r18-404"),
    );
    expect(parsed.error).toBe(true);
    expect(parsed.body).toEqual([]);
  });

  it("parses novel, user and profile-top payloads", () => {
    const novel = ajaxEnvelopeSchema(ajaxNovelBodySchema).parse(fixture("novel"));
    expect(novel.body?.xRestrict).toBe(0);
    expect(typeof novel.body?.content).toBe("string");

    const user = ajaxEnvelopeSchema(ajaxUserBodySchema).parse(fixture("user"));
    expect(user.body?.userId).toBe("11");

    const top = ajaxEnvelopeSchema(ajaxUserProfileTopBodySchema).parse(fixture("user-profile-top"));
    expect(Array.isArray(top.body?.illusts)).toBe(true);
  });

  it("ignores sl entirely — it is 6 even for all-ages works", () => {
    // ADR 0006 / ADR 0007: sl は年齢判定に使えない。スキーマにも載せない。
    const parsed = ajaxIllustBodySchema.parse((fixture("illust-single") as { body: unknown }).body);
    expect("sl" in parsed).toBe(false);
  });

  it("fails closed when a required field disappears upstream", () => {
    const raw = fixture("illust-single") as { body: Record<string, unknown> };
    delete raw.body.xRestrict;
    expect(() => ajaxIllustBodySchema.parse(raw.body)).toThrow(/xRestrict/);
  });

  it("rejects an unknown xRestrict value instead of treating it as all-ages", () => {
    const raw = fixture("illust-single") as { body: Record<string, unknown> };
    raw.body.xRestrict = 99;
    expect(() => ajaxIllustBodySchema.parse(raw.body)).toThrow(/xRestrict/);
  });
});
