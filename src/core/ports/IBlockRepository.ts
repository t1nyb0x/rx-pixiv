export interface BlockTarget {
  readonly kind: "artwork" | "user";
  readonly id: string;
}

export interface BlockRecord {
  readonly target: BlockTarget;
  readonly reason?: string;
  readonly createdAt: string;
}

export interface IBlockRepository {
  find(target: BlockTarget): Promise<BlockRecord | undefined>;
  list(): Promise<readonly BlockRecord[]>;
  save(record: BlockRecord): Promise<void>;
  delete(target: BlockTarget): Promise<boolean>;
}
