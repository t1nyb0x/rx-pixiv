export interface Limit {
  <T>(task: () => PromiseLike<T> | T): Promise<T>;
  readonly activeCount: number;
  readonly pendingCount: number;
}

export function pLimit(concurrency: number): Limit {
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new RangeError("concurrency must be a positive integer");
  }

  let activeCount = 0;
  const queue: Array<() => void> = [];

  const runNext = () => {
    if (activeCount >= concurrency) return;
    queue.shift()?.();
  };

  const limit = <T>(task: () => PromiseLike<T> | T): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        activeCount += 1;
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            activeCount -= 1;
            runNext();
          });
      };

      queue.push(run);
      runNext();
    });

  Object.defineProperties(limit, {
    activeCount: { get: () => activeCount },
    pendingCount: { get: () => queue.length },
  });

  return limit as Limit;
}
