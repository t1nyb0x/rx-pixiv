import { ComponentType, MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";

import { ComponentsV2Renderer } from "#adapters/discord/ComponentsV2Renderer";
import { EmbedRenderer } from "#adapters/discord/EmbedRenderer";
import type { RenderPlan } from "#core/models/RenderPlan";

const plan = (over: Partial<RenderPlan> = {}): RenderPlan => ({
  items: [
    {
      url: "https://www.pixiv.net/artworks/1",
      spoiler: false,
      title: "作品",
      description: "説明",
      author: { name: "作者", url: "https://www.pixiv.net/users/2" },
      fields: [{ name: "タグ", value: "#test" }],
      media: [{ url: "https://proxy/1.jpg", description: "1", spoiler: false }],
    },
  ],
  ...over,
});

describe("ComponentsV2Renderer", () => {
  it("renders text and a media gallery with Components V2", () => {
    const payload = new ComponentsV2Renderer().render(plan());
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    const json = JSON.parse(JSON.stringify(payload.components));
    expect(json[0].type).toBe(ComponentType.Container);
    expect(JSON.stringify(json)).toContain("https://proxy/1.jpg");
  });

  it("rejects an oversized gallery before Discord does", () => {
    const oversized = plan({
      items: [
        {
          ...plan().items[0]!,
          media: Array.from({ length: 11 }, (_, index) => ({
            url: `https://proxy/${index}.jpg`,
            spoiler: false,
          })),
        },
      ],
    });
    expect(() => new ComponentsV2Renderer().render(oversized)).toThrow(RangeError);
  });

  it("keeps an individual media spoiler inside a plain container", () => {
    const item = plan().items[0]!;
    const payload = new ComponentsV2Renderer().render(
      plan({
        items: [
          {
            ...item,
            media: [{ url: "https://proxy/restricted.jpg", spoiler: true }],
          },
        ],
      }),
    );
    const json = JSON.stringify(payload.components);
    expect(json).toContain("restricted.jpg");
    expect(json).toContain('"spoiler":true');
  });
});

describe("EmbedRenderer", () => {
  it("renders metadata and plain media", () => {
    const payload = new EmbedRenderer().render(plan());
    expect(payload.embeds).toHaveLength(1);
    expect(JSON.stringify(payload.embeds)).toContain("https://proxy/1.jpg");
  });

  it("omits external media and metadata when spoiler rendering is required", () => {
    const item = plan().items[0]!;
    const payload = new EmbedRenderer().render(plan({ items: [{ ...item, spoiler: true }] }));
    const json = JSON.stringify(payload);
    expect(json).toContain("スポイラー付きpixiv作品");
    expect(json).not.toContain("https://proxy/1.jpg");
    expect(json).not.toContain("#test");
  });

  it("omits individually spoilered media from a plain profile embed", () => {
    const item = plan().items[0]!;
    const payload = new EmbedRenderer().render(
      plan({
        items: [
          {
            ...item,
            media: [
              { url: "https://proxy/plain.jpg", spoiler: false },
              { url: "https://proxy/restricted.jpg", spoiler: true },
            ],
          },
        ],
      }),
    );
    const json = JSON.stringify(payload);
    expect(json).toContain("plain.jpg");
    expect(json).not.toContain("restricted.jpg");
  });

  it("rejects more than ten generated embeds", () => {
    const item = plan().items[0]!;
    expect(() =>
      new EmbedRenderer().render(
        plan({
          items: [
            {
              ...item,
              media: Array.from({ length: 11 }, (_, index) => ({
                url: `https://proxy/${index}.jpg`,
                spoiler: false,
              })),
            },
          ],
        }),
      ),
    ).toThrow(RangeError);
  });
});
