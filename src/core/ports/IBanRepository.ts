export interface BanSubject {
  readonly kind: "user" | "guild";
  readonly id: string;
}

export interface BanRecord {
  readonly subject: BanSubject;
  readonly reason?: string;
  readonly createdAt: string;
  readonly actorId: string;
}

export interface IBanRepository {
  find(subject: BanSubject): Promise<BanRecord | undefined>;
  list(): Promise<readonly BanRecord[]>;
  save(record: BanRecord): Promise<void>;
  delete(subject: BanSubject): Promise<boolean>;
}
