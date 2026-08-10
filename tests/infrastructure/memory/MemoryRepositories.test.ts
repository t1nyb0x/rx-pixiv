import { describe, expect, it } from "vitest";

import {
  MemoryBanRepository,
  MemoryBlockRepository,
  MemoryCooldownStore,
} from "#infrastructure/memory/MemoryRepositories";

describe("MemoryBanRepository", () => {
  it("stores, finds, lists and deletes", async () => {
    const repo = new MemoryBanRepository();
    const record = {
      subject: { kind: "user", id: "1" } as const,
      createdAt: "now",
      actorId: "owner",
    };

    expect(await repo.find(record.subject)).toBeUndefined();
    await repo.save(record);
    expect(await repo.find(record.subject)).toEqual(record);
    expect(await repo.list()).toEqual([record]);
    expect(await repo.delete(record.subject)).toBe(true);
    expect(await repo.delete(record.subject)).toBe(false);
  });

  it("keeps user and guild namespaces separate", async () => {
    const repo = new MemoryBanRepository();
    await repo.save({ subject: { kind: "user", id: "1" }, createdAt: "n", actorId: "o" });
    expect(await repo.find({ kind: "guild", id: "1" })).toBeUndefined();
  });
});

describe("MemoryBlockRepository", () => {
  it("keeps artwork and user namespaces separate", async () => {
    const repo = new MemoryBlockRepository();
    await repo.save({ target: { kind: "artwork", id: "1" }, createdAt: "n" });
    expect(await repo.find({ kind: "artwork", id: "1" })).toBeDefined();
    expect(await repo.find({ kind: "user", id: "1" })).toBeUndefined();
  });
});

describe("MemoryCooldownStore", () => {
  it("lets the first call through and blocks within the window", async () => {
    let clock = 1_000;
    const store = new MemoryCooldownStore({ now: () => clock });
    const subject = { kind: "user", id: "1" } as const;

    expect(await store.consume(subject, 5_000)).toBe(true);
    expect(await store.consume(subject, 5_000)).toBe(false);

    clock = 6_001;
    expect(await store.consume(subject, 5_000)).toBe(true);
  });

  it("tracks subjects independently", async () => {
    const store = new MemoryCooldownStore({ now: () => 0 });
    expect(await store.consume({ kind: "user", id: "1" }, 1_000)).toBe(true);
    expect(await store.consume({ kind: "user", id: "2" }, 1_000)).toBe(true);
    expect(await store.consume({ kind: "channel", id: "1" }, 1_000)).toBe(true);
  });

  it("evicts expired entries instead of growing without bound", async () => {
    let clock = 0;
    const store = new MemoryCooldownStore({ now: () => clock, maxEntries: 2 });

    await store.consume({ kind: "user", id: "a" }, 100);
    await store.consume({ kind: "user", id: "b" }, 100);
    clock = 1_000;
    // 上限に達したところで期限切れが掃除され、新しい主体を受け入れられる。
    expect(await store.consume({ kind: "user", id: "c" }, 100)).toBe(true);
    expect(await store.consume({ kind: "user", id: "a" }, 100)).toBe(true);
  });
});
