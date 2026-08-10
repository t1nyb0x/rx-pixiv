# Plan 0011: 管理コマンド・濫用対策・Redis 永続化

## 実装状況: 一部完了（残り: runtime配線・返信map・Discord handler統合）

<!-- AccessGate・コマンド解釈/実行、インメモリ実装、Redis接続とban/block/cooldownは完了。
     index.tsでの接続/preload/health配線、reply map、Discord handler統合が残る。 -->

owner_feedback: 不要

edge: derived-from 0001
edge: blocked-by 0002

> 出典: 設計フェーズ後のオーナーとの議論（2026-08-10）で「管理コマンドがあったほうが良い」
> 「ブロックリストは Redis で」と決まったもの。
> [ADR 0015](../../../docs/adr/0015-admin-commands-and-abuse-control.md) と
> [ADR 0016](../../../docs/adr/0016-redis-for-persistent-state.md) の実装

## 関連 Plan

- [Plan 0001: 要件定義・アーキテクチャ設計・ADR 整備](0001-requirements-and-adr.md) — 分離元
- [Plan 0002: プロジェクト基盤整備](0002-project-scaffold.md) — 依存（compose に redis を足す）
- [Plan 0007: Discord レンダリングと messageCreate 配線](0007-rendering-and-wiring.md) — ゲートの適用先
- [Plan 0010: ギルド別設定](0010-guild-config.md) — 本 Plan が Redis を持ち込むため、着手の障壁が下がる

## 目的

**運用者が Bot を制御できるようにする。**
誤用しているサーバーから抜けられ、濫用する利用者を止められ、
権利者からの削除要請に実際に応じられる状態を作る。

## 現状の挙動

`AccessGate`、管理コマンドの解釈・実行サービス、インメモリ実装、Redis接続と
ban/block/cooldownリポジトリは実装済み。ただし `src/index.ts` へ未配線のため、
Bot上の管理コマンド・永続ゲート・Redis healthはまだ動作しない。

## 変更内容（項目・フェーズ）

### 項目1: Redis 基盤

- **対象**: `src/infrastructure/redis/client.ts`、`docker-compose.yml`
- `redis` v5 クライアント。接続・再接続・切断検知
- Plan 0002 で追加済みの `redis:8-alpine`（`--appendonly yes`）を利用
- **起動時に接続できなくても起動は続行**する（Discord には繋ぐ）。`/readyz` は 503 を返す
- `/health` に Redis の状態を出す

### 項目2: リポジトリ

- **対象**: `src/core/ports/{IBanRepository,IBlockRepository}.ts`、
  `src/infrastructure/redis/Redis*Repository.ts`
- 禁止（`app:ban:*`）・展開拒否（`app:block:*`）・クールダウン（`app:cooldown:*`）を実装済み。
  返信マップ（`app:reply:*`）は Plan 0007 の返信追跡と合わせて実装する
- **禁止と展開拒否は起動時に全件プリロード**し、変更時に更新する。
  毎メッセージで Redis に往復しない
- ポートは `core/ports/` に置き、ファイル方式へ戻せる余地を残す

### 項目3: 縮退ポリシー

- **対象**: `src/core/services/` のゲート適用箇所
- **Redis を読めないときはフェイルクローズ**（`REDIS_DOWN_FALLBACK=deny` が既定）
- クールダウンだけは読めなくても通す（安全側の判断に影響しないため）
- 返信マップを書けなくても展開は続行し、追従削除だけ諦める

### 項目4: オーナーコマンド

- **対象**: `src/adapters/discord/OwnerCommandHandler.ts`
- DM の `!owner/...` プレフィックス方式。実行者が `OWNER_USER_ID` に一致する DM のみ処理し、
  それ以外は**無反応**
- `guilds` / `leave` / `ban` / `unban` / `ban-guild` / `unban-guild` / `list-bans` /
  `block` / `unblock` / `list-blocks` / `status` / `help`
- `block` は作品 ID 単位と `user:<pixivUserId>` 単位の2粒度
- 出力は 1900 文字ごとに分割
- **パースとディスパッチだけの薄い層にする**。判定ロジックは `core/services/` に置く
- `DirectMessages` intent と `Message` / `Channel` の partial を有効化する

### 項目5: クールダウン

- **対象**: `src/core/services/` + `RedisCooldownStore`
- 利用者ごと10秒（`USER_COOLDOWN_MS`）、チャンネルごと5秒（`CHANNEL_COOLDOWN_MS`）
- **超過時は無反応**（警告も出さない）
- オーナーは対象外

### 項目6: ゲートの適用順序

- **対象**: `src/adapters/discord/MessageHandler.ts`
- [ADR 0015](../../../docs/adr/0015-admin-commands-and-abuse-control.md) の順序で、
  **安いものから順に**弾く:
  Bot 判定 → オーナーコマンド → 禁止 → 許可チャンネル → クールダウン →
  **（ここで初めて）URL 検出** → 展開拒否リスト → 取得
- **禁止とクールダウンを URL 検出より前に置く**。濫用時に本文解析すら行わせない
- 展開拒否は取得の**前**に判定する。拒否対象に対して pixiv へリクエストを飛ばさない

## 影響範囲

`src/infrastructure/redis/`（新規）、`src/adapters/discord/MessageHandler.ts`（順序変更）、
`src/core/ports/`（ポート2つ追加）、`docker-compose.yml`、`.env.example`、
Discord の intent 設定。

残る実行時DI・reply map・Discord handlerは、同じ境界を触る
[Plan 0007](0007-rendering-and-wiring.md) に統合して完了させる。

## テスト方針

- `OwnerCommandHandler`: 全コマンドのパース、**オーナー以外は無反応**、
  ギルド内での発話は無視、出力の 1900 文字分割
- 禁止・展開拒否・クールダウンの各リポジトリを、フェイク Redis（インメモリ実装）で検証
- **縮退テスト**: Redis 読み取り失敗時に `deny` で展開されないこと。
  `allow` に切り替えたときは展開されること
- **順序テスト**: 禁止された利用者のメッセージで `UrlDetector` が**呼ばれない**こと
  （スパイで検証）。展開拒否された作品で pixiv へのリクエストが**発生しない**こと
- 起動時プリロードが行われ、以後のメッセージ処理で Redis への往復が発生しないこと

## 破壊的変更の許容範囲

なし。`OWNER_USER_ID` は既存の必須設定、`REDIS_URL` は既定値付きの任意設定。

## 要オーナー確認

- 展開拒否リストを Redis ではなく JSON ファイルで持つ選択肢も僅差で成立する
  （[ADR 0016 の Rejected alternatives](../../../docs/adr/0016-redis-for-persistent-state.md)）。
  コンテナを増やしたくない事情があれば知らせてほしい

## 完了条件

- [ ] `!owner/leave <guildId>` でサーバーから離脱できる
- [ ] `!owner/ban` した利用者のメッセージで **`UrlDetector` が呼ばれない**（スパイで検証）
- [ ] `!owner/block` した作品 URL で **pixiv へのリクエストが発生しない**（スパイで検証）
- [ ] 禁止と展開拒否が**プロセス再起動をまたいで残る**
- [ ] オーナー以外の `!owner/...` に無反応
- [ ] Redis 読み取り失敗時に `REDIS_DOWN_FALLBACK=deny` で展開されない
- [ ] Redis に接続できなくても Bot は起動し、`/readyz` が 503 を返す
- [ ] クールダウン超過時に**何も投稿しない**
- [ ] 起動時プリロード後、通常のメッセージ処理で Redis への往復が発生しない

## AI 実装時間見積もり

2セッション程度。
