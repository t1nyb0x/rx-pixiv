import type { z } from "zod";

import type { FetchError } from "#core/models/errors";
import type { PixivRef } from "#core/models/PixivRef";
import type { PixivWork, SourceName } from "#core/models/PixivWork";
import { err, ok, type Result } from "#core/models/Result";
import type { HttpRequest, IHttpClient } from "#core/ports/IHttpClient";
import type { FetchContext, IPixivSource, SourceCapabilities } from "#core/ports/IPixivSource";

/** 解析失敗時にログへ残す生レスポンスの断片の長さ。 */
const PARSE_ERROR_SAMPLE_LENGTH = 200;

export interface BasePixivSourceOptions {
  readonly httpClient: IHttpClient;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * 取得経路の共通土台。
 *
 * HTTP・JSON 解析・スキーマ検証を1箇所に集め、各ソースは
 * 「どの URL を叩き、結果をどう `PixivWork` へ写像するか」だけに集中する。
 *
 * **例外は投げない。** 想定内の失敗はすべて `Result` の `err` として返す（ADR 0004）。
 */
export abstract class BasePixivSource implements IPixivSource {
  protected readonly httpClient: IHttpClient;
  readonly #headers: Readonly<Record<string, string>>;

  protected constructor(options: BasePixivSourceOptions) {
    this.httpClient = options.httpClient;
    this.#headers = options.headers ?? {};
  }

  public abstract readonly name: SourceName;
  public abstract readonly capabilities: SourceCapabilities;

  public supports(ref: PixivRef): boolean {
    return this.capabilities.supportedKinds.includes(ref.kind);
  }

  public abstract fetch(
    ref: PixivRef,
    context: FetchContext,
  ): Promise<Result<PixivWork, FetchError>>;

  /**
   * 本文をそのまま取得する（HTML 経路用）。
   *
   * `getJson` と同じく、HTTP レイヤの失敗はそのまま透過する。
   */
  protected async getText(url: string, context: FetchContext): Promise<Result<string, FetchError>> {
    const response = await this.httpClient.request({
      url,
      method: "GET",
      headers: this.#headers,
      signal: context.signal,
    });
    if (!response.ok) return response;
    return ok(response.value.body);
  }

  /**
   * JSON を取得し、スキーマで検証して返す。
   *
   * HTTP レイヤの失敗（`not_found` / `rate_limited` / `timeout` 等）は
   * **そのまま透過する**。404 の意味づけは呼び出し側の責務である
   * —— エンドポイントによって「作品が無い」と「画像が無い」に分かれるため（ADR 0003）。
   */
  protected async getJson<T>(
    url: string,
    schema: z.ZodType<T>,
    context: FetchContext,
  ): Promise<Result<T, FetchError>> {
    const request: HttpRequest = {
      url,
      method: "GET",
      headers: this.#headers,
      signal: context.signal,
    };

    const response = await this.httpClient.request(request);
    if (!response.ok) return response;

    let raw: unknown;
    try {
      raw = JSON.parse(response.value.body);
    } catch {
      return err(parseError(response.value.body));
    }

    const parsed = schema.safeParse(raw);
    if (!parsed.success) return err(parseError(response.value.body));

    return ok(parsed.data);
  }
}

function parseError(body: string): FetchError {
  return { kind: "parse_error", sample: body.slice(0, PARSE_ERROR_SAMPLE_LENGTH) };
}
