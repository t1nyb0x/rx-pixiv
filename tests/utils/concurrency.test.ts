import { describe, expect, it } from "vitest";

import { pLimit } from "#utils/concurrency";

describe("pLimit", () => {
  it("never exceeds the configured concurrency and drains in order", async () => {
    const limit = pLimit(2);
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    const started: number[] = [];
    const tasks = gates.map((gate, index) =>
      limit(async () => {
        started.push(index);
        await gate.promise;
        return index;
      }),
    );
    await Promise.resolve();

    expect(started).toEqual([0, 1]);
    expect(limit.activeCount).toBe(2);
    expect(limit.pendingCount).toBe(1);
    gates[0]!.resolve();
    await tasks[0];
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);

    gates[1]!.resolve();
    gates[2]!.resolve();
    await expect(Promise.all(tasks)).resolves.toEqual([0, 1, 2]);
    expect(limit.activeCount).toBe(0);
  });

  it("releases a slot after a synchronous exception", async () => {
    const limit = pLimit(1);
    const failure = limit(() => {
      throw new Error("boom");
    });
    const success = limit(() => "recovered");

    await expect(failure).rejects.toThrow("boom");
    await expect(success).resolves.toBe("recovered");
  });

  it("rejects invalid concurrency", () => {
    expect(() => pLimit(0)).toThrow(RangeError);
    expect(() => pLimit(1.5)).toThrow(RangeError);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
