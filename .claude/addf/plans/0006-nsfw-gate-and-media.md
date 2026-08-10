# Plan 0006: NSFW ゲートとメディア取得

## 実装状況: 未着手

owner_feedback: 不要

edge: derived-from 0001
edge: blocked-by 0003
edge: blocked-by 0005

> 出典: [ADR 0006 年齢制限コンテンツはフェイルクローズで扱う](../../../docs/adr/0006-age-restricted-content.md)
> および [ADR 0005 画像は Bot が取得して Discord 添付として再配信する](../../../docs/adr/0005-media-delivery.md) の実装

## 関連 Plan

- [Plan 0001: 要件定義・アーキテクチャ設計・ADR 整備](0001-requirements-and-adr.md) — 分離元
- [Plan 0003: ドメインモデルと URL 検出](0003-domain-and-url-detection.md) — 依存（`ContentRating`）
- [Plan 0005: Ajax ソースとフォールバック連鎖](0005-ajax-source-and-chain.md) — 依存（年齢ヒント）
- [Plan 0007: Discord レンダリングと messageCreate 配線](0007-rendering-and-wiring.md) — 本 Plan の判定結果を描画する

## 目的

**この Bot でいちばん壊れてはいけない部分を作る。**
年齢区分とチャンネル種別から展開可否を決め、
`Referer` を付けて画像バイトを取得する。

## 現状の挙動

未実装。

## 変更内容（項目・フェーズ）

### 項目1: チャンネル年齢判定

- **対象**: `src/adapters/discord/channelRating.ts`
- `isAgeRestricted(channel)` を**1箇所に集約**する
- `GuildText` / `GuildAnnouncement` / `GuildVoice` / `GuildStageVoice`: `.nsfw`
- **スレッド（`PublicThread` / `PrivateThread` / `AnnouncementThread`）: `channel.parent?.nsfw`**
  — スレッド自身は `nsfw` を持たない。ここが沈黙する偽陰性の温床
- フォーラム投稿: フォーラムチャンネルから継承
- **DM / グループ DM: 年齢制限チャンネルではない**（`ALLOW_NSFW_IN_DM`、既定 `false`）
- 未知・将来のチャンネル型: 年齢制限チャンネルではない

### 項目2: 年齢ゲート

- **対象**: `src/core/services/NsfwPolicy.ts`
- `decide({ rating, channelIsNsfw, isDM })` → `expand_plain` / `expand_spoiler` /
  `link_only` / `skip`
- 判定表は [ADR 0006](../../../docs/adr/0006-age-restricted-content.md) の通り
- **`confidence: "unknown"` は制限ありとして扱う**（フェイルクローズ）
- 環境変数 `SENSITIVE_IN_SFW` / `UNKNOWN_RATING_SFW` / `SPOILER_IN_NSFW` で調整可能
- **純粋関数として書く**（discord.js に依存しない）

### 項目3: 画像取得

- **対象**: `src/infrastructure/http/PximgFetcher.ts`
- `Referer: https://www.pixiv.net/` を付けて `i.pximg.net` から取得する
- **PHPSESSID を送らない**
- HEAD で `content-length` を事前確認（無駄な取得を始めないための最適化）
- **バイト上限はストリーミング中のカウンタで強制する**。
  予算を越えた時点で読み出しを中断する。`content-length` だけに頼らない

### 項目4: メディア選択

- **対象**: `src/core/services/MediaSelector.ts`
- サイズ変種ラダー: `regular` → `small` → `thumb`（`IMAGE_VARIANT_PREFERENCE`）
- **`original` は選ばない**
- 表示枚数: 既定4枚（`MAX_PAGES_DEFAULT`）、上限10枚（`MAX_PAGES_HARD`）
- 総バイト予算は**メッセージ全体**で配分し、10% のヘッドルームを残す

### 項目5: 添付上限の解決

- **対象**: `src/adapters/discord/attachmentLimit.ts`
- `guild.premiumTier` → バイト予算。rx-twitter の同名ファイルを移植する
- **移植時に現行の Discord 仕様に対して値を再確認する**
  （無料枠が 10 MiB に引き上げられた際に変わっている）

### 項目6: ユーザープロフィールのサムネイル判定

- **対象**: `MediaSelector` / `NsfwPolicy` の適用箇所
- 最近作サムネイルは**1枚ずつ**判定する。
  通常チャンネルで制限ありまたは判定不能なものは、そのサムネイルだけ落とす
  （カード全体を落とすのではない）

## 影響範囲

`core/services/` と `adapters/discord/`、`infrastructure/http/` にまたがる。
本 Plan の判定結果が Plan 0007 の描画を決める。

## テスト方針

**3つの網羅テーブルテストを必須とする。**

1. **`NsfwPolicy` の全直積**:
   `{all, r18, r18g} × {sensitive: 真偽} × {authoritative, inferred, unknown} × {nsfw, sfw, dm}`
   = 54 ケース。テーブル駆動で全件書く
2. **`isAgeRestricted` の全 `ChannelType`**: Discord の全チャンネル型を列挙し、
   スレッドが親を見ること・DM がフェイルクローズであることを含めて検証する
3. **`PximgFetcher`**: undici の `MockAgent` で
   **`Referer` ヘッダが実際に送出されたこと**を検証する。
   これがこのユニットの存在理由なので、ここだけはモジュールモックを使ってよい

加えて:
- `content-length` を詐称した応答（実体のほうが大きい）で、
  **上限超過前に読み出しが中断される**ことを検証する
- `MediaSelector` のバイト予算配分とラダー降格を検証する

## 破壊的変更の許容範囲

なし。

## 要オーナー確認

なし（方針は ADR 0006 で確定済み）。

## 完了条件

- [ ] `NsfwPolicy` の 54 ケーステーブルテストが緑
- [ ] `isAgeRestricted` の全 `ChannelType` テストが緑（スレッド・DM を含む）
- [ ] `MockAgent` で `Referer` の送出が検証されている
- [ ] `content-length` 詐称時に、上限超過前にストリーミングが中断される
- [ ] `original` サイズが選択されないことがテストで担保されている
- [ ] `NsfwPolicy` が discord.js に依存していない（純粋関数）
- [ ] PHPSESSID が `i.pximg.net` にも phixiv にも送られないことがテストで担保されている
- [ ] `attachmentLimit` のティア別値を現行 Discord 仕様に対して再確認済み <!-- human-judgment -->

## AI 実装時間見積もり

2セッション程度。
