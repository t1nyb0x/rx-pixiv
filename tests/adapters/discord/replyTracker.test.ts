import { describe, expect, it, vi } from "vitest";

import { REPLY_TTL_MS, ReplyTracker } from "#adapters/discord/replyTracker";
import type { IReplyRepository, ReplyRecord } from "#core/ports/IReplyRepository";

class MemoryReplies implements IReplyRepository {
  public readonly records = new Map<string, ReplyRecord>();
  public readonly deleted = new Set<string>();
  public ttlMs: number | undefined;

  public find(id: string): Promise<ReplyRecord | undefined> {
    return Promise.resolve(this.records.get(id));
  }
  public add(originalMessageId: string, replyMessageId: string, ttlMs: number): Promise<boolean> {
    const current = this.records.get(originalMessageId)?.replyMessageIds ?? [];
    this.records.set(originalMessageId, {
      originalMessageId,
      replyMessageIds: [...new Set([...current, replyMessageId])],
    });
    this.ttlMs = ttlMs;
    return Promise.resolve(!this.deleted.has(originalMessageId));
  }
  public markDeleted(id: string): Promise<void> {
    this.deleted.add(id);
    return Promise.resolve();
  }
  public remove(originalMessageId: string, replyMessageId: string): Promise<boolean> {
    const record = this.records.get(originalMessageId);
    if (record === undefined) return Promise.resolve(false);
    const replyMessageIds = record.replyMessageIds.filter((id) => id !== replyMessageId);
    if (replyMessageIds.length === 0) this.records.delete(originalMessageId);
    else this.records.set(originalMessageId, { originalMessageId, replyMessageIds });
    return Promise.resolve(replyMessageIds.length !== record.replyMessageIds.length);
  }
}

describe("ReplyTracker", () => {
  it("tracks replies for 24 hours and deletes them with the original", async () => {
    const repository = new MemoryReplies();
    const tracker = new ReplyTracker(repository);
    const deleteReply = vi.fn<(replyMessageId: string) => Promise<void>>(() => Promise.resolve());

    await tracker.track("original", "reply-1", deleteReply);
    await tracker.track("original", "reply-2", deleteReply);
    expect(repository.ttlMs).toBe(REPLY_TTL_MS);
    expect(await tracker.handleDelete("original", deleteReply)).toBe(true);
    expect(deleteReply).toHaveBeenCalledWith("reply-1");
    expect(deleteReply).toHaveBeenCalledWith("reply-2");
    expect(repository.records.size).toBe(0);
  });

  it("deletes a reply immediately when it arrives after the original was deleted", async () => {
    const repository = new MemoryReplies();
    const tracker = new ReplyTracker(repository);
    const deleteReply = vi.fn<(replyMessageId: string) => Promise<void>>(() => Promise.resolve());

    await tracker.handleDelete("original", deleteReply);
    await expect(tracker.track("original", "late", deleteReply)).resolves.toBe(false);
    expect(deleteReply).toHaveBeenCalledWith("late");
    expect(repository.records.size).toBe(0);
  });

  it("keeps a late reply ID when its immediate deletion fails", async () => {
    const repository = new MemoryReplies();
    const tracker = new ReplyTracker(repository);
    await tracker.handleDelete("original", () => Promise.resolve());

    await expect(
      tracker.track("original", "orphan", () => Promise.reject(new Error("discord unavailable"))),
    ).rejects.toThrow(/discord unavailable/);
    expect(repository.records.get("original")?.replyMessageIds).toEqual(["orphan"]);
  });

  it("keeps failed reply IDs for diagnostics or retry", async () => {
    const repository = new MemoryReplies();
    const tracker = new ReplyTracker(repository);
    await tracker.track("original", "ok", () => Promise.resolve());
    await tracker.track("original", "failed", () => Promise.resolve());

    await expect(
      tracker.handleDelete("original", (id) =>
        id === "failed" ? Promise.reject(new Error("discord unavailable")) : Promise.resolve(),
      ),
    ).rejects.toThrow(AggregateError);
    expect(repository.records.get("original")?.replyMessageIds).toEqual(["failed"]);
  });

  it("does nothing when no reply is tracked", async () => {
    const tracker = new ReplyTracker(new MemoryReplies());
    expect(
      await tracker.handleDelete(
        "missing",
        vi.fn<(replyMessageId: string) => Promise<void>>(() => Promise.resolve()),
      ),
    ).toBe(false);
  });
});
