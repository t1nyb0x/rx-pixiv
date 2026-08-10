export interface PreloadableRepository {
  preload(): Promise<void>;
}

export interface RedisPreloaderOptions {
  readonly repositories: readonly PreloadableRepository[];
  readonly onSuccess?: () => void;
  readonly onError?: (error: unknown) => void;
}

/** ban/blockのpreload完了を、Redis readinessとは別に追跡する。 */
export class RedisPreloader {
  readonly #options: RedisPreloaderOptions;
  #ready = false;
  #generation = 0;
  #inFlight: { readonly generation: number; readonly promise: Promise<boolean> } | undefined;

  public constructor(options: RedisPreloaderOptions) {
    this.#options = options;
  }

  public get isReady(): boolean {
    return this.#ready;
  }

  public markDisconnected(): void {
    this.#ready = false;
    this.#generation += 1;
  }

  public preload(): Promise<boolean> {
    const generation = this.#generation;
    if (this.#inFlight !== undefined) {
      if (this.#inFlight.generation === generation) return this.#inFlight.promise;
      // 切断前の古いpreloadが残っている。終了後に現世代を必ず読み直す。
      return this.#inFlight.promise.then(() =>
        this.#generation === generation ? this.preload() : false,
      );
    }
    this.#ready = false;
    const promise = Promise.all(
      this.#options.repositories.map((repository) => repository.preload()),
    )
      .then(() => {
        if (this.#generation !== generation) return false;
        this.#ready = true;
        this.#options.onSuccess?.();
        return true;
      })
      .catch((error: unknown) => {
        this.#options.onError?.(error);
        return false;
      })
      .finally(() => {
        if (this.#inFlight?.generation === generation) this.#inFlight = undefined;
      });
    this.#inFlight = { generation, promise };
    return promise;
  }
}
