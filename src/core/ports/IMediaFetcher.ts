import type { FetchError } from "#core/models/errors";
import type { Result } from "#core/models/Result";

export type MediaFetchResult =
  | {
      readonly kind: "bytes";
      readonly bytes: Uint8Array;
      readonly contentType: string;
      readonly filename?: string;
    }
  | { readonly kind: "url"; readonly url: string };

export interface MediaFetchRequest {
  readonly url: string;
  readonly signal: AbortSignal;
  readonly maxBytes?: number;
}

export interface IMediaFetcher {
  fetch(request: MediaFetchRequest): Promise<Result<MediaFetchResult, FetchError>>;
}
