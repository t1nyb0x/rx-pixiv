import { Agent, request as undiciRequest, type Dispatcher } from "undici";

import { NODE_TIMER_MAX_MS } from "#config/constants";
import type { AppEnv } from "#config/env";
import type { FetchError } from "#core/models/errors";
import { err, ok, type Result } from "#core/models/Result";
import type { HttpRequest, HttpResponse, IHttpClient } from "#core/ports/IHttpClient";
import { RateLimiter } from "#infrastructure/http/RateLimiter";

export interface HttpClientOptions {
  readonly dispatcher?: Dispatcher;
  readonly userAgent?: string;
  readonly timeoutMs?: number;
  readonly retryDelayMs?: number;
  readonly jitterMs?: () => number;
  readonly rateLimiter?: RateLimiter;
  /** メタデータ応答本文の上限。巨大・終端なし応答によるメモリ枯渇を防ぐ。 */
  readonly maxBodyBytes?: number;
}

export class HttpClient implements IHttpClient {
  readonly #dispatcher: Dispatcher;
  readonly #ownedAgent: Agent | undefined;
  readonly #userAgent: string;
  readonly #timeoutMs: number;
  readonly #retryDelayMs: number;
  readonly #jitterMs: () => number;
  readonly #rateLimiter: RateLimiter;
  readonly #maxBodyBytes: number;

  public constructor(options: HttpClientOptions = {}) {
    const agent = options.dispatcher === undefined ? new Agent() : undefined;
    this.#dispatcher = options.dispatcher ?? agent!;
    this.#ownedAgent = agent;
    this.#userAgent = options.userAgent ?? "rx-pixiv/0.1";
    this.#timeoutMs = options.timeoutMs ?? 3_000;
    this.#retryDelayMs = options.retryDelayMs ?? 250;
    this.#jitterMs = options.jitterMs ?? (() => Math.floor(Math.random() * 101));
    this.#rateLimiter = options.rateLimiter ?? RateLimiter.forPixiv();
    this.#maxBodyBytes = options.maxBodyBytes ?? 1_048_576;

    validateTimer("timeoutMs", this.#timeoutMs, false);
    validateTimer("retryDelayMs", this.#retryDelayMs, true);
    if (!Number.isSafeInteger(this.#maxBodyBytes) || this.#maxBodyBytes <= 0) {
      throw new RangeError("maxBodyBytes must be a positive safe integer");
    }
  }

  public static fromEnv(
    env: Pick<AppEnv, "SOURCE_TIMEOUT_MS" | "PIXIV_RPS">,
    options: Omit<HttpClientOptions, "timeoutMs" | "rateLimiter"> = {},
  ): HttpClient {
    return new HttpClient({
      ...options,
      timeoutMs: env.SOURCE_TIMEOUT_MS,
      rateLimiter: RateLimiter.forPixiv(env.PIXIV_RPS),
    });
  }

  public async request(request: HttpRequest): Promise<Result<HttpResponse, FetchError>> {
    if (request.signal.aborted) return err({ kind: "timeout" });

    let hostname: string;
    try {
      hostname = new URL(request.url).hostname;
    } catch {
      return err({ kind: "network", cause: "invalid request URL" });
    }
    return this.#attempt(request, hostname, false);
  }

  async #attempt(
    request: HttpRequest,
    hostname: string,
    alreadyRetried: boolean,
  ): Promise<Result<HttpResponse, FetchError>> {
    try {
      await this.#rateLimiter.acquire(hostname, request.signal);
    } catch {
      return err({ kind: "timeout" });
    }

    const result = await this.#requestOnce(request);
    if (result.ok || !isRetryable(result.error) || alreadyRetried) return result;

    const jitterMs = this.#jitterMs();
    validateTimer("jitterMs", jitterMs, true);
    const totalDelayMs = this.#retryDelayMs + jitterMs;
    validateTimer("retryDelayMs + jitterMs", totalDelayMs, true);
    const completed = await delay(totalDelayMs, request.signal);
    return completed ? this.#attempt(request, hostname, true) : err({ kind: "timeout" });
  }

  public async close(): Promise<void> {
    await this.#ownedAgent?.close();
  }

  async #requestOnce(request: HttpRequest): Promise<Result<HttpResponse, FetchError>> {
    if (request.signal.aborted) return err({ kind: "timeout" });

    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () => timeoutController.abort(new DOMException("Request timed out", "TimeoutError")),
      this.#timeoutMs,
    );
    const signal = AbortSignal.any([request.signal, timeoutController.signal]);

    try {
      const response = await undiciRequest(request.url, {
        method: request.method ?? "GET",
        headers: withUserAgent(request.headers, this.#userAgent),
        signal,
        dispatcher: this.#dispatcher,
      });
      if (response.statusCode === 404) {
        response.body.destroy();
        return err({ kind: "not_found" });
      }
      if (response.statusCode === 429) {
        response.body.destroy();
        const retryAfterMs = parseRetryAfter(response.headers["retry-after"]);
        return retryAfterMs === undefined
          ? err({ kind: "rate_limited" })
          : err({ kind: "rate_limited", retryAfterMs });
      }
      if (response.statusCode >= 500) {
        response.body.destroy();
        return err({ kind: "upstream_5xx", status: response.statusCode });
      }

      // 認証要求という安全上の証拠は、本文のサイズ・終端状態より先に確定する。
      // source層はstatusだけで auth_required へ写像できるため本文を保持しない。
      if (response.statusCode === 401 || response.statusCode === 403) {
        response.body.destroy();
        return ok({
          status: response.statusCode,
          headers: normalizeHeaders(response.headers),
          body: "",
        });
      }

      const contentLength = parseContentLength(response.headers["content-length"]);
      if (contentLength !== undefined && contentLength > this.#maxBodyBytes) {
        response.body.destroy();
        return err({ kind: "parse_error", sample: "response body exceeds size limit" });
      }

      const body = await readBody(response.body, this.#maxBodyBytes);
      if (body === undefined) {
        return err({ kind: "parse_error", sample: "response body exceeds size limit" });
      }

      return ok({
        status: response.statusCode,
        headers: normalizeHeaders(response.headers),
        body,
      });
    } catch (error) {
      if (signal.aborted) return err({ kind: "timeout" });
      return err({ kind: "network", cause: errorMessage(error) });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseContentLength(value: string | readonly string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

async function readBody(
  body: AsyncIterable<Uint8Array> & { destroy(): void },
  maxBytes: number,
): Promise<string | undefined> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      body.destroy();
      return undefined;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isRetryable(error: FetchError): boolean {
  return error.kind === "network" || error.kind === "upstream_5xx";
}

function withUserAgent(
  headers: Readonly<Record<string, string>> | undefined,
  userAgent: string,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    normalized[name.toLowerCase()] = value;
  }
  normalized["user-agent"] ??= userAgent;
  return normalized;
}

function normalizeHeaders(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) {
      normalized[name] = typeof value === "string" ? value : value.join(", ");
    }
  }
  return normalized;
}

function parseRetryAfter(value: string | readonly string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return undefined;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);

  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function delay(delayMs: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateTimer(name: string, value: number, allowZero: boolean): void {
  if (
    !Number.isSafeInteger(value) ||
    value > NODE_TIMER_MAX_MS ||
    (allowZero ? value < 0 : value <= 0)
  ) {
    throw new RangeError(`${name} must be ${allowZero ? "non-negative" : "positive"}`);
  }
}
