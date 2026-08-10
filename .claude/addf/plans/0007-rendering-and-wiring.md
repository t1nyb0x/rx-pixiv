# Plan 0007: Discord レンダリングと messageCreate 配線

## 実装状況: 未着手

owner_feedback: 不要

edge: derived-from 0001
edge: blocked-by 0005
edge: blocked-by 0006

> 出典: [ADR 0009 レンダラは Components V2 を既定とする](../../../docs/adr/0009-components-v2-renderer.md)、
> [ADR 0010 元メッセージは削除せず埋め込み抑制のみ行う](../../../docs/adr/0010-suppress-not-delete.md)、
> [ADR 0013 小説は冒頭抜粋のみを展開する](../../../docs/adr/0013-novel-excerpt-only.md) の実装

## 関連 Plan

- [Plan 0001: 要件定義・アーキテクチャ設計・ADR 整備](0001-requirements-and-adr.md) — 分離元
- [Plan 0005: Ajax ソースとフォールバック連鎖](0005-ajax-source-and-chain.md) — 依存
- [Plan 0006: NSFW ゲートとメディア取得](0006-nsfw-gate-and-media.md) — 依存
- [Plan 0008: 運用面の仕上げ](0008-operations-hardening.md) — 本 Plan の後に着手する

## 目的

ここまでの部品を Discord につなぎ、実際に動く Bot にする。

## 現状の挙動

未実装。

## 変更内容（項目・フェーズ）

### 項目1: 表示計画の組み立て

- **対象**: `src/core/services/MessageComposer.ts`
- `PixivWork` と `NsfwPolicy` の判定から `RenderPlan` を作る。
  **discord.js の型を一切使わない**
- 判定別の内容:
  - `expand_plain`: 通常表示
  - `expand_spoiler`: 全メディアと**小説の抜粋**をスポイラー化
  - `link_only`: **定型文と正規 URL のみ**。タイトル・タグ・作者名・サムネイルを出さない
  - `skip`: 空の `RenderPlan`（何も投稿しない）
- 小説は本文冒頭 300 文字の抜粋（[ADR 0013](../../../docs/adr/0013-novel-excerpt-only.md)）。
  HTML タグと pixiv 独自記法（`[newpage]` 等）を保守的に除去してから切り出す
- 複数ページ作品は「全 N ページ中 M ページを表示」を明記する
- **うごイラは「うごイラ（静止画のみ表示）」と明示する**（[ADR 0012](../../../docs/adr/0012-ugoira-out-of-scope.md)）
- 日付は JST（`Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo' })`）、
  数値は「万」表記（rx-instagram の書式を踏襲）

### 項目2: レンダラ2種

- **対象**: `src/adapters/discord/ComponentsV2Renderer.ts`、`EmbedRenderer.ts`
- Components V2 が既定（`RENDERER=components_v2`）。
  `MediaGalleryItem` は `attachment://<name>` で添付を参照し、
  スポイラーは **item 単位**で立てる
- v1 Embed は退避経路（`RENDERER=embed`）。**本当に動くものとして維持する**
- **送信前に硬いアサート**: 添付 ≤10、gallery item ≤10、embed ≤10。
  rx-instagram の既知バグ（上限超過で未捕捉例外）をここで塞ぐ

### 項目3: メッセージハンドラ

- **対象**: `src/adapters/discord/MessageHandler.ts`
- Bot 自身・他 Bot を無視、チャンネル送信可否を確認
- `traceId` を発番し、子ロガーで通す
- `UrlDetector` → 最大3 URL、**同時実行2本**（`Promise.all` を無制限に使わない）
- `WorkResolver` → `NsfwPolicy` → `MediaSelector` → `PximgFetcher` → `MessageComposer` → レンダラ
- `message.reply({ allowedMentions: { repliedUser: false } })`
- 1件以上展開したら `message.suppressEmbeds(true)`。
  **失敗しても展開自体は続行する**
- **ハンドラ全体を try/catch で包み、例外を client へ漏らさない**

### 項目4: 返信の追従削除

- **対象**: `src/adapters/discord/replyTracker.ts`
- 元メッセージ ID → Bot 返信 ID のプロセス内 TTL Map（1時間）
- `messageDelete` で Bot の返信を削除する
- 再起動で失われることは許容済み（[ADR 0008](../../../docs/adr/0008-in-memory-cache.md)）

### 項目5: DI 配線

- **対象**: `src/index.ts`
- 全層を手動 DI で組み立てる。**ここだけが3層すべてを import してよい**
- `SOURCE_CHAIN` に従って経路を並べる

## 影響範囲

`src/adapters/discord/`、`src/core/services/MessageComposer.ts`、`src/index.ts`。
ここで初めて Bot が実際に動く。

## テスト方針

- **統合テスト4シナリオを両レンダラで通す**（`RENDERER=components_v2` と `embed`）:
  1. 全年齢作品 × 通常チャンネル → 素の展開
  2. R-18 作品 × 年齢制限チャンネル → スポイラー付き展開
  3. R-18 作品 × 通常チャンネル → `link_only`（**タイトル・タグが payload に含まれないこと**を検証）
  4. 判定不能 × 通常チャンネル → 何も送信しないこと
- discord.js は手書きのフェイク（`Partial<X> as X`）で代替する
- **アサートは payload の特定フィールドに対して行う**。
  スナップショットは使わない（リファクタのたびに壊れ、読まれなくなる）
- 上限超過（添付11件・gallery item 11件）で例外ではなくアサートエラーになること
- 小説の抜粋テスト: 独自記法の除去と、`link_only` で抜粋が出ないこと

## 破壊的変更の許容範囲

なし。

## 要オーナー確認

なし。

## 完了条件

- [ ] 統合テスト4シナリオが `components_v2` と `embed` の**両方**で緑
- [ ] `link_only` の payload にタイトル・タグ・作者名・サムネイルが含まれない
- [ ] `skip` で `channel.send` / `message.reply` が一度も呼ばれない
- [ ] 添付・gallery item・embed の上限超過が未捕捉例外にならない
- [ ] `suppressEmbeds` が権限不足で失敗しても展開が続行される
- [ ] ハンドラ内の例外が client へ漏れない
- [ ] うごイラが「うごイラ（静止画のみ表示）」と明示される
- [ ] 実チャンネルで複数ページ作品が表示されることを目視確認 <!-- human-judgment -->

## AI 実装時間見積もり

2セッション程度。
