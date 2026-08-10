# Plan 0006: NSFW ゲートとメディア URL 組み立て

## 実装状況: 完了（2026-08-10）

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

チャンネル年齢判定、純粋なNSFWポリシー、画像URL書き換え、メディア選択を実装済み。
Discord描画への適用は Plan 0007 で行う。任意の `PximgFetcher` はv1完了条件外のため未実装。

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
- **`sensitive` は v1 では常に false**（`sl` が全年齢作品でも 6 を返し判定に使えないため。
  Plan 0005 フェーズ0 の実測結果）。判定表とフィールドは残し、将来の指標に備える
- **純粋関数として書く**（discord.js に依存しない）

### 項目3: 画像 URL の書き換え

- **対象**: `src/adapters/pixiv/ImageUrlRewriter.ts`
- `https://i.pximg.net/<path>` → `${PXIMG_PROXY_BASE_URL}/<path>`（既定 `https://phixiv.net/i`）
- **ホスト書き換えのみ。バイトを取得しない**
- **訂正（実装時）**: 当初この Plan には「`i.pximg.net` 以外は書き換えず、埋め込みもしない」
  と書いていたが、**そのまま実装すると phixiv 経路と OGP 経路の画像がすべて消える**。
  phixiv は既にプロキシ済みの `https://phixiv.net/i/...` を返し、
  OGP は `https://embed.pixiv.net/...` を返すため。
  正しくは「**`i.pximg.net` は書き換え、埋め込み可能と実測できたホストは素通し、
  それ以外は弾く**」。この Plan は項目3・4 の実測より前に書かれていた
- 想定外のホストは素通しも書き換えもしない
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
  通常チャンネルではセンシティブを設定どおりspoiler/link-only/skipへ振り分け、
  R-18や判定不能などメディアを出せない判定はそのサムネイルだけ落とす。
  カード全体は落とさず、個別spoiler判定をレンダラまで保持する

### 将来候補: 添付フォールバック（本Plan・v1対象外）

- **対象**: `src/infrastructure/http/PximgFetcher.ts`
- [ADR 0014](../../../docs/adr/0014-media-delivery-via-proxy-url.md) の第3段。
  将来別Planで実装する場合に `MEDIA_FALLBACK=attachment` と同時に設定入口を追加する
- `Referer: https://www.pixiv.net/` を付けて取得し、`IMediaFetcher` の `bytes` を返す
- **PHPSESSID を送らない**
- **バイト上限はストリーミング中のカウンタで強制する**（`content-length` だけに頼らない）
- **本Planでは実装しない。** 将来Planが設定入口、安全条件、テスト、完了条件をまとめて所有する

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
   **検証済みの phixiv / `embed.pixiv.net` は素通しし、未知のホストは埋め込み対象から外れること**

加えて:
- `MediaSelector` の枚数上限と部分失敗時の挙動を検証する
- `original` が選択されないことを担保する

> **[ADR 0006 の既知の限界2](../../../docs/adr/0006-age-restricted-content.md)**:
> R-18 の実レスポンスを fixture としてリポジトリに置けないため、
> **実データ → `ContentRating` の写像だけは継続的な検証の外側にある**。
> Plan 0005 のスパイクで観測した構造（`xRestrict:1` / `aiType:2` / `/pages` が 404 /
> `body.urls` が null）を合成 fixture に落とし、
> `xRestrict` と `R-18` タグの2経路で冗長に判定することで、単一フィールドの誤読で倒れないようにする。

## 破壊的変更の許容範囲

なし。

## 要オーナー確認

なし（方針は ADR 0006 / ADR 0014 で確定済み）。

## 完了条件

- [x] `NsfwPolicy` の 54 ケーステーブルテストが緑
- [x] `isAgeRestricted` の全 `ChannelType` テストが緑（スレッド・DM を含む）
- [x] `ImageUrlRewriter` が**未検証のホスト**を埋め込み対象から外す（埋め込み可能と実測したホストは素通し）
- [x] `original` サイズが選択されないことがテストで担保されている
- [x] 部分失敗時に取れた分だけ表示される
- [x] `NsfwPolicy` が discord.js に依存していない（純粋関数）
- [x] `xRestrict` と `R-18`/`R-18G` タグの**2経路**で年齢区分を判定している（`sl` は使わない）
- [x] `sensitive` が v1 では常に false になっている
- [x] `PXIMG_PROXY_BASE_URL` を差し替えるだけでプロキシの向き先が変わる

## AI 実装時間見積もり

1セッション以内（ADR 0014 への切り替えで当初計画の約半分に縮小した）。
