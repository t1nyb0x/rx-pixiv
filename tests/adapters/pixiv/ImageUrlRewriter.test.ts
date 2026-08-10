import { describe, expect, it } from "vitest";

import { ImageUrlRewriter } from "#adapters/pixiv/ImageUrlRewriter";

const rewriter = new ImageUrlRewriter({ proxyBaseUrl: "https://phixiv.net/i" });

describe("ImageUrlRewriter", () => {
  it("rewrites i.pximg.net to the proxy, keeping the path", () => {
    // Referer 制約は「ホスト名を替えるだけ」で解ける（ADR 0014）。
    expect(rewriter.rewrite("https://i.pximg.net/img-master/img/2022/x_p0_master1200.jpg")).toBe(
      "https://phixiv.net/i/img-master/img/2022/x_p0_master1200.jpg",
    );
  });

  it("preserves the query string", () => {
    expect(rewriter.rewrite("https://i.pximg.net/a.jpg?v=1")).toBe(
      "https://phixiv.net/i/a.jpg?v=1",
    );
  });

  it("passes through urls that are already embeddable", () => {
    // phixiv 経路は既にプロキシ済みの URL を返し、OGP 経路は embed.pixiv.net を返す。
    // ここで弾くと、それらの経路の画像がすべて消える。
    expect(rewriter.rewrite("https://phixiv.net/i/img-master/x.jpg")).toBe(
      "https://phixiv.net/i/img-master/x.jpg",
    );
    expect(rewriter.rewrite("https://embed.pixiv.net/decorate.php?illust_id=1")).toBe(
      "https://embed.pixiv.net/decorate.php?illust_id=1",
    );
  });

  it("refuses unknown hosts rather than embedding them unchecked", () => {
    expect(rewriter.rewrite("https://s.pximg.net/www/images/pixiv_logo.png")).toBeUndefined();
    expect(rewriter.rewrite("https://evil.example/x.jpg")).toBeUndefined();
  });

  it("refuses non-https and malformed urls", () => {
    expect(rewriter.rewrite("http://i.pximg.net/a.jpg")).toBeUndefined();
    expect(rewriter.rewrite("not a url")).toBeUndefined();
    expect(rewriter.rewrite("")).toBeUndefined();
  });

  it("follows a custom proxy base, including its host allowlist", () => {
    const custom = new ImageUrlRewriter({ proxyBaseUrl: "https://pximg.example.test/proxy/" });
    expect(custom.rewrite("https://i.pximg.net/a.jpg")).toBe(
      "https://pximg.example.test/proxy/a.jpg",
    );
    // 自前ホストへ切り替えたら、そのホストの URL も素通しできる。
    expect(custom.rewrite("https://pximg.example.test/proxy/a.jpg")).toBe(
      "https://pximg.example.test/proxy/a.jpg",
    );
    // 旧プロキシは素通ししない。
    expect(custom.rewrite("https://phixiv.net/i/a.jpg")).toBeUndefined();
  });
});
