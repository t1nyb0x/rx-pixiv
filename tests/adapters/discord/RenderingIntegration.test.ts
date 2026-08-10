import { MessageFlags, type MessageReplyOptions } from "discord.js";
import { describe, expect, it } from "vitest";

import { ComponentsV2Renderer } from "#adapters/discord/ComponentsV2Renderer";
import { EmbedRenderer } from "#adapters/discord/EmbedRenderer";
import { ImageUrlRewriter } from "#adapters/pixiv/ImageUrlRewriter";
import type { ContentRating } from "#core/models/ContentRating";
import type { IllustWork } from "#core/models/PixivWork";
import { composeMessage } from "#core/services/MessageComposer";
import { selectMedia } from "#core/services/MediaSelector";
import { decideExpansion } from "#core/services/NsfwPolicy";

const rendererCases = [
  ["components_v2", new ComponentsV2Renderer()],
  ["embed", new EmbedRenderer()],
] as const;

const rating = (over: Partial<ContentRating> = {}): ContentRating => ({
  level: "all",
  sensitive: false,
  ai: "no",
  confidence: "authoritative",
  ...over,
});

const work = (contentRating: ContentRating): IllustWork => ({
  kind: "illust",
  id: "1",
  canonicalUrl: "https://www.pixiv.net/artworks/1",
  title: "秘密の作品名",
  author: { id: "2", name: "秘密の作者", url: "https://www.pixiv.net/users/2" },
  rating: contentRating,
  source: "ajax",
  fetchedAt: 0,
  partial: false,
  illustType: "illust",
  pageCount: 1,
  pages: [{ page: 0, urls: { regular: "https://i.pximg.net/secret.jpg" } }],
  pagesTruncated: false,
  tags: [{ name: "秘密タグ" }],
});

function render(
  renderer: { render(plan: ReturnType<typeof composeMessage>): MessageReplyOptions },
  contentRating: ContentRating,
  channel: { channelIsNsfw: boolean; isDm: boolean },
): MessageReplyOptions | undefined {
  const value = work(contentRating);
  const decision = decideExpansion(value.rating, channel);
  const media = selectMedia(
    value.pages,
    value.pageCount,
    new ImageUrlRewriter({ proxyBaseUrl: "https://proxy.example/i" }),
  );
  const plan = composeMessage(value, { decision, media });
  return plan.items.length === 0 && plan.content === undefined ? undefined : renderer.render(plan);
}

describe.each(rendererCases)("%s rendering integration", (_name, renderer) => {
  it("expands all-ages work in a normal channel", () => {
    const payload = render(renderer, rating(), { channelIsNsfw: false, isDm: false });
    const json = JSON.stringify(payload);
    expect(json).toContain("秘密の作品名");
    expect(json).toContain("https://proxy.example/i/secret.jpg");
  });

  it("spoilers R-18 work in an age-restricted channel", () => {
    const payload = render(renderer, rating({ level: "r18" }), {
      channelIsNsfw: true,
      isDm: false,
    });
    const json = JSON.stringify(payload);
    expect(json.includes("spoiler") || json.includes("||")).toBe(true);
    // classic embedは外部画像をspoiler化できないので、安全なspoilerリンクへ縮退する。
    expect(json.includes("secret.jpg")).toBe(_name === "components_v2");
  });

  it("renders link_only without metadata for R-18 in a normal channel", () => {
    const payload = render(renderer, rating({ level: "r18" }), {
      channelIsNsfw: false,
      isDm: false,
    });
    const json = JSON.stringify(payload);
    expect(json).toContain("https://www.pixiv.net/artworks/1");
    expect(json).not.toContain("秘密の作品名");
    expect(json).not.toContain("秘密の作者");
    expect(json).not.toContain("秘密タグ");
    expect(json).not.toContain("secret.jpg");
    expect(Number(payload?.flags) & MessageFlags.SuppressEmbeds).toBe(MessageFlags.SuppressEmbeds);
  });

  it("sends nothing for an unknown rating in a normal channel", () => {
    expect(
      render(renderer, rating({ confidence: "unknown" }), {
        channelIsNsfw: false,
        isDm: false,
      }),
    ).toBeUndefined();
  });
});
