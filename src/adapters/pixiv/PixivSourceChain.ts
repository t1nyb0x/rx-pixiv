import type { FetchError } from "#core/models/errors";
import type { PixivRef } from "#core/models/PixivRef";
import { mergeWorks, type PixivWork, type SourceName } from "#core/models/PixivWork";
import { err, ok, type Result } from "#core/models/Result";
import type { FetchContext, IPixivSource, SourceCapabilities } from "#core/ports/IPixivSource";

export interface PixivSourceChainOptions {
  readonly sources: readonly IPixivSource[];
  /** 1経路あたりの上限。総予算とあわせて `AbortSignal.any` で打ち切る。 */
  readonly sourceTimeoutMs?: number;
  readonly onSourceResult?: (event: SourceAttempt) => void;
}

export interface SourceAttempt {
  readonly source: SourceName;
  readonly outcome: "success" | "failure" | "skipped";
  readonly error?: FetchError;
}

/**
 * 取得経路の多段フォールバック（ADR 0003）。
 *
 * 素朴な「最初に成功した経路を採用」では足りない。経路ごとに持っている情報が違い、
 * とくに R-18 では Ajax が権威ある年齢区分を持つ一方で画像を持たず、
 * phixiv が画像を持つ一方で年齢区分の権威を持たない。
 * したがって**各段の結果を蓄積して補完マージ**し、「十分」になった時点で打ち切る。
 */
export class PixivSourceChain implements IPixivSource {
  public readonly name: SourceName = "ajax";

  readonly #sources: readonly IPixivSource[];
  readonly #sourceTimeoutMs: number | undefined;
  readonly #onSourceResult: ((event: SourceAttempt) => void) | undefined;

  public constructor(options: PixivSourceChainOptions) {
    this.#sources = options.sources;
    this.#sourceTimeoutMs = options.sourceTimeoutMs;
    this.#onSourceResult = options.onSourceResult;
  }

  public get capabilities(): SourceCapabilities {
    const kinds = new Set<PixivRef["kind"]>();
    let multiPage = false;
    let authority: SourceCapabilities["ratingAuthority"] = "unknown";

    for (const source of this.#sources) {
      for (const kind of source.capabilities.supportedKinds) kinds.add(kind);
      multiPage ||= source.capabilities.multiPage;
      if (source.capabilities.ratingAuthority === "authoritative") authority = "authoritative";
      else if (authority !== "authoritative" && source.capabilities.ratingAuthority === "inferred")
        authority = "inferred";
    }

    return { supportedKinds: [...kinds], ratingAuthority: authority, multiPage };
  }

  public supports(ref: PixivRef): boolean {
    return this.#sources.some((source) => source.supports(ref));
  }

  public async fetch(ref: PixivRef, context: FetchContext): Promise<Result<PixivWork, FetchError>> {
    let accumulated: PixivWork | undefined;
    let ratingHint = context.ratingHint;
    let lastError: FetchError = { kind: "unsupported", reason: "capability" };

    for (const source of this.#sources) {
      if (!source.supports(ref)) {
        this.#onSourceResult?.({ source: source.name, outcome: "skipped" });
        continue;
      }

      // 総予算が尽きていれば次の経路を起動しない（ADR 0003）。
      if (context.signal.aborted) {
        this.#onSourceResult?.({ source: source.name, outcome: "skipped" });
        break;
      }

      // 逐次であることがこの連鎖の本質である。前段の結果（年齢ヒント・蓄積した作品）が
      // 次段の入力になり、「十分」になれば後段を叩かない。並列化すると
      // 打ち切りが効かず、上流への不要なリクエストが増える。
      // eslint-disable-next-line no-await-in-loop
      const result = await source.fetch(ref, this.#contextFor(context, ratingHint));

      if (!result.ok) {
        lastError = result.error;
        this.#onSourceResult?.({
          source: source.name,
          outcome: "failure",
          error: result.error,
        });

        // 権威ある不在。後段に問い合わせても古いカードが出るだけで害になる。
        if (result.error.kind === "not_found") return err(result.error);

        // 弾かれた事実自体が年齢制限の証拠になる（予備の推定経路）。
        if (result.error.kind === "auth_required") {
          ratingHint = Object.assign({}, ratingHint, {
            level: "r18" as const,
            confidence: "inferred" as const,
          });
        }
        continue;
      }

      this.#onSourceResult?.({ source: source.name, outcome: "success" });
      accumulated =
        accumulated === undefined ? result.value : mergeWorks(accumulated, result.value);
      ratingHint = accumulated.rating;

      if (isSufficient(accumulated)) break;
    }

    return accumulated === undefined ? err(lastError) : ok(accumulated);
  }

  #contextFor(context: FetchContext, ratingHint: FetchContext["ratingHint"]): FetchContext {
    const signal =
      this.#sourceTimeoutMs === undefined
        ? context.signal
        : AbortSignal.any([context.signal, AbortSignal.timeout(this.#sourceTimeoutMs)]);

    return ratingHint === undefined ? { signal } : { signal, ratingHint };
  }
}

/**
 * これ以上の経路を試す必要が無いか。
 *
 * 画像の欠落が起きるのはイラスト経路だけなので、他の種別は最初の成功で足りる。
 */
export function isSufficient(work: PixivWork): boolean {
  if (work.kind !== "illust") return true;
  return work.rating.confidence === "authoritative" && work.pages.length > 0;
}
