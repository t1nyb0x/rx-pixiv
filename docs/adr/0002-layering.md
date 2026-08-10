# ADR 0002: レイヤリングと依存方向

- Status: Accepted
- Date: 2026-08-10
- Issue: -

## Context

兄弟2本は両極端にある。

- **rx-twitter** は Core ← Adapter ← Infrastructure の3層を持ち、`src/index.ts` で
  手動 DI する。構造は明快だが、表示ロジックが `ComponentsV2Builder` の中で
  discord.js の型と混ざっており、そこだけ単体テストが書きにくい
- **rx-instagram** はフラットな機能フォルダ構成（7ファイル）。小さいうちは読みやすいが、
  年齢ゲートとフォールバック連鎖という2つの横断的関心事を置く場所が無い

rx-pixiv で最も正しさが要求されるのは `NsfwPolicy`（年齢ゲート）と
`PixivSourceChain`（フォールバック連鎖）であり、いずれも**純粋ロジックとして
単体テストできる形で書けるかどうか**が品質を決める。

また、レイヤ規則は放っておくと必ず腐る。規約文書に書いただけの依存方向は、
締め切り前の1行の import で破られる。

## Decision

rx-twitter と同じ3層を採用し、**依存は内向きにのみ向ける**。

```
Infrastructure ──┐
                 ├──► Core（ポートを所有する）
Adapters ────────┘

index.ts のみが3層すべてを import してよい（合成ルート）
```

- `core/` は `adapters/` と `infrastructure/` を import しない
- `core/` が必要とする能力は、**`core/ports/` のインターフェースとして core 側が定義**し、
  外側がそれを実装する（依存性逆転）
- この規則を **oxlint の `no-restricted-imports` で強制する**。CI で落ちる規則にする

加えて、rx-twitter に対する改善として **`RenderPlan` 中間表現**を導入する。

- `core/services/MessageComposer.ts` は `PixivWork` と年齢ゲートの判定結果から
  `RenderPlan` を作る。`RenderPlan` は **discord.js の型を一切含まない**
- `adapters/discord/` のレンダラ（Components V2 / v1 Embed）は
  `RenderPlan` を Discord ペイロードへ変換するだけの薄い層にする

## Consequences

### Positive

- 「何を・何枚・スポイラー付きで出すか」という判断が discord.js のモック無しで単体テストできる
- レンダラが2つあっても表示判断は1箇所に集約され、二重実装にならない
- Discord 側の API 変更（Components V2 の仕様変更など）の影響が `adapters/discord/` に閉じる
- 依存方向が lint で強制されるため、規約が時間とともに腐らない

### Negative

- 変換が1段増える（`PixivWork` → `RenderPlan` → Discord ペイロード）。
  ファイル数と間接参照が増える
- v1 の規模（推定20〜30ファイル）に対して、3層は過剰に見えうる
- `core/ports/` を先に定義してから実装する順序を守る必要があり、書き始めの摩擦がある

### Mitigation

- 層は3つに留め、これ以上分けない。`utils/` は層の外に置き、どこからでも使ってよいことにする
- `RenderPlan` は素朴なデータ構造（判別共用体＋配列）に留め、振る舞いを持たせない
- lint 規則は Plan 0002 の時点で入れる。後から入れると既存の違反を直す作業が発生する

## Rejected alternatives

### rx-instagram 式のフラット構成

7ファイル規模なら妥当だが、rx-pixiv は年齢ゲート・フォールバック連鎖・
レート制御・サーキットブレーカ・2種類のレンダラを持つ。
これらをフラットに置くと、`NsfwPolicy` の単体テストのために
discord.js と undici の両方をモックすることになり、
**いちばん壊れてはいけないロジックがいちばんテストしにくくなる**。

### rx-twitter をそのまま踏襲し `RenderPlan` を導入しない

構造としては成立するが、表示ロジックが discord.js の型と結合したままになる。
rx-twitter で実際にその部分の単体テストが薄くなっている事実があり、
同じ形を選んで同じ結果になるのを避ける。

### 依存方向を規約文書だけで運用する

守られない。CI で落ちない規約は、いずれ必ず破られる。
