# Plan 0003: ドメインモデルと URL 検出

## 実装状況: 完了（2026-08-10）

owner_feedback: 不要

edge: derived-from 0001
edge: blocked-by 0002

> 出典: [Plan 0001](0001-requirements-and-adr.md) で確定した要件 FR-1 と
> [ADR 0004 Result エラーモデル](../../../docs/adr/0004-result-error-model.md) の実装

## 関連 Plan

- [Plan 0001: 要件定義・アーキテクチャ設計・ADR 整備](0001-requirements-and-adr.md) — 分離元
- [Plan 0002: プロジェクト基盤整備](0002-project-scaffold.md) — 依存（ツールチェーンが要る）
- [Plan 0005: Ajax ソースとフォールバック連鎖](0005-ajax-source-and-chain.md) — 本 Plan のモデルへ写像する

## 目的

外部依存ゼロの `core/` を作る。
URL 文字列から正規化された参照を取り出す純粋関数と、
すべての取得経路が収束する先のドメインモデルを定義する。

## 現状の挙動

URL 検出・正規化と外部依存ゼロのドメイン型を実装済み。
Discord の `messageCreate` への配線、作品取得、描画は後続 Plan で実装する。

## 変更内容（項目・フェーズ）

### 項目1: 基礎型

- **対象**: `src/core/models/Result.ts`、`errors.ts`、`ContentRating.ts`
- `Result<T, E>` と `ok()` / `err()`（20行程度。ライブラリを導入しない）
- `FetchError` の8種の判別共用体（`not_found` / `auth_required` / `rate_limited` /
  `upstream_5xx` / `timeout` / `network` / `parse_error` / `unsupported`）
- `ContentRating`（`level` / `sensitive` / `ai` / **`confidence`**）

### 項目2: 作品モデル

- **対象**: `src/core/models/PixivWork.ts`、`PixivRef.ts`、`RenderPlan.ts`
- `PixivWork` は `kind` による判別共用体（`illust` / `novel` / `novel_series` / `user`）
- 取得できない項目は `null` / `undefined`。**空文字センチネルを使わない**
- `UserWork` は最近作を**1件ずつ `ContentRating` 付き**で持つ
- `RenderPlan` は **discord.js の型を含まない**表示記述

### 項目3: ポート定義

- **対象**: `src/core/ports/{IPixivSource,IHttpClient,IMediaFetcher,IWorkCache,IBanRepository,IBlockRepository}.ts`
- `IWorkCache` / `IBanRepository` / `IBlockRepository` は**非同期**インターフェースにする
  （[ADR 0016](../../../docs/adr/0016-redis-for-persistent-state.md)。実装差し替えの余地を残す）
- `IMediaFetcher` は `{ kind: "bytes" } | { kind: "url" }` を返す（[ADR 0012](../../../docs/adr/0012-ugoira-out-of-scope.md)）

### 項目4: URL 検出

- **対象**: `src/core/services/UrlDetector.ts`
- 純粋関数 `detect(content: string): PixivRef[]`。**I/O を持たない**
- 対応する URL 形:
  - `/artworks/{id}`、`/{lang}/artworks/{id}`
  - `/member_illust.php?illust_id={id}`、`/i/{id}`
  - `/novel/show.php?id={id}`、`/novel/series/{id}`
  - `/users/{id}`、`/{lang}/users/{id}`、`/member.php?id={id}`
  - `pixiv.me/{name}` は `{ kind: "shortlink" }` として返す（解決は Plan 0005）
- 重複排除、最大3件（`MAX_URLS_PER_MESSAGE`）
- **検出しないもの**（偽陽性の排除）:
  - `pixivision.net` / `pixiv.help` / `sketch.pixiv.net`
  - コードブロック（```` ``` ````）内・インラインコード内
  - `<https://...>` で囲まれたもの
  - すでに `||...||` でスポイラー化されているもの

## 影響範囲

`src/core/` と `tests/core/` を新規追加する。契約同期のため要件・設計文書と後続 Plan 0005 を更新する。
実装コードは他層への依存を持たない。

## テスト方針

- **`UrlDetector` は網羅的なテーブルテストを必須とする**。
  上記の全 URL 形（正例）＋全偽陽性ケース（負例）を1つのテーブルに並べる
- カバレッジ 95% 以上（`core/services/UrlDetector.ts` 単体で）
- `PixivWork` の判別共用体は、型レベルの網羅性を
  `switch` の `never` チェックでコンパイル時に担保する

## 破壊的変更の許容範囲

なし。

## 要オーナー確認

なし。

## 完了条件

- [x] URL 検出のテーブルテストが全 URL 形と全偽陽性ケースで緑
- [x] `UrlDetector` のカバレッジが 95% 以上
- [x] `PixivWork` が illust / manga / novel / novel series / user を表現できている
- [x] `ContentRating.confidence` が3値（`authoritative` / `inferred` / `unknown`）で定義されている
- [x] `src/core/` が `adapters/` `infrastructure/` を import していない（lint で担保）
- [x] `UrlDetector` が I/O を一切行わない（`pixiv.me` は解決せず shortlink として返す）

## AI 実装時間見積もり

1セッション以内。
