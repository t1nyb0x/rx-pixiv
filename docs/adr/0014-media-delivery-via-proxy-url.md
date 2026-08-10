# ADR 0014: 画像は画像プロキシの URL を埋め込む（ADR 0005 を置き換える）

- Status: Accepted
- Date: 2026-08-10
- Issue: -
- Supersedes: [ADR 0005](0005-media-delivery.md)

## Context

[ADR 0005](0005-media-delivery.md) は「Bot 自身が `Referer` を付けて画像を取得し、
Discord の添付としてアップロードする」と決めた。その中核の根拠は次の主張だった。

> 添付方式だけが item 単位のスポイラーを実現できる。
> プロキシ URL を `||...||` で囲むと展開そのものが止まり、
> 「ぼかした画像」ではなく「ぼかしたリンク」になる。

**この主張は誤りだった。** v1 Embed には当てはまるが、
**Components V2 の `MediaGalleryItem` は外部 URL に対しても `spoiler` が効く**。
[ADR 0009](0009-components-v2-renderer.md) で Components V2 を既定に決めている以上、
ADR 0005 の根拠は成立しない。

併せて、ADR 0005 の帰結として次の負債が生じていた。

1. **帯域増幅**: 1メッセージあたり数MBを下りと上りで二重に払う。
   これは pixiv ではなく**私たち**への負荷であり、濫用の的になる
2. **添付の永続性**: 作者が pixiv から作品を削除しても、Discord CDN 上のコピーは残る
3. **Discord 上の配信主体になる**: R-18 を添付でアップロードすると、
   アップロード主体は Bot のアカウントになる。誤用時に Discord の
   Trust & Safety が向かう先が、投稿者ではなく Bot のトークンになる
4. **削除要請への対応可能性**: 一度アップロードした添付を我々が回収する手段がない

### 実測（2026-08-10）

| 検証 | 結果 |
|---|---|
| `MediaGalleryItem` の `spoiler` | **外部 URL でも効く**（discord.js / discord.py / disnake いずれも対応） |
| `https://phixiv.net/i/<pximg のパス>` | **JPEG を返す**（`master1200`、646KB、HTTP 200） |
| thelaao/phixiv | Rust 製・**Dockerfile 同梱**・`sample.env` あり・**pixiv トークン不要**・稼働中 |

`i.pximg.net` の URL を**そのまま**埋め込むことは依然できない（Discord のメディアプロキシが
`Referer` を付けられないため 403 になる）。しかし**ホスト名を書き換えるだけ**で解決する。

## Decision

**画像は画像プロキシの URL を `MediaGalleryItem` に直接埋め込む。バイトを運ばない。**

- Ajax API が返す `https://i.pximg.net/<path>` を
  `${PXIMG_PROXY_BASE_URL}/<path>`（既定 `https://phixiv.net/i`）へ**ホスト書き換え**する
- R-18 / センシティブ時は `MediaGalleryItem.spoiler = true` を **item 単位**で立てる
- **Bot は画像バイトを一切ダウンロードもアップロードもしない**

### プロキシ依存を単一障害点にしないための措置

phixiv は本家がアーカイブ済みで、フォークの寿命も保証されない。
[ADR 0003](0003-source-fallback-chain.md) の「単一の外部依存が Bot を落とさない」
という原則に従い、3段構えにする。

| 段 | 手段 | 切り替え方 |
|---|---|---|
| 1 | 公開 phixiv（`https://phixiv.net/i`） | 既定 |
| 2 | **自前ホストの phixiv** | `PXIMG_PROXY_BASE_URL` を差し替えるだけ。phixiv は Dockerfile 同梱なので compose に1サービス足せば済む |
| 3 | 添付方式へのフォールバック（ADR 0005 の方式） | `MEDIA_FALLBACK=attachment` で明示的に有効化。既定は無効 |

第3段を `IMediaFetcher` の別実装として残す。
[ADR 0012](0012-ugoira-out-of-scope.md) で切ったポート
（`{ kind: "bytes" } | { kind: "url" }`）がそのまま活きる。

### 維持される決定

ADR 0005 のうち、以下は本 ADR でも維持する。

- **`original`（原寸）を使わない。** `regular`（img-master 1200px）を既定とする。
  帯域の問題は消えたが、原寸の再配信を助長しないという姿勢は変わらない
- **表示枚数は既定4枚・上限10枚**（`MediaGallery` の item 上限）。
  「全 N ページ中 M ページを表示」と明記してリンクを添える
- **必ず pixiv の作品ページへのリンクを併記する**

### 不要になるもの

- `PximgFetcher`（バイト取得）— 第3段のフォールバックとしてのみ残す
- `attachmentLimit.ts`（ブーストティア別のバイト予算）
- `AttachmentUrlCache`（Discord CDN URL の失効管理）
- メッセージ全体のバイト予算配分とストリーミング中の上限強制

## Consequences

### Positive

- **帯域を消費しない。** 濫用による帯域増幅の懸念が消える
- **Discord 上の配信主体にならない。** 我々は「リンクを貼る側」であり、
  R-18 を Bot のトークンでアップロードすることもない
- **作者が作品を削除すれば、埋め込みも自然に見えなくなる**。
  添付のように我々のコピーが残り続けることがない
- 実装が大幅に減る（バイト予算・ストリーミング上限・添付上限解決・CDN URL 失効管理が丸ごと不要）
- 表示までのレイテンシが下がる（アップロード待ちが無くなる）

### Negative

- **画像表示が phixiv の可用性に依存する**。落ちれば画像が出ない
  （メタデータは公式 Ajax API から取れているので、テキストは出る）
- 我々の利用が phixiv の帯域を消費する。第三者への負荷転嫁である
- 自前ホストに切り替えた場合、公開ホスト名・TLS が必要になり、
  ADR 0005 で「悪用の的になる」と挙げた懸念が（第2段を選んだときだけ）復活する

### Mitigation

- `PXIMG_PROXY_BASE_URL` で**コード変更もリリースも無しに**切り替えられる。
  phixiv は Dockerfile 同梱なので、自前ホストへの移行コストが低い
- 画像プロキシの失敗はメトリクス（`pixiv_media_total{proxy,result}`）で可視化する。
  ヘルスチェックにも含める
- phixiv への負荷は、キャッシュ（同一作品の再貼り付けで再取得しない）と
  表示枚数上限（既定4枚）で抑える。そもそも我々は URL を貼るだけで、
  実際に取得するのは Discord のメディアプロキシと閲覧者である
- 自前ホスト時の悪用対策は、その選択をする時点で改めて設計する
  （第2段は緊急避難であり、既定の運用形態ではない）

## Rejected alternatives

### ADR 0005 の方式（添付アップロード）を維持する

根拠だった「添付だけがスポイラーできる」が誤りであった以上、維持する理由がない。
帯域・永続性・配信主体・削除要請の4つの負債だけが残る。
**第3段のフォールバックとしてのみ残す。**

### `i.pximg.net` の URL をそのまま埋め込む

`Referer` 制約により Discord のメディアプロキシが 403 を受ける。描画されない。

### 最初から自前ホストの phixiv だけを使う

公開ホスト名・TLS・悪用対策のコストを、公開 phixiv が動いている間から負う理由がない。
`PXIMG_PROXY_BASE_URL` の切り替えで済むため、必要になってから移ればよい。

### `pixiv.cat` を使う

単一障害点であり、Bot バックエンドとしての大量利用を歓迎していない。
phixiv は自前ホストへの逃げ道（Dockerfile 同梱）があるぶん優れている。

---

## 決定ログ

| 日付 | 出来事 |
|---|---|
| 2026-08-10 | ADR 0005 として「添付アップロード」を Accepted |
| 2026-08-10 | オーナーの指摘を受けて実測。`MediaGalleryItem` の spoiler が外部 URL でも効くこと、phixiv の `/i/` プロキシが実際に画像を返すことを確認。ADR 0005 を本 ADR で置き換え |
