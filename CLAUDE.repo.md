# CLAUDE.repo.md

rx-pixiv です。
Discord 関連のプロジェクトとして `works/discord/` 配下に置かれている。

## プロジェクト概要

Discord に貼られた **pixiv の URL を展開する Bot**。
`rx-twitter`（`rx-twitter/rx-twitter`）、`rx-instagram`（`t1nyb0x/rx-instagram`）に続く3本目。

pixiv の URL を貼っても Discord のプレビューにはタイトルとロゴしか出ない。
画像 CDN `i.pximg.net` が `Referer: https://www.pixiv.net/` を要求し、
Discord の埋め込みプロキシがそれを付けられないためである。
rx-pixiv は Bot 自身が `Referer` を付けて画像を取得し、Discord の添付として再配信する。

**v1 スコープ**: イラスト・マンガ（複数ページ）／小説／ユーザープロフィール。
うごイラはロードマップ送り。

**設計上の最優先事項**: R-18 / R-18G 作品を年齢制限チャンネル以外に出さないこと。
判断に迷う場面はすべて「出さない」に倒す（フェイルクローズ）。

### 主要ドキュメント

| 文書 | 内容 |
|---|---|
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | 要件定義（機能 FR-1〜5 / 非機能 NFR-1〜6 / 制約） |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | アーキテクチャ設計（層構成・データフロー・ドメインモデル） |
| [docs/adr/](docs/adr/) | 設計判断の記録（ADR 0001〜0013） |
| [TODO.md](TODO.md) | 実装フェーズのバックログ |

### 実装前に必ず読むべき ADR

- [ADR 0002 レイヤリングと依存方向](docs/adr/0002-layering.md) — `core/` から外側を import してはならない（lint で強制）
- [ADR 0004 Result エラーモデル](docs/adr/0004-result-error-model.md) — 取得関数は例外を投げない
- [ADR 0006 年齢制限コンテンツ](docs/adr/0006-age-restricted-content.md) — **この Bot でいちばん壊れてはいけない部分**

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

技術スタックは [ADR 0001](docs/adr/0001-tech-stack.md) で確定済み
（TypeScript 6 / Node 24 / ESM / discord.js v14 / undici / zod / pino / Vitest / oxlint + oxfmt）。

> **注**: 以下のコマンドは
> [Plan 0002 プロジェクト基盤整備](.claude/addf/plans/0002-project-scaffold.md) で
> `package.json` が作られた時点から利用可能になる。それ以前は ADDF のテストランナーのみが動く。

| 種別 | コマンド |
|---|---|
| ビルド | `npm run build` |
| 型検査 | `npm run typecheck` |
| Lint | `npm run lint`（oxlint） |
| フォーマット | `npm run fmt` / 検査は `npx oxfmt --check src tests` |
| テスト | `npm test` |
| カバレッジ | `npm run test:coverage`（閾値: 行・文・関数 90% / 分岐 85%） |
| 開発起動 | `npm run dev` |

品質ゲートでは `build` → `typecheck` → `lint` → `test:coverage` の順に実行する。

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
