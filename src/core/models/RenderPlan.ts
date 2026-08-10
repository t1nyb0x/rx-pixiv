export interface RenderAuthor {
  readonly name: string;
  readonly url: string;
  readonly iconUrl?: string;
}

export interface RenderField {
  readonly name: string;
  readonly value: string;
  readonly inline?: boolean;
}

export interface RenderMedia {
  readonly url: string;
  readonly description?: string;
  readonly spoiler: boolean;
}

export interface RenderItem {
  readonly url: string;
  readonly title?: string;
  readonly description?: string;
  readonly author?: RenderAuthor;
  readonly fields: readonly RenderField[];
  readonly media: readonly RenderMedia[];
}

export interface RenderPlan {
  readonly content?: string;
  readonly items: readonly RenderItem[];
}
