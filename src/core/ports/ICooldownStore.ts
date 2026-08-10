export interface CooldownSubject {
  readonly kind: "user" | "channel";
  readonly id: string;
}

export interface ICooldownStore {
  /**
   * クールダウンを消費する。通してよければ `true`。
   *
   * 判定と記録を分けると、確認と記録の間に別のメッセージが通り抜ける。
   * 1つの操作にまとめる。
   */
  consume(subject: CooldownSubject, windowMs: number): Promise<boolean>;
}
