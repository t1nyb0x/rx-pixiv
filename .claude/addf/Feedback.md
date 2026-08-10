# Process Feedback

開発プロセスの振り返りと改善を記録する。

## 記録方法

タスク完了時や問題発生時に、以下のいずれかのセクションに追記する。
反映済みの項目は削除する。

## オーナーフィードバック

（現在なし）

## 問題の記録

- **Codex のサンドボックスでは ADDF テストが利用者環境の cache・Git 署名設定を継承して偽陰性になる**
  （2026-08-10, Plan 0002 で確認）:
  `run-all.sh` の一時リポジトリ作成がグローバルな `commit.gpgsign=true` を継承し、秘密鍵を
  使えない環境では fixture commit が失敗する。また `uv` は既定のユーザー cache が読み取り専用だと
  PyYAML の準備前に失敗する。`UV_CACHE_DIR=/tmp/...` と
  `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false` を指定すると、
  既知の `test-template-sync.sh` Test 4b 以外は通過した。
  - 改善候補: テストランナー自身が一時 cache を作り、fixture repo の commit 時だけ署名を無効化する
  - 影響: 製品差分に無関係な13スイート失敗として見え、真の退行判定を妨げる

- **ADDF テストスイート `test-template-sync.sh` がダウンストリームで7件失敗する**
  → **2026-08-10 に 1件へ改善**（Plan 0001 で `README.md` を作成したため6件が解消）。
  残る1件は下記 Test 4b（`タスク欄の変更でペア1 は OK` が exit=2 になる）で、
  README.md を持っていても解消しない上流側の課題。
  対応候補 (a)（`/addf-contribution` で上流に修正提案）が引き続き有効:
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

- **実測で結論が変わったら、コードだけでなく現在状態を語る文書を語句検索で横断する**
  （2026-08-11, Plan 0005 品質レビューで実践）:
  phixiv の再実測後も、ADR 冒頭・Requirements・TODO・Progress の現行チェックリストに
  「認証なしでは R-18 画像を出せない」が残り、不要な完全資格情報を供給させる誘因になった。
  訂正履歴は残しつつ、`PHPSESSID`・`R-18`・`未実装` 等の決定語を `rg` で横断し、
  Plan / TODO / Progress / README / ADR index の現在状態を同じコミットで同期する。

- **設計フェーズでは「推測で埋めない箇所」を ADR の `Proposed` として明示的に残す**
  （2026-08-10, Plan 0001 で実践）:
  rx-pixiv の設計では pixiv 認証の要否（ADR 0007）だけを `Proposed` で残し、
  決定に必要な事実（無認証で R-18 を叩いたときの応答形）を後続 Plan のスパイクに委ねた。
  ADR に「何が分かれば決まるか」を書いておくと、後続 Plan の完了条件がそのまま書ける。
  すべてを Accepted で埋めきろうとすると、いちばん危険な箇所が推測の上に建つ。

- **設計フェーズでも外部 API は実測する**（2026-08-10, Plan 0001 で実践）:
  「R-18 は無認証で取れないだろう」という推測から入ったが、
  実際に `/ajax/illust/{id}` 等を叩いたところ v1 スコープの3種別すべてが
  無認証で取得できた。この1点で一次経路の選定が変わった。
  設計エージェントを起動する前に実測しておくと、提案の前提が正確になる。
