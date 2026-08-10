# rx-pixiv アーキテクチャ設計

- 最終更新: 2026-08-10
- 対象バージョン: v1
- 前提となる要件: [REQUIREMENTS.md](REQUIREMENTS.md)

> **本書はこれから作るものの設計であり、実装状況の記録ではない。**
> 2026-08-10 時点でプロダクトコードは存在しない。
> 以下に登場するファイルパス・型・クラスはすべて**これから作るもの**である。
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
                   │ messageCreate          │ reply（添付ファイル同梱）
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
               │ ①メタデータ     │ ②画像バイト   │ ③ヘルス/メトリクス
               ▼                ▼              ▼
     ┌──────────────────┐  ┌────────────┐  ┌──────────┐
     │ www.pixiv.net    │  │i.pximg.net │  │ :9090    │
     │  /ajax/*         │  │ (Referer   │  │ (非公開) │
     │ phixiv.net       │  │  必須)      │  └──────────┘
     │ 作品ページ OGP    │  └────────────┘
     └──────────────────┘
```

**外部に公開する HTTP 面は持たない。** ヘルスポートは Docker ネットワーク内に留める。
永続ストアも持たない（[ADR 0008](adr/0008-in-memory-cache.md)）。

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
│   │   └── IWorkCache.ts
│   └── services/
│       ├── UrlDetector.ts            # 純粋: string -> PixivRef[]
│       ├── WorkResolver.ts           # キャッシュ -> 経路連鎖 -> PixivWork
│       ├── NsfwPolicy.ts             # 年齢区分 × チャンネル -> Decision
│       ├── MediaSelector.ts          # ページ・サイズ変種・バイト予算の選択
│       └── MessageComposer.ts        # PixivWork + Decision -> RenderPlan
├── adapters/
│   ├── pixiv/
│   │   ├── BasePixivSource.ts
│   │   ├── AjaxPixivSource.ts        # 一次
│   │   ├── PhixivSource.ts           # 二次
│   │   ├── OgpScrapeSource.ts        # 三次
│   │   ├── PixivSourceChain.ts       # フォールバック統括
│   │   ├── shortlink.ts              # pixiv.me のリダイレクト解決
│   │   ├── schemas/                  # ajax レスポンスの zod スキーマ
│   │   └── mappers/                  # 各ソース DTO -> PixivWork
│   └── discord/
│       ├── MessageHandler.ts         # messageCreate の入口
│       ├── ComponentsV2Renderer.ts   # RenderPlan -> Components v2
│       ├── EmbedRenderer.ts          # RenderPlan -> v1 Embed（退避経路）
│       ├── channelRating.ts          # isAgeRestricted(channel)
│       ├── attachmentLimit.ts        # premiumTier -> バイト予算
│       └── replyTracker.ts           # 元メッセージ -> Bot 返信 ID
├── infrastructure/
│   ├── http/
│   │   ├── HttpClient.ts             # undici Agent・UA・タイムアウト・1回リトライ
│   │   ├── PximgFetcher.ts           # Referer 付き取得・ストリーミングバイト上限
│   │   ├── RateLimiter.ts            # ホスト別トークンバケット
│   │   ├── CircuitBreaker.ts
│   │   └── HealthServer.ts           # Hono: /healthz /readyz /health /metrics
│   ├── cache/{LruTtlCache,WorkCache,AttachmentUrlCache}.ts
│   ├── session/PixivSession.ts       # 任意の PHPSESSID 保持＋有効性プローブ
│   └── metrics/Counters.ts
└── utils/{logger,concurrency,bytes,html}.ts
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
   ├─ traceId 発番、チャンネル送信可否の確認
   │
   ├─ UrlDetector.detect(content) ──► PixivRef[]（重複排除・最大3件）
   │     └ コードブロック内 / <> 抑制内 / 既存スポイラー内は除外
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
   │     ├─ MediaSelector.select(work, byteBudget)  … 枚数・サイズ変種の決定
   │     ├─ PximgFetcher.fetch(urls)                … Referer 付き取得
   │     └─ MessageComposer.compose() ──► RenderPlan
   │
   ├─ Renderer が RenderPlan を Discord ペイロードへ変換
   ├─ 送信前アサート（添付10・gallery item 10・embed 10 を超えない）
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
  | (WorkBase & { kind: "user"; bio?: string; counts?: {...};
                  recentWorks: PixivImage[]; recentWorkRatings: ContentRating[] });
```

- 取得できなかった項目は `null` / `undefined`。**空文字センチネルは使わない**
- `UserWork` の最近作は**1枚ずつ年齢区分を持つ**。プロフィール自体が全年齢でも、
  最近作に R-18 が混ざりうるため、サムネイル単位でゲートをかける
- **部分成功を捨てない**: `/ajax/illust/{id}` が成功して `/pages` が失敗しても、
  1ページ目だけを持つ作品として `pagesTruncated: true` で返す

---

## 7. 取得経路の連鎖

```ts
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

---

## 8. メディア配信

**Bot が `Referer` 付きで取得し、Discord の添付として再アップロードする。**
Components v2 の `MediaGalleryItem` から `attachment://<name>` で参照する。

理由と却下案は [ADR 0005](adr/0005-media-delivery.md) に記す。要点だけ:

- 添付方式だけが **item 単位のスポイラー**を実現できる。プロキシ URL を `||...||` で囲むと
  展開そのものが止まり、「ぼかした画像」ではなく「ぼかしたリンク」になる
- 公開プロキシへの依存は、アーカイブ済みプロジェクトに恒常機能の中核を預けることになる
- 自前の公開画像プロキシは、公開ホスト名・TLS・署名付き URL・悪用対策を必要とし、
  それだけやってもスポイラーはできない。**厳密に多い労力で厳密に少ない機能**

### サイズ変種のラダー

1. `regular`（img-master 1200px、概ね 150KB〜1.2MB）を第一候補
2. HEAD で `content-length` を確認し、予算超過なら `small`（540px）→ `thumb`
3. **`original` は v1 では取得しない**
4. **上限はストリーミング中に強制する**。`content-length` は欠落も詐称もありうるので、
   読み出しバイト数を数えて予算を越えた時点で中断する。実際に守ってくれるのはこちら

### Discord の上限との突き合わせ

- 添付総バイト予算 = ブーストティア由来の上限 × 0.9（10%のヘッドルーム）。
  ファイル単位ではなく**メッセージ全体**で配分する
- 送信前に硬いアサート: 添付 ≤10、MediaGallery item ≤10、Embed ≤10。
  rx-instagram の既知バグ（embed 数超過で未捕捉例外）はここで塞ぐ
- 200ページのマンガは既定4枚。「全 200 ページ中 4 ページを表示」と明記してリンクを添える。
  R-18 でも枚数は減らさない（item 単位でぼかされるため）

---

## 9. キャッシュ

インメモリ TTL + LRU のみ。Redis も SQLite も持たない（[ADR 0008](adr/0008-in-memory-cache.md)）。

| キャッシュ | キー | TTL | 上限 |
|---|---|---|---|
| 作品メタ（illust/manga/novel） | `work:illust:{id}` | 6h | 2000 |
| ユーザープロフィール | `work:user:{id}` | 1h | 500 |
| ネガティブ（`not_found`） | `neg:{kind}:{id}` | 10min | 1000 |
| 添付 CDN URL | `att:{id}:{page}:{variant}` | min(6h, CDN の `ex` 失効時刻) | 2000 |
| 返信マップ | `reply:{originMsgId}` | 1h | 2000 |

- **画像バイトをディスクにキャッシュしない**。Discord CDN が実質のキャッシュであり、
  再貼り付けは添付 URL キャッシュで拾える。計測前の最適化はしない
- Discord CDN の URL は `?ex=&is=&hm=` で署名され失効する。TTL は `ex` から導出する。
  脆いと分かったら添付 URL キャッシュ自体を落とす（最適化であって要件ではない）
- `IWorkCache` は `core/ports` に置き、**初日から非同期インターフェース**にする。
  2インスタンス目が必要になった日に `RedisWorkCache` を差し込めるようにするため

---

## 10. 設定

環境変数のみ。`src/config/env.ts` の zod スキーマで起動時に一括検証し、
不備は読める形の集約エラーを出して exit 1。YAML 設定ファイルは v1 では持たない。

主要なもの（全量は `.env.example`）:

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
| `PIXIV_PHPSESSID` | 未設定 | 任意・秘匿・ログでマスク |
| `FETCH_TOTAL_BUDGET_MS` / `SOURCE_TIMEOUT_MS` | `8000` / `3000` | |
| `PIXIV_RPS` / `PXIMG_CONCURRENCY` | `1` / `4` | |
| `HEALTH_PORT` | `9090` | 公開しない |

---

## 11. 可観測性

- **ログ**: pino、JSON を stdout へ。`redact` で cookie と PHPSESSID を無条件にマスク。
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
4. `index.ts` の連鎖組み立てに登録し、`SOURCE_CHAIN` の既定値に加える

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
| 永続化 | Redis | 無し | **インメモリのみ** |
| エラー | `undefined` + `instanceof` 判定 | センチネル文字列 | **判別可能 `Result`** |
| 元メッセージ | `suppressEmbeds` | `delete()` | **`suppressEmbeds`** |
| 表示ロジック | ビルダに混在 | ビルダに混在 | **`RenderPlan` に分離** |

rx-twitter から**持ってこないもの**: `packages/*` ワークスペース、`publish-shared.yml`、
`orval.config.ts`、Redis 前提の三値 `ConfigResult` と縮退設計。
いずれもダッシュボード連携のために存在するもので、v1 には対応物が無い。

---

## 関連ドキュメント

- [要件定義](REQUIREMENTS.md)
- [ADR 一覧](adr/)
