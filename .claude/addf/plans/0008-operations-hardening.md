# Plan 0008: 運用面の仕上げ（可観測性・シャットダウン・ライブスモーク）

## 実装状況: 未着手

owner_feedback: 不要

edge: derived-from 0001
edge: blocked-by 0007

> 出典: [Plan 0001](0001-requirements-and-adr.md) で確定した非機能要件 NFR-3 / NFR-6 の実装

## 関連 Plan

- [Plan 0001: 要件定義・アーキテクチャ設計・ADR 整備](0001-requirements-and-adr.md) — 分離元
- [Plan 0007: Discord レンダリングと messageCreate 配線](0007-rendering-and-wiring.md) — 依存

## 目的

動く Bot を、運用できる Bot にする。
壊れたときに壊れたと分かり、直すべき場所が分かる状態を作る。

## 現状の挙動

Plan 0007 までで Bot は動くが、
何が起きているかを外から観測する手段が乏しい。

## 変更内容（項目・フェーズ）

### 項目1: メトリクス

- **対象**: `src/infrastructure/metrics/Counters.ts`、`HealthServer.ts` の `/metrics`
- Prometheus テキスト形式。**自前実装**（数十行。`prom-client` を導入しない）
- 出すもの:
  - `pixiv_fetch_total{source,result}` — 「phixiv は死んでいるか」「レート制限を食っているか」
  - `pixiv_fallback_depth_total{depth}` — 常時2段目以降なら一次経路の破損
  - `pixiv_render_total{decision}` — **`skip` の急増は年齢判定の故障を意味する**。
    **R-18 判定の急減も同様にアラート対象**（写像が壊れた兆候。[ADR 0006 既知の限界2](../../../docs/adr/0006-age-restricted-content.md)）
  - `pixiv_media_total{proxy,result}` — 画像プロキシの健全性（[ADR 0014](../../../docs/adr/0014-media-delivery-via-proxy-url.md)）
  - `pixiv_cache_hits_total` / `pixiv_cache_misses_total`
  - `pixiv_circuit_state{source}`

### 項目2: ヘルスの充実

- **対象**: `src/infrastructure/http/HealthServer.ts`
- `/readyz`: `client.isReady()` かつ WS ping が数値のときのみ 200。それ以外は 503
- `/health`: uptime・WS 状態と ping・ギルド数・キャッシュサイズ・
  経路別サーキット状態・`authenticated: boolean`（**値そのものは出さない**）

### 項目3: 正常終了

- **対象**: `src/index.ts`
- SIGINT / SIGTERM で:
  新規メッセージの受付停止 → 処理中を**最大5秒**待つ →
  `client.destroy()` → ヘルスサーバ停止 → `agent.close()` → exit 0

### 項目4: プロセスレベルのエラー処理

- **対象**: `src/index.ts`
- `unhandledRejection`: fatal ログのみ。**落とさない**
- `uncaughtException`: fatal ログ後 exit(1)。**握り潰さない**（Docker に再起動させる）
- `client.on("error" | "shardError" | "warn")` と REST の `rateLimited` をログする

### 項目5: ライブスモークテスト

- **対象**: `tests/live/ajaxShape.live.test.ts`、`.github/workflows/live-smoke.yml`
- 環境変数でガードし、**CI のマージゲートにはしない**
- 既知の公開全年齢作品 ID に対して実 pixiv を叩き、zod スキーマが依然通ることを検証する
- **この Bot の失敗モードは依存の腐敗ではなく上流のレスポンス形の変化**であり、
  それを検知できるのはこのテストだけである
- 週次 cron で実行し、失敗時に通知する（ゲートしない）

### 項目6: README

- **対象**: `README.md`
- 対応 URL 一覧、必要な Discord 権限、セットアップ手順、環境変数表
- **[ADR 0014](../../../docs/adr/0014-media-delivery-via-proxy-url.md) の姿勢を明記する**
  （画像プロキシの URL を埋め込むだけでバイトを再配信しない・`regular` サイズのみ・
  4枚上限・必ず作品リンクを併記・削除要請には `!owner/block` で応じる）
- **管理コマンド**（[ADR 0015](../../../docs/adr/0015-admin-commands-and-abuse-control.md)）の一覧と、
  **`Manage Messages` が実質必須である理由**（[ADR 0006 既知の限界1](../../../docs/adr/0006-age-restricted-content.md)）を書く
- [ADR 0007](../../../docs/adr/0007-pixiv-session-optional.md) を実装した場合、
  **PHPSESSID の規約リスクと捨てアカウント推奨を明記する**

## 影響範囲

`src/infrastructure/`、`src/index.ts`、`tests/live/`、`README.md`。

## テスト方針

- `/metrics` が全カウンタを Prometheus 形式で返すこと
- `/readyz` が未 ready 時に 503 を返すこと（`honoApp.request()` で listen せずに検証）
- `unhandledRejection` がログされ、プロセスが落ちないこと
- 正常終了の順序と 5 秒の締め切りをフェイクタイマーで検証
- ライブスモークは手動実行で緑になること（CI ではゲートしない）

## 破壊的変更の許容範囲

なし。

## 要オーナー確認

- 週次ライブスモークの失敗通知先（GitHub Issue 起票 / Pushover / なし）

## 完了条件

- [ ] SIGTERM から 5 秒以内に処理中を待って exit 0 する
- [ ] Discord 未接続時に `/readyz` が 503 を返す
- [ ] `unhandledRejection` がログされ、握り潰されず、かつプロセスが落ちない
- [ ] `/metrics` が全カウンタを返す
- [ ] `/health` に PHPSESSID の値が含まれない（`authenticated` の真偽のみ）
- [ ] ライブスモークが手動実行で緑
- [ ] `README.md` に権利上の姿勢が明記されている
- [ ] 週次 cron ワークフローが設定され、マージゲートになっていない

## AI 実装時間見積もり

1セッション以内。
