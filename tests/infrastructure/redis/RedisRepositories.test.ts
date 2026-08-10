import type { RedisClientType } from "redis";
import { describe, expect, it } from "vitest";

import {
  RedisBanRepository,
  RedisBlockRepository,
  RedisCooldownStore,
} from "#infrastructure/redis/RedisRepositories";

interface SetOptions {
  readonly condition?: string;
  readonly expiration?: { readonly type: string; readonly value: number };
}

/**
 * 使っているコマンドだけを実装したフェイク。
 * `redis` パッケージをモジュールごとモックせず、**クライアントの形**に対して当てる。
 */
class FakeRedis {
  public readonly strings = new Map<string, { value: string; expiresAt?: number }>();
  public readonly sets = new Map<string, Set<string>>();
  public now = 0;
  public failNext = false;

  public sMembers(key: string): Promise<string[]> {
    this.#maybeFail();
    return Promise.resolve([...(this.sets.get(key) ?? [])]);
  }

  public get(key: string): Promise<string | null> {
    this.#maybeFail();
    const entry = this.strings.get(key);
    if (entry === undefined) return Promise.resolve(null);
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.now) {
      this.strings.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value);
  }

  public set(key: string, value: string, options?: SetOptions): Promise<string | null> {
    this.#maybeFail();
    const existing = this.strings.get(key);
    const alive =
      existing !== undefined && (existing.expiresAt === undefined || existing.expiresAt > this.now);

    if (options?.condition === "NX" && alive) return Promise.resolve(null);

    const entry: { value: string; expiresAt?: number } = { value };
    if (options?.expiration?.type === "PX") entry.expiresAt = this.now + options.expiration.value;
    this.strings.set(key, entry);
    return Promise.resolve("OK");
  }

  public sAdd(key: string, member: string): Promise<number> {
    this.#maybeFail();
    const set = this.sets.get(key) ?? new Set<string>();
    set.add(member);
    this.sets.set(key, set);
    return Promise.resolve(1);
  }

  public sRem(key: string, member: string): Promise<number> {
    this.#maybeFail();
    return Promise.resolve(this.sets.get(key)?.delete(member) === true ? 1 : 0);
  }

  public del(key: string): Promise<number> {
    this.#maybeFail();
    return Promise.resolve(this.strings.delete(key) ? 1 : 0);
  }

  public asClient(): RedisClientType {
    return this as unknown as RedisClientType;
  }

  #maybeFail(): void {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("redis down");
    }
  }
}

const banRecord = {
  subject: { kind: "user", id: "1" } as const,
  reason: "spam",
  createdAt: "2026-08-10T00:00:00Z",
  actorId: "owner",
};

describe("RedisBanRepository", () => {
  it("refuses to answer before preload", async () => {
    // プリロード前に「禁止されていない」と答えると、ゲートが素通しになる。
    const repo = new RedisBanRepository(new FakeRedis().asClient());
    await expect(repo.find(banRecord.subject)).rejects.toThrow(/not loaded/);
    await expect(repo.list()).rejects.toThrow(/not loaded/);
  });

  it("survives a restart", async () => {
    const redis = new FakeRedis();

    const first = new RedisBanRepository(redis.asClient());
    await first.preload();
    await first.save(banRecord);

    // 別プロセスを模して、同じ Redis から読み直す。
    const second = new RedisBanRepository(redis.asClient());
    await second.preload();
    expect(await second.find(banRecord.subject)).toEqual(banRecord);
  });

  it("removes the record and its index entry", async () => {
    const redis = new FakeRedis();
    const repo = new RedisBanRepository(redis.asClient());
    await repo.preload();
    await repo.save(banRecord);

    expect(await repo.delete(banRecord.subject)).toBe(true);
    expect(await repo.find(banRecord.subject)).toBeUndefined();

    const reloaded = new RedisBanRepository(redis.asClient());
    await reloaded.preload();
    expect(await reloaded.list()).toEqual([]);
  });

  it("skips malformed entries instead of failing the whole preload", async () => {
    const redis = new FakeRedis();
    await redis.sAdd("app:ban:list", "user:1");
    await redis.sAdd("app:ban:list", "user:2");
    await redis.set("app:ban:user:1", "{ broken");
    await redis.set("app:ban:user:2", JSON.stringify(banRecord));

    const repo = new RedisBanRepository(redis.asClient());
    await repo.preload();
    expect(await repo.list()).toHaveLength(1);
  });

  it("propagates a preload failure so the caller can fail closed", async () => {
    const redis = new FakeRedis();
    redis.failNext = true;
    const repo = new RedisBanRepository(redis.asClient());
    await expect(repo.preload()).rejects.toThrow(/redis down/);
  });

  it("does not hit redis on the hot path once loaded", async () => {
    const redis = new FakeRedis();
    const repo = new RedisBanRepository(redis.asClient());
    await repo.preload();
    await repo.save(banRecord);

    // 以後の参照で Redis が落ちていても答えられる。
    redis.failNext = true;
    expect(await repo.find(banRecord.subject)).toEqual(banRecord);
  });
});

describe("RedisBlockRepository", () => {
  const record = { target: { kind: "artwork", id: "42" } as const, createdAt: "now" };

  it("survives a restart", async () => {
    const redis = new FakeRedis();
    const first = new RedisBlockRepository(redis.asClient());
    await first.preload();
    await first.save(record);

    const second = new RedisBlockRepository(redis.asClient());
    await second.preload();
    expect(await second.find(record.target)).toEqual(record);
  });

  it("refuses to answer before preload", async () => {
    const repo = new RedisBlockRepository(new FakeRedis().asClient());
    await expect(repo.find(record.target)).rejects.toThrow(/not loaded/);
  });

  it("keeps artwork and user namespaces separate", async () => {
    const redis = new FakeRedis();
    const repo = new RedisBlockRepository(redis.asClient());
    await repo.preload();
    await repo.save(record);
    expect(await repo.find({ kind: "user", id: "42" })).toBeUndefined();
  });
});

describe("RedisCooldownStore", () => {
  it("uses a single round trip that both checks and records", async () => {
    // 判定と記録を分けると、その間に別のメッセージが通り抜ける。
    const redis = new FakeRedis();
    const store = new RedisCooldownStore(redis.asClient());
    const subject = { kind: "user", id: "1" } as const;

    expect(await store.consume(subject, 5_000)).toBe(true);
    expect(await store.consume(subject, 5_000)).toBe(false);
  });

  it("lets the subject through once the window expires", async () => {
    const redis = new FakeRedis();
    const store = new RedisCooldownStore(redis.asClient());
    const subject = { kind: "channel", id: "1" } as const;

    expect(await store.consume(subject, 5_000)).toBe(true);
    redis.now = 5_001;
    expect(await store.consume(subject, 5_000)).toBe(true);
  });

  it("tracks user and channel subjects separately", async () => {
    const redis = new FakeRedis();
    const store = new RedisCooldownStore(redis.asClient());
    expect(await store.consume({ kind: "user", id: "1" }, 1_000)).toBe(true);
    expect(await store.consume({ kind: "channel", id: "1" }, 1_000)).toBe(true);
  });
});
