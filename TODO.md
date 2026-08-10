# TODO

`.claude/addf/plans/` の完了状態・優先度をトラックする。
`.claude/addf/plans/` と TODO が一致しなければ TODO を編集する。

## 現在のフェーズ: Plan 0002（プロジェクト基盤整備）

## バックログ

| 優先度 | Phase | 計画ファイル | 状態 |
|---|---|---|---|
| 1 | 0002 | [プロジェクト基盤整備](.claude/addf/plans/0002-project-scaffold.md) | 未着手 |
| 2 | 0003 | [ドメインモデルと URL 検出](.claude/addf/plans/0003-domain-and-url-detection.md) | 未着手（0002 依存） |
| 2 | 0004 | [HTTP 基盤・レート制御・キャッシュ](.claude/addf/plans/0004-http-ratelimit-cache.md) | 未着手（0002 依存・0003 と並列可） |
| 3 | 0005 | [Ajax ソースとフォールバック連鎖](.claude/addf/plans/0005-ajax-source-and-chain.md) | 未着手（0003+0004 依存・**R-18 スパイクを内包**） |
| 3 | 0006 | [NSFW ゲートとメディア取得](.claude/addf/plans/0006-nsfw-gate-and-media.md) | 未着手（0003+0005 依存） |
| 4 | 0007 | [Discord レンダリングと messageCreate 配線](.claude/addf/plans/0007-rendering-and-wiring.md) | 未着手（0005+0006 依存） |
| 5 | 0008 | [運用面の仕上げ](.claude/addf/plans/0008-operations-hardening.md) | 未着手（0007 依存） |
| - | 0009 | [うごイラ対応](.claude/addf/plans/0009-ugoira-support.md) | 検討スタブ（トリガー待ち） |
| - | 0010 | [ギルド別設定](.claude/addf/plans/0010-guild-config.md) | 検討スタブ（トリガー待ち） |

### 並列化のメモ

0003 と 0004 は互いに独立しており、git worktree で並列実装できる。
0005 は両方の完了を待つ。

オーナーリクエスト:
タスクが無くなったら以下に取り組んでください
- プロジェクトの品質を向上させる計画を追加する

---

## オーナー判断待ち

| 事項 | 関連 | 影響 |
|---|---|---|
| GitHub に `t1nyb0x/rx-pixiv` を作成する（remote は張り替え済み） | Plan 0001 | push できない |
| pixiv 画像を Discord 添付として再配信する権利上の姿勢の許容 | [ADR 0005](docs/adr/0005-media-delivery.md) | 否なら画像配信方式を差し替える |
| `PIXIV_PHPSESSID` を供給するか（アカウント停止リスクの受容） | [ADR 0007](docs/adr/0007-pixiv-session-optional.md)（Proposed） | Plan 0005 のスパイク後に判断 |
| ギルド/チャンネル許可リストを v1 に入れるか | Plan 0002 | 既定は「空 = 全許可」で進める |

---

## アーカイブ

| Phase | 計画ファイル | 状態 |
|---|---|---|
| 0001 | [要件定義・アーキテクチャ設計・ADR 整備](.claude/addf/plans/0001-requirements-and-adr.md) | 完了（2026-08-10） |
