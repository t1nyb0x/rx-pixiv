# ADR 0004: エラーモデルに判別可能な Result 型を採用する

- Status: Accepted
- Date: 2026-08-10
- Issue: -

## Context

取得失敗の表現方法として、兄弟2本は異なる選択をしている。

- **rx-instagram**: 例外を投げず、`title: 'Instagram'` というセンチネル値を持つ
  フォールバックオブジェクトを返す。呼び出し側は
  `if (!data.title || data.title === 'Instagram')` で失敗を検出する
- **rx-twitter**: `Promise<Tweet | undefined>` を返し、フォールバック判断のために
  `error instanceof VxTwitterServerError` を見る

rx-pixiv では、失敗の**種類**が下流の挙動を直接変える。

| 失敗の種類 | 期待される挙動 |
|---|---|
| 作品が存在しない（404） | 連鎖を打ち切り、「見つかりません」を表示 |
| 年齢制限で弾かれた | **年齢制限作品であることの証拠**として扱い、連鎖を続行 |
| レート制限 | サーキットを開き、リトライせず続行 |
| ネットワーク断 | 1回リトライして続行 |
| スキーマ検証失敗 | 続行し、生レスポンス断片をログへ |

とくに「年齢制限で弾かれた」と「単に落ちた」の区別は、
[ADR 0006](0006-age-restricted-content.md) のフェイルクローズ判定に不可欠である。
この2つを区別できない設計では、要件 FR-4 の縮退経路が実装できない。

## Decision

取得関数を**全関数**とし、判別可能な `Result` 型で結果を返す。

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

type FetchError =
  | { kind: "not_found" }
  | { kind: "auth_required" }
  | { kind: "rate_limited"; retryAfterMs?: number }
  | { kind: "upstream_5xx"; status: number }
  | { kind: "timeout" }
  | { kind: "network"; cause: string }
  | { kind: "parse_error"; sample?: string }
  | { kind: "unsupported"; reason: "capability" | "circuit_open" };
```

- `IPixivSource.fetch` は**想定内の失敗で例外を投げない**
- 例外を投げるのは**プログラマエラーのときだけ**。
  zod の検証失敗は `parse_error`（外部データは間違っていて当然）、
  null 参照は throw（それは我々のバグ）
- 連鎖の分岐は `kind` に対する閉じた `switch` で書く

## Consequences

### Positive

- 失敗の種類が型に現れるため、呼び出し側で取り違えようがない
- `FetchError` に新しい `kind` を足すと、**分岐を書いたすべての箇所がコンパイルエラーになる**。
  対応漏れが型検査で見つかる
- `auth_required` を第一級の値として扱えるので、年齢ヒントの伝播（ADR 0003）が素直に書ける
- 例外の伝播経路を追う必要がなく、制御フローが読める

### Negative

- 呼び出し側に `if (!result.ok)` の分岐が増える。素朴な throw / catch より記述が冗長になる
- `Result` を剥がし忘れると型エラーになるため、書き始めの摩擦がある
- TypeScript には `Result` の標準がなく、自前定義になる（`neverthrow` 等は導入しない）

### Mitigation

- `Result` は `core/models/Result.ts` の20行程度に留め、
  ライブラリを導入しない。`ok` / `err` の2つのコンストラクタ関数だけ用意する
- モナド的なチェーン API（`map` / `andThen`）は**作らない**。
  素の `if` と `switch` で書くほうが、この規模では読みやすい

## Rejected alternatives

### rx-instagram 式のセンチネルオブジェクト

呼び出し側で型として区別できない。「投稿が削除された」「ネットワークが落ちた」
「認証が要る」がすべて同じ形の値になり、
**本 ADR の Context に挙げた5つの挙動を書き分けられない**。
加えて、センチネル値（`title === 'Instagram'`）は
正当なデータと衝突しうる（タイトルが本当に "Instagram" の投稿）。

### rx-twitter 式の `T | undefined` ＋ 例外クラスの `instanceof` 判定

「作品が無い」と「アダプタが壊れた」が同じ `undefined` に潰れる。
そのため実際にフォールバック判断を例外クラスの `instanceof` で行うことになっており、
これは**型システムが運ぶべき情報を運べていない**兆候である。
同じ形を選んで同じ問題を引き受ける理由がない。

### 例外で表現する（catch で分岐）

例外は「起きてはならないこと」の表現に留めたい。
上流のレート制限や 404 は**想定内の日常**であり、例外にすると
try/catch が制御フローの一部になって読めなくなる。
また、どの関数がどの例外を投げるかが型に現れない。

### `neverthrow` 等のライブラリを導入する

機能は十分だが、この規模で必要なのは `Result` 型の定義20行だけである。
依存を1つ増やし、チェーン API という別の学習対象を持ち込む価値がない。
