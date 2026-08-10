# ADR 0007: v1ではpixiv認証を実装しない（将来は任意）

- Status: **Accepted**
- Date: 2026-08-10
- Issue: -

> 2026-08-10 の実測（Plan 0005 フェーズ0）により Accepted で確定した。
> **無認証でも年齢区分は `authoritative` に取得できる**ため、
> 認証なしでも phixiv 経由で単ページの R-18 画像まで表示できる。
> v1 は完全資格情報を受け付けず、`PixivSession` を実装しない。

## Context

[ADR 0006](0006-age-restricted-content.md) の年齢ゲートは、`auth_required` 応答自体を
年齢制限の証拠として扱うことで、**認証なしでも安全側には倒れる**。
単ページの R-18 画像は phixiv 経由で無認証表示できる。認証の利得は
phixiv 非依存の Ajax 直取得と R-18 複数ページ対応に限られる。

一方で、`PHPSESSID` は**アカウントの完全な資格情報**である。
これを使った自動取得は pixiv の利用規約に抵触する可能性があり、
アカウント停止は現実的な帰結である。

### 実測結果（2026-08-10 / Plan 0005 フェーズ0）

正規の User-Agent と `Referer: https://www.pixiv.net/` を付けた無認証クライアントで実測した。

| 検証 | 全年齢作品 | R-18 作品 |
|---|---|---|
| `GET /ajax/illust/{id}` | HTTP 200・`error:false`・`xRestrict:0` | **HTTP 200・`error:false`・`xRestrict:1`** |
| 同上の `body.urls` | 5キーとも **null** | 5キーとも **null** |
| `GET /ajax/illust/{id}/pages` | HTTP 200・URL は**すべて非 null** | **HTTP 404**・`error:true`・`body:[]` |
| `sl` | **6** | **6** |
| `aiType` | 0 | 2 |
| `pageCount` | 1 | 8 |
| phixiv（`/artworks/{id}`、**bot UA**） | 稼働・og:image あり | **稼働・og:image あり**（下記訂正） |

**結論は当初の想定より良かった。**

1. **年齢区分は無認証で確定できる。** `/ajax/illust/{id}` は R-18 でも 200 を返し、
   `xRestrict` がそのまま入っている。**`confidence: "authoritative"` が認証なしで得られる。**
   当初の問い（`auth_required` を `unavailable` と区別できるか）は、
   **そもそも `auth_required` が発生しない**という形で解消した
2. **Ajax 経路では画像 URL が得られない。** R-18 では `/pages` が 404 になる。
   ただし **phixiv が R-18 の画像 URL を供給できる**（下記訂正を参照）
3. **`body.urls` は全年齢作品でも常に null。** 画像 URL は `/pages` からしか取れない
4. **`sl` は判定に使えない。** 全年齢作品でも `sl: 6` が返るため、
   「`sl >= 4` ならセンシティブ」という当初の仮置きは**誤り**だった（要件 Q-5 の回答）

### 訂正（2026-08-10・Plan 0005 項目3）

当初この ADR には「**phixiv も R-18 には og:image を出さない**」と書いていた。
**これは誤りだった。**

原因は観測方法にある。`WebFetch`（User-Agent を指定できない）で確認したため、
phixiv が通常 UA に対して **307 で pixiv へ転送する**挙動を「og:image が無い」と読み違えていた。
**bot の User-Agent（`Discordbot/2.0` 等）を付けて再検証したところ、
R-18 作品でも `og:image` が返る。** さらにその URL（`https://phixiv.net/i/...`）は
UA を問わず **206 / `image/jpeg`** で実バイトを返す（＝Discord のメディアプロキシが取得できる）。

これは、この ADR 自身が Context に書いた
「ヘッダを制御できないツールの観測を鵜呑みにしない」という教訓を**破った**結果である。

### 帰結（訂正後）

| チャンネル | 認証なし | 認証あり |
|---|---|---|
| 通常 | **`link_only` が完全に成立**（R-18 と確定できるため） | 同左 |
| 年齢制限 | **メタデータも画像も出せる**（画像は phixiv 経由） | 同左（Ajax から直接取れる） |

**安全側の判定も、年齢制限チャンネルでの表示も、認証なしで成立する。**
認証の価値は「phixiv に依存せず Ajax から直接画像 URL を取れる」ことに縮小した。

ただし phixiv 経由の R-18 展開には制約が残る:

- 年齢区分は **Ajax（`authoritative`）から取り、画像だけを phixiv から得る**構成になる。
  phixiv 単独では `confidence: "inferred"` に落ちるため、
  [ADR 0006](0006-age-restricted-content.md) のフェイルクローズにより通常チャンネルでは展開されない
- phixiv は **1リクエストにつき画像1枚**。複数ページ作品は先頭のみになる
- phixiv 本家はアーカイブ済みで、フォークの寿命も保証されない（[ADR 0014](0014-media-delivery-via-proxy-url.md)）

## Decision

v1 は `PIXIV_PHPSESSID` を受け付けず、`PixivSession` を実装しない。
安全性にも単ページの R-18 表示にも不要な完全資格情報を、利得が限定的な段階で
運用者へ要求しないためである。ヘルスの `authenticated` は v1 では常に `false` とする。

将来、phixiv 非依存または R-18 複数ページ対応を別 Plan で実装する場合も、
**未設定で Bot が動作すること**を不変条件とし、次の制約を守る:

- Cookie は **`www.pixiv.net` の ajax リクエストにのみ**付与する。
  phixiv にも `i.pximg.net` にも送らない
- 起動時に**有効性プローブ**を行い、結果をログに残す。
  以後1時間ごと、および最初の `auth_required` 発生時に再プローブする
- セッションが失効したら、警告を出して**無認証モードへ縮退**する。落とさない
- ロガーで**無条件にマスク**する（`redact: ["*.cookie", "*.PIXIV_PHPSESSID", "req.headers.cookie"]`）
- 認証時はレート制限を**より厳しく**する。
  無認証でレート制限を食うと失うのは IP だが、認証済みで目を付けられると失うのはアカウントである
- `/health` に `authenticated: boolean` を出す（値そのものは出さない）

## Consequences

### Positive

- v1 は完全資格情報を保持・送信せず、漏洩とアカウント停止の面を増やさない
- 年齢判定と単ページの R-18 表示は無認証で成立する

### Negative

- 年齢制限チャンネルでの R-18 の画像表示が **phixiv の可用性に依存する**。
  phixiv が落ちれば画像は出ない（メタデータは Ajax から出る）
- 未設定時、R-18 の複数ページ作品は先頭1枚のみになる
- R-18 の複数ページを Ajax から直接取得できない

### Mitigation

- `.env.example` と設定スキーマに資格情報の入口を置かない
- ロガーの PHPSESSID マスクは、誤投入と将来実装に対する多層防御として維持する
- 将来実装する場合は別 Plan とレビューで、送信先制限・規約リスク・失効時縮退を再確認する

## Rejected alternatives

### 認証を必須にする

無認証で v1 スコープの3種別すべてが取得できることは実測で確認済みであり、
全年齢作品のためにアカウントリスクを負わせる理由がない。

### refresh_token による AppAPI 認証（pixivpy 相当）

PHPSESSID より寿命が長く運用は楽になるが、
トークン取得に Selenium 相当の手順が要り、
アカウントリスクの本質（自動取得が規約に触れうる）は変わらない。
Ajax API と AppAPI の二重実装にもなる。

---

## 決定ログ

| 日付 | 出来事 |
|---|---|
| 2026-08-10 | Proposed として起票。Plan 0005 のスパイク待ち |
| 2026-08-10 | スパイク実施。**無認証でも `xRestrict` が取れる**ことが判明し、安全側の判定に認証は不要と確定。認証は「年齢制限チャンネルで R-18 の画像を見せる」ためだけの追加機能に格下げして **Accepted** |
| 2026-08-10 | Plan 0005 項目3 で **「phixiv は R-18 に og:image を出さない」が誤りだったと判明**（bot UA を付けていなかった観測ミス）。R-18 の画像も無認証で出せるため、認証の価値はさらに縮小。Status は Accepted のまま |
| 2026-08-11 | v1 では `PIXIV_PHPSESSID` を受け付けず `PixivSession` を実装しないと確定。将来必要なら別 Plan で再判断する |
