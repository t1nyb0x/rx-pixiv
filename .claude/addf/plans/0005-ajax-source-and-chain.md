# Plan 0005: Ajax ソースとフォールバック連鎖（メタデータのみ）

## 実装状況: 完了（2026-08-11）

<!-- フェーズ0・項目1〜5 は完了。項目6 はスパイクと phixiv 再実測の結果、
     v1 では実装しないと決定した。資格情報なしでも安全性と単ページ表示が成立する。 -->

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

Ajax / phixiv / OGP source、補完マージする取得連鎖、短縮URL解決、キャッシュ付き作品解決を実装済み。
Botの実行経路へのDIとDiscordメッセージ処理は Plan 0007 で行う。

## 変更内容（項目・フェーズ）

### フェーズ0: R-18 応答形のスパイク ✅ **完了（2026-08-10）**

オーナーから受領した R-18 作品 ID で実測した。**結果は当初の想定より良かった。**

| 検証 | 全年齢 | R-18 |
|---|---|---|
| `/ajax/illust/{id}` | 200・`xRestrict:0` | **200・`xRestrict:1`**・`aiType:2` |
| 同 `body.urls` | 5キーとも **null** | 5キーとも **null** |
| `/ajax/illust/{id}/pages` | 200・URL 全て非 null | **404**・`error:true`・`body:[]` |
| `sl` | **6** | **6** |
| phixiv `/artworks/{id}`（bot UA） | 稼働・og:image あり | **稼働・og:image あり**（当初「無し」と誤記録。項目3 で訂正） |

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
- `/ajax/illust/{id}/pages` の多ページ応答を確認。`master1200` の実サイズ分布は
  v1が枚数・URL変種で制限し画像バイトを扱わないため測定対象外とした
- 小説シリーズのメタデータ取得に使える Ajax endpoint と応答形を実測し、一次取得経路を確定する
- pixiv の429実閾値は、上流へ意図的な負荷を掛けるため測定しない。
  既定1 rps・1回retry・サーキットブレーカで保守的に運用する
- **`sl`（sanity level）は全年齢でも6だったため判定に使わない**（要件 Q-5 解消）
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
- **bot UA（`Discordbot/2.0` 等）が必須**。通常の UA では 307 で pixiv へ転送される
- **R-18 作品でも og:image が返る**。Ajax の `/pages` が 404 になる R-18 において、
  **無認証で画像 URL を得られる唯一の経路**になる
- `/api/v1/statuses/{id}` は**要求と異なる作品を返す**ため使わない
- 1リクエストにつき画像1枚（`multiPage: false`）
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

- **v1では実装しない。** 無認証でも年齢判定とphixiv経由のR-18単ページ表示が成立し、
  完全な資格情報を扱うリスクに見合う必須利益がないため
- 将来、phixiv非依存またはR-18複数ページが必要になった場合だけ、
  `src/infrastructure/session/PixivSession.ts` を別Planで再検討する。実装する場合:
  - Cookie は **`www.pixiv.net` にのみ**付与する
  - 起動時と1時間ごとに有効性プローブ。失効時は警告を出して無認証モードへ縮退
  - 認証時はレート制限をより厳しくする

## 影響範囲

`src/adapters/pixiv/` の新規追加と `core/services/WorkResolver.ts`。
フェーズ0 の結果を ADR 0007 と Plan 0006 の縮退経路へ反映済み。

## テスト方針

- 実 API から採取した fixture（`tests/fixtures/ajax/*.json`）に対する写像テスト。
  `illust-single` / `illust-manga` / `illust-ugoira` / `novel` / `novel-series` / `user` /
  `error-notfound` を用意する。実測で発生しなかった `auth_required` は連鎖の合成テストで扱う
- **モックはポート（`IHttpClient`）に対して行う**。`vi.mock("undici")` はしない
- 連鎖のテスト: 各エラー種別で「打ち切るか続行するか」を全て検証する
- 年齢ヒントが後段で**緩められないこと**を明示的にテストする
- `tests/live/` に手動実行のスモークテストを置く（CI ではゲートにしない）

## 破壊的変更の許容範囲

なし。

## 要オーナー確認

- ~~フェーズ0 の結果を見て ADR 0007 をどちらに倒すか~~ → **Accepted で確定**
- ~~`PIXIV_PHPSESSID` を実際に供給するか~~ → **v1では供給せず、PixivSessionも実装しない。**
  安全性と単ページ表示は無認証で成立する。phixiv非依存・R-18複数ページが必要になった時だけ再検討する

## 完了条件

- [x] フェーズ0 のスパイク結果が ADR 0007 の Context と決定ログに記録され、Status が確定している
- [x] fixture から illust / manga / novel / novel series / user が正しく `PixivWork` へ写像される
- [x] `not_found` で連鎖が打ち切られ、他のエラーでは続行することがテストで確認できる
- [x] `auth_required` が `ratingHint = r18/inferred` を立て、**後段で緩められない**
- [x] `/pages` の失敗時に**画像ゼロ枚**のメタデータのみで返り `pagesTruncated: true` になる
- [x] **`/pages` の 404 が `not_found` に写像されない**（R-18 作品で「見つかりません」と誤報しない）
- [x] 1ページ作品でも `/pages` を呼んでいる（`body.urls` に依存していない）
- [x] `pixiv.me` のリダイレクトが解決され、再判定される
- [x] `sl` の値域を実測し、要件 Q-5 に反映した（**判定に使えないという否定的結論**）
- [x] 総予算超過時に次の経路を起動しない
- [x] `vi.mock("undici")` を使っていない（ポートに対してモックしている）
- [x] **補完マージ**: R-18 で Ajax の年齢区分と phixiv の画像が両方使われる（ADR 0003 に追記）
- [x] 項目6 `PixivSession` はv1で実装しないと決定し、資格情報なしの経路を既定にした

## AI 実装時間見積もり

2セッション程度（フェーズ0 のスパイクを含む）。
