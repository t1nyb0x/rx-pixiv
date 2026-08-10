# rx-pixiv

Discord に貼られた **pixiv の URL を読める形に展開する Bot**。

`rx-twitter`（Twitter/X）、`rx-instagram`（Instagram）に続く3本目。

> **状態: 設計フェーズ完了 / 実装未着手**
> 要件定義・アーキテクチャ設計・ADR が確定し、実装 Plan に落とした段階です。
> 進捗は [TODO.md](TODO.md) を参照してください。

---

## なぜ必要か

pixiv の URL を Discord に貼っても、プレビューにはタイトルと pixiv のロゴ程度しか出ません。
画像 CDN `i.pximg.net` が `Referer: https://www.pixiv.net/` を要求し、
Discord の埋め込みプロキシがそのヘッダを付けられないためです。

rx-pixiv は Bot 自身が `Referer` を付けて画像を取得し、Discord の添付として再配信します。

---

## 対応予定の URL

| 種別 | URL 形 |
|---|---|
| イラスト・マンガ | `https://www.pixiv.net/artworks/{id}` |
| ロケール付き | `https://www.pixiv.net/en/artworks/{id}` 等（artworks / users とも対応） |
| 旧形式 | `member_illust.php?illust_id={id}` / `/i/{id}` |
| 小説 | `https://www.pixiv.net/novel/show.php?id={id}` |
| 小説シリーズ | `https://www.pixiv.net/novel/series/{id}` |
| ユーザー | `https://www.pixiv.net/users/{id}` / `member.php?id={id}` |
| 短縮 | `https://pixiv.me/{name}` |

**うごイラ（ugoira）は v1 では静止画のみ**の表示になります
（[ADR 0012](docs/adr/0012-ugoira-out-of-scope.md)）。

---

## 年齢制限コンテンツの扱い

**この Bot の設計上の最優先事項です。**

| 年齢区分 ＼ チャンネル | 年齢制限チャンネル | 通常チャンネル |
|---|---|---|
| 全年齢 | 展開 | 展開 |
| センシティブ | スポイラー付き展開 | スポイラー付き展開 |
| R-18 / R-18G | **スポイラー付き展開** | **リンクのみ**（タイトル・タグも出さない） |
| 判定不能 | リンクのみ | **無反応** |

- スレッドは親チャンネルの年齢制限属性を継承します
- **DM は年齢制限チャンネルとして扱いません**（全年齢のみ展開）
- 年齢区分を確定できない場合はすべて「判定不能」に倒します（フェイルクローズ）

詳細は [ADR 0006](docs/adr/0006-age-restricted-content.md) を参照してください。

---

## 画像の扱いについて

本 Bot は pixiv の画像を取得し、Discord の添付として再アップロードします
（[ADR 0005](docs/adr/0005-media-delivery.md)）。
これは pixiv の `Referer` 制約を回避する唯一の実用的な手段ですが、
「ホットリンク」ではなく「再配信」にあたります。

以下の姿勢で運用します。

- **原寸画像（`original`）を配信しない**。`regular`（長辺1200px）のみ
- **1作品あたり既定4枚**まで。200ページの作品でも全ページを展開しない
- **必ず pixiv の作品ページへのリンクを併記する**
- 権利者からの削除要請には速やかに応じる

自身のサーバーで運用する際は、この姿勢を理解したうえでご利用ください。

---

## 必要な Discord 権限

| 権限 | 要否 |
|---|---|
| View Channels | 必須 |
| Send Messages | 必須 |
| Embed Links | 必須 |
| Attach Files | 必須 |
| Read Message History | 必須 |
| Manage Messages | **推奨**（pixiv 側の貧弱なプレビューを抑制するため。無くても動作します） |

Discord Developer Portal で **Message Content Intent を有効化**する必要があります。

---

## ドキュメント

| 文書 | 内容 |
|---|---|
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | 要件定義 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | アーキテクチャ設計 |
| [docs/adr/](docs/adr/) | 設計判断の記録（ADR 0001〜0013） |
| [TODO.md](TODO.md) | 実装バックログ |

---

## 開発

技術スタックは [ADR 0001](docs/adr/0001-tech-stack.md) で確定しています
（TypeScript 6 / Node 24 / ESM / discord.js v14 / undici / zod / pino / Vitest / oxlint + oxfmt）。

コマンドは [Plan 0002](.claude/addf/plans/0002-project-scaffold.md) の完了後に利用可能になります。

```bash
npm run build        # ビルド
npm run typecheck    # 型検査
npm run lint         # Lint
npm test             # テスト
npm run test:coverage
npm run dev          # 開発起動
```

---

## ライセンス

[MIT](LICENSE)
