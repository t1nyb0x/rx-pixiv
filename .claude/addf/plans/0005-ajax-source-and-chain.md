# Plan 0005: Ajax ソースとフォールバック連鎖（メタデータのみ）

## 実装状況: 未着手

owner_feedback: 済

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
- [Plan 0006: NSFW ゲートとメディア URL 組み立て](0006-nsfw-gate-and-media.md) — 本 Plan の年齢ヒントを使う

## 目的

pixiv から作品メタデータを取得する。画像バイトの取得は Plan 0006 で扱う。
併せて、ADR 0007 を確定させるための事実をスパイクで得る。

## 現状の挙動

未実装。

## 変更内容（項目・フェーズ）

### フェーズ0: R-18 応答形のスパイク ✅ **完了（2026-08-10）**

オーナーから受領した R-18 作品 ID で実測した。**結果は当初の想定より良かった。**

| 検証 | 全年齢 | R-18 |
|---|---|---|
| `/ajax/illust/{id}` | 200・`xRestrict:0` | **200・`xRestrict:1`**・`aiType:2` |
| 同 `body.urls` | 5キーとも **null** | 5キーとも **null** |
| `/ajax/illust/{id}/pages` | 200・URL 全て非 null | **404**・`error:true`・`body:[]` |
| `sl` | **6** | **6** |
| phixiv `/artworks/{id}` | 稼働 | **og:image 無し** |

**実装に直結する3つの帰結:**

1. **年齢区分は無認証で `authoritative` に取れる。** `auth_required` からの推論は予備に降格。
   [ADR 0007](../../../docs/adr/0007-pixiv-session-optional.md) は **Accepted** で確定
2. **`body.urls` は常に null。** 画像 URL は `/pages` からしか取れないので、
   **1ページ作品でも必ず `/pages` を呼ぶ**
3. **`/pages` の 404 を `not_found` に写像してはならない。**
   R-18 では作品が実在するのに `/pages` だけ 404 になる。
   誤ると実在作品に「見つかりません」と誤報する
   （[ADR 0003 の 404 の取り扱い](../../../docs/adr/0003-source-fallback-chain.md)）
4. **`sl` は判定に使えない**（全年齢でも 6）。要件 Q-5 は否定的結論で解消

#### 実施済みの調査項目（記録）

- **対象**: 調査のみ。成果物は [ADR 0007](../../../docs/adr/0007-pixiv-session-optional.md) の Context への追記
- 無認証で R-18 作品の `/ajax/illust/{id}` を叩き、以下を記録する:
  - HTTP ステータス、`error` / `message` の値、メタデータだけでも返るか
  - **`auth_required` を `unavailable` と区別できるか**
- phixiv が R-18 のメタデータ・画像を返すか
- `/ajax/illust/{id}/pages` の多ページ応答と `master1200` の実サイズ分布
- 小説シリーズのメタデータ取得に使える Ajax endpoint と応答形を実測し、一次取得経路を確定する
- pixiv のレート制限の実閾値（何 req/min で 429 が返るか）
- **`sl`（sanity level）の値域と「センシティブ」の閾値**。
  現在の `sl >= 4` は**未検証の仮置き**である（要件 Q-5）
- ~~結果を ADR 0007 の決定ログに記録し Status を確定~~ → **完了**

### 項目1: スキーマと写像

- **対象**: `src/adapters/pixiv/schemas/`、`mappers/`
- zod スキーマ: `ajaxEnvelope` / `ajaxIllust` / `ajaxIllustPages` / `ajaxNovel` / `ajaxNovelSeries` / `ajaxUser`
- **実際に消費するフィールドだけ**を記述する。全フィールドを写経しない
- mapper は純粋関数 `(validatedRaw) => PixivWork`

### 項目2: Ajax ソース（一次）

- **対象**: `src/adapters/pixiv/AjaxPixivSource.ts`、`BasePixivSource.ts`
- `/ajax/illust/{id}` + `/ajax/illust/{id}/pages`、`/ajax/novel/{id}`、フェーズ0で確定した小説シリーズ endpoint、`/ajax/user/{id}?full=1`
- `xRestrict`（0/1/2）→ `RatingLevel`、`aiType` → `ai`、`confidence: "authoritative"`。
  **`sl` は使わない**（全年齢でも 6 のため）。`sensitive` は v1 では常に false
- **1ページ作品でも必ず `/pages` を呼ぶ**（`body.urls` が常に null のため）
- **部分成功を捨てない**: `/pages` が失敗したら**画像ゼロ枚**のメタデータのみで返し
  `pagesTruncated: true` を立てる
- **404 の写像をエンドポイント別に分ける**:
  `/ajax/illust/{id}` の 404 → `not_found`（連鎖打ち切り）、
  **`/pages` の 404 → `not_found` にしない**（画像ゼロ枚で続行）

### 項目3: phixiv ソース（二次）

- **対象**: `src/adapters/pixiv/PhixivSource.ts`
- `PHIXIV_BASE_URL`（既定 `https://phixiv.net`）を叩く。
  **`/api/info` は廃止済みのため使わない**。OGP 形の取得として実装する
- `R-18` タグの有無から `confidence: "inferred"` の年齢区分を導く
- **R-18 作品には og:image が無い**（実測済み）。R-18 画像の代替供給源にはならない
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
- `HttpClient.fromEnv(env)` で生成した1インスタンスを全 source で共有し、各 source を
  `CircuitProtectedSource.fromEnv(source, env)` で包む（物理 retry は共有 host rate limit の計数対象、
  zod の `parse_error` は source 単位の circuit failure にする）

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
  `illust-single` / `illust-manga` / `illust-ugoira` / `novel` / `novel-series` / `user` /
  `error-notfound` / `error-authrequired` を用意する
- **モックはポート（`IHttpClient`）に対して行う**。`vi.mock("undici")` はしない
- 連鎖のテスト: 各エラー種別で「打ち切るか続行するか」を全て検証する
- 年齢ヒントが後段で**緩められないこと**を明示的にテストする
- `tests/live/` に手動実行のスモークテストを置く（CI ではゲートにしない）

## 破壊的変更の許容範囲

なし。

## 要オーナー確認

- ~~フェーズ0 の結果を見て ADR 0007 をどちらに倒すか~~ → **Accepted で確定**
- `PIXIV_PHPSESSID` を実際に供給するか（アカウント停止リスクの受容）。
  **供給しなくても安全性は損なわれない**。年齢制限チャンネルで R-18 の**画像**を
  出したい場合のみ必要（要件 Q-3）

## 完了条件

- [x] フェーズ0 のスパイク結果が ADR 0007 の Context と決定ログに記録され、Status が確定している
- [ ] fixture から illust / manga / novel / novel series / user が正しく `PixivWork` へ写像される
- [ ] `not_found` で連鎖が打ち切られ、他のエラーでは続行することがテストで確認できる
- [ ] `auth_required` が `ratingHint = r18/inferred` を立て、**後段で緩められない**
- [ ] `/pages` の失敗時に**画像ゼロ枚**のメタデータのみで返り `pagesTruncated: true` になる
- [ ] **`/pages` の 404 が `not_found` に写像されない**（R-18 作品で「見つかりません」と誤報しない）
- [ ] 1ページ作品でも `/pages` を呼んでいる（`body.urls` に依存していない）
- [ ] `pixiv.me` のリダイレクトが解決され、再判定される
- [x] `sl` の値域を実測し、要件 Q-5 に反映した（**判定に使えないという否定的結論**）
- [ ] 総予算超過時に次の経路を起動しない
- [ ] `vi.mock("undici")` を使っていない（ポートに対してモックしている）

## AI 実装時間見積もり

2セッション程度（フェーズ0 のスパイクを含む）。
