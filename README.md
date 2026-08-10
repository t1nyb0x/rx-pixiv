# rx-pixiv

Discord に貼られた **pixiv の URL を読める形に展開する Bot**。

`rx-twitter`（Twitter/X）、`rx-instagram`（Instagram）に続く3本目。

> **状態: URL展開経路の実装・自動テスト完了、運用仕上げ中**
> 作品取得の多段フォールバック、年齢制限判定、メディア選択、Discordレンダラ、
> `messageCreate`、管理コマンド、Redis永続化と実行時DIまで実装済みです。
> 実際のDiscordチャンネルでの表示確認と、Plan 0008のメトリクス・正常終了・週次smokeを
> 残しています。
> 進捗は [TODO.md](TODO.md) を参照してください。

---

## v1 で実現すること

pixiv の URL を Discord に貼っても、プレビューにはタイトルと pixiv のロゴ程度しか出ません。
画像 CDN `i.pximg.net` が `Referer: https://www.pixiv.net/` を要求し、
Discord の埋め込みプロキシがそのヘッダを付けられないためです。

v1 の rx-pixiv は画像 URL のホスト名を画像プロキシへ書き換えて埋め込みます。
**Bot 自身は画像バイトを一切運びません**（[ADR 0014](docs/adr/0014-media-delivery-via-proxy-url.md)）。

---

## 対応 URL

| 種別 | URL 形 |
|---|---|
| イラスト・マンガ | `https://www.pixiv.net/artworks/{id}` |
| ロケール付き | `https://www.pixiv.net/en/artworks/{id}` 等（artworks / users とも対応） |
| 旧形式 | `member_illust.php?illust_id={id}` / `/i/{id}` |
| 小説 | `https://www.pixiv.net/novel/show.php?id={id}` |
| 小説シリーズ | `https://www.pixiv.net/novel/series/{id}` |
| ユーザー | `https://www.pixiv.net/users/{id}` / `member.php?id={id}` |
| 短縮 | `https://pixiv.me/{name}` |

**うごイラ（ugoira）は v1 では静止画のみ**の表示になります
（[ADR 0012](docs/adr/0012-ugoira-out-of-scope.md)）。

---

## 年齢制限コンテンツの扱い

**この Bot の設計上の最優先事項です。**

| 年齢区分 ＼ チャンネル | 年齢制限チャンネル | 通常チャンネル |
|---|---|---|
| 全年齢 | 展開 | 展開 |
| センシティブ | スポイラー付き展開 | スポイラー付き展開 |
| R-18 / R-18G | **スポイラー付き展開** | **リンクのみ**（タイトル・タグも出さない） |
| 判定不能 | リンクのみ | **無反応** |

`RENDERER=components_v2` では制限付き画像をitem単位でspoiler表示します。
退避経路の `RENDERER=embed` は外部画像を安全にspoiler化できないため、制限付き画像と
メタデータを省き、spoiler付き作品リンクへ縮退します。

- スレッドは親チャンネルの年齢制限属性を継承します
- **DM は年齢制限チャンネルとして扱いません**（全年齢のみ展開）
- 年齢区分を確定できない場合はすべて「判定不能」に倒します（フェイルクローズ）

詳細は [ADR 0006](docs/adr/0006-age-restricted-content.md) を参照してください。

---

## 画像の扱いについて

`i.pximg.net` は `Referer: https://www.pixiv.net/` を要求するため、URL をそのまま
埋め込んでも Discord は描画できません。本 Bot は **URL のホスト名を画像プロキシへ
書き換えて埋め込むだけ**で、**画像バイトのダウンロードもアップロードも行いません**
（[ADR 0014](docs/adr/0014-media-delivery-via-proxy-url.md)）。

```
pixiv が返す:  https://i.pximg.net/img-master/.../xxx_p0_master1200.jpg
埋め込む:      https://phixiv.net/i/img-master/.../xxx_p0_master1200.jpg
```

つまり本 Bot は**配信者ではなくリンクを貼る側**です。作者が pixiv から作品を削除すれば、
埋め込みも自然に見えなくなります。

- 画像プロキシの向き先は `PXIMG_PROXY_BASE_URL` で変更できます（自前ホストも可能）
- **原寸画像（`original`）は使いません**。`regular` を優先し、`small` / `thumb` へ縮退します
- **1作品あたり既定4枚**まで。200ページの作品でも全ページを展開しません
- **必ず pixiv の作品ページへのリンクを併記します**
- 権利者からの削除要請には `!owner/block` による展開拒否で応じます

## pixiv認証について

v1は `PIXIV_PHPSESSID` を受け付けず、pixivへのログインやCookie送信を行いません。
安全性判定と単ページ表示は無認証経路で成立します。将来、認証が必要な機能を追加する場合は、
資格情報の送信先・規約リスク・捨てアカウント利用を別Planで再設計します。

---

## v1 で必要になる Discord 権限

| 権限 | 要否 |
|---|---|
| View Channels | 必須 |
| Send Messages | 必須 |
| Embed Links | 必須 |
| Read Message History | 必須 |
| Manage Messages | **実質必須** |

> **`Manage Messages` について**: 形式上は無くても動作しますが、この権限が無いと
> `suppressEmbeds` できず、**Discord 自身が pixiv の OGP を展開して R-18 のタイトルが
> 通常チャンネルに出てしまいます**（[ADR 0006 既知の限界1](docs/adr/0006-age-restricted-content.md)）。
> 年齢制限の扱いを重視するなら付与してください。

Discord Developer Portal で **Message Content Intent を有効化**する必要があります。

---

## 管理コマンド

オーナー（`OWNER_USER_ID`）との DM でのみ動作します
（[ADR 0015](docs/adr/0015-admin-commands-and-abuse-control.md)）。

| コマンド | 役割 |
|---|---|
| `!owner/guilds` / `!owner/leave <guildId>` | 導入サーバーの確認と離脱 |
| `!owner/ban <userId>` / `!owner/unban <userId>` | 利用者の禁止 |
| `!owner/ban-guild <guildId>` / `!owner/unban-guild <guildId>` | サーバーの禁止 |
| `!owner/block <artworkId\|user:<pixivUserId>>` / `!owner/unblock ...` | **展開拒否**（削除要請の受け皿） |
| `!owner/list-bans` / `!owner/list-blocks` / `!owner/status` / `!owner/help` | 一覧と状態 |

利用者ごと10秒・チャンネルごと5秒のクールダウンがあります（超過時は無反応）。

## ドキュメント

| 文書 | 内容 |
|---|---|
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | 要件定義 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | アーキテクチャ設計 |
| [docs/adr/](docs/adr/) | 設計判断の記録（ADR 0001〜0016） |
| [TODO.md](TODO.md) | 実装バックログ |

---

## 開発

技術スタックは [ADR 0001](docs/adr/0001-tech-stack.md) で確定しています
（TypeScript 6 / Node 24 / ESM / discord.js v14 / undici / zod / pino / Vitest / oxlint + oxfmt）。

### 必要なもの

- Node.js 24
- Discord Bot tokenとMessage Content Intent
- Redis 8（ローカルではComposeのRedisだけを起動可能）

### ローカル起動

依存関係と環境変数を用意します。

```bash
npm ci
cp .env.example .env
```

`.env` の `DISCORD_TOKEN` と `OWNER_USER_ID` を設定してください。`.env` は秘密情報を含むため
commitしないでください。`npm run dev` は `.env` があれば自動で読み込みます。

Redisを先に起動してからBotを起動します。

```bash
docker compose up -d redis
npm run dev
```

### 環境変数

全項目と値の例は [.env.example](.env.example) にあります。

| 変数 | 必須・既定 | 説明 |
|---|---|---|
| `DISCORD_TOKEN` | 必須 | Discord Bot token。秘密情報として扱う |
| `OWNER_USER_ID` | 必須 | `!owner/...` を実行できるDiscordユーザーID |
| `NODE_ENV` / `LOG_LEVEL` | `development` / `info` | 実行環境とログレベル。exampleは本番向けに`production` |
| `ALLOWED_GUILD_IDS` / `ALLOWED_CHANNEL_IDS` | 空＝全許可 | 許可するDiscord IDのカンマ区切り |
| `SOURCE_CHAIN` | `ajax,phixiv,ogp` | pixiv取得経路の試行順 |
| `PHIXIV_BASE_URL` | `https://phixiv.net` | phixivメタデータ取得元 |
| `PXIMG_PROXY_BASE_URL` | `https://phixiv.net/i` | `i.pximg.net`画像URLの書換え先 |
| `RENDERER` | `components_v2` | `components_v2` または退避用の `embed` |
| `REDIS_URL` | `redis://localhost:6379` | Redis接続先。TLSは`rediss://` |
| `REDIS_DOWN_FALLBACK` | `deny` | Redis不通時に停止するか、未確認で展開するか |
| `MAX_URLS_PER_MESSAGE` | `3` | 1メッセージから展開するURL数（上限3） |
| `MAX_PAGES_DEFAULT` / `MAX_PAGES_HARD` | `4` / `10` | 通常表示枚数とDiscord上限 |
| `FETCH_TOTAL_BUDGET_MS` / `SOURCE_TIMEOUT_MS` | `8000` / `3000` | URL全体と取得経路ごとの時間予算。OGPは最大2500ms |
| `PIXIV_RPS` | `1` | pixivホストへの毎秒リクエスト数 |
| `CIRCUIT_FAILURE_THRESHOLD` / `CIRCUIT_OPEN_MS` | `5` / `120000` | circuit breakerの失敗数と開放時間 |
| `USER_COOLDOWN_MS` / `CHANNEL_COOLDOWN_MS` | `10000` / `5000` | 利用者・チャンネル単位のcooldown |
| `SPOILER_IN_NSFW` | `true` | 年齢制限チャンネルでもspoilerを付ける |
| `ALLOW_NSFW_IN_DM` | `false` | DMを年齢制限チャンネル相当として扱うか |
| `SENSITIVE_IN_SFW` | `spoiler` | 将来互換用。v1では通常no-op |
| `UNKNOWN_RATING_SFW` | `skip` | `skip` / `link_only` |
| `IMAGE_VARIANT_PREFERENCE` | `regular,small,thumb` | 画像サイズの選好順。`original`は指定不可 |
| `HEALTH_PORT` | `9090` | ヘルスサーバーの待受ポート |

`REDIS_DOWN_FALLBACK=allow` は、banや削除要請のblockを確認できない状態でも展開を許します。
開発時を除き、既定の `deny` を推奨します。`ALLOW_NSFW_IN_DM=true` も安全側の既定を緩める
設定なので、運用方針を確認してから変更してください。

`SENSITIVE_IN_SFW` は将来互換の設定です。v1の取得結果は `sensitive=false` 固定のため、
通常は変更しても表示に影響しません。

### 品質確認

```bash
npm run build        # ビルド
npm run typecheck    # 型検査
npm run lint         # Lint
npm run fmt:check    # フォーマット検査
npm test             # テスト
npm run test:coverage
npm run dev          # .env を読み込んで開発起動
```

Redisに接続できなくてもDiscord接続は続行しますが、既定の `REDIS_DOWN_FALLBACK=deny` では
禁止・展開拒否を確認できないため全展開を止め、`/readyz` は503になります。`allow` は
禁止や削除要請を適用できない状態で展開を許すため、開発時にリスクを理解した場合だけ使います。

ローカル起動でもヘルスサーバーは `0.0.0.0:${HEALTH_PORT}` で全interfaceに待ち受けます。
信頼できないLANやポート公開されたWSL/Docker環境では、firewall等で外部アクセスを遮断してください。

### コンテナ起動

コンテナで起動する場合は `docker compose up --build` を使います。ヘルスエンドポイント
`/healthz`、`/readyz`、`/health`、`/metrics` はコンテナネットワーク内の `9090` 番で提供し、
ホストには公開しません。

---

## ライセンス

[MIT](LICENSE)
