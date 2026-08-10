import type { FetchError } from "#core/models/errors";
import type { PixivRef } from "#core/models/PixivRef";
import type { PixivWork } from "#core/models/PixivWork";
import { err, ok, type Result } from "#core/models/Result";
import type { FetchContext, IPixivSource } from "#core/ports/IPixivSource";
import type { IWorkCache } from "#core/ports/IWorkCache";

export interface IShortlinkResolver {
  resolve(
    ref: Extract<PixivRef, { kind: "shortlink" }>,
    signal: AbortSignal,
  ): Promise<Result<PixivRef, FetchError>>;
}

export interface WorkResolverOptions {
  readonly source: IPixivSource;
  readonly cache: IWorkCache;
  readonly shortlinkResolver?: IShortlinkResolver;
  /** 1 URL あたりの総予算（ADR 0003）。省略時は呼び出し側の signal に従う。 */
  readonly totalBudgetMs?: number;
}

/**
 * 参照1件を作品へ解決する。
 *
 * キャッシュ参照 → 短縮 URL の解決 → 取得経路の連鎖 → キャッシュ書き込み。
 * 総予算の管理もここで行い、経路側は渡された `signal` に従うだけでよい。
 */
export class WorkResolver {
  readonly #source: IPixivSource;
  readonly #cache: IWorkCache;
  readonly #shortlinkResolver: IShortlinkResolver | undefined;
  readonly #totalBudgetMs: number | undefined;

  public constructor(options: WorkResolverOptions) {
    this.#source = options.source;
    this.#cache = options.cache;
    this.#shortlinkResolver = options.shortlinkResolver;
    this.#totalBudgetMs = options.totalBudgetMs;
  }

  public async resolve(ref: PixivRef, signal: AbortSignal): Promise<Result<PixivWork, FetchError>> {
    const budgetSignal =
      this.#totalBudgetMs === undefined
        ? signal
        : AbortSignal.any([signal, AbortSignal.timeout(this.#totalBudgetMs)]);

    const resolvedRef = await this.#resolveShortlink(ref, budgetSignal);
    if (!resolvedRef.ok) return resolvedRef;

    const target = resolvedRef.value;

    const cached = await this.#cache.get(target);
    if (cached !== undefined) return cached;

    const context: FetchContext = { signal: budgetSignal };
    const result = await this.#source.fetch(target, context);

    // 作品の不在だけをネガティブキャッシュする。
    // 一時的な失敗（レート制限・タイムアウト）を焼き付けない。
    if (result.ok) await this.#cache.set(target, ok(result.value));
    else if (result.error.kind === "not_found") await this.#cache.set(target, err(result.error));

    return result;
  }

  async #resolveShortlink(
    ref: PixivRef,
    signal: AbortSignal,
  ): Promise<Result<PixivRef, FetchError>> {
    if (ref.kind !== "shortlink") return ok(ref);
    if (this.#shortlinkResolver === undefined) {
      return err({ kind: "unsupported", reason: "capability" });
    }
    return this.#shortlinkResolver.resolve(ref, signal);
  }
}
