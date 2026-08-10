# Plan 0001: 要件定義・アーキテクチャ設計・ADR 整備

## 実装状況: 完了

owner_feedback: 済

> 出典: オーナー指示「rx-twitter / rx-instagram の pixiv 版として rx-pixiv を作る。
> 設計、必要に応じて ADR の作成を行うとともに、要件定義をしていきたい」（2026-08-10）

## 関連 Plan

- [Plan 0002: プロジェクト基盤整備](0002-project-scaffold.md) — 本 Plan で確定した設計に基づく最初の実装
- [Plan 0005: Ajax ソースとフォールバック連鎖](0005-ajax-source-and-chain.md) — 本 Plan が積み残した R-18 応答形のスパイクを内包する

## 目的

rx-pixiv の要件・アーキテクチャ・設計判断を文書として確定し、
後続の実装 Plan に落とす。プロダクトコードは1行も書かない。

## 現状の挙動

リポジトリは `LICENSE` と ADDF v0.7.0 の足場のみ。
`CLAUDE.repo.md` はプロジェクト概要とビルド／Lint／テストコマンドが「未確定」のまま。
`.claude/addf/plans/` は空で、`TODO.md` にバックログが無い。

加えて `git remote origin` が `t1nyb0x/rx-instagram.git` を指しており（コピー元の残骸）、
push すると別リポジトリに入る事故が仕込まれている。

## 変更内容（項目・フェーズ）

### 項目1: git remote の是正

- **対象**: `.git/config`
- `origin` を `git@github.com:t1nyb0x/rx-pixiv.git` に張り替える

### 項目2: 要件定義書

- **対象**: `docs/REQUIREMENTS.md`（新規）
- スコープ（v1 対象／スコープ外）、機能要件 FR-1〜FR-5、非機能要件 NFR-1〜NFR-6、
  制約 C-1〜C-7、実測で確認済みの前提、未確定事項 Q-1〜Q-4

### 項目3: アーキテクチャ設計書

- **対象**: `docs/ARCHITECTURE.md`（新規）
- 設計の姿勢、全体構成図、レイヤリング、ディレクトリ構成、データフロー、
  ドメインモデル、取得経路の連鎖、メディア配信、キャッシュ、設定、可観測性、
  拡張レシピ、兄弟プロジェクトとの差分

### 項目4: ADR

- **対象**: `docs/adr/`（新規）
- 0001 技術スタック / 0002 レイヤリング / 0003 多段フォールバック /
  0004 Result エラーモデル / 0005 画像配信 / 0006 年齢制限コンテンツ /
  0007 pixiv 認証（**Proposed**）/ 0008 インメモリキャッシュ /
  0009 Components V2 / 0010 削除せず抑制 / 0011 レート制御 /
  0012 うごイラ範囲外 / 0013 小説は抜粋のみ
- 書式は rx-twitter の ADR に揃える（Status / Date / Issue / Context / Decision /
  Consequences{Positive,Negative,Mitigation} / Rejected alternatives、日本語）

### 項目5: 実装 Plan の起票と TODO 登録

- **対象**: `.claude/addf/plans/0002`〜`0010`、`TODO.md`

### 項目6: リポジトリ文書の整備

- **対象**: `CLAUDE.repo.md`、`README.md`（新規）
- `CLAUDE.repo.md` の「未確定」2箇所を埋める
- `README.md` を新規作成する（`.claude/addf/Feedback.md` 記録の
  ADDF テスト失敗6件の解消も兼ねる）

## 影響範囲

ドキュメントのみ。プロダクトコードへの影響なし。
`.claude/addf/Feedback.md` に記録済みの ADDF テストスイート失敗のうち、
README.md 不在に起因する6件が解消される見込み。

## テスト方針

- `addf-doc-review-agent` によるドキュメントドリフト観点のレビュー
- `/addf-lint` による Plan 状態 ⇔ TODO の突合
- `bash .claude/addf/tests/run-all.sh`（既知失敗の件数が減ることを確認）

## 破壊的変更の許容範囲

なし（新規プロジェクトのため既存の互換性対象が存在しない）。

## 要オーナー確認

- リポジトリ `t1nyb0x/rx-pixiv` の作成（remote は先行して張り替え済み）
- [ADR 0005](../../../docs/adr/0005-media-delivery.md) の権利上の姿勢
  （pixiv 画像を Discord 添付として再配信することの許容）

## 完了条件

- [x] `git remote origin` が rx-pixiv を指している
- [x] `docs/REQUIREMENTS.md` が存在する
- [x] `docs/ARCHITECTURE.md` が存在する
- [x] `docs/adr/` に 0001〜0013 と README が存在する
- [x] `.claude/addf/plans/` に 0002〜0010 が起票され `TODO.md` に登録されている
- [x] `CLAUDE.repo.md` に「未確定」の記述が残っていない
- [x] `README.md` が存在する
- [x] `addf-doc-review-agent` のレビューを通過している（指摘5件を修正。詳細は下記） <!-- human-judgment -->

## AI 実装時間見積もり

1セッション以内。

---

## ドキュメントレビューでの指摘と対応（2026-08-10）

`addf-doc-review-agent` により、**Plan 番号の相互参照誤り4件**と状態不整合1件を検出。
数値整合（枚数・タイムアウト・カバレッジ閾値・TTL・レート制限）、
ADR 番号／タイトル／Status、リンク切れ、オーナー決定8項目の反映は
いずれも指摘なしだった。

| # | 指摘 | 対応 |
|---|---|---|
| 1 | R-18 スパイクの実施 Plan を「Plan 0004」と誤記（REQUIREMENTS Q-1・ADR 0007 の3箇所） | Plan 0005 に修正 |
| 2 | ギルド許可リストの判断 Plan を「Plan 0001」と誤記（REQUIREMENTS Q-4） | Plan 0002 に修正 |
| 3 | lint 規則導入 Plan を「Plan 0001」と誤記（ADR 0002 Mitigation）。Plan 0001 には `package.json` が存在せず技術的に不可能 | Plan 0002 に修正 |
| 4 | `IMediaFetcher` の定義元 Plan を 0006 と記載（Plan 0009 内で自己矛盾） | 定義は Plan 0003、Plan 0006 は具象 `PximgFetcher` のみ、と整理 |
| 5 | README のロケール接頭辞が artworks のみに見える | users も対象と明記 |

**教訓**: Plan 番号と ADR 番号が別採番で偶然一致する（Plan 0007 と ADR 0007 など）ため、
文中では必ず「Plan NNNN」「ADR NNNN」とプレフィックスを省略せずに書く。
指摘1〜4 はいずれもこの取り違えが疑われる。
