# ADR 0003: 取得経路の多段フォールバック

- Status: Accepted
- Date: 2026-08-10
- Issue: -

## Context

pixiv のコンテンツを取得する手段は、いずれも単独では信頼に足りない。

| 手段 | 性質 |
|---|---|
| 公式 Ajax API（`www.pixiv.net/ajax/*`） | 非公開 API。実測では無認証でイラスト・小説・ユーザーを取得でき、`xRestrict` など年齢区分の権威ある情報を持つ。ただしレート制限とボット対策があり、仕様は予告なく変わる |
| phixiv（`phixiv.net`） | Discord 向け埋め込み修正サービス。**本家 HazelTheWitch/phixiv は 2026-06 にアーカイブ済み**。フォーク（thelaao/phixiv）が稼働中だが `/api/info` は廃止済み |
| 作品ページの OGP スクレイプ | HTML 構造の変更に弱く、年齢制限作品では年齢確認インタースティシャルが返る |

rx-twitter は同様の状況に対し VxTwitter → FxTwitter の2段フォールバックで対応しており、
この形は実運用で機能している。ただし rx-twitter の実装は
`error instanceof VxTwitterServerError` で分岐しており、
「どの失敗でフォールバックすべきか」が型に現れていない。

## Decision

**公式 Ajax API を一次、phixiv を二次、OGP スクレイプを三次**とする多段フォールバックを採用する。

```ts
interface IPixivSource {
  readonly name: SourceName;              // "ajax" | "phixiv" | "ogp"
  readonly capabilities: SourceCapabilities;
  supports(ref: PixivRef): boolean;
  fetch(ref: PixivRef, ctx: FetchContext): Promise<Result<PixivWork, FetchError>>;
}
```

### 連鎖の規則

- **`not_found`（HTTP 404 等）のときのみ連鎖を打ち切る。** それ以外の失敗はすべて次段へ進む
- 各経路は `capabilities` を正直に宣言する
  （`ratingAuthority`: 年齢区分を確定できるか / `multiPage`: 全ページを列挙できるか / 対応種別）
- **年齢ヒントを持ち回る**。ある経路が `auth_required` を返したら、
  その事実自体が「年齢制限作品である」証拠になる。
  `ratingHint = { level: "r18", confidence: "inferred" }` を後段へ渡し、
  **後段は制限を強める方向にしか更新できない**（`r18` を `all` に緩めることはできない）
- **部分成功を捨てない**。`/ajax/illust/{id}` が成功して `/ajax/illust/{id}/pages` が
  失敗した場合、1ページ目だけを持つ作品として `pagesTruncated: true` で返す
- 経路の並びは環境変数 `SOURCE_CHAIN` で変更できる

### 時間予算

1 URL あたり総予算 8000ms。経路別に ajax 3000ms / phixiv 3000ms / ogp 2500ms を割り当て、
`AbortSignal.any([総予算, 経路別])` で打ち切る。
**総予算が尽きていれば次の経路は起動しない。**

## Consequences

### Positive

- どの単一経路が死んでも Bot 全体は動き続ける
- `SOURCE_CHAIN` により、死んだ経路をコード変更もリリースも無しに外せる。
  phixiv の本家がアーカイブ済みである以上、この運用つまみは実際に使われる公算が高い
- `auth_required` を年齢ヒントとして扱うことで、**pixiv 認証なしでも
  年齢ゲート（ADR 0006）が成立する**
- 部分成功を返すことで、ページ一覧の取得失敗が「何も出ない」に落ちない

### Negative

- 経路が3本あるぶん、写像（mapper）とスキーマが3組必要になる。
  それぞれ取得できる項目が異なり、`partial` フラグの管理が要る
- 全経路が失敗する場合、最悪 8 秒待たされる
- phixiv と OGP は年齢区分の権威を持たない。これらから得た作品は
  `confidence` が下がり、通常チャンネルでは展開されないことがある

### Mitigation

- mapper は純粋関数とし、採取した実レスポンスの fixture に対するテーブルテストで担保する
- サーキットブレーカ（[ADR 0011](0011-rate-limit-and-circuit-breaker.md)）により、
  死んだ経路は待たずに即スキップされる。8 秒はブレーカが開くまでの一時的な最悪値に留まる
- `confidence` の低下による非展開は**意図した挙動**である。
  権威ある情報が無いのに展開するほうが危険であり、これは欠陥ではなく設計である
- `pixiv_fallback_depth_total{depth}` を計測し、常時2段目以降に落ちているなら
  一次経路の破損として検知する

## Rejected alternatives

### 公式 Ajax API 単独

実測では v1 対象の3種別すべてを賄えるため、最も素直ではある。
しかし非公開 API であり、仕様変更・ボット対策・レート制限のいずれかが起きた時点で
Bot が全面停止する。単一障害点を中核に置かない。

### phixiv 等の公開プロキシ単独

実装量は最小だが、**本家が既にアーカイブされている**サービスに
恒常機能の全体を預けることになる。フォークの寿命も保証されない。
メタ取得のフォールバックとしてのみ使う。

### 認証あり AppAPI（pixivpy 相当）を一次にする

R-18 を含めて確実に取得できるが、アカウント停止リスク・トークン維持・
厳しいレート制限の運用コストを恒常的に負う。
無認証で v1 スコープが賄えることが実測で分かっている以上、
一次経路に据える理由がない（[ADR 0007](0007-pixiv-session-optional.md)）。

### `not_found` でも連鎖を続ける

権威あるソースの 404 は権威がある。その後にキャッシュ的なプロキシへ問い合わせても、
削除済み・非公開化された作品の古いカードが出るだけであり、
「見つかりません」と伝えるより積極的に悪い。
