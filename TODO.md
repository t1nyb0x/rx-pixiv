# TODO

`.claude/addf/plans/` の完了状態・優先度をトラックする。
`.claude/addf/plans/` と TODO が一致しなければ TODO を編集する。

## 現在のフェーズ: Plan 0007（Discord レンダリングと実行時配線）

## バックログ

| 優先度 | Phase | 計画ファイル | 状態 |
|---|---|---|---|
| 4 | 0007 | [Discord レンダリングと messageCreate 配線](.claude/addf/plans/0007-rendering-and-wiring.md) | 未着手（0005+0006 依存） |
| 4 | 0011 | [管理コマンド・濫用対策・Redis 永続化](.claude/addf/plans/0011-admin-and-abuse-control.md) | **一部完了**（core・memory・Redis・service 完了。残りは実行時DI、reply map、Discord handler。0007 と統合） |
| 5 | 0008 | [運用面の仕上げ](.claude/addf/plans/0008-operations-hardening.md) | 未着手（0007 依存） |
| - | 0009 | [うごイラ対応](.claude/addf/plans/0009-ugoira-support.md) | 検討スタブ（トリガー待ち） |
| - | 0010 | [ギルド別設定](.claude/addf/plans/0010-guild-config.md) | 検討スタブ（トリガー待ち） |

### 並列化のメモ

0003〜0006 は完了済み。0011 の Discord 非依存部分も完了した。
0011 の残りは `MessageHandler` と実行時DIで 0007 と同じ場所を触るため、0007 内で統合する。

オーナーリクエスト:
タスクが無くなったら以下に取り組んでください
- プロジェクトの品質を向上させる計画を追加する

---

## オーナー判断待ち

| 事項 | 関連 | 影響 |
|---|---|---|
| ~~GitHub に `t1nyb0x/rx-pixiv` を作成する~~ → **解消**（作成・初回 push 済み） | Plan 0001 | — |
| ~~pixiv 画像を Discord 添付として再配信する権利上の姿勢の許容~~ → **解消**（[ADR 0014](docs/adr/0014-media-delivery-via-proxy-url.md) で URL 埋め込みに変更し、再配信しなくなった） | — | — |
| 展開拒否リストを Redis ではなく JSON ファイルで持つ選択肢（僅差） | [ADR 0016](docs/adr/0016-redis-for-persistent-state.md) | コンテナを増やしたくない事情があれば知らせてほしい |
| ~~`PIXIV_PHPSESSID` を供給するか~~ → **解消**（v1では供給せず設定入口も作らない） | [ADR 0007](docs/adr/0007-pixiv-session-optional.md)（Accepted） | 安全性と単ページの R-18 表示は無認証で成立。将来必要なら別 Plan |
| ~~ギルド/チャンネル許可リストを v1 に入れるか~~ → **解消**（v1 に導入済み、空 = 全許可） | Plan 0002 | — |

---

## アーカイブ

| Phase | 計画ファイル | 状態 |
|---|---|---|
| 0001 | [要件定義・アーキテクチャ設計・ADR 整備](.claude/addf/plans/0001-requirements-and-adr.md) | 完了（2026-08-10） |
| 0006 | [NSFW ゲートとメディア URL 組み立て](.claude/addf/plans/0006-nsfw-gate-and-media.md) | 完了（2026-08-10） |
| 0002 | [プロジェクト基盤整備](.claude/addf/plans/0002-project-scaffold.md) | 完了（2026-08-10） |
| 0003 | [ドメインモデルと URL 検出](.claude/addf/plans/0003-domain-and-url-detection.md) | 完了（2026-08-10） |
| 0004 | [HTTP 基盤・レート制御・キャッシュ](.claude/addf/plans/0004-http-ratelimit-cache.md) | 完了（2026-08-10） |
| 0005 | [Ajax ソースとフォールバック連鎖](.claude/addf/plans/0005-ajax-source-and-chain.md) | 完了（2026-08-11） |
