# CLAUDE.repo.md

rx-pixiv です。
Discord 関連のプロジェクトとして `works/discord/` 配下に置かれている。

> **未確定**: プロジェクトの目的・スコープは未記述（リポジトリは `LICENSE` のみの初期状態）。
> ブートシーケンス手順4の骨格プランニング（`.claude/addf/plans/` が空のときに発動）で
> オーナーにヒアリングし、このセクションを埋めること。

# プロジェクト種別

このリポジトリは **ADDF 利用プロジェクト** です。

`/addf-permission-audit` はこの宣言に基づき、権限をダウンストリームパターンで分類します。

# 上位 CLAUDE.md との関係

`/home/t1nyb0x/works/CLAUDE.md`（親ワークスペース）にも独自のブートシーケンス
（RESEARCH_NOTE / Progress.md / Feedback.md）があり、Claude Code は親ディレクトリの
CLAUDE.md も読み込むため両方が同時に効く。

**このリポジトリ内では ADDF のブートシーケンス・開発プロセスを正とする。**

- 開発プロセス（計画駆動・品質ゲート・進捗管理・フィードバック）→ ADDF 側に従う
  （`TODO.md` / `.claude/addf/Progress.md` / `.claude/addf/Feedback.md` / `.claude/addf/Questions.md`）
- 親ワークスペースが指す `Progress.md` / `Feedback.md` は、このリポジトリでは
  `.claude/addf/` 配下のものを指すと読み替える
- 人格・振る舞い（SOUL.md）と研究ノート（memory_mcp）の運用は親側を継続してよい
  — ADDF は開発プロセスの枠組みであり、人格定義とは競合しない

---

## コミットログ規約

日本語で書く。形式:

```
[領域] 変更内容の要約

詳細説明（必要な場合）
```

---

## ビルド・Lint・テスト

> **未確定**: 言語・ランタイム未選定のため、プロジェクト固有のコマンドは未定義。
> 技術スタック決定時にこのセクションを埋めること。

| 種別 | コマンド |
|---|---|
| ビルド | （未定） |
| Lint | （未定） |
| テスト | （未定） |

ADDF フレームワーク自体のテストランナー:

```bash
bash .claude/addf/tests/run-all.sh
```

品質ゲートの Stage 1 では、プロジェクト固有のビルド・Lint・テストに加えて
`bash .claude/addf/tests/run-all.sh` を実行する。

---

## 実行環境の注意

- 開発環境は **WSL2 (Linux)**。`.claude/addf/addfTools/` の Swift バイナリ4本
  （`window-info` / `capture-window` / `annotate-grid` / `clip-image`）は
  **macOS arm64 (Mach-O) のため実行できない**。GUI テスト機能（`/addf-gui-test` 等）は
  オプトインなので通常の開発には影響しないが、有効化しても動かない点に注意する

---

## ノウハウ記録の3観点

タスク実行中、以下の3つのタイミングで `/addf-knowhow` を使い知見を記録する。
ProgressTemplate の運用ルールに組み込み済み。

1. **コーディング知見**（実装フェーズ完了時）: 再利用可能なパターン、落とし穴、技術的判断とその根拠
2. **品質ゲート知見**（品質検証完了時）: レビューエージェントが検出した再発しうるパターン
3. **タスク総括**（完了処理時）: 計画と実装のギャップ、想定外だった点、次回同種タスクへの教訓

記録済みの知見と重複しないよう、各タイミングで既存 knowhow を確認すること。
