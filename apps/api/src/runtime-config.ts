import { timingSafeEqual } from "node:crypto";

export function parsePort(value: string | undefined): number {
  const candidate = value ?? "4000";
  if (!/^[0-9]+$/u.test(candidate)) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  const port = Number(candidate);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

type Environment = Readonly<Record<string, string | undefined>>;

export interface OidcRuntimeConfig {
  readonly allowedClientIds: readonly string[];
  readonly audience: string;
  readonly issuer: string;
  readonly jwksUrl: URL;
  readonly maxTokenLifetimeSeconds: number;
}

export interface CorsRuntimeConfig {
  readonly allowedOrigins: readonly string[];
}

export interface AiRuntimeConfig {
  readonly knowledgeBaseUrl: URL;
  readonly maxResponseBytes: number;
  readonly serviceHmacKey: Uint8Array;
  readonly rateLimit: {
    readonly clientLimit: number;
    readonly globalLimit: number;
    readonly networkLimit: number;
    readonly redisUrl: URL;
    readonly windowSeconds: number;
  };
  readonly requestTimeoutMs: number;
}

export interface ApiRuntimeConfig {
  readonly ai: AiRuntimeConfig;
  readonly cors: CorsRuntimeConfig;
  readonly nodeEnv: "development" | "production" | "test";
  readonly oidc: OidcRuntimeConfig;
  readonly port: number;
}

const LOCAL_ISSUER = "http://127.0.0.1:8080/realms/gopher-assistant-dev";
const LOCAL_AI_KNOWLEDGE_URL = "http://127.0.0.1:8100";
const LOCAL_AI_REDIS_URL = "redis://:local-redis-password-only@127.0.0.1:6379";
const DEFAULT_ALLOWED_CLIENT_IDS = ["gopher-web", "gopher-cli", "gopher-mcp"] as const;
const DEFAULT_CORS_ORIGINS = ["http://localhost:3000"] as const;
const DEFAULT_MAX_TOKEN_LIFETIME_SECONDS = 300;
const MAX_TOKEN_LIFETIME_SECONDS = 600;
const MAX_ALLOWED_CLIENT_IDS = 32;
const MAX_CORS_ORIGINS = 32;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9._~:-]{1,128}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const DEVELOPMENT_CURSOR_HMAC_KEY = Buffer.from("development-only-catalog-cursor-hmac-key-v1", "utf8");
const DEVELOPMENT_AI_RATE_LIMIT_HMAC_KEY = Buffer.from("development-only-ai-rate-limit-hmac-key-v1", "utf8");
const DEVELOPMENT_AI_SERVICE_HMAC_KEY = Buffer.from("development-only-ai-service-hmac-key-v1", "utf8");
const DEVELOPMENT_AI_BFF_PROOF_HMAC_KEY = Buffer.from(
  "development-only-ai-bff-core-proof-hmac-key-v1",
  "utf8",
);

function parseNodeEnvironment(value: string | undefined): ApiRuntimeConfig["nodeEnv"] {
  const nodeEnv = value ?? "development";
  if (nodeEnv !== "development" && nodeEnv !== "production" && nodeEnv !== "test") {
    throw new TypeError("NODE_ENV must be development, production, or test");
  }
  return nodeEnv;
}

/**
 * Returns key material without ever retaining or logging the encoded secret.
 * Production uses one stable deployment secret so signed cursors survive restarts
 * and cannot be rewritten to bypass traversal budgets.
 */
export function loadCatalogCursorHmacKey(environment: Environment = process.env): Uint8Array {
  const nodeEnv = parseNodeEnvironment(environment["NODE_ENV"]);
  const encoded = environment["API_CATALOG_CURSOR_HMAC_KEY"];
  if (encoded === undefined) {
    if (nodeEnv === "production") {
      throw new TypeError("API_CATALOG_CURSOR_HMAC_KEY is required in production");
    }
    return new Uint8Array(DEVELOPMENT_CURSOR_HMAC_KEY);
  }
  if (!BASE64URL_PATTERN.test(encoded)) {
    throw new TypeError("API_CATALOG_CURSOR_HMAC_KEY must be canonical base64url");
  }
  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.toString("base64url") !== encoded || decoded.byteLength < 32 || decoded.byteLength > 64) {
    throw new TypeError(
      "API_CATALOG_CURSOR_HMAC_KEY must be canonical base64url encoding of 32 through 64 bytes",
    );
  }
  return new Uint8Array(decoded);
}

export function loadAiRateLimitHmacKey(environment: Environment = process.env): Uint8Array {
  const nodeEnv = parseNodeEnvironment(environment["NODE_ENV"]);
  const encoded = environment["API_AI_RATE_LIMIT_HMAC_KEY"];
  if (encoded === undefined) {
    if (nodeEnv === "production") {
      throw new TypeError("API_AI_RATE_LIMIT_HMAC_KEY is required in production");
    }
    return new Uint8Array(DEVELOPMENT_AI_RATE_LIMIT_HMAC_KEY);
  }
  if (!BASE64URL_PATTERN.test(encoded)) {
    throw new TypeError("API_AI_RATE_LIMIT_HMAC_KEY must be canonical base64url");
  }
  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.toString("base64url") !== encoded || decoded.byteLength < 32 || decoded.byteLength > 64) {
    throw new TypeError(
      "API_AI_RATE_LIMIT_HMAC_KEY must be canonical base64url encoding of 32 through 64 bytes",
    );
  }
  if (nodeEnv === "production" && decoded.equals(DEVELOPMENT_AI_RATE_LIMIT_HMAC_KEY)) {
    throw new TypeError("API_AI_RATE_LIMIT_HMAC_KEY must not use the fixed development key in production");
  }
  return new Uint8Array(decoded);
}

export function loadAiKnowledgeServiceHmacKey(environment: Environment = process.env): Uint8Array {
  const nodeEnv = parseNodeEnvironment(environment["NODE_ENV"]);
  const encoded = environment["API_AI_KNOWLEDGE_HMAC_KEY"];
  if (encoded === undefined) {
    if (nodeEnv === "production") {
      throw new TypeError("API_AI_KNOWLEDGE_HMAC_KEY is required in production");
    }
    return new Uint8Array(DEVELOPMENT_AI_SERVICE_HMAC_KEY);
  }
  if (!BASE64URL_PATTERN.test(encoded)) {
    throw new TypeError("API_AI_KNOWLEDGE_HMAC_KEY must be canonical base64url");
  }
  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.toString("base64url") !== encoded || decoded.byteLength < 32 || decoded.byteLength > 64) {
    throw new TypeError(
      "API_AI_KNOWLEDGE_HMAC_KEY must be canonical base64url encoding of 32 through 64 bytes",
    );
  }
  if (nodeEnv === "production" && decoded.equals(DEVELOPMENT_AI_SERVICE_HMAC_KEY)) {
    throw new TypeError("API_AI_KNOWLEDGE_HMAC_KEY must not use the fixed development key in production");
  }
  return new Uint8Array(decoded);
}

export function loadAiBffProofHmacKey(environment: Environment = process.env): Uint8Array {
  const nodeEnv = parseNodeEnvironment(environment["NODE_ENV"]);
  const encoded = environment["INTERNAL_AI_BFF_PROOF_HMAC_KEY"];
  if (encoded === undefined) {
    if (nodeEnv === "production") {
      throw new TypeError("INTERNAL_AI_BFF_PROOF_HMAC_KEY is required in production");
    }
    return new Uint8Array(DEVELOPMENT_AI_BFF_PROOF_HMAC_KEY);
  }
  if (!BASE64URL_PATTERN.test(encoded)) {
    throw new TypeError("INTERNAL_AI_BFF_PROOF_HMAC_KEY must be canonical base64url");
  }
  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.toString("base64url") !== encoded || decoded.byteLength < 32 || decoded.byteLength > 64) {
    throw new TypeError(
      "INTERNAL_AI_BFF_PROOF_HMAC_KEY must be canonical base64url encoding of 32 through 64 bytes",
    );
  }
  if (nodeEnv === "production" && decoded.equals(DEVELOPMENT_AI_BFF_PROOF_HMAC_KEY)) {
    throw new TypeError(
      "INTERNAL_AI_BFF_PROOF_HMAC_KEY must not use the fixed development key in production",
    );
  }
  return new Uint8Array(decoded);
}

function sameSecret(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "[::1]" || normalized === "::1") return true;
  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(normalized);
  return match?.slice(1).every((part) => Number(part) <= 255) ?? false;
}

function parseEndpoint(raw: string, name: string): URL {
  if (raw.trim() !== raw) {
    throw new TypeError(`${name} must not contain surrounding whitespace`);
  }

  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    throw new TypeError(`${name} must be an absolute HTTP or HTTPS URL`);
  }

  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new TypeError(`${name} must use HTTP or HTTPS`);
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new TypeError(`${name} must not contain credentials, a query, or a fragment`);
  }
  if (endpoint.protocol === "http:" && !isLoopbackHostname(endpoint.hostname)) {
    throw new TypeError(`${name} may use HTTP only on an explicit loopback address`);
  }
  return endpoint;
}

function parseRedisEndpoint(raw: string, nodeEnv: ApiRuntimeConfig["nodeEnv"]): URL {
  if (raw.trim() !== raw) {
    throw new TypeError("API_AI_REDIS_URL must not contain surrounding whitespace");
  }
  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    throw new TypeError("API_AI_REDIS_URL must be an absolute Redis URL");
  }
  if (endpoint.protocol !== "redis:" && endpoint.protocol !== "rediss:") {
    throw new TypeError("API_AI_REDIS_URL must use redis or rediss");
  }
  if (endpoint.search || endpoint.hash || (endpoint.pathname !== "" && endpoint.pathname !== "/")) {
    throw new TypeError("API_AI_REDIS_URL must not contain a database path, query, or fragment");
  }
  if (endpoint.password.length === 0) {
    throw new TypeError("API_AI_REDIS_URL must contain a password");
  }
  if (nodeEnv === "production" && endpoint.protocol !== "rediss:") {
    throw new TypeError("API_AI_REDIS_URL must use rediss in production");
  }
  if (
    endpoint.protocol === "redis:" &&
    !isLoopbackHostname(endpoint.hostname) &&
    endpoint.hostname.toLowerCase() !== "localhost"
  ) {
    throw new TypeError("Plaintext API_AI_REDIS_URL is allowed only on loopback");
  }
  return endpoint;
}

function defaultJwksUrl(issuer: URL): URL {
  const path = `${issuer.pathname.replace(/\/+$/u, "")}/protocol/openid-connect/certs`;
  return new URL(path, issuer.origin);
}

function parseAudience(value: string | undefined): string {
  const audience = value ?? "gopher-api";
  if (audience.length === 0 || audience.length > 512 || /\s/u.test(audience)) {
    throw new TypeError("API_OIDC_AUDIENCE must be 1 through 512 non-whitespace characters");
  }
  return audience;
}

function parseIntegerSetting(
  value: string | undefined,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const candidate = value ?? String(defaultValue);
  if (!/^[0-9]+$/u.test(candidate)) {
    throw new TypeError(`${name} must be an integer between ${String(minimum)} and ${String(maximum)}`);
  }
  const parsed = Number(candidate);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TypeError(`${name} must be an integer between ${String(minimum)} and ${String(maximum)}`);
  }
  return parsed;
}

function parseAllowedClientIds(
  value: string | undefined,
  nodeEnv: ApiRuntimeConfig["nodeEnv"],
): readonly string[] {
  if (value === undefined && nodeEnv === "production") {
    throw new TypeError("API_OIDC_ALLOWED_CLIENT_IDS is required in production");
  }
  const clientIds = value === undefined ? [...DEFAULT_ALLOWED_CLIENT_IDS] : value.split(",");
  if (
    clientIds.length === 0 ||
    clientIds.length > MAX_ALLOWED_CLIENT_IDS ||
    clientIds.some((clientId) => !CLIENT_ID_PATTERN.test(clientId))
  ) {
    throw new TypeError(
      `API_OIDC_ALLOWED_CLIENT_IDS must contain 1 through ${String(MAX_ALLOWED_CLIENT_IDS)} canonical client IDs`,
    );
  }
  return Object.freeze([...new Set(clientIds)]);
}

function parseCorsAllowedOrigins(
  value: string | undefined,
  nodeEnv: ApiRuntimeConfig["nodeEnv"],
): readonly string[] {
  if (value === undefined && nodeEnv === "production") {
    throw new TypeError("API_CORS_ALLOWED_ORIGINS is required in production");
  }
  const rawOrigins = value === undefined ? [...DEFAULT_CORS_ORIGINS] : value.split(",");
  if (rawOrigins.length === 0 || rawOrigins.length > MAX_CORS_ORIGINS) {
    throw new TypeError(
      `API_CORS_ALLOWED_ORIGINS must contain 1 through ${String(MAX_CORS_ORIGINS)} origins`,
    );
  }

  const origins = rawOrigins.map((rawOrigin) => {
    if (rawOrigin === "*" || rawOrigin.trim() !== rawOrigin) {
      throw new TypeError("API_CORS_ALLOWED_ORIGINS must contain canonical origins and must not contain *");
    }
    let origin: URL;
    try {
      origin = new URL(rawOrigin);
    } catch {
      throw new TypeError("API_CORS_ALLOWED_ORIGINS must contain absolute HTTP or HTTPS origins");
    }
    if (
      (origin.protocol !== "http:" && origin.protocol !== "https:") ||
      origin.username !== "" ||
      origin.password !== "" ||
      origin.pathname !== "/" ||
      origin.search !== "" ||
      origin.hash !== "" ||
      origin.origin !== rawOrigin
    ) {
      throw new TypeError("API_CORS_ALLOWED_ORIGINS must contain canonical HTTP or HTTPS origins only");
    }
    const isDevelopmentLoopback =
      origin.hostname.toLowerCase() === "localhost" || isLoopbackHostname(origin.hostname);
    if (origin.protocol === "http:" && (nodeEnv === "production" || !isDevelopmentLoopback)) {
      throw new TypeError("API_CORS_ALLOWED_ORIGINS may use HTTP only on loopback outside production");
    }
    return origin.origin;
  });
  return Object.freeze([...new Set(origins)]);
}

export function loadApiRuntimeConfig(environment: Environment = process.env): ApiRuntimeConfig {
  const nodeEnv = parseNodeEnvironment(environment["NODE_ENV"]);
  if (nodeEnv === "production") {
    for (const name of ["API_OIDC_ISSUER", "API_OIDC_AUDIENCE", "API_OIDC_JWKS_URL"] as const) {
      if (environment[name] === undefined) {
        throw new TypeError(`${name} is required in production`);
      }
    }
    for (const name of ["API_AI_KNOWLEDGE_URL", "API_AI_REDIS_URL"] as const) {
      if (environment[name] === undefined) {
        throw new TypeError(`${name} is required in production`);
      }
    }
  }

  const issuerRaw = environment["API_OIDC_ISSUER"] ?? LOCAL_ISSUER;
  const issuerUrl = parseEndpoint(issuerRaw, "API_OIDC_ISSUER");
  const jwksUrl = parseEndpoint(
    environment["API_OIDC_JWKS_URL"] ?? defaultJwksUrl(issuerUrl).toString(),
    "API_OIDC_JWKS_URL",
  );
  if (jwksUrl.origin !== issuerUrl.origin) {
    throw new TypeError("API_OIDC_JWKS_URL must share the issuer origin");
  }
  if (nodeEnv === "production" && (issuerUrl.protocol !== "https:" || jwksUrl.protocol !== "https:")) {
    throw new TypeError("API OIDC endpoints must use HTTPS in production");
  }
  // Validate the secret during startup; catalog cursors load the same material
  // at encode/decode time without exposing it through the public runtime config.
  const cursorHmacKey = loadCatalogCursorHmacKey(environment);
  const aiRateLimitHmacKey = loadAiRateLimitHmacKey(environment);
  const aiBffProofHmacKey = loadAiBffProofHmacKey(environment);
  const aiKnowledgeServiceHmacKey = loadAiKnowledgeServiceHmacKey(environment);
  if (
    sameSecret(cursorHmacKey, aiRateLimitHmacKey) ||
    sameSecret(cursorHmacKey, aiBffProofHmacKey) ||
    sameSecret(cursorHmacKey, aiKnowledgeServiceHmacKey) ||
    sameSecret(aiRateLimitHmacKey, aiBffProofHmacKey) ||
    sameSecret(aiRateLimitHmacKey, aiKnowledgeServiceHmacKey) ||
    sameSecret(aiBffProofHmacKey, aiKnowledgeServiceHmacKey)
  ) {
    throw new TypeError(
      "Catalog cursor, AI rate-limit, AI BFF proof, and AI knowledge service HMAC keys must be independent",
    );
  }

  const aiKnowledgeBaseUrl = parseEndpoint(
    environment["API_AI_KNOWLEDGE_URL"] ?? LOCAL_AI_KNOWLEDGE_URL,
    "API_AI_KNOWLEDGE_URL",
  );
  if (nodeEnv === "production" && aiKnowledgeBaseUrl.protocol !== "https:") {
    throw new TypeError("API_AI_KNOWLEDGE_URL must use HTTPS in production");
  }
  const clientLimit = parseIntegerSetting(
    environment["API_AI_RATE_LIMIT_CLIENT"],
    "API_AI_RATE_LIMIT_CLIENT",
    12,
    1,
    1_000,
  );
  const globalLimit = parseIntegerSetting(
    environment["API_AI_RATE_LIMIT_GLOBAL"],
    "API_AI_RATE_LIMIT_GLOBAL",
    600,
    1,
    100_000,
  );
  const networkLimit = parseIntegerSetting(
    environment["API_AI_RATE_LIMIT_NETWORK"],
    "API_AI_RATE_LIMIT_NETWORK",
    120,
    1,
    100_000,
  );
  if (networkLimit < clientLimit) {
    throw new TypeError("API_AI_RATE_LIMIT_NETWORK must be greater than or equal to the client limit");
  }
  if (globalLimit < networkLimit) {
    throw new TypeError("API_AI_RATE_LIMIT_GLOBAL must be greater than or equal to the network limit");
  }

  return {
    ai: {
      knowledgeBaseUrl: aiKnowledgeBaseUrl,
      maxResponseBytes: parseIntegerSetting(
        environment["API_AI_MAX_RESPONSE_BYTES"],
        "API_AI_MAX_RESPONSE_BYTES",
        262_144,
        16_384,
        1_048_576,
      ),
      serviceHmacKey: aiKnowledgeServiceHmacKey,
      rateLimit: {
        clientLimit,
        globalLimit,
        networkLimit,
        redisUrl: parseRedisEndpoint(environment["API_AI_REDIS_URL"] ?? LOCAL_AI_REDIS_URL, nodeEnv),
        windowSeconds: parseIntegerSetting(
          environment["API_AI_RATE_LIMIT_WINDOW_SECONDS"],
          "API_AI_RATE_LIMIT_WINDOW_SECONDS",
          60,
          10,
          3_600,
        ),
      },
      requestTimeoutMs: parseIntegerSetting(
        environment["API_AI_REQUEST_TIMEOUT_MS"],
        "API_AI_REQUEST_TIMEOUT_MS",
        3_000,
        250,
        10_000,
      ),
    },
    cors: {
      allowedOrigins: parseCorsAllowedOrigins(environment["API_CORS_ALLOWED_ORIGINS"], nodeEnv),
    },
    nodeEnv,
    oidc: {
      allowedClientIds: parseAllowedClientIds(environment["API_OIDC_ALLOWED_CLIENT_IDS"], nodeEnv),
      audience: parseAudience(environment["API_OIDC_AUDIENCE"]),
      issuer: issuerRaw,
      jwksUrl,
      maxTokenLifetimeSeconds: parseIntegerSetting(
        environment["API_OIDC_MAX_TOKEN_LIFETIME_SECONDS"],
        "API_OIDC_MAX_TOKEN_LIFETIME_SECONDS",
        DEFAULT_MAX_TOKEN_LIFETIME_SECONDS,
        30,
        MAX_TOKEN_LIFETIME_SECONDS,
      ),
    },
    port: parsePort(environment["PORT"]),
  };
}
