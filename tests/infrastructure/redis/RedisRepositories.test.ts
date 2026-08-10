import type { RedisClientType } from "redis";
import { describe, expect, it } from "vitest";

import {
  RedisBanRepository,
  RedisBlockRepository,
  RedisCooldownStore,
  RedisReplyRepository,
} from "#infrastructure/redis/RedisRepositories";

interface SetOptions {
  readonly condition?: string;
  readonly expiration?: { readonly type: string; readonly value: number };
}

interface EvalOptions {
  readonly keys: readonly string[];
  readonly arguments: readonly string[];
}

interface FakeMulti {
  set(key: string, value: string): FakeMulti;
  sAdd(key: string, member: string): FakeMulti;
  del(key: string): FakeMulti;
  sRem(key: string, member: string): FakeMulti;
  pExpire(key: string, ttlMs: number): FakeMulti;
  exec(): Promise<unknown[]>;
}

/**
 * 使っているコマンドだけを実装したフェイク。
 * `redis` パッケージをモジュールごとモックせず、**クライアントの形**に対して当てる。
 */
class FakeRedis {
  public readonly strings = new Map<string, { value: string; expiresAt?: number }>();
  public readonly sets = new Map<string, Set<string>>();
  public readonly setExpiries = new Map<string, number>();
  public now = 0;
  public failNext = false;
  public failExecAfterCommit = false;
  public multiCalls = 0;
  public afterSMembersRead: ((key: string) => Promise<void>) | undefined;

  public async sMembers(key: string): Promise<string[]> {
    this.#maybeFail();
    if ((this.setExpiries.get(key) ?? Number.POSITIVE_INFINITY) <= this.now) {
      this.sets.delete(key);
      this.setExpiries.delete(key);
    }
    const result = [...(this.sets.get(key) ?? [])];
    await this.afterSMembersRead?.(key);
    return result;
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
    const deleted = this.strings.delete(key) || this.sets.delete(key);
    this.setExpiries.delete(key);
    return Promise.resolve(deleted ? 1 : 0);
  }

  public pExpire(key: string, ttlMs: number): Promise<boolean> {
    this.#maybeFail();
    if (!this.sets.has(key) && !this.strings.has(key)) return Promise.resolve(false);
    this.setExpiries.set(key, this.now + ttlMs);
    return Promise.resolve(true);
  }

  public async eval(_script: string, options: EvalOptions): Promise<number> {
    this.#maybeFail();
    const [replyKey, tombstoneKey] = options.keys;
    const [replyMessageId, ttlRaw] = options.arguments;
    if (
      replyKey === undefined ||
      tombstoneKey === undefined ||
      replyMessageId === undefined ||
      ttlRaw === undefined
    ) {
      throw new Error("invalid eval arguments");
    }
    const tombstone = this.strings.get(tombstoneKey);
    const deleted =
      tombstone !== undefined &&
      (tombstone.expiresAt === undefined || tombstone.expiresAt > this.now);
    await this.sAdd(replyKey, replyMessageId);
    await this.pExpire(replyKey, Number(ttlRaw));
    return deleted ? 0 : 1;
  }

  public multi(): FakeMulti {
    this.multiCalls += 1;
    const commands: Array<() => Promise<unknown>> = [];
    const transaction = {
      set: (key: string, value: string) => {
        commands.push(() => this.set(key, value));
        return transaction;
      },
      sAdd: (key: string, member: string) => {
        commands.push(() => this.sAdd(key, member));
        return transaction;
      },
      del: (key: string) => {
        commands.push(() => this.del(key));
        return transaction;
      },
      sRem: (key: string, member: string) => {
        commands.push(() => this.sRem(key, member));
        return transaction;
      },
      pExpire: (key: string, ttlMs: number) => {
        commands.push(() => this.pExpire(key, ttlMs));
        return transaction;
      },
      exec: async () => {
        const replies: unknown[] = [];
        // Redis の MULTI/EXEC と同じく、登録順に直列実行するフェイク。
        // eslint-disable-next-line no-await-in-loop
        for (const command of commands) replies.push(await command());
        if (this.failExecAfterCommit) {
          this.failExecAfterCommit = false;
          throw new Error("transaction response lost");
        }
        return replies;
      },
    };
    return transaction;
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
    expect(redis.multiCalls).toBe(1);

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
    expect(redis.multiCalls).toBe(2);
    expect(await repo.find(banRecord.subject)).toBeUndefined();

    const reloaded = new RedisBanRepository(redis.asClient());
    await reloaded.preload();
    expect(await reloaded.list()).toEqual([]);
  });

  it("fails closed when an indexed entry is malformed", async () => {
    const redis = new FakeRedis();
    await redis.sAdd("app:ban:list", "user:1");
    await redis.sAdd("app:ban:list", "user:2");
    await redis.set("app:ban:user:1", "{ broken");
    await redis.set("app:ban:user:2", JSON.stringify(banRecord));

    const repo = new RedisBanRepository(redis.asClient());
    await expect(repo.preload()).rejects.toThrow(/malformed/);
    await expect(repo.list()).rejects.toThrow(/not loaded/);
  });

  it("fails closed when an indexed entry is missing", async () => {
    const redis = new FakeRedis();
    await redis.sAdd("app:ban:list", "user:1");

    const repo = new RedisBanRepository(redis.asClient());
    await expect(repo.preload()).rejects.toThrow(/missing/);
  });

  it("rejects an indexed record whose identity differs from its index key", async () => {
    const redis = new FakeRedis();
    await redis.sAdd("app:ban:list", "user:2");
    await redis.set("app:ban:user:2", JSON.stringify(banRecord));

    const repo = new RedisBanRepository(redis.asClient());
    await expect(repo.preload()).rejects.toThrow(/identity/);
    await expect(repo.list()).rejects.toThrow(/not loaded/);
  });

  it("marks a loaded repository unavailable when a reload fails", async () => {
    const redis = new FakeRedis();
    const repo = new RedisBanRepository(redis.asClient());
    await repo.preload();
    await repo.save(banRecord);
    await redis.set("app:ban:user:1", "{ broken");

    await expect(repo.preload()).rejects.toThrow(/malformed/);
    await expect(repo.find(banRecord.subject)).rejects.toThrow(/not loaded/);
  });

  it("fails closed when a transaction may have committed but its response is lost", async () => {
    const redis = new FakeRedis();
    const repo = new RedisBanRepository(redis.asClient());
    await repo.preload();
    redis.failExecAfterCommit = true;

    await expect(repo.save(banRecord)).rejects.toThrow(/response lost/);
    await expect(repo.find(banRecord.subject)).rejects.toThrow(/not loaded/);
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

  it("serializes a reload with an owner update so the snapshot cannot overwrite it", async () => {
    const redis = new FakeRedis();
    const repo = new RedisBanRepository(redis.asClient());
    await repo.preload();

    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    redis.afterSMembersRead = async (key) => {
      if (key !== "app:ban:list") return;
      started();
      await waiting;
    };

    const reload = repo.preload();
    await startedPromise;
    const newRecord = {
      ...banRecord,
      subject: { kind: "user", id: "2" } as const,
    };
    const save = repo.save(newRecord);
    release();
    await Promise.all([reload, save]);

    expect(await repo.find(newRecord.subject)).toEqual(newRecord);
  });
});

describe("RedisBlockRepository", () => {
  const record = { target: { kind: "artwork", id: "42" } as const, createdAt: "now" };

  it("survives a restart", async () => {
    const redis = new FakeRedis();
    const first = new RedisBlockRepository(redis.asClient());
    await first.preload();
    await first.save(record);
    expect(redis.multiCalls).toBe(1);

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

describe("RedisReplyRepository", () => {
  it("stores replies with TTL and rejects late additions after deletion", async () => {
    const redis = new FakeRedis();
    const repo = new RedisReplyRepository(redis.asClient());

    expect(await repo.add("original", "reply-1", 1_000)).toBe(true);
    expect(await repo.add("original", "reply-2", 1_000)).toBe(true);
    expect(await repo.find("original")).toEqual({
      originalMessageId: "original",
      replyMessageIds: ["reply-1", "reply-2"],
    });
    await repo.markDeleted("original", 1_000);
    expect(await repo.add("original", "late", 1_000)).toBe(false);
    expect(await repo.find("original")).toEqual({
      originalMessageId: "original",
      replyMessageIds: ["reply-1", "reply-2", "late"],
    });
    expect(await repo.remove("original", "reply-1")).toBe(true);
    expect(await repo.remove("original", "reply-2")).toBe(true);
    expect(await repo.remove("original", "late")).toBe(true);
    expect(await repo.find("original")).toBeUndefined();
  });

  it("expires reply mappings", async () => {
    const redis = new FakeRedis();
    const repo = new RedisReplyRepository(redis.asClient());
    await repo.add("original", "reply", 1_000);
    redis.now = 1_001;
    expect(await repo.find("original")).toBeUndefined();
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])("rejects invalid TTL %s", async (ttlMs) => {
    const repo = new RedisReplyRepository(new FakeRedis().asClient());
    await expect(repo.add("original", "reply", ttlMs)).rejects.toThrow(RangeError);
    await expect(repo.markDeleted("original", ttlMs)).rejects.toThrow(RangeError);
  });
});
