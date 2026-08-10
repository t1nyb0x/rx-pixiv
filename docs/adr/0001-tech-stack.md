# ADR 0001: 技術スタック選定

- Status: Accepted
- Date: 2026-08-10
- Issue: -

## Context

rx-pixiv は `rx-twitter` と `rx-instagram` に続く3本目の Discord Bot である。
両兄弟はスタックが大きく異なる。

- **rx-twitter**: TypeScript ESM / npm workspaces / discord.js v14 / Redis / zod /
  orval（OpenAPI からのクライアント生成）/ winston + ファイルローテート / Hono
- **rx-instagram**: TypeScript CommonJS / discord.js v14 / cheerio / 外部ストアなし /
  `console.log` のみ / 依存7ファイル約350行

オーナーの方針は「新規に選定」であり、どちらかの踏襲は義務ではない。
ただし目的は目新しさではなく、pixiv 固有の制約に対する適合である。

pixiv 固有の事情は3つある。

1. **公開された OpenAPI 仕様が存在しない**（Ajax API は非公開 API であり、仕様は観測に基づく）
2. **HTTP レイヤに細かい制御が要る** — `i.pximg.net` への `Referer` 付与、
   任意の Cookie、リダイレクト追跡、ストリーミング中のバイト数上限
3. **単一インスタンス運用**で、設定を共有する外部プロセス（ダッシュボード）が無い

## Decision

以下を採用する。

| 領域 | 採用 |
|---|---|
| 言語 | TypeScript 6（`strict` + `noUncheckedIndexedAccess`） |
| モジュール | **ESM**（`"type": "module"`、`moduleResolution: nodenext`） |
| パス別名 | **package.json の `imports` フィールド**（`#core/*` 等） |
| ランタイム | Node.js 24 LTS |
| Discord | discord.js v14 |
| HTTP | **undici を直接使う** |
| 検証 | zod v4（すべての外部境界） |
| ロギング | **pino**（JSON を stdout へ） |
| 設定 | 環境変数のみ、zod 検証、fail-fast |
| 永続化 | **なし**（インメモリ TTL+LRU） |
| ヘルス HTTP | Hono + `@hono/node-server` |
| テスト | Vitest 4 + v8 カバレッジ + Codecov |
| Lint / Format | oxlint + oxfmt |
| リリース | release-please / GHCR / HMAC 署名デプロイ webhook |
| パッケージ構成 | **単一パッケージ**（ワークスペースを使わない） |

兄弟から意図的に外れる点と理由:

- **orval を使わない** — 生成元となる OpenAPI 仕様が存在しない。
  自分で書いた仕様から自分でクライアントを生成するのは二重管理にしかならない。
  代わりに、実際に消費するフィールドだけを手書きの zod スキーマで表現する。
  「外部レスポンスは検証してからドメインに入れる」という rx-twitter ADR 0001 の
  思想そのものは継承する
- **undici を直接使う** — `Referer` の付与、Cookie の宛先制御、
  ストリーミング中のバイト打ち切りが必要で、生成クライアント越しでは扱いにくい。
  テストでは `MockAgent` が使え、「`Referer` を実際に送ったか」を検証できる
- **pino を使う** — コンテナは stdout に吐いてランタイムにローテートさせるべきで、
  rx-twitter がファイルローテートするのは VPS のファイルシステム上で動く前提による。
  加えて pino の `redact` は必須である（PHPSESSID をログに載せてはならない）
- **CommonJS を継がない** — rx-instagram の CommonJS は行き止まりであり、
  新規プロジェクトで選ぶ理由がない
- **ワークスペースを持たない** — rx-twitter の `packages/shared` は
  Astro ダッシュボードと型を共有するために存在する。v1 に対応物が無い

## Consequences

### Positive

- 依存が少なく、把握しやすい。ネイティブ依存（sharp・ffmpeg）をゼロで始められる
- `imports` フィールドにより、ビルド後の `tsc-alias` 工程が不要になる
- pino の `redact` で認証情報のログ漏洩を構造的に防げる
- stdout ログはコンテナ運用と素直に噛み合う

### Negative

- ロガーが3プロジェクトで揃わなくなる（winston / console / pino）。
  ログ形式とローテート設定の運用手順が rx-twitter と別物になる
- 手書き zod スキーマは、pixiv 側のレスポンス変更に人手で追随する必要がある
- `imports` フィールドは `tsc-alias` ほど枯れていない。ツールチェーンによっては解決に難がありうる

### Mitigation

- ロガー差分は「コンテナ運用に最適化した結果」として本 ADR に記録し、
  ログ項目名（`traceId` / `guildId` / `source` 等）は3プロジェクトで揃える
- レスポンス変更は、zod 検証失敗を `parse_error` として計測し
  （`pixiv_fetch_total{source,result}`）、週次のライブスモークテストで
  利用者の報告より先に検知する
- `imports` が問題を起こしたら `tsc-alias` へ退避する。
  rx-twitter に実績があるので退避先は確実である

## Rejected alternatives

### rx-twitter のスタックをそのまま踏襲する

Redis・ワークスペース・orval・winston をまとめて引き継ぐことになる。
Redis はダッシュボードとの共有のために存在し、v1 には共有相手がいない。
orval は生成元の仕様が無い。導入コストと運用面（コンテナ追加・障害モード追加）に
見合う利得が無いため採用しない。

### rx-instagram のスタックをそのまま踏襲する

規模感は近いが、CommonJS・ロガー不在・タイムアウト不在・リトライ不在・
同時実行制限不在という既知の弱点をそのまま引き継ぐことになる。
pixiv はレート制限が厳しく、これらの不在は実害に直結する。

### Go / Rust で書く

うごイラの ffmpeg 連携や画像処理を見据えれば魅力はあるが、
discord.js に相当する成熟度のライブラリと、オーナーの2プロジェクト分の
運用知見を捨てることになる。v1 の主要な難所は年齢ゲートの正しさであって
実行速度ではない。

### sharp による画像リサイズ

ネイティブ依存でイメージが約30MB 増え、ベースイメージの選択も縛られる。
pixiv は `thumb`/`small`/`regular` の変種を無償で提供しており、
サイズ調整はその選択で足りる。変種ラダーでは不十分だと計測で示されるまで導入しない。
