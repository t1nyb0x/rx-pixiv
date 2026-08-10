import { createClient, type RedisClientType } from "redis";

export interface RedisConnectionOptions {
  readonly url: string;
  readonly onError?: (error: unknown) => void;
  /** 接続確立の上限。**起動をブロックさせない**ための値（既定 3 秒）。 */
  readonly connectTimeoutMs?: number;
  /** 再接続の間隔（ミリ秒）。既定 5 秒。 */
  readonly reconnectDelayMs?: number;
}

/**
 * Redis クライアントの薄い包み（ADR 0016）。
 *
 * **接続できなくても起動は続行する。** Discord には接続するが、禁止・展開拒否を
 * 読めない間は既定でゲートがフェイルクローズし、`/readyz` が 503 を返す。
 */
export class RedisConnection {
  readonly #client: RedisClientType;
  readonly #connectBudgetMs: number;
  #ready = false;

  public constructor(options: RedisConnectionOptions) {
    const reconnectDelayMs = options.reconnectDelayMs ?? 5_000;
    this.#connectBudgetMs = options.connectTimeoutMs ?? 3_000;
    this.#client = createClient({
      url: options.url,
      socket: {
        connectTimeout: options.connectTimeoutMs ?? 3_000,
        // 一定間隔で再接続を試み続ける。諦めると復旧を検知できない。
        reconnectStrategy: () => reconnectDelayMs,
      },
    }) as RedisClientType;
    this.#client.on("error", (error: unknown) => {
      this.#ready = false;
      options.onError?.(error);
    });
    this.#client.on("ready", () => {
      this.#ready = true;
    });
    this.#client.on("end", () => {
      this.#ready = false;
    });
  }

  public get client(): RedisClientType {
    return this.#client;
  }

  public get isReady(): boolean {
    return this.#ready;
  }

  /**
   * 接続を試みる。**失敗しても例外を投げず、起動を止めない**（ADR 0016）。
   *
   * 再接続戦略を設定していると `connect()` は再試行を続けて**解決しない**。
   * そのまま `await` すると起動がブロックされるため、待つのは初回の予算までにし、
   * **再試行はバックグラウンドへ流す**。
   *
   * 失敗時は `isReady` が false のままになり、ゲートがフェイルクローズし、
   * `/readyz` が 503 を返す。復旧は再接続が検知する。
   */
  public async connect(): Promise<boolean> {
    // 解決しないまま残りうるので、未処理の拒否にしないよう受けておく。
    const attempt = this.#client.connect().then(
      () => true,
      () => false,
    );

    const budget = new Promise<false>((resolve) => {
      const timer = setTimeout(() => resolve(false), this.#connectBudgetMs);
      timer.unref?.();
    });

    return await Promise.race([attempt, budget]);
  }

  public async close(): Promise<void> {
    try {
      await this.#client.close();
    } catch {
      // 切断時の失敗は無視する。終了処理を止める理由がない。
    }
  }
}
