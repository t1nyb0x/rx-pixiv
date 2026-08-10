import type { NotFoundError } from "#core/models/errors";
import type { PixivRef } from "#core/models/PixivRef";
import type { PixivWork } from "#core/models/PixivWork";
import type { Result } from "#core/models/Result";

export type CachedWork = Result<PixivWork, NotFoundError>;

export interface IWorkCache {
  get(ref: PixivRef): Promise<CachedWork | undefined>;
  set(ref: PixivRef, value: CachedWork): Promise<void>;
  delete(ref: PixivRef): Promise<void>;
}
