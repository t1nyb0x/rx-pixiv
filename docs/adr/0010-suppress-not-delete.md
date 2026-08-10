# ADR 0010: 元メッセージは削除せず埋め込み抑制のみ行う

- Status: Accepted
- Date: 2026-08-10
- Issue: -

## Context

貼られた URL を Bot が展開するとき、元の投稿をどう扱うかで兄弟2本は分かれている。

- **rx-instagram**: `message.delete()` で**利用者のメッセージを削除**し、
  Bot が Embed を投稿し直す（`Manage Messages` 権限が必要）
- **rx-twitter**: `message.suppressEmbeds(true)` で元の貧弱なプレビューを抑制し、
  リプライで展開する

pixiv の URL を Discord に貼ったときに出るプレビューは、タイトルと pixiv のロゴ程度で
実質的に無価値であり、抑制しても失うものはない。

## Decision

**元メッセージを削除しない。`message.suppressEmbeds(true)` ＋ リプライで展開する。**

- 1件以上を展開した場合にのみ `suppressEmbeds` を呼ぶ
- `Manage Messages` 権限が無く抑制に失敗しても、**展開自体は続行する**。
  権限不足で機能全体を落とさない
- Bot の返信 ID を元メッセージ ID に紐づけて保持し、
  元メッセージが削除されたら Bot の返信も削除する
  （プロセス内保持のため再起動で失われる。[ADR 0008](0008-in-memory-cache.md) で許容済み）

## Consequences

### Positive

- 利用者のコメントと投稿者情報が保たれる。「誰が何と言って貼ったか」が消えない
- スレッドや引用の文脈が壊れない
- `Manage Messages` 権限が必須でなくなり、Bot の要求権限が減る
- 削除→再投稿による通知の二重発火や、投稿順の入れ替わりが起きない

### Negative

- タイムラインに元メッセージと Bot の返信の2つが並ぶ。rx-instagram より縦に長くなる
- `suppressEmbeds` にも `Manage Messages` が要るため、権限が無い環境では
  pixiv の貧弱なプレビューが残ったまま Bot の展開が下に付く（二重に見える）

### Mitigation

- リプライは `allowedMentions: { repliedUser: false }` で送り、通知の煩わしさを減らす
- 権限不足時の見え方は README に明記し、`Manage Messages` を推奨権限として案内する
  （必須ではなく推奨）

## Rejected alternatives

### rx-instagram に倣って元メッセージを削除する

- 利用者のコメント（「これ好き」等）が一緒に消える。**著者性を破壊する**
- スレッド内では文脈が追えなくなる
- `Manage Messages` が必須になり、要求権限が増える
- 削除が失敗したとき（権限不足・既に削除済み）の分岐が増える

利用者から見て「勝手に消された」と感じられる挙動であり、
得られるのは縦の短さだけである。割に合わない。

### 何もしない（元のプレビューを残す）

pixiv のプレビューと Bot の展開が二重に表示され、単に見づらい。
抑制できる環境では抑制するのが素直である。
