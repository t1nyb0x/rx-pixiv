# Plan 0006: NSFW ゲートとメディア URL 組み立て

## 実装状況: 未着手

owner_feedback: 不要

edge: derived-from 0001
edge: blocked-by 0003
edge: blocked-by 0005

> 出典: [ADR 0006 年齢制限コンテンツはフェイルクローズで扱う](../../../docs/adr/0006-age-restricted-content.md)
> および [ADR 0014 画像は画像プロキシの URL を埋め込む](../../../docs/adr/0014-media-delivery-via-proxy-url.md) の実装。
> 当初は ADR 0005（添付アップロード）に基づく計画だったが、
> ADR 0005 が ADR 0014 に置き換えられたため大幅に縮小した

## 関連 Plan

- [Plan 0001: 要件定義・アーキテクチャ設計・ADR 整備](0001-requirements-and-adr.md) — 分離元
- [Plan 0003: ドメインモデルと URL 検出](0003-domain-and-url-detection.md) — 依存（`ContentRating`）
- [Plan 0005: Ajax ソースとフォールバック連鎖](0005-ajax-source-and-chain.md) — 依存（年齢ヒント）
- [Plan 0007: Discord レンダリングと messageCreate 配線](0007-rendering-and-wiring.md) — 本 Plan の判定結果を描画する

## 目的

**この Bot でいちばん壊れてはいけない部分を作る。**
年齢区分とチャンネル種別から展開可否を決め、埋め込む画像 URL を組み立てる。

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

### 項目3: 画像 URL の書き換え

- **対象**: `src/adapters/pixiv/ImageUrlRewriter.ts`
- `https://i.pximg.net/<path>` → `${PXIMG_PROXY_BASE_URL}/<path>`（既定 `https://phixiv.net/i`）
- **ホスト書き換えのみ。バイトを取得しない**
- 入力が `i.pximg.net` 以外のホストだった場合は**書き換えず、埋め込みもしない**
  （想定外の URL を無検査で埋め込まない）
- 末尾スラッシュの有無を正規化する

### 項目4: メディア選択

- **対象**: `src/core/services/MediaSelector.ts`
- サイズ変種は `regular` を使う（`IMAGE_VARIANT_PREFERENCE` で `small` / `thumb` へ変更可）
- **`original` は選ばない**
- 表示枚数: 既定4枚（`MAX_PAGES_DEFAULT`）、上限10枚（`MAX_PAGES_HARD`）
- **部分失敗を捨てない**: 一部のページしか URL を組み立てられなくても、
  取れた分を表示し、残りは件数として注記する

### 項目5: ユーザープロフィールのサムネイル判定

- **対象**: `MediaSelector` / `NsfwPolicy` の適用箇所
- 最近作サムネイルは**1枚ずつ**判定する。
  通常チャンネルで制限ありまたは判定不能なものは、そのサムネイルだけ落とす
  （カード全体を落とすのではない）

### 項目6: 添付フォールバック（既定は無効）

- **対象**: `src/infrastructure/http/PximgFetcher.ts`
- [ADR 0014](../../../docs/adr/0014-media-delivery-via-proxy-url.md) の第3段。
  `MEDIA_FALLBACK=attachment` のときだけ有効
- `Referer: https://www.pixiv.net/` を付けて取得し、`IMediaFetcher` の `bytes` を返す
- **PHPSESSID を送らない**
- **バイト上限はストリーミング中のカウンタで強制する**（`content-length` だけに頼らない）
- **既定が無効である以上、v1 の完了条件からは外す**。実装は最小限でよい

## 影響範囲

`core/services/`、`adapters/discord/`、`adapters/pixiv/`。
本 Plan の判定結果が Plan 0007 の描画を決める。

ADR 0014 への切り替えにより、**当初計画から以下が不要になった**:
`attachmentLimit.ts`（ブーストティア別バイト予算）、`AttachmentUrlCache`、
メッセージ全体のバイト予算配分。

## テスト方針

**3つの網羅テーブルテストを必須とする。**

1. **`NsfwPolicy` の全直積**:
   `{all, r18, r18g} × {sensitive: 真偽} × {authoritative, inferred, unknown} × {nsfw, sfw, dm}`
   = 54 ケース。テーブル駆動で全件書く
2. **`isAgeRestricted` の全 `ChannelType`**: Discord の全チャンネル型を列挙し、
   スレッドが親を見ること・DM がフェイルクローズであることを含めて検証する
3. **`ImageUrlRewriter`**: `i.pximg.net` の各パス形（`img-master` / `custom-thumb` /
   `user-profile`）が正しく書き換わること、
   **`i.pximg.net` 以外のホストは書き換えず埋め込み対象から外れること**

加えて:
- `MediaSelector` の枚数上限と部分失敗時の挙動を検証する
- `original` が選択されないことを担保する

> **[ADR 0006 の既知の限界2](../../../docs/adr/0006-age-restricted-content.md)**:
> R-18 の実レスポンスを fixture としてリポジトリに置けないため、
> **実データ → `ContentRating` の写像だけは継続的な検証の外側にある**。
> Plan 0005 のスパイクで観測した構造（フィールド名と値域）を合成 fixture に落とし、
> `xRestrict` / `sl` / タグの3経路で冗長に判定することで、単一フィールドの誤読で倒れないようにする。

## 破壊的変更の許容範囲

なし。

## 要オーナー確認

なし（方針は ADR 0006 / ADR 0014 で確定済み）。

## 完了条件

- [ ] `NsfwPolicy` の 54 ケーステーブルテストが緑
- [ ] `isAgeRestricted` の全 `ChannelType` テストが緑（スレッド・DM を含む）
- [ ] `ImageUrlRewriter` が `i.pximg.net` 以外のホストを埋め込み対象から外す
- [ ] `original` サイズが選択されないことがテストで担保されている
- [ ] 部分失敗時に取れた分だけ表示される
- [ ] `NsfwPolicy` が discord.js に依存していない（純粋関数）
- [ ] `xRestrict` / `sl` / タグの3経路で年齢区分を判定している（単一フィールド依存でない）
- [ ] `PXIMG_PROXY_BASE_URL` を差し替えるだけでプロキシの向き先が変わる

## AI 実装時間見積もり

1セッション以内（ADR 0014 への切り替えで当初計画の約半分に縮小した）。
