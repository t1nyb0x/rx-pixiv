# Plan 0005: Ajax ソースとフォールバック連鎖（メタデータのみ）

## 実装状況: 未着手

owner_feedback: 待ち
feedback_ask: R-18 スパイクの結果を見て、ADR 0007（pixiv 認証）を Accepted / Rejected のどちらに倒すか
feedback_since: 2026-08-10

edge: derived-from 0001
edge: blocked-by 0003
edge: blocked-by 0004

> 出典: [ADR 0003 取得経路の多段フォールバック](../../../docs/adr/0003-source-fallback-chain.md) の実装。
> [ADR 0007 pixiv 認証](../../../docs/adr/0007-pixiv-session-optional.md) を確定させるための
> スパイクを内包する

## 関連 Plan

- [Plan 0001: 要件定義・アーキテクチャ設計・ADR 整備](0001-requirements-and-adr.md) — 分離元
- [Plan 0003: ドメインモデルと URL 検出](0003-domain-and-url-detection.md) — 依存（写像先のモデル）
- [Plan 0004: HTTP 基盤・レート制御・キャッシュ](0004-http-ratelimit-cache.md) — 依存
- [Plan 0006: NSFW ゲートとメディア取得](0006-nsfw-gate-and-media.md) — 本 Plan の年齢ヒントを使う

## 目的

pixiv から作品メタデータを取得する。画像バイトの取得は Plan 0006 で扱う。
併せて、ADR 0007 を確定させるための事実をスパイクで得る。

## 現状の挙動

未実装。

## 変更内容（項目・フェーズ）

### フェーズ0: R-18 応答形のスパイク（**最初に行う**）

- **対象**: 調査のみ。成果物は [ADR 0007](../../../docs/adr/0007-pixiv-session-optional.md) の Context への追記
- 無認証で R-18 作品の `/ajax/illust/{id}` を叩き、以下を記録する:
  - HTTP ステータス、`error` / `message` の値、メタデータだけでも返るか
  - **`auth_required` を `unavailable` と区別できるか**
- phixiv が R-18 のメタデータ・画像を返すか
- `/ajax/illust/{id}/pages` の多ページ応答と `master1200` の実サイズ分布
- pixiv のレート制限の実閾値（何 req/min で 429 が返るか）
- 結果を ADR 0007 の「決定ログ」に記録し、Status を Accepted / Rejected に確定する

### 項目1: スキーマと写像

- **対象**: `src/adapters/pixiv/schemas/`、`mappers/`
- zod スキーマ: `ajaxEnvelope` / `ajaxIllust` / `ajaxIllustPages` / `ajaxNovel` / `ajaxUser`
- **実際に消費するフィールドだけ**を記述する。全フィールドを写経しない
- mapper は純粋関数 `(validatedRaw) => PixivWork`

### 項目2: Ajax ソース（一次）

- **対象**: `src/adapters/pixiv/AjaxPixivSource.ts`、`BasePixivSource.ts`
- `/ajax/illust/{id}` + `/ajax/illust/{id}/pages`、`/ajax/novel/{id}`、`/ajax/user/{id}?full=1`
- `xRestrict`（0/1/2）→ `RatingLevel`、`sl` → `sensitive`、`aiType` → `ai`。
  `confidence: "authoritative"`
- **部分成功を捨てない**: `/pages` が失敗しても1ページ目だけで返し `pagesTruncated: true`
- 404 → `not_found`。年齢制限で弾かれた応答 → `auth_required`（フェーズ0の結果に従う）

### 項目3: phixiv ソース（二次）

- **対象**: `src/adapters/pixiv/PhixivSource.ts`
- `PHIXIV_BASE_URL`（既定 `https://phixiv.net`）を叩く。
  **`/api/info` は廃止済みのため使わない**。OGP 形の取得として実装する
- `R-18` タグの有無から `confidence: "inferred"` の年齢区分を導く
- **PHPSESSID を送らない**

### 項目4: OGP スクレイプ（三次）

- **対象**: `src/adapters/pixiv/OgpScrapeSource.ts`
- 作品ページの OGP メタタグを読む
- **年齢確認インタースティシャルを検出**し、検出できたら `inferred` / `r18`、
  できなければ `unknown`

### 項目5: 連鎖と解決

- **対象**: `src/adapters/pixiv/PixivSourceChain.ts`、`shortlink.ts`、
  `src/core/services/WorkResolver.ts`
- **`not_found` のときのみ打ち切る**。他は次段へ
- **年齢ヒントを持ち回り、後段は制限を強める方向にしか更新できない**
- 総予算 8000ms、経路別 ajax/phixiv 3000ms・ogp 2500ms。
  総予算が尽きていれば次段を**起動しない**
- `pixiv.me` のリダイレクト解決（最大3ホップ、2秒）→ 純粋な `UrlDetector` で再判定
- `WorkResolver` はキャッシュ参照 → 連鎖 → キャッシュ書き込み

### 項目6: 任意の pixiv セッション

- **対象**: `src/infrastructure/session/PixivSession.ts`
- フェーズ0 の結果次第で実装するか決める。実装する場合:
  - Cookie は **`www.pixiv.net` にのみ**付与する
  - 起動時と1時間ごとに有効性プローブ。失効時は警告を出して無認証モードへ縮退
  - 認証時はレート制限をより厳しくする

## 影響範囲

`src/adapters/pixiv/` の新規追加と `core/services/WorkResolver.ts`。
フェーズ0 の結果次第で ADR 0007 の Status が変わり、
Plan 0006 の NSFW ゲートの縮退経路の記述に影響する。

## テスト方針

- 実 API から採取した fixture（`tests/fixtures/ajax/*.json`）に対する写像テスト。
  `illust-single` / `illust-manga` / `illust-ugoira` / `novel` / `user` /
  `error-notfound` / `error-authrequired` を用意する
- **モックはポート（`IHttpClient`）に対して行う**。`vi.mock("undici")` はしない
- 連鎖のテスト: 各エラー種別で「打ち切るか続行するか」を全て検証する
- 年齢ヒントが後段で**緩められないこと**を明示的にテストする
- `tests/live/` に手動実行のスモークテストを置く（CI ではゲートにしない）

## 破壊的変更の許容範囲

なし。

## 要オーナー確認

- **フェーズ0 の結果を見て、ADR 0007（pixiv 認証）を Accepted / Rejected のどちらに倒すか**
- 認証を実装する場合、`PIXIV_PHPSESSID` を実際に供給するか（アカウント停止リスクの受容）

## 完了条件

- [ ] フェーズ0 のスパイク結果が ADR 0007 の Context と決定ログに記録され、Status が確定している
- [ ] fixture から illust / manga / novel / user が正しく `PixivWork` へ写像される
- [ ] `not_found` で連鎖が打ち切られ、他のエラーでは続行することがテストで確認できる
- [ ] `auth_required` が `ratingHint = r18/inferred` を立て、**後段で緩められない**
- [ ] `/pages` の失敗時に1ページ目だけで返り `pagesTruncated: true` になる
- [ ] `pixiv.me` のリダイレクトが解決され、再判定される
- [ ] 総予算超過時に次の経路を起動しない
- [ ] `vi.mock("undici")` を使っていない（ポートに対してモックしている）

## AI 実装時間見積もり

2セッション程度（フェーズ0 のスパイクを含む）。
