import type { AppEnv } from "#config/env";
import type { FetchError } from "#core/models/errors";
import type { PixivRef } from "#core/models/PixivRef";
import type { PixivWork, SourceName } from "#core/models/PixivWork";
import { err, type Result } from "#core/models/Result";
import type { FetchContext, IPixivSource, SourceCapabilities } from "#core/ports/IPixivSource";
import { CircuitBreaker, classifyFetchError } from "#infrastructure/http/CircuitBreaker";

export class CircuitProtectedSource implements IPixivSource {
  public constructor(
    readonly inner: IPixivSource,
    readonly breaker: CircuitBreaker = new CircuitBreaker(),
  ) {}

  public static fromEnv(
    inner: IPixivSource,
    env: Pick<AppEnv, "CIRCUIT_FAILURE_THRESHOLD" | "CIRCUIT_OPEN_MS">,
  ): CircuitProtectedSource {
    return new CircuitProtectedSource(
      inner,
      new CircuitBreaker({
        failureThreshold: env.CIRCUIT_FAILURE_THRESHOLD,
        openMs: env.CIRCUIT_OPEN_MS,
      }),
    );
  }

  public get name(): SourceName {
    return this.inner.name;
  }

  public get capabilities(): SourceCapabilities {
    return this.inner.capabilities;
  }

  public supports(ref: PixivRef): boolean {
    return this.inner.supports(ref);
  }

  public async fetch(ref: PixivRef, context: FetchContext): Promise<Result<PixivWork, FetchError>> {
    if (context.signal.aborted) return err({ kind: "timeout" });

    return this.breaker.execute(
      () => this.inner.fetch(ref, context),
      (error) =>
        error.kind === "timeout" && context.signal.aborted ? "neutral" : classifyFetchError(error),
    );
  }
}
