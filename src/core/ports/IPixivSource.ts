import type { ContentRating } from "#core/models/ContentRating";
import type { FetchError } from "#core/models/errors";
import type { PixivRef } from "#core/models/PixivRef";
import type { PixivWork, SourceName } from "#core/models/PixivWork";
import type { Result } from "#core/models/Result";

export interface SourceCapabilities {
  readonly supportedKinds: readonly PixivRef["kind"][];
  readonly ratingAuthority: "authoritative" | "inferred" | "unknown";
  readonly multiPage: boolean;
}

export interface FetchContext {
  readonly signal: AbortSignal;
  readonly ratingHint?: Partial<ContentRating>;
}

export interface IPixivSource {
  readonly name: SourceName;
  readonly capabilities: SourceCapabilities;
  supports(ref: PixivRef): boolean;
  fetch(ref: PixivRef, context: FetchContext): Promise<Result<PixivWork, FetchError>>;
}
