import { describe, expect, it } from "vitest";

import {
  loadAiBffProofHmacKey,
  loadAiRateLimitHmacKey,
  loadAiKnowledgeServiceHmacKey,
  loadApiRuntimeConfig,
  loadCatalogCursorHmacKey,
  parsePort,
} from "../src/runtime-config.js";

const cursorHmacKey = Buffer.alloc(32, 1).toString("base64url");
const rateLimitHmacKey = Buffer.alloc(32, 2).toString("base64url");
const bffProofHmacKey = Buffer.alloc(32, 3).toString("base64url");
const knowledgeServiceHmacKey = Buffer.alloc(32, 4).toString("base64url");
const accountSubjectHmacKey = Buffer.alloc(32, 5).toString("base64url");
const productionDpop = {
  API_DPOP_REDIS_URL: "rediss://:dpop-password@redis.internal.example.edu:6379",
  API_PUBLIC_ORIGIN: "https://api.example.edu",
} as const;

describe("runtime configuration", () => {
  it("accepts only complete decimal ports in the TCP range", () => {
    expect(parsePort(undefined)).toBe(4000);
    expect(parsePort("1")).toBe(1);
    expect(parsePort("65535")).toBe(65_535);

    for (const invalid of ["", "0", "65536", "1.5", "4000garbage", "+4000", " 4000", "０４０００"]) {
      expect(() => parsePort(invalid), invalid).toThrow("PORT must be an integer between 1 and 65535");
    }
  });

  it("loads a validated local OIDC configuration", () => {
    expect(loadApiRuntimeConfig({ NODE_ENV: "test" })).toEqual({
      ai: {
        knowledgeBaseUrl: new URL("http://127.0.0.1:8100"),
        maxResponseBytes: 262_144,
        serviceHmacKey: new TextEncoder().encode("development-only-ai-service-hmac-key-v1"),
        rateLimit: {
          clientLimit: 12,
          globalLimit: 600,
          networkLimit: 120,
          redisUrl: new URL("redis://:local-redis-password-only@127.0.0.1:6379"),
          windowSeconds: 60,
        },
        requestTimeoutMs: 3_000,
      },
      cors: {
        allowedOrigins: ["http://localhost:3000"],
      },
      nodeEnv: "test",
      oidc: {
        allowedClientIds: ["gopher-web", "gopher-cli"],
        audience: "gopher-api",
        dpop: {
          nonceTtlSeconds: 300,
          operationTimeoutMs: 1_000,
          proofLimit: 600,
          proofMaxAgeSeconds: 60,
          proofWindowSeconds: 60,
          publicOrigin: new URL("http://127.0.0.1:4000"),
          redisUrl: new URL("redis://:local-redis-password-only@127.0.0.1:6379"),
          replayTtlSeconds: 120,
        },
        issuer: "http://127.0.0.1:8080/realms/gopher-assistant-dev",
        jwksUrl: new URL("http://127.0.0.1:8080/realms/gopher-assistant-dev/protocol/openid-connect/certs"),
        maxTokenLifetimeSeconds: 300,
      },
      port: 4000,
    });
  });

  it("preserves the issuer exactly while deriving a canonical JWKS URL", () => {
    const config = loadApiRuntimeConfig({
      API_OIDC_AUDIENCE: "gopher-api",
      API_OIDC_ISSUER: "https://identity.example.edu/realms/gopher/",
      NODE_ENV: "test",
    });

    expect(config.oidc.issuer).toBe("https://identity.example.edu/realms/gopher/");
    expect(config.oidc.jwksUrl.toString()).toBe(
      "https://identity.example.edu/realms/gopher/protocol/openid-connect/certs",
    );
  });

  it("requires explicit HTTPS OIDC settings in production", () => {
    expect(() => loadApiRuntimeConfig({ NODE_ENV: "production" })).toThrow(
      "API_OIDC_ISSUER is required in production",
    );
    expect(() =>
      loadApiRuntimeConfig({
        API_AI_KNOWLEDGE_URL: "https://ai.internal.example.edu",
        API_AI_REDIS_URL: "rediss://:redis-password@redis.internal.example.edu:6379",
        API_OIDC_AUDIENCE: "gopher-api",
        API_OIDC_ISSUER: "http://127.0.0.1:8080/realms/gopher",
        API_OIDC_JWKS_URL: "http://127.0.0.1:8080/realms/gopher/protocol/openid-connect/certs",
        ...productionDpop,
        NODE_ENV: "production",
      }),
    ).toThrow("API OIDC endpoints must use HTTPS in production");
  });

  it("requires explicit client and HTTPS CORS allowlists in production", () => {
    const productionOidc = {
      API_ACCOUNT_HMAC_KEY_VERSION: "1",
      API_ACCOUNT_SUBJECT_HMAC_KEY: accountSubjectHmacKey,
      API_AI_KNOWLEDGE_URL: "https://ai.internal.example.edu",
      API_AI_KNOWLEDGE_HMAC_KEY: knowledgeServiceHmacKey,
      API_AI_RATE_LIMIT_HMAC_KEY: rateLimitHmacKey,
      API_AI_REDIS_URL: "rediss://:redis-password@redis.internal.example.edu:6379",
      API_CATALOG_CURSOR_HMAC_KEY: cursorHmacKey,
      API_OIDC_AUDIENCE: "gopher-api",
      API_OIDC_ISSUER: "https://identity.example.edu/realms/gopher",
      API_OIDC_JWKS_URL: "https://identity.example.edu/realms/gopher/protocol/openid-connect/certs",
      INTERNAL_AI_BFF_PROOF_HMAC_KEY: bffProofHmacKey,
      ...productionDpop,
      NODE_ENV: "production",
    } as const;

    expect(() =>
      loadApiRuntimeConfig({
        ...productionOidc,
        API_CORS_ALLOWED_ORIGINS: "https://assistant.example.edu",
      }),
    ).toThrow("API_OIDC_ALLOWED_CLIENT_IDS is required in production");
    expect(() =>
      loadApiRuntimeConfig({
        ...productionOidc,
        API_OIDC_ALLOWED_CLIENT_IDS: "gopher-web,gopher-cli",
      }),
    ).toThrow("API_CORS_ALLOWED_ORIGINS is required in production");

    expect(
      loadApiRuntimeConfig({
        ...productionOidc,
        API_CORS_ALLOWED_ORIGINS: "https://assistant.example.edu,https://admin.example.edu",
        API_OIDC_ALLOWED_CLIENT_IDS: "gopher-web,gopher-cli",
        API_OIDC_MAX_TOKEN_LIFETIME_SECONDS: "180",
      }),
    ).toMatchObject({
      cors: {
        allowedOrigins: ["https://assistant.example.edu", "https://admin.example.edu"],
      },
      oidc: {
        allowedClientIds: ["gopher-web", "gopher-cli"],
        maxTokenLifetimeSeconds: 180,
      },
    });
  });

  it("requires canonical 32-to-64-byte cursor HMAC material in production", () => {
    const validProduction = {
      API_ACCOUNT_HMAC_KEY_VERSION: "1",
      API_ACCOUNT_SUBJECT_HMAC_KEY: accountSubjectHmacKey,
      API_AI_KNOWLEDGE_URL: "https://ai.internal.example.edu",
      API_AI_KNOWLEDGE_HMAC_KEY: knowledgeServiceHmacKey,
      API_AI_RATE_LIMIT_HMAC_KEY: rateLimitHmacKey,
      API_AI_REDIS_URL: "rediss://:redis-password@redis.internal.example.edu:6379",
      API_CORS_ALLOWED_ORIGINS: "https://assistant.example.edu",
      API_OIDC_ALLOWED_CLIENT_IDS: "gopher-web",
      API_OIDC_AUDIENCE: "gopher-api",
      API_OIDC_ISSUER: "https://identity.example.edu/realms/gopher",
      API_OIDC_JWKS_URL: "https://identity.example.edu/realms/gopher/protocol/openid-connect/certs",
      INTERNAL_AI_BFF_PROOF_HMAC_KEY: bffProofHmacKey,
      ...productionDpop,
      NODE_ENV: "production",
    } as const;
    expect(() => loadApiRuntimeConfig(validProduction)).toThrow(
      "API_CATALOG_CURSOR_HMAC_KEY is required in production",
    );
    expect(() =>
      loadApiRuntimeConfig({ ...validProduction, API_CATALOG_CURSOR_HMAC_KEY: "not+base64" }),
    ).toThrow("canonical base64url");
    expect(() =>
      loadCatalogCursorHmacKey({ NODE_ENV: "test", API_CATALOG_CURSOR_HMAC_KEY: "c2hvcnQ" }),
    ).toThrow("32 through 64 bytes");
    expect(
      loadCatalogCursorHmacKey({ NODE_ENV: "test", API_CATALOG_CURSOR_HMAC_KEY: cursorHmacKey }),
    ).toHaveLength(32);
  });

  it("requires secure explicit AI service settings in production", () => {
    const production = {
      API_ACCOUNT_HMAC_KEY_VERSION: "1",
      API_ACCOUNT_SUBJECT_HMAC_KEY: accountSubjectHmacKey,
      API_AI_KNOWLEDGE_HMAC_KEY: knowledgeServiceHmacKey,
      API_CATALOG_CURSOR_HMAC_KEY: cursorHmacKey,
      API_AI_RATE_LIMIT_HMAC_KEY: rateLimitHmacKey,
      API_CORS_ALLOWED_ORIGINS: "https://assistant.example.edu",
      API_OIDC_ALLOWED_CLIENT_IDS: "gopher-web",
      API_OIDC_AUDIENCE: "gopher-api",
      API_OIDC_ISSUER: "https://identity.example.edu/realms/gopher",
      API_OIDC_JWKS_URL: "https://identity.example.edu/realms/gopher/protocol/openid-connect/certs",
      INTERNAL_AI_BFF_PROOF_HMAC_KEY: bffProofHmacKey,
      ...productionDpop,
      NODE_ENV: "production",
    } as const;
    expect(() => loadApiRuntimeConfig(production)).toThrow("API_AI_KNOWLEDGE_URL is required");
    expect(() =>
      loadApiRuntimeConfig({ ...production, API_AI_KNOWLEDGE_URL: "https://ai.internal.example.edu" }),
    ).toThrow("API_AI_REDIS_URL is required");
    expect(() =>
      loadApiRuntimeConfig({
        ...production,
        API_AI_KNOWLEDGE_URL: "https://ai.internal.example.edu",
        API_AI_REDIS_URL: "redis://:password@127.0.0.1:6379",
      }),
    ).toThrow("must use rediss in production");
  });

  it("validates AI rate-limit HMAC material and bounded runtime values", () => {
    expect(() => loadAiRateLimitHmacKey({ API_AI_RATE_LIMIT_HMAC_KEY: "c2hvcnQ", NODE_ENV: "test" })).toThrow(
      "32 through 64 bytes",
    );
    expect(
      loadAiRateLimitHmacKey({ API_AI_RATE_LIMIT_HMAC_KEY: cursorHmacKey, NODE_ENV: "test" }),
    ).toHaveLength(32);
    expect(() =>
      loadAiRateLimitHmacKey({
        API_AI_RATE_LIMIT_HMAC_KEY: Buffer.from("development-only-ai-rate-limit-hmac-key-v1").toString(
          "base64url",
        ),
        NODE_ENV: "production",
      }),
    ).toThrow("fixed development key");
    expect(() =>
      loadApiRuntimeConfig({
        API_AI_RATE_LIMIT_CLIENT: "100",
        API_AI_RATE_LIMIT_NETWORK: "99",
        NODE_ENV: "test",
      }),
    ).toThrow("API_AI_RATE_LIMIT_NETWORK must be greater than or equal to the client limit");
    expect(() =>
      loadApiRuntimeConfig({
        API_AI_RATE_LIMIT_GLOBAL: "119",
        API_AI_RATE_LIMIT_NETWORK: "120",
        NODE_ENV: "test",
      }),
    ).toThrow("API_AI_RATE_LIMIT_GLOBAL must be greater than or equal to the network limit");
    expect(
      loadApiRuntimeConfig({
        API_AI_RATE_LIMIT_CLIENT: "100",
        API_AI_RATE_LIMIT_GLOBAL: "300",
        API_AI_RATE_LIMIT_NETWORK: "200",
        NODE_ENV: "test",
      }).ai.rateLimit,
    ).toMatchObject({ clientLimit: 100, globalLimit: 300, networkLimit: 200 });
    expect(() => loadApiRuntimeConfig({ API_AI_REQUEST_TIMEOUT_MS: "249", NODE_ENV: "test" })).toThrow(
      "API_AI_REQUEST_TIMEOUT_MS",
    );
  });

  it("requires canonical service-auth HMAC material without exposing a production default", () => {
    expect(() => loadAiKnowledgeServiceHmacKey({ NODE_ENV: "production" })).toThrow(
      "API_AI_KNOWLEDGE_HMAC_KEY is required in production",
    );
    expect(() =>
      loadAiKnowledgeServiceHmacKey({ API_AI_KNOWLEDGE_HMAC_KEY: "c2hvcnQ", NODE_ENV: "test" }),
    ).toThrow("32 through 64 bytes");
    expect(() =>
      loadAiKnowledgeServiceHmacKey({
        API_AI_KNOWLEDGE_HMAC_KEY: Buffer.from("development-only-ai-service-hmac-key-v1").toString(
          "base64url",
        ),
        NODE_ENV: "production",
      }),
    ).toThrow("fixed development key");
    expect(
      loadAiKnowledgeServiceHmacKey({
        API_AI_KNOWLEDGE_HMAC_KEY: cursorHmacKey,
        NODE_ENV: "test",
      }),
    ).toHaveLength(32);
  });

  it("requires strong independent BFF proof material", () => {
    expect(() => loadAiBffProofHmacKey({ NODE_ENV: "production" })).toThrow(
      "INTERNAL_AI_BFF_PROOF_HMAC_KEY is required",
    );
    expect(() =>
      loadAiBffProofHmacKey({ INTERNAL_AI_BFF_PROOF_HMAC_KEY: "c2hvcnQ", NODE_ENV: "test" }),
    ).toThrow("32 through 64 bytes");
    expect(() =>
      loadAiBffProofHmacKey({
        INTERNAL_AI_BFF_PROOF_HMAC_KEY: Buffer.from(
          "development-only-ai-bff-core-proof-hmac-key-v1",
        ).toString("base64url"),
        NODE_ENV: "production",
      }),
    ).toThrow("fixed development key");
    expect(
      loadAiBffProofHmacKey({ INTERNAL_AI_BFF_PROOF_HMAC_KEY: bffProofHmacKey, NODE_ENV: "test" }),
    ).toHaveLength(32);
    expect(() =>
      loadApiRuntimeConfig({
        API_AI_RATE_LIMIT_HMAC_KEY: rateLimitHmacKey,
        API_CATALOG_CURSOR_HMAC_KEY: cursorHmacKey,
        INTERNAL_AI_BFF_PROOF_HMAC_KEY: rateLimitHmacKey,
        NODE_ENV: "test",
      }),
    ).toThrow("must be independent");
  });

  it.each(["29", "601", "1.5", "+300", " 300", ""])(
    "rejects invalid maximum access-token lifetime %s",
    (value) => {
      expect(() =>
        loadApiRuntimeConfig({ API_OIDC_MAX_TOKEN_LIFETIME_SECONDS: value, NODE_ENV: "test" }),
      ).toThrow("API_OIDC_MAX_TOKEN_LIFETIME_SECONDS must be an integer between 30 and 600");
    },
  );

  it.each([
    "*",
    "https://assistant.example.edu/path",
    "https://assistant.example.edu/",
    "https://assistant.example.edu?query=true",
    "https://user:password@assistant.example.edu",
    "http://assistant.example.edu",
    " https://assistant.example.edu",
  ])("rejects unsafe CORS origin configuration %s", (origin) => {
    expect(() => loadApiRuntimeConfig({ API_CORS_ALLOWED_ORIGINS: origin, NODE_ENV: "test" })).toThrow();
  });

  it.each(["", "gopher web", "*", "gopher-web, gopher-cli"])(
    "rejects malformed OIDC client allowlist %s",
    (clientIds) => {
      expect(() =>
        loadApiRuntimeConfig({ API_OIDC_ALLOWED_CLIENT_IDS: clientIds, NODE_ENV: "test" }),
      ).toThrow();
    },
  );

  it.each([
    [
      "non-loopback plaintext issuer",
      { API_OIDC_ISSUER: "http://identity.example.edu/realms/gopher", NODE_ENV: "test" },
    ],
    [
      "cross-origin JWKS",
      {
        API_OIDC_ISSUER: "https://identity.example.edu/realms/gopher",
        API_OIDC_JWKS_URL: "https://attacker.example/jwks",
        NODE_ENV: "test",
      },
    ],
    [
      "issuer credentials",
      { API_OIDC_ISSUER: "https://user:password@identity.example.edu/realms/gopher", NODE_ENV: "test" },
    ],
    ["whitespace audience", { API_OIDC_AUDIENCE: "gopher api", NODE_ENV: "test" }],
  ])("rejects %s", (_label, environment) => {
    expect(() => loadApiRuntimeConfig(environment)).toThrow();
  });
});
