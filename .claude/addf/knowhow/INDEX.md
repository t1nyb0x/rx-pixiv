# Knowhow Index

> 自動生成。`/addf-knowhow-index reindex` で再生成できる。

## Claude Code 設定・運用

| ファイル | 要約 | キーワード |
|---|---|---|
| [ADDF/claude-md-at-mention.md](ADDF/claude-md-at-mention.md) | CLAUDE.md の @FileName メンション展開の仕組みと使い分け | @展開, メンション, クオート, ネスト展開, CLAUDE.md, インライン展開, ファイル参照, ブートシーケンス |
| [ADDF/ignore-file-strategy.md](ADDF/ignore-file-strategy.md) | .gitignore / .claudeignore / .git/info/exclude の役割分けと運用戦略 | .gitignore, .claudeignore, .git/info/exclude, respectGitignore, settings.json, settings.local.json, Glob, Grep, ファイル除外 |

## rx-pixiv 固有の知見

| ファイル | 要約 | キーワード |
|---|---|---|
| [pixiv-ajax-schema-pitfalls.md](pixiv-ajax-schema-pitfalls.md) | pixiv Ajax API のスキーマ設計 — null と欠落の違い・エンドポイント別の形の差・数値フラグの3値目・観測ツールの信頼度 | pixiv, Ajax API, zod, スキーマ, fixture, 実測, null, maxXRestrict, aiType, exactOptionalPropertyTypes, 非公開API |
| [design-phase-spike-and-numbering.md](design-phase-spike-and-numbering.md) | 設計フェーズの5つの型 — 実測で前提を潰す・Proposed で残す・採番衝突・**却下理由こそ実測対象**・置換 ADR は残す | 設計フェーズ, 要件定義, ADR, Proposed, Superseded, スパイク, 実測, 採番, 相互参照, Rejected alternatives, 却下理由, ドキュメントレビュー, 骨格プランニング |
| [typescript-service-scaffold-boundaries.md](typescript-service-scaffold-boundaries.md) | TypeScript サービス基盤の解決経路・設定境界・配布順序を負例で固定する | TypeScript, ESM, package imports, zod, env, oxlint, workflow_call, release-please, CI/CD |
| [upstream-protection-composition.md](upstream-protection-composition.md) | 上流保護は独立クラスではなく物理試行と論理経路へ合成する | undici, retry, rate limit, circuit breaker, timeout, Node timer, TTL, LRU |
| [url-detection-and-domain-unions.md](url-detection-and-domain-unions.md) | URL 検出とドメイン共用体は抑制範囲・正規化キー・閉集合を契約にする | URL検出, Markdown抑制, 正規化, 重複排除, 判別共用体, expectTypeOf, capabilities |

> ADDF 由来の知見は `ADDF/` 配下（29件）にある。上表は未インデックス分を含むため、
> 初回タスク前に `/addf-knowhow-index reindex` で全件を再生成すること。
