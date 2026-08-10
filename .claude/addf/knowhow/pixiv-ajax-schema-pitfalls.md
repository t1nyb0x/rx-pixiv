---
title: pixiv Ajax API のスキーマ設計 — 実測 fixture でしか捕まらない落とし穴と、観測ツールの信頼度
created: 2026-08-10
last_verified: 2026-08-10
depends_on:
  - src/adapters/pixiv/schemas/ajax.ts
  - src/adapters/pixiv/mappers/ajaxMapper.ts
  - docs/adr/0003-source-fallback-chain.md
status: active
---

# pixiv Ajax API のスキーマ設計

> 出典: rx-pixiv Plan 0005 項目1・項目2。非公開 API のスキーマと写像を実装した際に、
> **推測で書いていたら静かに壊れていた**箇所が4つ見つかった

## 発見した知見

### 1. ヘッダを制御できない観測ツールの結果を、そのまま設計判断にしない

スパイクで `WebFetch`（User-Agent や `Referer` を指定できない）を使ったところ、
全年齢作品でも `body.urls` が全 null に見えた。
これは pixiv のボット対策による劣化応答の可能性があった。

**正規の UA と `Referer: https://www.pixiv.net/` を付けた `curl` で再検証**したところ、
結果は同じ（＝本当に null）だったが、`sl` の値や `/pages` の 404 も同時に確定できた。

観測が設計を左右する場面では、**ヘッダを制御できるクライアントで裏を取る**。
二段構えにするコストは小さく、外したときの損害は大きい。

#### この教訓を書いた直後に、自分で破った

同じスパイクで phixiv も `WebFetch` で確認し、「R-18 には `og:image` が無い」と結論して
ADR 0007・ADR 0014・要件・Plan の4箇所に書いた。**誤りだった。**

phixiv は **bot の User-Agent でなければ 307 で pixiv へ転送する**。
`Discordbot/2.0` を名乗って再取得したところ、R-18 でも `og:image` は返る。
しかもその画像 URL は UA を問わず実バイトを返す。

つまり「**認証なしでは R-18 の画像を出せない**」という結論そのものが誤りで、
ADR 0007 の帰結表を書き直すことになった。

**教訓の再確認**: ツールの観測は「そのツールが名乗った身元での応答」でしかない。
**「無かった」という否定的観測はとくに危うい** —— 存在の確認は1回で足りるが、
不在の確認は「見えなかっただけ」かもしれないからである。
否定的観測を設計判断の根拠にするときは、必ず別の条件で裏を取る。

### 2. 「欠落」と「null」は別物 — `maxXRestrict` で踏んだ

`/ajax/novel/series/{id}` の `maxXRestrict`（配下エピソードの最大年齢制限）は、
該当なしのとき**キーが消えるのではなく `null` が入る**。

`z.number().int().optional()` は `undefined` は許すが `null` は弾く。
実 API から採った fixture でテストしていたため即座に落ちたが、
手書き fixture（キーを省略して書く）なら**本番で初めて壊れていた**。

対策として、null を返しうるフィールドは境界で `undefined` に正規化する:

```ts
const nullableInt = z
  .union([z.number().int(), z.null()])
  .optional()
  .transform((v) => (v === null ? undefined : v));
```

### 3. 同じ概念でもエンドポイントごとに形が違う

| 概念 | illust / novel | novel series |
|---|---|---|
| タグ | `{ tags: [{ tag, translation }] }` | **素の文字列配列** |
| 画像 | `urls{thumb_mini,small,regular,original}` | `cover.urls{128x128,240mw,480mw,1200x1200,original}` |

**共通スキーマを1つ書いて使い回そうとしてはいけない。**
「同じはず」という推測が最も危険で、エンドポイントごとに実測してから書く。

### 4. 数値フラグの取りうる値を勝手に2値と決めない

`aiType` を「2 なら AI 使用、それ以外は不使用」と実装していたが、
シリーズの実データで **`aiType: 1`** が出てきた。
正しくは 0=未設定 / 1=AI 不使用 / 2=AI 使用 の3値である。

2値と決めつけると **0（未設定）を「AI 不使用」と断定する**ことになる。
`unknown` を表現できるドメイン型（`"no" | "yes" | "unknown"`）を用意しておけば、
判明した時点で正しく倒せる。

### 5. スキーマは「消費するフィールドだけ」書き、必須は最小限にする

pixiv の応答は巨大で、9割は使わない。全部書くと上流の変更に過剰反応して落ちる。

- 実際に読むフィールドだけ記述する（未知のフィールドは zod が黙って落とす）
- 必須にするのは、欠けたら意味をなさないものだけ
  （`xRestrict` は必須 —— 欠けたまま展開すると年齢ゲートが機能しない）
- 検証失敗は例外ではなく `parse_error` として扱い、後段の経路へフォールバックさせる

### 6. `exactOptionalPropertyTypes` 下では `{ x: undefined }` を作れない

`tsconfig` で `exactOptionalPropertyTypes: true` を有効にしていると、
省略可能プロパティに `undefined` を**代入**できない（省略とは別物として扱われる）。

上流の欠損値をドメインへ流すたびに衝突するので、ヘルパを1つ用意して通す:

```ts
function compact<T extends object>(obj: T): { [K in keyof T]?: NonNullable<T[K]> } { ... }
// 使用: { ...compact({ description: body.description, createdAt: body.createDate }) }
```

## 適用条件

- 非公開 API・OpenAPI 仕様の無い上流に対してスキーマを書くとき
- 実 API から fixture を採取できる状況（採れるなら必ず採る）
- 年齢制限など「間違うと安全性に直結する」フィールドを扱うとき

## 関連

- [[design-phase-spike-and-numbering]] — 「却下理由こそ実測対象」。
  本記事はその実装版で、**フィールドの型と値域も実測対象**であるという話
- `docs/adr/0003-source-fallback-chain.md`「404 の取り扱い」 —
  エンドポイントごとに 404 の意味が違うという、同種の「同じはず」の罠
