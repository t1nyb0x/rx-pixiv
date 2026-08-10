import type { FetchError } from "#core/models/errors";
import type { Result } from "#core/models/Result";

export interface HttpRequest {
  readonly url: string;
  readonly method?: "GET" | "HEAD";
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface IHttpClient {
  request(request: HttpRequest): Promise<Result<HttpResponse, FetchError>>;
}
