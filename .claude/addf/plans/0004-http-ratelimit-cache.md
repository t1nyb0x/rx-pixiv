# Plan 0004: HTTP 基盤・レート制御・キャッシュ

## 実装状況: 未着手

owner_feedback: 不要

edge: derived-from 0001
edge: blocked-by 0002

> 出典: [ADR 0011 レート制御とサーキットブレーカ](../../../docs/adr/0011-rate-limit-and-circuit-breaker.md)
> および [ADR 0008 インメモリキャッシュ](../../../docs/adr/0008-in-memory-cache.md) の実装

## 関連 Plan

- [Plan 0001: 要件定義・アーキテクチャ設計・ADR 整備](0001-requirements-and-adr.md) — 分離元
- [Plan 0002: プロジェクト基盤整備](0002-project-scaffold.md) — 依存
- [Plan 0005: Ajax ソースとフォールバック連鎖](0005-ajax-source-and-chain.md) — 本 Plan の基盤を使う

## 目的

上流に対して行儀よく振る舞うための HTTP 基盤を作る。
rx-instagram に無かったもの（タイムアウト・リトライ・同時実行制限・レート制御）を、
最初から入れる。

## 現状の挙動

未実装。参考として rx-instagram にはこれらの機構が一切なく、
応答しない上流に対して無限に待ち、URL 数ぶんの取得を無制限に並列発火する。

## 変更内容（項目・フェーズ）

### 項目1: HTTP クライアント

- **対象**: `src/infrastructure/http/HttpClient.ts`
- undici の `Agent` と `request` を直接使う（[ADR 0001](../../../docs/adr/0001-tech-stack.md)）
- User-Agent の設定、`AbortSignal` によるタイムアウト
- リトライは **`network` と `upstream_5xx` に対して1回のみ**、250ms + ジッタ
- **429 と 4xx はリトライしない**
- `IHttpClient` ポートを実装する

### 項目2: レート制御

- **対象**: `src/infrastructure/http/RateLimiter.ts`
- ホスト別トークンバケット。`www.pixiv.net` 1rps/burst3、`i.pximg.net` 8rps/同時4
- 環境変数 `PIXIV_RPS` / `PXIMG_CONCURRENCY` で調整可能

### 項目3: サーキットブレーカ

- **対象**: `src/infrastructure/http/CircuitBreaker.ts`
- 60秒内5連続失敗で開 → 120秒 → 半開1本
- 開いている間は**遅延ゼロ**で失敗を返す
- 環境変数 `CIRCUIT_FAILURE_THRESHOLD` / `CIRCUIT_OPEN_MS`

### 項目4: キャッシュ

- **対象**: `src/infrastructure/cache/{LruTtlCache,WorkCache,AttachmentUrlCache}.ts`
- TTL + LRU。`IWorkCache`（非同期）を実装する
- ネガティブキャッシュ（`not_found`、TTL 10分）を含む
- `AttachmentUrlCache` は Discord CDN URL の `ex` パラメータから TTL を導出する

### 項目5: 同時実行ユーティリティ

- **対象**: `src/utils/concurrency.ts`
- 小さな `pLimit` 相当。ライブラリを導入しない

## 影響範囲

`src/infrastructure/` と `src/utils/` の新規追加。`core/` のポートを実装する。

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

## AI 実装時間見積もり

1セッション以内。
