# Plan 0009: うごイラ対応 — メディアサービス切り出しの検討（検討スタブ）

## 実装状況: 未着手

owner_feedback: 不要

edge: derived-from 0001
edge: blocked-by external

> 出典: [ADR 0012 うごイラを v1 スコープ外とする](../../../docs/adr/0012-ugoira-out-of-scope.md)。
> オーナー判断で「ロードマップ対応」とされた

## 関連 Plan

- [Plan 0001: 要件定義・アーキテクチャ設計・ADR 整備](0001-requirements-and-adr.md) — 分離元
- [Plan 0003: ドメインモデルと URL 検出](0003-domain-and-url-detection.md) — `IMediaFetcher` ポートを定義した Plan
- [Plan 0006: NSFW ゲートとメディア URL 組み立て](0006-nsfw-gate-and-media.md) — 具象実装（`ImageUrlRewriter` と、既定無効の `PximgFetcher`）を追加した Plan

## 分かっていること

- うごイラはフレーム画像の ZIP と、フレームごとの delay メタデータで構成される
- Discord で動くものとして見せるには MP4 / WebM への変換が必要で、**ffmpeg が要る**
- [ADR 0012](../../../docs/adr/0012-ugoira-out-of-scope.md) により、
  **ffmpeg を Bot 本体イメージに入れないことは決まっている**
- v1 では検出のみ行い、「うごイラ（静止画のみ表示）」と明示して静止画1枚を出す
- `IMediaFetcher` ポートは `{ kind: "bytes" } | { kind: "url" }` を返す形で
  **Plan 0003 で定義済み**（Plan 0006 が追加するのは具象の `PximgFetcher` のみ）。
  ffmpeg を要する実装を**別実装として差し込める**

## 未解決の問い

- 変換をどこで行うか — 別コンテナ（`rx-pixiv-media`）か、外部サービスか
- 別コンテナにする場合、Bot との通信は HTTP か、共有ボリューム経由か
- 変換結果をキャッシュするか。するならどこに（[ADR 0014](../../../docs/adr/0014-media-delivery-via-proxy-url.md) により
  Bot は画像バイトを扱わなくなったが、変換が必要な ugoira は例外になる。どこに置くか）
- 変換の同時実行数と、CPU 予算の上限
- 出力形式（MP4 / WebM / GIF）と、Discord 上での再生互換性
- 年齢ゲートとの関係 — 動画に対して item 単位スポイラーが効くか
- 変換に失敗したときの縮退先（静止画へ戻す）

## 着手のトリガー

- **うごイラ URL の投稿頻度がメトリクスで有意になったとき**
  （Plan 0008 の `pixiv_render_total` に ugoira 種別のラベルを足して観測する）
- または、自前ホストの画像プロキシ（[ADR 0014](../../../docs/adr/0014-media-delivery-via-proxy-url.md) の第2段）へ
  移行することになったとき（その場合、画像プロキシと ugoira 変換を同じサービスに載せられる）
