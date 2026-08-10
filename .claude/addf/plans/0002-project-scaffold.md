# Plan 0002: プロジェクト基盤整備（ツールチェーン・CI・Docker・設定・ロガー・ヘルス）

## 実装状況: 完了（2026-08-10）

owner_feedback: 不要

edge: derived-from 0001

> 出典: [Plan 0001](0001-requirements-and-adr.md) で確定した
> [ADR 0001 技術スタック選定](../../../docs/adr/0001-tech-stack.md) の実装

## 関連 Plan

- [Plan 0001: 要件定義・アーキテクチャ設計・ADR 整備](0001-requirements-and-adr.md) — 分離元
- [Plan 0003: ドメインモデルと URL 検出](0003-domain-and-url-detection.md) — 本 Plan の完了後に着手できる

## 目的

プロダクトコードを書き始められる状態を作る。
ビルド・Lint・テスト・コンテナ・CI が緑になり、
設定読み込み・ロガー・ヘルスエンドポイントが動く。

## 現状の挙動

リポジトリに `package.json` すら存在しない。

## 変更内容（項目・フェーズ）

### 項目1: ツールチェーン

- **対象**: `package.json`、`tsconfig.json`、`vitest.config.ts`、`oxlint.json`、`.oxfmtrc.json`
- TypeScript 6 / ESM（`"type": "module"`、`moduleResolution: nodenext`）
- `strict` + `noUncheckedIndexedAccess`
- パス別名は **package.json の `imports` フィールド**（`#core/*` 等）。`tsc-alias` を使わない
- Vitest 4 + v8 カバレッジ。閾値は行・文・関数 90% / 分岐 85%
  （`src/index.ts` と `HealthServer.ts` を除外）
- oxlint に **`no-restricted-imports` を設定し、`src/core/**` から
  `adapters/` `infrastructure/` への import を禁止**する（[ADR 0002](../../../docs/adr/0002-layering.md)）
- npm scripts: `build` / `dev` / `start` / `test` / `test:coverage` / `lint` / `fmt` / `typecheck`

### 項目2: 設定読み込み

- **対象**: `src/config/env.ts`、`src/config/constants.ts`、`.env.example`
- zod スキーマで環境変数を一括検証。不備は**集約した読めるエラー**を出して exit 1
- 必須: `DISCORD_TOKEN`、`OWNER_USER_ID`（[ADR 0015](../../../docs/adr/0015-admin-commands-and-abuse-control.md)）
- 主要な任意: `PXIMG_PROXY_BASE_URL`（既定 `https://phixiv.net/i`）、`REDIS_URL`、
  `REDIS_DOWN_FALLBACK`（既定 `deny`）、`SOURCE_CHAIN`、`RENDERER`
- `constants.ts` には Discord 側の硬い上限（embed 10・gallery item 10）を置く。
  可変つまみは env 側に置き、両者を混ぜない

### 項目3: ロガー

- **対象**: `src/utils/logger.ts`
- pino、JSON を stdout へ。開発時のみ pino-pretty
- **`redact` を初日から設定する**: `["*.cookie", "*.PIXIV_PHPSESSID", "req.headers.cookie"]`
- 子ロガーで `{traceId, guildId, channelId, workId, source}` を束ねられる形にする

### 項目4: ヘルスサーバ

- **対象**: `src/infrastructure/http/HealthServer.ts`
- Hono + `@hono/node-server`。`/healthz`（常に200）、`/readyz`、`/health`、`/metrics`
- **ポートを外部公開しない**。Docker ネットワーク内に留める
- `honoApp.request()` で listen せずにテストできる形にする
- readiness の状態は外から注入できる形にする。本 Plan では Discord 接続状態を判定し、
  Plan 0011 で Redis 接続状態を追加する（Redis クライアント自体は本 Plan では実装しない）

### 項目5: 最小の起動経路

- **対象**: `src/index.ts`
- discord.js クライアントの起動、intents（`Guilds` / `GuildMessages` / `MessageContent`）、
  `clientReady` のログ、正常終了（SIGINT/SIGTERM）
- `unhandledRejection` は fatal ログのみで落とさない。
  `uncaughtException` は fatal ログ後 exit(1)

### 項目6: コンテナと CI

- **対象**: `Dockerfile`、`docker-compose.yml`、`.dockerignore`、`.github/workflows/`
- Dockerfile は 2-stage `node:24-alpine`（digest ピン）、非 root、
  `HEALTHCHECK` は `/healthz`、`NODE_OPTIONS=--enable-source-maps`
- docker-compose は bot + **redis**（`redis:8-alpine`、`--appendonly yes`）。
  [ADR 0008](../../../docs/adr/0008-in-memory-cache.md) は Redis 不採用としていたが、
  [ADR 0016](../../../docs/adr/0016-redis-for-persistent-state.md) で置き換えられた
  （本 Plan はサービス定義まで。Redis クライアントとリポジトリは Plan 0011）
- ワークフロー4本を rx-instagram から移植: `ci` / `push-image`（GHCR）/
  `release`（release-please）/ `deploy`（HMAC 署名 webhook）
- `ci` は Node 24、`npm ci` → `oxlint` → `oxfmt --check` → `tsc --noEmit` →
  `vitest run --coverage` → Codecov

### 項目7: リポジトリ文書

- **対象**: `CLAUDE.repo.md`
- ビルド／Lint／テストコマンド表を確定値で埋める
- 画像配信方式・ADR 一覧など、実装時点で判明している既存記述のドリフトも合わせて直す

## 影響範囲

既存の `README.md`、`CLAUDE.repo.md`、`.gitignore` を更新し、その他の基盤ファイルを新設する。
破壊的影響はない。`CLAUDE.repo.md` のコマンド表が埋まることで、以降の品質ゲートが
機能するようになる。

## テスト方針

- `src/config/env.ts`: 必須変数欠落・型不正・既定値適用のテスト
- `src/utils/logger.ts`: `redact` が実際に値をマスクすることのテスト
- `HealthServer`: `honoApp.request()` で各エンドポイントの応答を検証
- CI が緑であること自体が統合的な検証になる

## 破壊的変更の許容範囲

なし。

## 要オーナー確認

- `ALLOWED_GUILD_IDS` / `ALLOWED_CHANNEL_IDS`（許可リスト）を v1 から入れるか
  （要件 Q-4）。未確定なら「空 = 全許可」の実装だけ入れて既定は空にする

## 完了条件

- [x] `npm run build` / `lint` / `typecheck` / `test` がすべて緑
- [x] `docker build` が成功し、コンテナ起動後に `/healthz` が 200 を返す
- [x] 必須環境変数が欠けた状態で起動すると、**読める理由**を出して exit 1 する
- [x] `PIXIV_PHPSESSID` を設定した状態でログを出し、値がマスクされていることをテストで確認
- [x] `src/core/` から `src/adapters/` を import すると **lint で落ちる**
- [x] GitHub Actions の `ci` ワークフローが緑
- [x] `CLAUDE.repo.md` のコマンド表に「未定」が残っていない

## AI 実装時間見積もり

1セッション以内。
