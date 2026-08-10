export type FetchError =
  | { readonly kind: "not_found" }
  | { readonly kind: "auth_required" }
  | { readonly kind: "blocked" }
  | { readonly kind: "rate_limited"; readonly retryAfterMs?: number }
  | { readonly kind: "upstream_5xx"; readonly status: number }
  | { readonly kind: "timeout" }
  | { readonly kind: "network"; readonly cause: string }
  | { readonly kind: "parse_error"; readonly sample?: string }
  | {
      readonly kind: "unsupported";
      readonly reason: "capability" | "circuit_open";
    };

export type NotFoundError = Extract<FetchError, { readonly kind: "not_found" }>;
