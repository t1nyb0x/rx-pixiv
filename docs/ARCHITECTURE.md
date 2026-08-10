# rx-pixiv アーキテクチャ設計

- 最終更新: 2026-08-10
- 対象バージョン: v1
- 前提となる要件: [REQUIREMENTS.md](REQUIREMENTS.md)

> **本書は v1 全体の設計であり、個々の機能の実装状況は記録しない。**
> 以下に登場するファイルパス・型・クラスには実装済みのものと後続 Plan で実装するものがある。
> 実装の進捗は [TODO.md](../TODO.md) と `.claude/addf/plans/` を参照すること。

---

## 1. 設計の姿勢

優先順位の高い順に3つ。判断に迷ったらこの順で決める。

1. **年齢判定はフェイルクローズ**。この Bot で起こしうる最悪のバグは、
   R-18 画像が通常チャンネルにインライン展開されることである。曖昧さはすべて「出さない」に倒す。
2. **単一の外部依存が Bot を落とさない**。pixiv はレート制限をかけ、phixiv の本家は
   アーカイブ済み。すべての経路は任意であり、死んだ経路は待たずに飛ばす。
3. **不確実性を型で表現する**。「年齢区分が分からない」は `undefined` ではなく、
   ドメインモデルの一級の値である。これが無いと FR-4 は書けない。

---

## 2. システム全体構成

```
        ┌─────────────────────────────────────────────┐
        │                  Discord                     │
        └──────────┬───────────────────────▲───────────┘
                   │ messageCreate          │ reply（URL 埋め込み）
                   ▼                        │
        ┌──────────────────────────────────────────────┐
        │            rx-pixiv Bot (Node.js)             │
        │                                               │
        │   ┌────────┐   ┌──────────┐   ┌────────────┐ │
        │   │  Core  │◄──│ Adapters │◄──│Infrastructure│
        │   │(純粋)   │   │          │   │            │ │
        │   └────────┘   └──────────┘   └────────────┘ │
        │        ▲                                      │
        │        └──── index.ts が全層を DI で組み立て   │
        └──────┬────────────────┬──────────────┬────────┘
               │ ①メタデータ     │ ②永続状態     │ ③ヘルス/メトリクス
               ▼                ▼              ▼
     ┌──────────────────┐  ┌────────────┐  ┌──────────┐
     │ www.pixiv.net    │  │  Redis     │  │ :9090    │
     │  /ajax/*         │  │ 禁止/拒否   │  │ (非公開) │
     │ phixiv.net       │  │ 返信/CD     │  └──────────┘
     │ 作品ページ OGP    │  └────────────┘
     └──────────────────┘

        画像は Bot を経由しない:
        ┌──────────┐  埋め込まれた URL   ┌──────────────┐  Referer 付与  ┌────────────┐
        │ 閲覧者    │◄── Discord CDN ───►│ phixiv.net/i │──────────────►│i.pximg.net │
        └──────────┘                     └──────────────┘                └────────────┘
```

**外部に公開する HTTP 面は持たない。** ヘルスポートは Docker ネットワーク内に留める。

**画像バイトは Bot を通らない**（[ADR 0014](adr/0014-media-delivery-via-proxy-url.md)）。
Bot が行うのは `i.pximg.net` の URL を画像プロキシの URL へ書き換えて埋め込むことだけで、
実際に画像を取得するのは Discord のメディアプロキシと閲覧者である。

永続ストアは Redis を持つが、**「消えては困る状態」に限る**
（[ADR 0016](adr/0016-redis-for-persistent-state.md)）。作品メタデータのキャッシュは
プロセス内 LRU のままで、Redis はホットパスに入らない。

---

## 3. レイヤリング

依存は**内向きにのみ**向く。

```
  Infrastructure ──┐
                   ├──► Core（ポートを所有する）
  Adapters ────────┘

  index.ts のみが3層すべてを import してよい（合成ルート）
```

- `core/` は `adapters/` と `infrastructure/` を **import しない**。
  必要な能力は `core/ports/` のインターフェースとして core 側が定義し、外側が実装する
- この規則は oxlint の `no-restricted-imports` で**強制する**。願望ではなく CI で落とす

（[ADR 0002](adr/0002-layering.md)）

---

## 4. ディレクトリ構成

```
src/
├── index.ts                          # 合成ルート: DI 配線・シグナル・起動
├── config/
│   ├── env.ts                        # zod スキーマ・起動時一括検証・fail-fast
│   └── constants.ts                  # Discord 側の硬い上限（可変つまみではない）
├── core/                             # 外部依存ゼロ。純粋ロジック
│   ├── models/
│   │   ├── PixivWork.ts              # 判別共用体（illust | novel | user）
│   │   ├── PixivRef.ts               # 正規化された URL 参照
│   │   ├── ContentRating.ts          # 年齢区分＋確信度
│   │   ├── Result.ts                 # Result<T, E>
│   │   ├── errors.ts                 # FetchError の分類
│   │   └── RenderPlan.ts             # 表示内容の記述（discord.js 型を含まない）
│   ├── ports/
│   │   ├── IPixivSource.ts
│   │   ├── IHttpClient.ts
│   │   ├── IMediaFetcher.ts
│   │   ├── IBanRepository.ts
│   │   ├── IBlockRepository.ts
│   │   └── IWorkCache.ts
│   └── services/
│       ├── UrlDetector.ts            # 純粋: string -> PixivRef[]
│       ├── WorkResolver.ts           # キャッシュ -> 経路連鎖 -> PixivWork
│       ├── NsfwPolicy.ts             # 年齢区分 × チャンネル -> Decision
│       ├── MediaSelector.ts          # ページ・サイズ変種の選択
│       └── MessageComposer.ts        # PixivWork + Decision -> RenderPlan
├── adapters/
│   ├── pixiv/
│   │   ├── BasePixivSource.ts
│   │   ├── AjaxPixivSource.ts        # 一次
│   │   ├── PhixivSource.ts           # 二次
│   │   ├── OgpScrapeSource.ts        # 三次
│   │   ├── PixivSourceChain.ts       # フォールバック統括
│   │   ├── shortlink.ts              # pixiv.me のリダイレクト解決
│   │   ├── ImageUrlRewriter.ts       # i.pximg.net -> ${PXIMG_PROXY_BASE_URL}
│   │   ├── schemas/                  # ajax レスポンスの zod スキーマ
│   │   └── mappers/                  # 各ソース DTO -> PixivWork
│   └── discord/
│       ├── MessageHandler.ts         # messageCreate の入口
│       ├── OwnerCommandHandler.ts    # !owner/... の DM コマンド
│       ├── ComponentsV2Renderer.ts   # RenderPlan -> Components v2
│       ├── EmbedRenderer.ts          # RenderPlan -> v1 Embed（退避経路）
│       ├── channelRating.ts          # isAgeRestricted(channel)
│       └── replyTracker.ts           # 元メッセージ -> Bot 返信 ID
├── infrastructure/
│   ├── http/
│   │   ├── HttpClient.ts             # undici Agent・UA・タイムアウト・1回リトライ
│   │   ├── RateLimiter.ts            # ホスト別トークンバケット
│   │   ├── CircuitBreaker.ts
│   │   ├── CircuitProtectedSource.ts # source取得・検証・写像を経路別に保護
│   │   ├── HealthServer.ts           # Hono: /healthz /readyz /health /metrics
│   │   └── PximgFetcher.ts           # 将来の任意経路（v1では未実装）
│   ├── cache/{LruTtlCache,WorkCache}.ts
│   ├── redis/
│   │   ├── client.ts                 # 接続・再接続・縮退
│   │   ├── RedisBanRepository.ts     # IBanRepository の実装
│   │   ├── RedisBlockRepository.ts   # IBlockRepository の実装
│   │   ├── RedisReplyRepository.ts
│   │   └── RedisCooldownStore.ts
│   ├── session/PixivSession.ts       # 将来候補（v1では資格情報を受け付けず未実装）
│   └── metrics/Counters.ts
└── utils/{logger,concurrency,html}.ts
```

### 構造上の要点: `RenderPlan`

`MessageComposer` が出力する `RenderPlan` は **discord.js の型を一切含まない**。
「何を・何枚・スポイラー付きで出すか」という面白い判断はすべてここで終わり、
レンダラは薄く愚直な変換に徹する。

両兄弟に対する明確な改善点であり、その帰結として:

- 表示ロジックを discord.js のモックなしで単体テストできる
- Components v2 と v1 Embed の2レンダラが、同じ判断を共有して二重実装にならない
- Discord 側の API 変更の影響が `adapters/discord/` に閉じる

---

## 5. データフロー

```
messageCreate
   │
   ├─ Bot 自身・他 Bot なら終了
   ├─ OwnerCommandHandler（DM の !owner/...）── 処理したら終了
   ├─ 禁止判定（利用者・サーバー）──────────── 該当なら終了
   ├─ 許可チャンネル判定 ───────────────────── 対象外なら終了
   ├─ クールダウン（利用者10秒 / チャンネル5秒）── 超過なら無反応で終了
   │     ※ ここまでを URL 検出より前に置く。濫用時に本文解析すら行わせない
   │
   ├─ traceId 発番、チャンネル送信可否の確認
   │
   ├─ UrlDetector.detect(content) ──► PixivRef[]（重複排除・最大3件）
   │     └ コードブロック内 / <> 抑制内 / 既存スポイラー内は除外
   │
   ├─ 展開拒否リスト照合 ── 該当分は取得せずスキップ
   │
   ├─ 同時実行2本まで、各 PixivRef について:
   │     │
   │     ├─ WorkCache 参照（ヒットなら以降を飛ばす）
   │     │
   │     ├─ PixivSourceChain.fetch(ref)
   │     │     ├─ AjaxPixivSource   ─┐
   │     │     ├─ PhixivSource      ─┼─ 404 で打ち切り、他は次段へ
   │     │     └─ OgpScrapeSource   ─┘   ratingHint を持ち回る
   │     │
   │     ├─ NsfwPolicy.decide({ rating, channelIsNsfw, isDM })
   │     │     └─ expand_plain | expand_spoiler | link_only | skip
   │     │
   │     ├─ skip なら何も投稿せず終了
   │     ├─ link_only なら定型文＋URL のみ（画像・タイトル・タグを出さない）
   │     │
   │     ├─ MediaSelector.select(work)              … 枚数・サイズ変種の決定
   │     ├─ ImageUrlRewriter.rewrite(urls)          … i.pximg.net -> プロキシ URL
   │     └─ MessageComposer.compose() ──► RenderPlan
   │
   ├─ Renderer が RenderPlan を Discord ペイロードへ変換
   ├─ 送信前アサート（gallery item 10・embed 10 を超えない）
   ├─ message.reply(...)  → replyTracker に記録
   └─ 1件でも展開したら message.suppressEmbeds(true)（失敗は無視）

messageDelete
   └─ replyTracker から Bot の返信 ID を引いて削除
```

---

## 6. ドメインモデル

### 年齢区分（設計の要）

```ts
type RatingLevel      = "all" | "r18" | "r18g";
type RatingConfidence = "authoritative" | "inferred" | "unknown";

interface ContentRating {
  level: RatingLevel;
  sensitive: boolean;              // pixiv の sanity level >= 4。xRestrict とは別物
  ai: "no" | "yes" | "unknown";
  confidence: RatingConfidence;
}
```

`confidence` が全体を支えている。

| 経路 | 判定材料 | confidence |
|---|---|---|
| Ajax | `xRestrict`（0/1/2）、`sl`、`aiType`、タグ | `authoritative` |
| phixiv | `R-18` タグの有無 | `inferred` |
| OGP スクレイプ | 年齢確認インタースティシャルの検出 | `inferred` または `unknown` |
| いずれかが `auth_required` を返した | **弾かれた事実そのもの** | `inferred` / level `r18` |

**`confidence: "unknown"` は「制限あり」として扱う。** これが無ければ、
「取得に失敗しただけ」と「R-18 だから取得できない」を区別できず、
要件 FR-4 の縮退経路が成立しない。

### 作品

```ts
type SourceName = "ajax" | "phixiv" | "ogp";

interface WorkBase {
  id: string; canonicalUrl: string; title: string;
  author: { id: string; name: string; url: string; avatarUrl?: string };
  rating: ContentRating;
  source: SourceName;
  fetchedAt: number;
  partial: boolean;                // この経路では埋まらなかった項目がある
}

type PixivWork =
  | (WorkBase & { kind: "illust"; illustType: "illust" | "manga" | "ugoira";
                  pageCount: number; pages: PixivImage[]; pagesTruncated: boolean;
                  tags: PixivTag[]; description?: string; stats?: {...}; createdAt?: string })
  | (WorkBase & { kind: "novel"; textCount?: number; coverImage?: PixivImage;
                  series?: {...}; tags: PixivTag[]; excerpt?: string })
  | (WorkBase & { kind: "novel_series"; description?: string;
                  coverImage?: PixivImage; novelCount?: number })
  | (WorkBase & { kind: "user"; bio?: string; counts?: {...};
                  recentWorks: UserRecentWork[] });

interface UserRecentWork {
  id: string;
  canonicalUrl: string;
  image: PixivImage;
  rating: ContentRating;
}
```

- 取得できなかった項目は `null` / `undefined`。**空文字センチネルは使わない**
- `UserWork` の最近作は**1枚ずつ年齢区分を持つ**。プロフィール自体が全年齢でも、
  最近作に R-18 が混ざりうるため、サムネイル単位でゲートをかける
- **部分成功を捨てない**: `/ajax/illust/{id}` が成功して `/pages` が失敗しても、
  1ページ目だけを持つ作品として `pagesTruncated: true` で返す

---

## 7. 取得経路の連鎖

```ts
interface SourceCapabilities {
  supportedKinds: PixivRef["kind"][];
  ratingAuthority: "authoritative" | "inferred" | "unknown";
  multiPage: boolean;
}

interface IPixivSource {
  readonly name: SourceName;
  readonly capabilities: SourceCapabilities;
  supports(ref: PixivRef): boolean;
  fetch(ref: PixivRef, ctx: FetchContext): Promise<Result<PixivWork, FetchError>>;
}

interface FetchContext { signal: AbortSignal; ratingHint?: Partial<ContentRating>; }
```

`fetch` は**全関数**である。想定内の失敗で例外を投げない
（投げるのは我々のバグ＝プログラマエラーのときだけ）。

### エラー分類と連鎖の挙動

| kind | 契機 | 連鎖の動作 |
|---|---|---|
| `not_found` | 404、または ajax の not-found エラー | **打ち切る**。権威ある不在。「作品が見つかりません」を表示 |
| `auth_required` | 無認証クライアントが R-18 で弾かれた | `ratingHint = r18/inferred` を立てて**続行** |
| `rate_limited` | 429・ソフトブロック | サーキットを開いて続行。**インラインリトライしない** |
| `upstream_5xx` | 5xx | 1回リトライ（250ms + ジッタ）後、続行 |
| `timeout` | AbortSignal 発火 | リトライせず続行（予算を使い切っている） |
| `network` | DNS / ECONNRESET | 1回リトライ後、続行 |
| `parse_error` | zod 検証失敗・OGP タグ欠落 | 続行。生レスポンスの断片を debug ログへ |
| `unsupported` | 経路が非対応、またはサーキット開 | 遅延ゼロで即続行 |

**`not_found` だけが連鎖を止める。** 権威あるソースの 404 は権威がある。
その後にキャッシュ的なプロキシへ問い合わせても、削除済み作品の古いカードが出るだけで、
「見つかりません」より積極的に悪い。

### 年齢ヒントの伝播

`auth_required` は「R-18 である」ことの証拠になる。連鎖はこのヒントを後段へ持ち回り、
**後段は制限を強める方向にしか更新できない**（`r18` を `all` に緩めることはできない）。
これにより、PHPSESSID が無くても FR-4 が成立する。

### 時間予算

```
総予算 8000ms
  ├ ajax   3000ms
  ├ phixiv 3000ms
  └ ogp    2500ms
signal = AbortSignal.any([総予算, AbortSignal.timeout(経路別)])
```

総予算が尽きていれば次の経路は**起動しない**。利用者が体感するのは
最悪ケースのレイテンシなので、そこを固定する。

### 上流保護

| 機構 | 設定 |
|---|---|
| サーキットブレーカ（経路別） | 60秒内5連続失敗で開 → 120秒 → 半開1本 |
| トークンバケット（ホスト別） | `www.pixiv.net` 1rps/burst3、`i.pximg.net` 8rps/同時4 |
| メッセージ内 URL 上限 | 3 |
| メッセージ内取得同時実行 | 2 |
| 作品内の画像同時取得 | 4（総バイト予算の下で） |

rate limit は `HttpClient` の各物理HTTP試行へ適用し、内部retryにも必ず課す。
circuit breaker は `CircuitProtectedSource` でsourceの取得・zod検証・写像全体を包み、
`parse_error` を含む論理経路の障害を記録する。呼び出し側のキャンセルは障害へ数えない。

---

## 8. メディア配信

**`i.pximg.net` の URL を画像プロキシの URL へホスト書き換えし、
`MediaGalleryItem` に直接埋め込む。Bot はバイトを運ばない。**
（[ADR 0014](adr/0014-media-delivery-via-proxy-url.md)）

```
ajax が返す:  https://i.pximg.net/img-master/img/.../100412238_p0_master1200.jpg
                              ↓ ホスト書き換えのみ
埋め込む:     https://phixiv.net/i/img-master/img/.../100412238_p0_master1200.jpg
```

`i.pximg.net` をそのまま埋め込めないのは `Referer` 制約のためだが、
**ホスト名を替えるだけで解決する**。R-18 / センシティブ時は
`MediaGalleryItem.spoiler = true` を item 単位で立てる —— これは**外部 URL でも効く**。

### プロキシを単一障害点にしない

| 段 | 手段 | 切り替え |
|---|---|---|
| 1 | 公開 phixiv（`https://phixiv.net/i`） | 既定 |
| 2 | **自前ホストの phixiv** | `PXIMG_PROXY_BASE_URL` を差し替え。Dockerfile 同梱なので compose に1サービス足すだけ |
| 3 | 添付方式（旧 ADR 0005 の方式） | `MEDIA_FALLBACK=attachment`。既定は無効 |

第3段のために `IMediaFetcher`（`{ kind: "bytes" } | { kind: "url" }`）を残す。

### 枚数とサイズ

- `regular`（img-master 1200px）を使う。**`original` は使わない**
- 既定4枚・上限10枚（`MediaGallery` の item 上限）。
  「全 200 ページ中 4 ページを表示」と明記してリンクを添える
- R-18 でも枚数は減らさない（item 単位でぼかされるため）
- **部分失敗は捨てない**。一部の URL しか組み立てられなくても、取れた分を表示する
- 送信前に硬いアサート: MediaGallery item ≤10、Embed ≤10。
  rx-instagram の既知バグ（embed 数超過で未捕捉例外）はここで塞ぐ

---

## 9. 状態の置き場所

**「消えては困る状態」だけ Redis、それ以外はプロセス内**
（[ADR 0016](adr/0016-redis-for-persistent-state.md)）。

### プロセス内 TTL + LRU（消えてよい）

| キャッシュ | キー | TTL | 上限 |
|---|---|---|---|
| 作品メタ（artwork/novel/novel_series） | `pixivRefKey(ref)`（作品用 Map） | 6h | 2000 |
| ユーザープロフィール | `pixivRefKey(ref)`（ユーザー用 Map） | 1h | 500 |
| ネガティブ（`not_found`） | `pixivRefKey(ref)`（不在用 Map） | 10min | 1000 |
| サーキットブレーカ状態 | — | — | — |

高頻度・大量であり、消えても再取得すればよい。**Redis をホットパスに入れない。**

### Redis（消えては困る）

| キー | 型 / TTL |
|---|---|
| `app:ban:list` / `app:ban:user:{id}` / `app:ban:guild:{id}` | Set + JSON ／無期限 |
| `app:block:list` / `app:block:artwork:{id}` / `app:block:user:{id}` | Set + JSON ／無期限 |
| `app:reply:{originMsgId}` | JSON ／24h |
| `app:cooldown:user:{id}` / `app:cooldown:channel:{id}` | 文字列 ／秒単位 |

- 禁止と展開拒否は**起動時に全件プリロード**し、変更時に更新する。
  毎メッセージで Redis に往復しない
- `appendonly yes` で永続化する
- **Redis を読めないときはフェイルクローズ**（`REDIS_DOWN_FALLBACK=deny` が既定）。
  ban できていない状態で動き続けるより止まるほうがよい。
  クールダウンだけは読めなくても通す（安全側の判断に影響しないため）
- `IBanRepository` / `IBlockRepository` / `IWorkCache` は `core/ports/` に置き、
  実装を差し替えられるようにする（ファイル方式へ戻す余地を残す）

---


## 10. 設定

環境変数のみ。`src/config/env.ts` の zod スキーマで起動時に一括検証し、
不備は読める形の集約エラーを出して exit 1。YAML 設定ファイルは v1 では持たない。

主要なもの（v1 の予定を含む。**現在利用可能な全量**は `.env.example`）:

| 変数 | 既定 | 用途 |
|---|---|---|
| `DISCORD_TOKEN` | （必須） | |
| `SOURCE_CHAIN` | `ajax,phixiv,ogp` | **死んだ経路をコード変更なしで外す** |
| `PHIXIV_BASE_URL` | `https://phixiv.net` | フォーク移転への追随 |
| `MAX_URLS_PER_MESSAGE` | `3` | |
| `MAX_PAGES_DEFAULT` / `MAX_PAGES_HARD` | `4` / `10` | |
| `IMAGE_VARIANT_PREFERENCE` | `regular,small,thumb` | |
| `RENDERER` | `components_v2` | `embed` に退避できる |
| `SPOILER_IN_NSFW` | `true` | FR-4。将来緩められるようにつまみだけ用意 |
| `SENSITIVE_IN_SFW` | `spoiler` | `spoiler` \| `link_only` \| `skip` |
| `UNKNOWN_RATING_SFW` | `skip` | `skip` \| `link_only` |
| `ALLOW_NSFW_IN_DM` | `false` | |
| `FETCH_TOTAL_BUDGET_MS` / `SOURCE_TIMEOUT_MS` | `8000` / `3000` | |
| `PIXIV_RPS` | `1` | |
| `CIRCUIT_FAILURE_THRESHOLD` / `CIRCUIT_OPEN_MS` | `5` / `120000` | 60秒内の連続失敗数 / 開状態の時間 |
| `HEALTH_PORT` | `9090` | 公開しない |
| **`PXIMG_PROXY_BASE_URL`** | `https://phixiv.net/i` | **画像プロキシの向き先。自前ホストへ逃げる口**（[ADR 0014](adr/0014-media-delivery-via-proxy-url.md)） |
| `MEDIA_FALLBACK` | `none` | `attachment` で旧・添付方式を第3段として有効化 |
| **`OWNER_USER_ID`** | （必須） | `!owner/...` コマンドの実行者（[ADR 0015](adr/0015-admin-commands-and-abuse-control.md)） |
| **`REDIS_URL`** | `redis://localhost:6379` | （[ADR 0016](adr/0016-redis-for-persistent-state.md)） |
| **`REDIS_DOWN_FALLBACK`** | **`deny`** | Redis 不通時にフェイルクローズ。`allow` で緩められる |
| `USER_COOLDOWN_MS` / `CHANNEL_COOLDOWN_MS` | `10000` / `5000` | 超過時は無反応 |

---

## 11. 可観測性

- **ログ**: pino、JSON を stdout へ。`redact` で cookie と PHPSESSID を無条件にマスク。
  v1 は PHPSESSID を設定として受け付けず、このマスクは誤投入への多層防御として残す。
  `messageCreate` ごとに `traceId` を発番し、`{traceId, guildId, channelId, workId, source}`
  を束ねた子ロガーで通す。**メッセージ本文は絶対に出さない**
- **メトリクス**: `/metrics` に Prometheus テキスト形式（自前実装、数十行）
  - `pixiv_fetch_total{source,result}` — 「phixiv は死んでいるか」「レート制限を食っているか」
  - `pixiv_fallback_depth_total{depth}`
  - `pixiv_render_total{decision}` — **`skip` の急増は年齢判定の故障を意味する**
  - `pixiv_bytes_uploaded_total` / `pixiv_cache_{hits,misses}_total` / `pixiv_circuit_state{source}`
- **プロセス**: `unhandledRejection` は fatal ログのみで落とさない。
  `uncaughtException` は fatal ログ後 exit(1) して Docker に再起動させる。握り潰さない
- **ヘルス**: `/healthz`（常に200）、`/readyz`（Discord 未接続なら503）、
  `/health`（uptime・WS ping・ギルド数・キャッシュサイズ・サーキット状態・`authenticated`）
- **正常終了**: SIGINT/SIGTERM で新規受付を止め、処理中を最大5秒待ち、
  `client.destroy()` → ヘルスサーバ停止 → `agent.close()` → exit 0

---

## 12. 拡張レシピ

### 取得経路を1本追加する

1. `IPixivSource` を実装するクラスを `adapters/pixiv/` に追加する
2. レスポンスの zod スキーマを `schemas/` に、`PixivWork` への写像を `mappers/` に置く
3. `capabilities`（`ratingAuthority` / `multiPage` / 対応種別）を正直に宣言する
4. `CircuitProtectedSource.fromEnv` で包み、論理経路単位のサーキットブレーカを適用する
5. `index.ts` の連鎖組み立てに登録し、`SOURCE_CHAIN` の既定値に加える

`core/` には一切触れない。

### 対応コンテンツ種別を増やす

1. `PixivWork` に判別子を追加する（`kind: "..."`）
2. `UrlDetector` に URL 形とテーブルテストを追加する
3. 各 mapper と `MessageComposer` の `switch` がコンパイルエラーになるので、そこを埋める

判別共用体なので、**対応漏れは型エラーとして出る**。

### うごイラに対応する（ロードマップ）

`IMediaFetcher` は `{ kind: "bytes" } | { kind: "url" }` を返すポートになっている。
ffmpeg を必要とする変換は、本体イメージではなく別コンテナ（`rx-pixiv-media`）に置き、
このポートの別実装として差し込む。Bot 本体は変更しない（[ADR 0012](adr/0012-ugoira-out-of-scope.md)）。

---

## 13. 兄弟プロジェクトとの差分

| 観点 | rx-twitter | rx-instagram | **rx-pixiv** |
|---|---|---|---|
| モジュール | ESM + workspaces | CommonJS | **ESM 単一パッケージ** |
| パス別名 | tsc-alias | tsc-alias | **package.json `imports`** |
| 外部 API | orval 生成（OpenAPI 有） | cheerio スクレイプ | **手書き zod**（OpenAPI 不在） |
| HTTP | orval fetch mutator | 素の `fetch` | **undici 直**（Referer/Cookie/ストリーミング制御が要る） |
| ロガー | winston + ファイルローテート | `console.log` | **pino / stdout** |
| 永続化 | Redis（全部） | 無し | **Redis は永続状態のみ・キャッシュはプロセス内** |
| エラー | `undefined` + `instanceof` 判定 | センチネル文字列 | **判別可能 `Result`** |
| 元メッセージ | `suppressEmbeds` | `delete()` | **`suppressEmbeds`** |
| メディア | プロキシ API の URL を埋め込み | `og:image` の URL を埋め込み | **画像プロキシへホスト書き換えして埋め込み** |
| 管理面 | DM `!owner/...` | 無し | **DM `!owner/...`（展開拒否リスト付き）** |
| 表示ロジック | ビルダに混在 | ビルダに混在 | **`RenderPlan` に分離** |

rx-twitter から**持ってこないもの**: `packages/*` ワークスペース、`publish-shared.yml`、
`orval.config.ts`、Redis 前提の三値 `ConfigResult` と縮退設計。
いずれもダッシュボード連携のために存在するもので、v1 には対応物が無い。

---

## 関連ドキュメント

- [要件定義](REQUIREMENTS.md)
- [ADR 一覧](adr/)
