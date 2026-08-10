# TODO

`.claude/addf/plans/` の完了状態・優先度をトラックする。
`.claude/addf/plans/` と TODO が一致しなければ TODO を編集する。

## 現在のフェーズ: Plan 0006（NSFW ゲートとメディア URL 組み立て）着手可能

## バックログ

| 優先度 | Phase | 計画ファイル | 状態 |
|---|---|---|---|
| 3 | 0005 | [Ajax ソースとフォールバック連鎖](.claude/addf/plans/0005-ajax-source-and-chain.md) | **一部完了**（フェーズ0・項目1〜5 完了。残りは項目6 `PixivSession` の実装可否判断のみ） |
| 3 | 0006 | [NSFW ゲートとメディア URL 組み立て](.claude/addf/plans/0006-nsfw-gate-and-media.md) | 未着手（**着手可能**） |
| 4 | 0007 | [Discord レンダリングと messageCreate 配線](.claude/addf/plans/0007-rendering-and-wiring.md) | 未着手（0005+0006 依存） |
| 4 | 0011 | [管理コマンド・濫用対策・Redis 永続化](.claude/addf/plans/0011-admin-and-abuse-control.md) | 未着手（着手可能・0007 と `MessageHandler` で重なる） |
| 5 | 0008 | [運用面の仕上げ](.claude/addf/plans/0008-operations-hardening.md) | 未着手（0007 依存） |
| - | 0009 | [うごイラ対応](.claude/addf/plans/0009-ugoira-support.md) | 検討スタブ（トリガー待ち） |
| - | 0010 | [ギルド別設定](.claude/addf/plans/0010-guild-config.md) | 検討スタブ（トリガー待ち） |

### 並列化のメモ

0003・0004 は完了済み。0005 は着手可能。
0011 は 0002 のあと単独で進められるが、`MessageHandler` のゲート順序で 0007 と衝突する。
**0011 を先に片付けてから 0007 に入るほうが衝突が小さい**（0007 はゲートを前提にできる）。

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
| `PIXIV_PHPSESSID` を供給するか（アカウント停止リスクの受容） | [ADR 0007](docs/adr/0007-pixiv-session-optional.md)（**Accepted**） | **供給しなくても安全性は損なわれない**（年齢判定は無認証で成立）。年齢制限チャンネルで R-18 の**画像**を出したい場合のみ必要 |
| ~~ギルド/チャンネル許可リストを v1 に入れるか~~ → **解消**（v1 に導入済み、空 = 全許可） | Plan 0002 | — |

---

## アーカイブ

| Phase | 計画ファイル | 状態 |
|---|---|---|
| 0001 | [要件定義・アーキテクチャ設計・ADR 整備](.claude/addf/plans/0001-requirements-and-adr.md) | 完了（2026-08-10） |
| 0002 | [プロジェクト基盤整備](.claude/addf/plans/0002-project-scaffold.md) | 完了（2026-08-10） |
| 0003 | [ドメインモデルと URL 検出](.claude/addf/plans/0003-domain-and-url-detection.md) | 完了（2026-08-10） |
| 0004 | [HTTP 基盤・レート制御・キャッシュ](.claude/addf/plans/0004-http-ratelimit-cache.md) | 完了（2026-08-10） |
