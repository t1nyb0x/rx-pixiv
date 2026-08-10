---
title: TypeScript サービス基盤は解決経路・設定境界・配布順序を負例で固定する
created: 2026-08-10
last_verified: 2026-08-10
depends_on:
  - package.json
  - src/config/env.ts
  - scripts/verify-layer-lint.mjs
  - .github/workflows/ci.yml
status: active
---

# TypeScript サービス基盤は解決経路・設定境界・配布順序を負例で固定する

## 発見した知見

### package imports は型検査時と実行時で参照先を分ける

ESM の `package.json#imports` は、`types` 条件を `src/**/*.ts`、`default` 条件を
`dist/**/*.js` に向けると、TypeScript の型検査とビルド後の Node 実行を同じ `#core/*` 等の
specifier で両立できる。Vitest は `src` への alias を別途持ち、テストがビルドを要求しない
ようにする。型検査だけで終えず、`dist` のモジュールを Node から実際に import して確認する。

### 設定例は実行可能な契約として扱う

`.env.example` の空欄はプロセスから見ると空文字であり、`optional()` だけでは未設定にならない。
任意の秘密値は空白文字列を `undefined` へ正規化してから検証する。また URL は形式だけでなく
protocol、数値は単項の範囲だけでなく `default <= hard` のような項目間制約も検証する。
固定上限は定数から参照し、「上限ちょうどは通る／1超過は落ちる」の両方をテストする。

### 禁止規則と配布順序も負例で自己検証する

lint の `no-restricted-imports` は設定が存在するだけでは不十分である。禁止 import の fixture を
一時的に対象レイヤへ置き、規則名付きで lint が失敗することを品質ゲートに含める。

CI、image publish、deploy を同じ push から独立起動すると、CI 失敗コミットを配布できてしまう。
image と deploy を `workflow_call` にし、CI 成功後に caller から順に呼ぶ。release-please が
`GITHUB_TOKEN` で作る release event は別 workflow を起動しないため、`release_created` と
`tag_name` の output からタグ image を直接呼ぶ。checkout 対象は caller が検証した SHA/tag を渡す。

## プロジェクトへの適用

- `package.json#imports`、Vitest alias、ビルド後 import の3経路をセットで保守する
- `.env.example` をコピーした最小構成が parse できる回帰テストを維持する
- Discord 上限3件・10枚と設定項目間の相関を zod schema で拒否する
- `ci` → `push-image` → `deploy` の依存を reusable workflow で明示する
- レイヤ規則を変えたときは `npm run lint:architecture` の負例も同時に更新する

## 注意点・制約

- `imports` の `types` 条件は先に置く。実行時は `default` が `dist` を指すため build が必要
- proxy URL はローカル・内部運用向けに `http:` も許容するが、Redis URL とは protocol を分ける
- reusable workflow の caller と callee の両方に必要最小限の `permissions` を与える
- 連続 push で古い `latest` が後勝ちしないよう caller に `concurrency` を置く

## 参照

- `package.json`
- `src/config/env.ts`
- `tests/config/env.test.ts`
- `scripts/verify-layer-lint.mjs`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `.github/workflows/push-image.yml`
- `.github/workflows/deploy.yml`
