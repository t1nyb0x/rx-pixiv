# Plan 0004: HTTP 基盤・レート制御・キャッシュ

## 実装状況: 進行中（2026-08-10）

owner_feedback: 不要

edge: derived-from 0001
edge: blocked-by 0002

> 出典: [ADR 0011 レート制御とサーキットブレーカ](../../../docs/adr/0011-rate-limit-and-circuit-breaker.md)
> および [ADR 0016 永続が要る状態のために Redis を導入する](../../../docs/adr/0016-redis-for-persistent-state.md) の実装
> （ADR 0008 は ADR 0016 に置き換えられたが、「作品メタのキャッシュはプロセス内 LRU」という判断は維持されている）

## 関連 Plan

- [Plan 0001: 要件定義・アーキテクチャ設計・ADR 整備](0001-requirements-and-adr.md) — 分離元
- [Plan 0002: プロジェクト基盤整備](0002-project-scaffold.md) — 依存
- [Plan 0005: Ajax ソースとフォールバック連鎖](0005-ajax-source-and-chain.md) — 本 Plan の基盤を使う
- [Plan 0011: 管理コマンド・濫用対策・Redis 永続化](0011-admin-and-abuse-control.md) — 永続が要る状態はそちらで Redis に置く

## 目的

上流に対して行儀よく振る舞うための HTTP 基盤を作る。
rx-instagram に無かったもの（タイムアウト・リトライ・同時実行制限・レート制御）を、
最初から入れる。

## 現状の挙動

HTTP timeout・限定 retry・物理試行ごとの rate limit・経路別 circuit breaker・プロセス内 cache・
同時実行制限の基盤を実装済み。作品取得 source への注入は Plan 0005 で行う。

## 変更内容（項目・フェーズ）

### 項目1: HTTP クライアント

- **対象**: `src/infrastructure/http/HttpClient.ts`
- undici の `Agent` と `request` を直接使う（[ADR 0001](../../../docs/adr/0001-tech-stack.md)）
- User-Agent の設定、`AbortSignal` によるタイムアウト
- リトライは **`network` と `upstream_5xx` に対して1回のみ**、250ms + ジッタ
- **429 と 4xx はリトライしない**
- 各物理 HTTP 試行を `RateLimiter` に通す。環境設定から安全に合成する factory を持つ
- `IHttpClient` ポートを実装する

### 項目2: レート制御

- **対象**: `src/infrastructure/http/RateLimiter.ts`
- ホスト別トークンバケット。`www.pixiv.net` 1rps/burst3
- 環境変数 `PIXIV_RPS` で調整可能
- `i.pximg.net` 向けの枠は [ADR 0014](../../../docs/adr/0014-media-delivery-via-proxy-url.md) により
  通常経路では不要（Bot が画像を取得しないため）。`MEDIA_FALLBACK=attachment` のときだけ使う

### 項目3: サーキットブレーカ

- **対象**: `src/infrastructure/http/CircuitBreaker.ts`
- 60秒内5連続失敗で開 → 120秒 → 半開1本
- 開いている間は**遅延ゼロ**で失敗を返す
- 環境変数 `CIRCUIT_FAILURE_THRESHOLD` / `CIRCUIT_OPEN_MS`
- `CircuitProtectedSource` で source の取得・検証全体を包み、`parse_error` を含む経路別の最終結果を記録する
- 呼び出し側の AbortSignal によるキャンセルは上流障害として数えない

### 項目4: キャッシュ

- **対象**: `src/infrastructure/cache/{LruTtlCache,WorkCache}.ts`
- TTL + LRU。`IWorkCache`（非同期）を実装する
- ネガティブキャッシュ（`not_found`、TTL 10分）を含む
- **プロセス内のみ。** 永続が要る状態（禁止・展開拒否・返信マップ・クールダウン）は
  [Plan 0011](0011-admin-and-abuse-control.md) で Redis に置く
  （[ADR 0016](../../../docs/adr/0016-redis-for-persistent-state.md)）。
  作品メタデータのキャッシュは高頻度・大量なので **Redis をホットパスに入れない**
- `AttachmentUrlCache` は [ADR 0014](../../../docs/adr/0014-media-delivery-via-proxy-url.md) により**不要になった**

### 項目5: 同時実行ユーティリティ

- **対象**: `src/utils/concurrency.ts`
- 小さな `pLimit` 相当。ライブラリを導入しない

## 影響範囲

`src/infrastructure/` と `src/utils/` の新規追加、`src/config/env.ts` と設定例・設計文書の更新。
`core/` のポートを実装する。

## テスト方針

- **すべてフェイクタイマー（`vi.useFakeTimers()`）で検証する**。実時間を待たない
- undici の `MockAgent` を使い、実ネットワークに出ない
- 検証項目:
  - タイムアウトで `AbortSignal` が発火すること
  - `network` / `5xx` で**ちょうど1回**リトライすること
  - **429 でリトライしないこと**
  - トークンバケットが持続レートとバーストを守ること
  - サーキットが閾値で開き、開いている間は即座に失敗を返し、
    120秒後に半開になること
  - TTL 失効と LRU 追い出しが起きること

## 破壊的変更の許容範囲

なし。

## 要オーナー確認

なし。

## 完了条件

- [ ] `MockAgent` によるテストが全項目で緑（タイムアウト・1回リトライ・429 非リトライ）
- [ ] トークンバケットとサーキットブレーカがフェイクタイマーで検証済み
- [ ] TTL 失効・LRU 追い出しが検証済み
- [ ] 外部ライブラリ（`bottleneck` / `opossum` / `p-limit` / `lru-cache`）を追加していない
- [ ] `IWorkCache` の実装が非同期シグネチャである
- [ ] テストが実ネットワークに一切出ない
- [ ] rate limit が `HttpClient` の各物理試行へ、circuit breaker が `CircuitProtectedSource` の論理取得経路へ合成され、設定が動作へ反映される

## AI 実装時間見積もり

1セッション以内。
