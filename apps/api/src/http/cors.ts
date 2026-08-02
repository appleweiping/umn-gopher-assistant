export const API_CORS_ALLOWED_HEADERS = Object.freeze([
  "Accept",
  "Accept-Language",
  "Authorization",
  "Content-Type",
  "DPoP",
  "Idempotency-Key",
  "If-Match",
  "If-None-Match",
  "X-Request-Id",
  "X-Vault-Read-Proof",
]);

export const API_CORS_EXPOSED_HEADERS = Object.freeze([
  "Cache-Control",
  "DPoP-Nonce",
  "ETag",
  "Idempotency-Replayed",
  "Location",
  "RateLimit-Limit",
  "RateLimit-Remaining",
  "RateLimit-Reset",
  "Retry-After",
  "WWW-Authenticate",
  "X-Request-Id",
]);

export function apiCorsOptions(allowedOrigins: readonly string[]) {
  return {
    allowedHeaders: [...API_CORS_ALLOWED_HEADERS],
    credentials: true,
    exposedHeaders: [...API_CORS_EXPOSED_HEADERS],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    origin: [...allowedOrigins],
  };
}
