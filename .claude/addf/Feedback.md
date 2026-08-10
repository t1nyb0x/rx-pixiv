# Process Feedback

開発プロセスの振り返りと改善を記録する。

## 記録方法

タスク完了時や問題発生時に、以下のいずれかのセクションに追記する。
反映済みの項目は削除する。

## オーナーフィードバック

（現在なし）

## 問題の記録

- **ADDF テストスイート `test-template-sync.sh` がダウンストリームで7件失敗する**（2026-08-10, ADDF v0.7.0 導入時に検出）:
  `make_sandbox()`（`.claude/addf/tests/tools/test-template-sync.sh:108`）が
  `cp "$PROJECT_DIR/README.md" "$box/"` を**無条件**で実行するため、README.md を持たない
  ダウンストリームプロジェクトでは6件が `cp: cannot stat` で失敗する。直後の行（:111）は
  `README.en.md` を `[ -f ... ] &&` で条件付きコピーしており、README.md 側だけ条件が抜けている。
  - 残り1件（Test 4b）は、README.md を仮置きしても失敗する。サンドボックスが
    `**ADDF 開発プロジェクト**` を宣言するためペア8（README スキルテーブル網羅性）が起動し、
    ダウンストリームの README にスキル一覧が無いことを WARNING(exit=2) として検出するため
  - 影響: 品質ゲート Stage 1 で `bash .claude/addf/tests/run-all.sh` を実行すると常に赤くなる。
    他104件と `test-tools.sh` は全て PASS しており、導入自体の健全性には問題ない
  - 対応候補: (a) `/addf-contribution` で上流に修正を提案する（:108 を条件付きコピーにし、
    upstream 宣言サンドボックスは自前の README fixture を使う） (b) プロジェクトに
    README.md を作成する（6件は解消、Test 4b は残る）

## 改善アクション

（現在なし）
