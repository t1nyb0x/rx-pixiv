export interface ReplyRecord {
  readonly originalMessageId: string;
  readonly replyMessageIds: readonly string[];
}

export interface IReplyRepository {
  find(originalMessageId: string): Promise<ReplyRecord | undefined>;
  /** cleanup集合へ追加し、元メッセージが未削除ならtrue、tombstone済みならfalse。 */
  add(originalMessageId: string, replyMessageId: string, ttlMs: number): Promise<boolean>;
  /** 削除済みtombstoneをTTL付きで記録する。 */
  markDeleted(originalMessageId: string, ttlMs: number): Promise<void>;
  /** 削除に成功した返信IDだけ追跡集合から外す。 */
  remove(originalMessageId: string, replyMessageId: string): Promise<boolean>;
}
