# Plan 0010: ギルド別設定（Redis + ダッシュボード連携）（検討スタブ）

## 実装状況: 未着手

owner_feedback: 不要

edge: derived-from 0001
edge: blocked-by external

> 出典: [ADR 0016 永続が要る状態のために Redis を導入する](../../../docs/adr/0016-redis-for-persistent-state.md)。
> 「ギルド別設定・ダッシュボード連携へ進む道が開く」とした先送りの受け皿
> （ADR 0008 が ADR 0016 に置き換えられ、Redis は [Plan 0011](0011-admin-and-abuse-control.md) で既に入る）

## 関連 Plan

- [Plan 0001: 要件定義・アーキテクチャ設計・ADR 整備](0001-requirements-and-adr.md) — 分離元
- [Plan 0004: HTTP 基盤・レート制御・キャッシュ](0004-http-ratelimit-cache.md) — `IWorkCache` を非同期ポートとして定義した Plan
- [Plan 0011: 管理コマンド・濫用対策・Redis 永続化](0011-admin-and-abuse-control.md) — Redis を先に導入する Plan

## 分かっていること

- v1 の設定はすべて環境変数であり、ギルドごとに変えられない
- **Redis は [Plan 0011](0011-admin-and-abuse-control.md) で既に導入される**（禁止・展開拒否のため）。
  本 Plan の障壁は当初想定より低い
- `IWorkCache` は非同期インターフェースとして定義してあるため、
  `RedisWorkCache` を差し込むときにシグネチャ変更は発生しない
- rx-twitter に前例がある。Redis を Bot ↔ Astro ダッシュボードの同期バスとして使い、
  SQLite 側を source of truth にしている。
  併せて三値 `ConfigResult{found|not_found|error}`、
  `REDIS_DOWN_FALLBACK` / `CONFIG_NOT_FOUND_FALLBACK` の縮退ポリシー、
  Pub/Sub によるキャッシュ無効化と不通時の縮退モードを実装済み
- rx-twitter の `@rx-twitter/shared` に相当する型共有パッケージが必要になる

## 未解決の問い

- ギルドごとに変えたい設定は何か。候補:
  - `SENSITIVE_IN_SFW` / `UNKNOWN_RATING_SFW`（年齢ゲートの厳しさ）
  - `MAX_PAGES_DEFAULT`（表示枚数）
  - 反応するチャンネルのホワイトリスト
  - `RENDERER`
- **年齢ゲートに関わる設定をギルド管理者に開放してよいか**。
  [ADR 0006](../../../docs/adr/0006-age-restricted-content.md) のフェイルクローズ方針と
  衝突しうる。緩める方向の設定は開放しない、という線引きがありうる
- ダッシュボードを新規に作るか、rx-twitter のダッシュボードに相乗りするか
- Redis 導入に伴う縮退設計を rx-twitter からどこまで移植するか
- 複数インスタンス運用に進むなら、レート制御とサーキットブレーカも共有する必要がある
  （[ADR 0011](../../../docs/adr/0011-rate-limit-and-circuit-breaker.md) はプロセス内前提）

## 着手のトリガー

- **2つ目のインスタンスが必要になったとき**（キャッシュとレート制御の共有が必須になる）
- または、ギルドごとに挙動を変えたいという具体的な要望が出たとき
- あるいは、環境変数だけでは運用が回らなくなったとき（設定変更のたびに再起動が要る不便が顕在化したとき）
