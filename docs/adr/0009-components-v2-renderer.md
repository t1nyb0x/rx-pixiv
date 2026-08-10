# ADR 0009: レンダラは Components V2 を既定とする

- Status: Accepted
- Date: 2026-08-10
- Issue: -

> **2026-08-11 amendment**: 画像配信は [ADR 0014](0014-media-delivery-via-proxy-url.md) で
> 添付から画像プロキシURLの直接参照へ変更した。以下のDecisionはこの訂正を反映済み。

## Context

Discord への表示方法は2つある。

- **v1 Embed**: `EmbedBuilder`。複数画像は「同じ `url` を持つ Embed を並べると
  Discord がギャラリーに畳む」という**副作用に頼った技**で表現する（rx-instagram が使用、上限4枚）
- **Components V2**: `ContainerBuilder` / `MediaGalleryBuilder` 等。
  `MessageFlags.IsComponentsV2` を立てて送る。rx-twitter が既定として採用済み

rx-pixiv の要件は表示方式に強い制約をかける。

1. **複数ページ作品**を最大10枚まで並べたい
2. **R-18 作品は item 単位でスポイラーをかけたい**（[ADR 0006](0006-age-restricted-content.md)）
3. 画像は [ADR 0014](0014-media-delivery-via-proxy-url.md) の画像プロキシURLを直接参照し、
   Bot自身は画像バイトを運ばないこと

## Decision

**Components V2 を既定のレンダラとする**（`RENDERER=components_v2`）。

- `MediaGalleryBuilder` に最大10 itemを載せ、画像プロキシの外部URLを直接参照する
- R-18 / センシティブ時は `MediaGalleryItem.spoiler = true` を **item 単位**で立てる
- 併せて **v1 Embed レンダラ（`RENDERER=embed`）を退避経路として維持する**。
  「存在するだけ」ではなく、統合テストの同じ4シナリオを通す

両レンダラは [ADR 0002](0002-layering.md) の `RenderPlan` を入力に取る。
表示判断はレンダラの外で終わっており、レンダラは変換に徹する。

## Consequences

### Positive

- item 単位のスポイラーが得られる。要件 FR-4 を素直に満たせる
- 10 item まで並べられる（v1 Embed のギャラリー畳み込みは4枚が実用上限）
- 「同じ `url` を並べると畳まれる」という**副作用依存の技が不要になる**
- rx-twitter と表示方式が揃うため、運用上の見た目の一貫性がある

### Negative

- Components V2 は `content` と `embeds` を同時に使えないなど制約があり、
  discord.js 側の API 変更の影響を受けやすい
- レンダラを2つ維持するぶん、テストシナリオが2倍になる
- v1 Embed に比べて情報が少ない環境（古いクライアント等）での見え方の検証が要る

### Mitigation

- `RENDERER=embed` を**本当に動く退避経路**として維持する。
  統合テストの4シナリオ（全年齢 / R-18×NSFW / R-18×通常 / 判定不能×通常）を
  両レンダラで通すことを完了条件に含める
- Embedは外部画像をspoiler化できないため、制限付き作品では画像・機微メタデータを省き、
  spoiler付き正規リンクへ安全に縮退する
- `RenderPlan` を挟むことで、レンダラ2つぶんの重複は変換コードのみに留まる
- 送信前に硬いアサート（gallery item ≤10、embed ≤10）を置き、
  上限超過が未捕捉例外にならないようにする（rx-instagram の既知バグを塞ぐ）

## Rejected alternatives

### v1 Embed のみを使う

item 単位のスポイラーができない。
Embed 全体に対して `||url||` を使うと展開そのものが止まり、
「ぼかした画像」ではなく「ぼかしたリンク」になる。要件 FR-4 を満たせない。
また、複数画像のギャラリー化が仕様ではなく副作用に依存しており、
Discord 側の変更で壊れうる。

### Components V2 のみを使い、退避経路を持たない

Discord または discord.js が Components V2 の仕様を変えた場合、
既定のレンダラが壊れた時点で Bot の表示機能が全損する。
[ADR 0003](0003-source-fallback-chain.md) で取得経路に冗長性を持たせている以上、
表示経路にも同じ姿勢を取る。

### 表示判断をレンダラの中に書く（rx-twitter / rx-instagram 方式）

レンダラが2つあると判断ロジックが二重化し、片方だけ直す事故が起きる。
また discord.js の型と混ざるため、いちばんテストしたい部分がテストしにくくなる
（[ADR 0002](0002-layering.md)）。
