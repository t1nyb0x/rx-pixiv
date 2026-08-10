---
title: 上流保護は独立クラスではなく物理試行と論理経路へ合成する
created: 2026-08-10
last_verified: 2026-08-10
depends_on:
  - src/infrastructure/http/HttpClient.ts
  - src/infrastructure/http/RateLimiter.ts
  - src/infrastructure/http/CircuitBreaker.ts
  - src/infrastructure/http/CircuitProtectedSource.ts
  - src/infrastructure/cache/WorkCache.ts
status: active
---

# 上流保護は独立クラスではなく物理試行と論理経路へ合成する

## 発見した知見

### retry の内側で rate limit を数える

HTTP client が内部 retry を持つ場合、外側の decorator で rate limit を1回だけ掛けると、2回目の
物理リクエストが計数を迂回する。rate limiter は各 undici request の直前に置き、論理リクエストを
retryへ展開した後の全物理試行を対象にする。複数 source は limiter を内包した同じ client を共有し、
host単位のバケットを分断しない。

### circuit breaker は host ではなく論理経路を識別する

同じ `www.pixiv.net` でも Ajax source と OGP source は失敗モードが異なる。breaker は HTTP transport
だけでなく、source の取得・zod検証・写像全体を包む。これにより200応答後の `parse_error` も経路障害として
観測できる。429 は再試行せず即座に circuit を開き、404や認証要求は上流が応答できている証拠として
失敗数をリセットする。呼び出し側AbortSignalによるキャンセルはneutralとし、失敗数へ加えない。

### 時間窓は最初の失敗を基準にする

「60秒内に5失敗」は隣り合う失敗の間隔ではない。直前失敗との差で数えると、50秒ごとの失敗が
何分続いても蓄積してしまう。成功時にリセットし、最初の失敗時刻から窓を測る。半開は同時に1本だけを
許可し、その結果で閉じるか再度開く。

### Node timerへ入る値にはランタイム上限がある

Node.js の `setTimeout` は `2_147_483_647ms` を超える値を約1msへ丸める。正の数という検証だけでは、
「非常に長いtimeout」が即時timeoutへ反転する。環境schemaとconstructorの両方でsafe integerかつ
Node timer上限以下を保証し、retry delayとjitterの合計にも同じ検証を行う。

### キャッシュはTTLと容量が異なる用途ごとに分離する

作品6h/2000件、ユーザー1h/500件、不在10分/1000件を1つのMapへ押し込むと、短命な大量の不在結果が
長寿命の作品を追い出す。用途別のLRUを持ち、同じ正規化参照キーで検索する。参照時にrecencyを更新し、
negativeから成功へ回復したときは他用途の古い値を必ず削除してから格納する。

## プロジェクトへの適用

- source構築時は `HttpClient.fromEnv(env)` の1インスタンスを共有し、各sourceを
  `CircuitProtectedSource.fromEnv(source, env)` で包む
- MockAgentのpending interceptorを使い、rate待機中・circuit open中に物理通信しないことを検証する
- circuitのfailure分類を変える場合は429/404/timeoutの状態遷移を同時に更新する
- TTLや容量を設定化するときも、作品・ユーザー・不在の独立性を維持する

## 注意点・制約

- rate limit待ちには呼び出し元のAbortSignalを渡し、総時間予算が尽きた待機を残さない
- timeoutはrate limit待ちの後、物理HTTP試行ごとに開始する。論理全体の予算は上位signalが担当する
- circuit stateはプロセス内であり、複数インスタンス間では共有しない

## 参照

- `docs/adr/0011-rate-limit-and-circuit-breaker.md`
- `src/infrastructure/http/HttpClient.ts`
- `src/infrastructure/http/RateLimiter.ts`
- `src/infrastructure/http/CircuitBreaker.ts`
- `src/infrastructure/http/CircuitProtectedSource.ts`
- `src/infrastructure/cache/WorkCache.ts`
- `tests/infrastructure/http/HttpClient.test.ts`
