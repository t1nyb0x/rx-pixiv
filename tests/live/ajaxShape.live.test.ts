import { describe, expect, it } from "vitest";

import { ajaxEnvelopeSchema, ajaxIllustBodySchema } from "#adapters/pixiv/schemas/ajax";

/**
 * 上流のレスポンス形が変わっていないかを実 API で確認する。
 *
 * **この Bot の失敗モードは依存の腐敗ではなく、上流のレスポンス形の変化**であり、
 * それを事前に検知できるのはこのテストだけである（Plan 0008 で週次 cron に載せる）。
 *
 * CI のマージゲートにはしない。`RUN_LIVE_API_TESTS=1` を付けたときだけ走る。
 */
const enabled = process.env["RUN_LIVE_API_TESTS"] === "1";

/** 全年齢の公開作品。R-18 は fixture にできないため、ここでも踏まない。 */
const KNOWN_PUBLIC_ARTWORK_ID = "100412238";

describe.skipIf(!enabled)("live: pixiv ajax response shape", () => {
  it("still satisfies the illust schema", async () => {
    const response = await fetch(`https://www.pixiv.net/ajax/illust/${KNOWN_PUBLIC_ARTWORK_ID}`, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
        referer: "https://www.pixiv.net/",
      },
    });

    expect(response.status).toBe(200);
    const parsed = ajaxEnvelopeSchema(ajaxIllustBodySchema).safeParse(await response.json());
    expect(parsed.success).toBe(true);
  }, 15_000);

  it("still returns image urls only from the pages endpoint", async () => {
    // body.urls が埋まるようになったら設計判断（ADR 0003）を見直す合図になる。
    const response = await fetch(
      `https://www.pixiv.net/ajax/illust/${KNOWN_PUBLIC_ARTWORK_ID}/pages`,
      {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
          referer: "https://www.pixiv.net/",
        },
      },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { body: { urls: Record<string, string> }[] };
    expect(body.body[0]?.urls["regular"]).toMatch(/^https:\/\/i\.pximg\.net\//);
  }, 15_000);
});
