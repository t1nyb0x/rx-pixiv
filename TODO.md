# TODO

`.claude/addf/plans/` の完了状態・優先度をトラックする。
`.claude/addf/plans/` と TODO が一致しなければ TODO を編集する。

## 現在のフェーズ: Plan 0007（Discord レンダリングと実行時配線）

## バックログ

| 優先度 | Phase | 計画ファイル | 状態 |
|---|---|---|---|
| 4 | 0007 | [Discord レンダリングと messageCreate 配線](.claude/addf/plans/0007-rendering-and-wiring.md) | **一部完了**（実装・自動検証完了。実チャンネル目視確認待ち） |
| 5 | 0008 | [運用面の仕上げ](.claude/addf/plans/0008-operations-hardening.md) | **一部完了**（health・基本metrics・プロセスエラー・live test・READMEは実装済み） |
| - | 0009 | [うごイラ対応](.claude/addf/plans/0009-ugoira-support.md) | 検討スタブ（トリガー待ち） |
| - | 0010 | [ギルド別設定](.claude/addf/plans/0010-guild-config.md) | 検討スタブ（トリガー待ち） |

### 並列化のメモ

0003〜0006 は完了済み。0011 の Discord 非依存部分も完了した。
0011 は `MessageHandler` と実行時DIを 0007 内で統合して完了した。

オーナーリクエスト:
タスクが無くなったら以下に取り組んでください
- プロジェクトの品質を向上させる計画を追加する

---

## オーナー判断待ち

| 事項 | 関連 | 影響 |
|---|---|---|
| ~~GitHub に `t1nyb0x/rx-pixiv` を作成する~~ → **解消**（作成・初回 push 済み） | Plan 0001 | — |
| ~~pixiv 画像を Discord 添付として再配信する権利上の姿勢の許容~~ → **解消**（[ADR 0014](docs/adr/0014-media-delivery-via-proxy-url.md) で URL 埋め込みに変更し、再配信しなくなった） | — | — |
| ~~展開拒否リストを Redis ではなく JSON ファイルで持つ選択肢~~ → **解消**（Redisを採用。コンテナ制約が生じた場合だけ別Planで再検討） | [ADR 0016](docs/adr/0016-redis-for-persistent-state.md) | — |
| ~~`PIXIV_PHPSESSID` を供給するか~~ → **解消**（v1では供給せず設定入口も作らない） | [ADR 0007](docs/adr/0007-pixiv-session-optional.md)（Accepted） | 安全性と単ページの R-18 表示は無認証で成立。将来必要なら別 Plan |
| ~~ギルド/チャンネル許可リストを v1 に入れるか~~ → **解消**（v1 に導入済み、空 = 全許可） | Plan 0002 | — |
| 週次live smoke失敗の通知先（GitHub Issue / Pushover / 通知なし） | Plan 0008 | workflowと必要secretが変わる |

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
| 0011 | [管理コマンド・濫用対策・Redis 永続化](.claude/addf/plans/0011-admin-and-abuse-control.md) | 完了（2026-08-11） |
