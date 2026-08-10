export const DISCORD_LIMITS = Object.freeze({
  embedsPerMessage: 10,
  galleryItemsPerMessage: 10,
});

export const PROCESSING_LIMITS = Object.freeze({
  urlsPerMessage: 3,
  pagesPerWork: DISCORD_LIMITS.galleryItemsPerMessage,
});

export const HEALTH_ENDPOINTS = Object.freeze({
  liveness: "/healthz",
  readiness: "/readyz",
  details: "/health",
  metrics: "/metrics",
});
