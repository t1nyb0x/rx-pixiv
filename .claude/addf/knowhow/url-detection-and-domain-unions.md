---
title: URL 検出とドメイン共用体は抑制範囲・正規化キー・閉集合を契約にする
created: 2026-08-10
last_verified: 2026-08-10
depends_on:
  - src/core/services/UrlDetector.ts
  - src/core/models/PixivRef.ts
  - src/core/models/PixivWork.ts
  - src/core/ports/IPixivSource.ts
status: active
---

# URL 検出とドメイン共用体は抑制範囲・正規化キー・閉集合を契約にする

## 発見した知見

### 抑制記法は削除ではなく同じ長さの空白へマスクする

コードフェンス、インラインコード、山括弧リンク、スポイラーを文字列から単純に削除すると、
前後の断片が連結して新しい URL 候補を作ることがある。改行を残し、それ以外を同じ長さの
空白へ置換してから候補を走査すると、元の順序と境界を保ったまま抑制範囲を除外できる。

### URL は正規表現だけで確定せず、構文解析後に経路を閉じる

一般 URL の候補を拾ったあと `URL` で解析し、完全一致する host、path、query の組み合わせだけを
`PixivRef` へ変換する。これにより `pixivision.net` のような類似ドメインや、pixiv.net 上の
未対応 route を同時に排除できる。異形 URL の重複排除には入力文字列ではなく
`kind + 正規化済み識別子` の安定キーを使い、最初の出現順を維持する。

### 参照種別には取得結果の到達先を必ず用意する

`PixivRef` に URL 種別を追加しただけでは、後続の source が返す `PixivWork` に写像できない。
検出対象を増やすときは、参照、取得結果、fixture、mapper、renderer の経路が最後まで閉じているかを
後続 Plan まで確認する。ユーザー最近作の画像と年齢区分のように対応関係が必要な値は、平行配列に
せず1要素の型へまとめる。

### 型の列挙テストは値を並べるだけでは閉集合を証明しない

`it.each<Union>([...])` は配列側が union の一部でも型検査を通るため、union への値追加を検出しない。
`expectTypeOf<Union>().toEqualTypeOf<...>()` で双方向の型同値を固定し、判別共用体は `switch` の
`never` 分岐も併用する。取得元の能力差も自由記述にせず、年齢判定の権威性・複数ページ対応・
対応種別を閉じた capabilities として公開する。

## プロジェクトへの適用

- URL 抑制範囲のマスク、正確な route 判定、正規化キーによる順序付き重複排除を維持する
- 新しい `PixivRef` を追加したら、対応する `PixivWork` と後続 Plan の fixture/mapper を同時に確認する
- 年齢区分など安全性に関わる union は型同値テストと `never` の両方で変更を検知する
- `IPixivSource.capabilities` は source 実装が実際に保証できる能力だけを宣言する

## 注意点・制約

- マスク処理は Markdown の完全な parser ではないため、対応する抑制記法をテーブルテストで明示する
- URL 上限は設定値が不正でも `NaN` や無限値を配列操作へ渡さないよう境界で正規化する
- `partial` は「取得経路が全情報を返したか」であり、年齢判定の確信度とは別の軸として扱う

## 参照

- `src/core/services/UrlDetector.ts`
- `src/core/models/PixivRef.ts`
- `src/core/models/PixivWork.ts`
- `src/core/ports/IPixivSource.ts`
- `tests/core/services/UrlDetector.test.ts`
- `tests/core/models/PixivWork.test.ts`
