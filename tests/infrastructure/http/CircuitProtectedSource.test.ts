import { describe, expect, it, vi } from "vitest";

import type { FetchError } from "#core/models/errors";
import type { PixivRef } from "#core/models/PixivRef";
import type { PixivWork } from "#core/models/PixivWork";
import { err, ok, type Result } from "#core/models/Result";
import type { IPixivSource } from "#core/ports/IPixivSource";
import { CircuitBreaker } from "#infrastructure/http/CircuitBreaker";
import { CircuitProtectedSource } from "#infrastructure/http/CircuitProtectedSource";

const ref: PixivRef = {
  kind: "artwork",
  id: "1",
  canonicalUrl: "https://www.pixiv.net/artworks/1",
};

describe("CircuitProtectedSource", () => {
  it("opens on repeated parse failures and blocks before invoking the source", async () => {
    const source = fakeSource();
    source.fetch.mockResolvedValue(err({ kind: "parse_error" }));
    const protectedSource = new CircuitProtectedSource(
      source,
      new CircuitBreaker({ failureThreshold: 2 }),
    );

    await protectedSource.fetch(ref, context());
    await protectedSource.fetch(ref, context());
    const blocked = await protectedSource.fetch(ref, context());

    expect(source.fetch).toHaveBeenCalledTimes(2);
    expect(blocked).toEqual({
      ok: false,
      error: { kind: "unsupported", reason: "circuit_open" },
    });
  });

  it("treats caller cancellation as neutral", async () => {
    const source = fakeSource();
    const pending = deferred<Result<PixivWork, FetchError>>();
    source.fetch.mockImplementationOnce(() => pending.promise).mockResolvedValue(ok(work()));
    const protectedSource = new CircuitProtectedSource(
      source,
      new CircuitBreaker({ failureThreshold: 1 }),
    );
    const controller = new AbortController();

    const cancelled = protectedSource.fetch(ref, context(controller.signal));
    controller.abort();
    pending.resolve(err({ kind: "timeout" }));
    await expect(cancelled).resolves.toEqual(err({ kind: "timeout" }));
    await expect(protectedSource.fetch(ref, context())).resolves.toEqual(ok(work()));
    expect(source.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not enter the circuit or source when already cancelled", async () => {
    const source = fakeSource();
    const controller = new AbortController();
    controller.abort();
    const protectedSource = new CircuitProtectedSource(source);

    await expect(protectedSource.fetch(ref, context(controller.signal))).resolves.toEqual(
      err({ kind: "timeout" }),
    );
    expect(source.fetch).not.toHaveBeenCalled();
  });

  it("uses environment thresholds and delegates source metadata", async () => {
    const source = fakeSource();
    source.fetch.mockResolvedValue(err({ kind: "rate_limited" }));
    const protectedSource = CircuitProtectedSource.fromEnv(source, {
      CIRCUIT_FAILURE_THRESHOLD: 5,
      CIRCUIT_OPEN_MS: 120_000,
    });

    expect(protectedSource.name).toBe("ajax");
    expect(protectedSource.capabilities).toBe(source.capabilities);
    expect(protectedSource.supports(ref)).toBe(true);
    await protectedSource.fetch(ref, context());
    await protectedSource.fetch(ref, context());
    expect(source.fetch).toHaveBeenCalledTimes(1);
  });
});

function fakeSource() {
  const fetch = vi.fn<IPixivSource["fetch"]>();
  return {
    name: "ajax" as const,
    capabilities: {
      supportedKinds: ["artwork"] as const,
      ratingAuthority: "authoritative" as const,
      multiPage: true,
    },
    supports: vi.fn<(candidate: PixivRef) => boolean>(() => true),
    fetch,
  } satisfies IPixivSource;
}

function context(signal = new AbortController().signal) {
  return { signal };
}

function work(): PixivWork {
  return {
    id: "1",
    canonicalUrl: "https://www.pixiv.net/artworks/1",
    title: "title",
    author: { id: "2", name: "author", url: "https://www.pixiv.net/users/2" },
    rating: { level: "all", sensitive: false, ai: "no", confidence: "authoritative" },
    source: "ajax",
    fetchedAt: 0,
    partial: false,
    kind: "illust",
    illustType: "illust",
    pageCount: 1,
    pages: [],
    pagesTruncated: false,
    tags: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
