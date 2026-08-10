# Plan 0007: Discord レンダリングと messageCreate 配線

## 実装状況: 一部完了（自動検証完了・実チャンネル目視確認待ち）

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
- [Plan 0006: NSFW ゲートとメディア URL 組み立て](0006-nsfw-gate-and-media.md) — 依存
- [Plan 0008: 運用面の仕上げ](0008-operations-hardening.md) — 本 Plan の後に着手する
- [Plan 0011: 管理コマンド・濫用対策・Redis 永続化](0011-admin-and-abuse-control.md) — `MessageHandler` のゲート順序で実装が重なる

## 目的

ここまでの部品を Discord につなぎ、実際に動く Bot にする。

## 現状の挙動

表示計画・レンダラ・Discord handler・実行時DIを実装済み。
Plan 0011 の owner handler・reply map・Redis起動配線も本Planで統合し、
自動テストと品質ゲートを通過した。残る作業は実チャンネルでの目視確認のみ。

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
  `MediaGalleryItem` は**画像プロキシの URL** を直接参照し、
  スポイラーは **item 単位**で立てる（外部 URL でも効く —
  [ADR 0014](../../../docs/adr/0014-media-delivery-via-proxy-url.md)）
- v1 Embed は退避経路（`RENDERER=embed`）。**本当に動くものとして維持する**
- v1 Embed は外部画像を安全にspoiler化できないため、spoiler判定時は画像・メタデータを
  省いたspoiler付き正規リンクへ縮退する。Components V2は画像itemへspoilerを付ける
- **送信前に硬いアサート**: gallery item ≤10、embed ≤10。
  rx-instagram の既知バグ（上限超過で未捕捉例外）をここで塞ぐ

### 項目3: メッセージハンドラ

- **対象**: `src/adapters/discord/MessageHandler.ts`
- Bot 自身・他 Bot を無視、チャンネル送信可否を確認
- `OwnerCommandHandler` を先頭に置き、オーナーDMだけ `OwnerCommandService` へ渡す。
  `DirectMessages` intent と `Message` / `Channel` partial を有効にする
- `traceId` を発番し、子ロガーで通す
- 禁止・許可チャンネル・クールダウンのゲートを通す（[Plan 0011](0011-admin-and-abuse-control.md) と実装が重なる）
- `UrlDetector` → 最大3 URL、**同時実行2本**（`Promise.all` を無制限に使わない）
- `WorkResolver` → `NsfwPolicy` → `MediaSelector` → `ImageUrlRewriter` → `MessageComposer` → レンダラ
- `message.reply({ allowedMentions: { repliedUser: false } })`
- 1件以上展開したら `message.suppressEmbeds(true)`。
  **失敗しても展開自体は続行する**
- **ハンドラ全体を try/catch で包み、例外を client へ漏らさない**

### 項目4: 返信の追従削除

- **対象**: `src/adapters/discord/replyTracker.ts`
- 元メッセージ ID → Bot 返信 ID を Redis に保持（TTL 24h、`app:reply:{id}`）
- `messageDelete` で Bot の返信を削除する
- `IReplyRepository` と Redis実装（`app:reply:*`）を本Planで追加する。
  書込み失敗時は展開を続け、追従削除だけ諦める
  （[ADR 0016](../../../docs/adr/0016-redis-for-persistent-state.md)）

### 項目5: DI 配線

- **対象**: `src/index.ts`
- 全層を手動 DI で組み立てる。**ここだけが3層すべてを import してよい**
- `SOURCE_CHAIN` に従って経路を並べる
- Redisへ接続し、ban/blockをpreloadしてからメッセージ受付を有効にする。
  接続またはpreload失敗時もDiscord接続自体は続けるが、既定の `deny` では
  `AccessGate` をフェイルクローズさせ、`/readyz` を503、`/health`へRedis状態を出す

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
- 上限超過（gallery item 11件・embed 11件）で例外ではなくアサートエラーになること
- 小説の抜粋テスト: 独自記法の除去と、`link_only` で抜粋が出ないこと
- シナリオ2のEmbed期待値は、画像・メタデータ無しのspoilerリンクへの安全縮退とする
- オーナー以外・ギルド内の `!owner/...` は無反応、DMの全コマンド返信は1900文字で分割
- ban/block preload完了前・失敗時はURL検出/取得へ進まず、preload後の通常判定では
  Redis往復が発生しないこと
- Redis不通でもDiscord起動は続き、`/readyz` は503になること
- reply map保存失敗でも展開が続き、保存成功時は `messageDelete` で返信を削除すること

## 破壊的変更の許容範囲

なし。

## 要オーナー確認

なし。

## 完了条件

- [x] 統合テスト4シナリオが `components_v2` と `embed` の**両方**で緑
- [x] `link_only` の payload にタイトル・タグ・作者名・サムネイルが含まれない
- [x] `skip` で `channel.send` / `message.reply` が一度も呼ばれない
- [x] gallery item・embed の上限超過が未捕捉例外にならない
- [x] `suppressEmbeds` が権限不足で失敗しても展開が続行される
- [x] ハンドラ内の例外が client へ漏れない
- [x] オーナーDMの管理コマンドが動作し、非オーナー/ギルド内では無反応
- [x] ban/block preload失敗時にフェイルクローズし、成功後は通常判定でRedisへ往復しない
- [x] Redis不通でもBotは起動し、`/readyz` が503、`/health` がRedis状態を返す
- [x] reply mapがRedisへ24時間保持され、元メッセージ削除時に返信も削除される
- [x] うごイラが「うごイラ（静止画のみ表示）」と明示される
- [ ] 実チャンネルで複数ページ作品が表示されることを目視確認 <!-- human-judgment -->

## AI 実装時間見積もり

2セッション程度。
