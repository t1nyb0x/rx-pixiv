---
title: レンダラの能力差は安全な縮退で吸収する
created: 2026-08-11
last_verified: 2026-08-11
depends_on:
  - src/core/services/MessageComposer.ts
  - src/adapters/discord/ComponentsV2Renderer.ts
  - src/adapters/discord/EmbedRenderer.ts
  - src/adapters/discord/replyTracker.ts
status: active
---

# レンダラの能力差は安全な縮退で吸収する

## 発見した知見

同じ表示計画を複数のDiscordレンダラへ出すとき、機微情報を隠す能力は一致しない。
表現できないspoilerを近似せず、メディアとメタデータを削った安全な表示へ縮退する。
検証は内部フラグではなく、最終payloadに機微情報が存在しないことを負例で固定する。

また、表示本体と返信追跡では障害時の重要度が違う。追跡保存の失敗で表示を取り消さず、
元メッセージ削除との競合はtombstoneと原子的なadd-if-activeで閉じる。

## プロジェクトへの適用

- coreは `plain` / `spoiler` / `link_only` / `skip` の表示意図だけを持ち、SDK型を持たない
- rendererが外部画像をspoiler化できない場合、画像を平文表示せず定型文と正規URLへ縮退する
- `link_only` / `skip` では画像URLの選択・書換え自体を実行しない
- mention抑制やgallery/embed上限は、各rendererの最終payload境界で強制する
- 1つの元メッセージから複数返信を作る場合、返信追跡は単一値ではなくSetとして保持する
- 返信追跡の保存失敗は表示を取り消さず、補助機能だけを諦める

## 注意点・制約

同じ4つの安全シナリオを全rendererへ通し、`link_only` とspoiler縮退のpayloadに
タイトル、作者、タグ、サムネイルURLが無いことを文字列レベルでも検証する。
上限超過、追跡保存失敗、元メッセージ削除時の複数返信削除も境界テストにする。

- `link_only` の正規URLには `SuppressEmbeds` を付け、Discord自身のOGP展開も止める
- profile内の最近作はカード全体ではなくメディアごとのspoiler判定を保持する
- 削除失敗した返信IDは追跡集合から外さず、再試行や診断の手掛かりを失わない

## 参照

- `docs/adr/0009-components-v2-renderer.md`
- `docs/adr/0010-suppress-not-delete.md`
- `docs/adr/0016-redis-for-persistent-state.md`
- `src/core/services/MessageComposer.ts`
- `src/adapters/discord/ComponentsV2Renderer.ts`
- `src/adapters/discord/EmbedRenderer.ts`
- `src/adapters/discord/replyTracker.ts`
- `tests/adapters/discord/RenderingIntegration.test.ts`
- `tests/adapters/discord/replyTracker.test.ts`
