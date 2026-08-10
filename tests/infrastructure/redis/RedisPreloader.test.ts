import { describe, expect, it, vi } from "vitest";

import { RedisPreloader } from "#infrastructure/redis/RedisPreloader";

describe("RedisPreloader", () => {
  it("becomes ready only after every repository has loaded", async () => {
    const first = { preload: vi.fn<() => Promise<void>>(() => Promise.resolve()) };
    const second = { preload: vi.fn<() => Promise<void>>(() => Promise.resolve()) };
    const preloader = new RedisPreloader({ repositories: [first, second] });

    expect(preloader.isReady).toBe(false);
    await expect(preloader.preload()).resolves.toBe(true);
    expect(preloader.isReady).toBe(true);
    expect(first.preload).toHaveBeenCalledOnce();
    expect(second.preload).toHaveBeenCalledOnce();
  });

  it("coalesces concurrent ready events into one preload", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const repository = { preload: vi.fn<() => Promise<void>>(() => waiting) };
    const preloader = new RedisPreloader({ repositories: [repository] });

    const first = preloader.preload();
    const second = preloader.preload();
    expect(first).toBe(second);
    release();
    await first;
    expect(repository.preload).toHaveBeenCalledOnce();
  });

  it("discards a preload from before disconnect and reloads for the new connection", async () => {
    const releases: Array<() => void> = [];
    const repository = {
      preload: vi.fn<() => Promise<void>>(
        () =>
          new Promise<void>((resolve) => {
            releases.push(resolve);
          }),
      ),
    };
    const preloader = new RedisPreloader({ repositories: [repository] });

    const stale = preloader.preload();
    preloader.markDisconnected();
    const reconnected = preloader.preload();
    releases[0]?.();
    await expect(stale).resolves.toBe(false);
    await vi.waitFor(() => expect(repository.preload).toHaveBeenCalledTimes(2));
    expect(preloader.isReady).toBe(false);
    releases[1]?.();
    await expect(reconnected).resolves.toBe(true);
    expect(preloader.isReady).toBe(true);
  });

  it("does not start a queued reload after that ready generation disconnects again", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const repository = { preload: vi.fn<() => Promise<void>>(() => waiting) };
    const preloader = new RedisPreloader({ repositories: [repository] });

    const stale = preloader.preload();
    preloader.markDisconnected();
    const queued = preloader.preload();
    preloader.markDisconnected();
    release();

    await expect(stale).resolves.toBe(false);
    await expect(queued).resolves.toBe(false);
    expect(repository.preload).toHaveBeenCalledOnce();
    expect(preloader.isReady).toBe(false);
  });

  it("stays closed on failure and closes again on disconnect", async () => {
    const onError = vi.fn<(error: unknown) => void>();
    const preloader = new RedisPreloader({
      repositories: [{ preload: () => Promise.reject(new Error("broken")) }],
      onError,
    });
    await expect(preloader.preload()).resolves.toBe(false);
    expect(preloader.isReady).toBe(false);
    expect(onError).toHaveBeenCalled();

    const recovered = new RedisPreloader({ repositories: [{ preload: () => Promise.resolve() }] });
    await recovered.preload();
    recovered.markDisconnected();
    expect(recovered.isReady).toBe(false);
  });
});
