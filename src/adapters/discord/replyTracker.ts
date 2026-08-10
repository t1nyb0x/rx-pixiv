import type { IReplyRepository } from "#core/ports/IReplyRepository";

export const REPLY_TTL_MS = 24 * 60 * 60 * 1_000;

export class ReplyTracker {
  public constructor(private readonly repository: IReplyRepository) {}

  public async track(
    originalMessageId: string,
    replyMessageId: string,
    deleteLateReply: (replyMessageId: string) => Promise<void>,
  ): Promise<boolean> {
    const tracked = await this.repository.add(originalMessageId, replyMessageId, REPLY_TTL_MS);
    if (!tracked) {
      // tombstone後でもcleanup SetへIDは記録済み。削除成功時だけ集合から外し、
      // Discord削除失敗時は診断・再試行用にIDを残す。
      await deleteLateReply(replyMessageId);
      await this.repository.remove(originalMessageId, replyMessageId);
    }
    return tracked;
  }

  public async handleDelete(
    originalMessageId: string,
    deleteReply: (replyMessageId: string) => Promise<void>,
  ): Promise<boolean> {
    // tombstoneを先に置く。これ以後のlate addは原子的に拒否され、送信側が即削除する。
    await this.repository.markDeleted(originalMessageId, REPLY_TTL_MS);
    const record = await this.repository.find(originalMessageId);
    if (record === undefined) return false;

    const results = await Promise.allSettled(
      record.replyMessageIds.map((replyMessageId) => deleteReply(replyMessageId)),
    );
    const deleteFailures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    const deletedIds = record.replyMessageIds.filter(
      (_, index) => results[index]?.status === "fulfilled",
    );
    const removals = await Promise.allSettled(
      deletedIds.map((replyMessageId) => this.repository.remove(originalMessageId, replyMessageId)),
    );
    const removalFailures = removals
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    const failures = [...deleteFailures, ...removalFailures];
    if (failures.length > 0) {
      throw new AggregateError(failures, "Unable to delete one or more tracked replies");
    }
    return true;
  }
}
