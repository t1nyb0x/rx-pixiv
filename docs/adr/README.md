# Architecture Decision Records

rx-pixiv の設計判断の記録。書式は `rx-twitter` の ADR に揃える
（Status / Date / Issue / Context / Decision / Consequences / Rejected alternatives）。

| # | タイトル | Status |
|---|---|---|
| [0001](0001-tech-stack.md) | 技術スタック選定 | Accepted |
| [0002](0002-layering.md) | レイヤリングと依存方向 | Accepted |
| [0003](0003-source-fallback-chain.md) | 取得経路の多段フォールバック | Accepted |
| [0004](0004-result-error-model.md) | エラーモデルに判別可能な Result 型を採用する | Accepted |
| [0005](0005-media-delivery.md) | 画像は Bot が取得して Discord 添付として再配信する | ~~Superseded by 0014~~ |
| [0006](0006-age-restricted-content.md) | 年齢制限コンテンツはフェイルクローズで扱う | Accepted |
| [0007](0007-pixiv-session-optional.md) | pixiv 認証（PHPSESSID）はオプション扱いとする | **Proposed** |
| [0008](0008-in-memory-cache.md) | キャッシュはインメモリ TTL+LRU とし Redis を導入しない | ~~Superseded by 0016~~ |
| [0009](0009-components-v2-renderer.md) | レンダラは Components V2 を既定とする | Accepted |
| [0010](0010-suppress-not-delete.md) | 元メッセージは削除せず埋め込み抑制のみ行う | Accepted |
| [0011](0011-rate-limit-and-circuit-breaker.md) | レート制御とサーキットブレーカで上流障害を局所化する | Accepted |
| [0012](0012-ugoira-out-of-scope.md) | うごイラを v1 スコープ外とする | Accepted |
| [0013](0013-novel-excerpt-only.md) | 小説は冒頭抜粋のみを展開する | Accepted |
| [0014](0014-media-delivery-via-proxy-url.md) | **画像は画像プロキシの URL を埋め込む**（0005 を置換） | Accepted |
| [0015](0015-admin-commands-and-abuse-control.md) | **管理コマンドと濫用対策を v1 に入れる** | Accepted |
| [0016](0016-redis-for-persistent-state.md) | **永続が要る状態のために Redis を導入する**（0008 を置換） | Accepted |

## Status の意味

- **Accepted**: 採用済み。実装はこれに従う
- **Proposed**: 提案段階。決定に必要な事実がまだ揃っていない。
  Context に「何が分かれば決まるか」を明記すること
- **Superseded by NNNN**: 後続の ADR に置き換えられた。
  置き換えられた ADR は削除せず、冒頭に置換先と**何が誤りだったか**を明記して残す
  （判断の履歴自体が資産であり、同じ誤りを繰り返さないための記録になる）

## 置き換えの履歴

| 旧 | 新 | 何が変わったか |
|---|---|---|
| 0005 | [0014](0014-media-delivery-via-proxy-url.md) | 「添付方式だけが item 単位のスポイラーを実現できる」という**前提が誤りだった**。Components V2 の `MediaGalleryItem` は外部 URL でも spoiler が効く。添付アップロードをやめ、画像プロキシの URL 埋め込みに変更 |
| 0008 | [0016](0016-redis-for-persistent-state.md) | 0015（管理コマンド）により禁止リスト・展開拒否リストという**「消えては困る状態」**が発生し、「保持したいのは消えてよいキャッシュだけ」という前提が崩れた |
