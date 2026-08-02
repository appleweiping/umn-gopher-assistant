// @vitest-environment node

import { describe, expect, it } from "vitest";

import { loadWebAuthRuntime } from "../lib/auth/runtime";

const COOKIE_KEY = Buffer.alloc(32, 7).toString("base64url");
const SESSION_KEY = Buffer.alloc(32, 9).toString("base64url");

describe("web OIDC runtime configuration", () => {
  it("uses an explicitly non-production local realm without exposing a client secret", () => {
    const runtime = loadWebAuthRuntime({ NODE_ENV: "test" });
    expect(runtime.clientId).toBe("gopher-web");
    expect(runtime.issuer).toBe("http://127.0.0.1:8080/realms/gopher-assistant-dev");
    expect(runtime.publicOrigin.origin).toBe("http://localhost:3000");
    expect(runtime.apiDpopOrigin.origin).toBe("http://127.0.0.1:4000");
    expect(runtime.redisUrl).toBe("redis://:local-redis-password-only@127.0.0.1:6379");
    expect(runtime).not.toHaveProperty("clientSecret");
  });

  it("requires HTTPS, TLS Redis, and independent production secrets", () => {
    expect(() => loadWebAuthRuntime({ NODE_ENV: "production" })).toThrow();

    const runtime = loadWebAuthRuntime({
      NODE_ENV: "production",
      WEB_AUTH_COOKIE_HMAC_KEY: COOKIE_KEY,
      WEB_AUTH_API_DPOP_ORIGIN: "https://api.example.edu",
      WEB_AUTH_OIDC_ISSUER: "https://identity.example.edu/realms/gopher",
      WEB_AUTH_PUBLIC_ORIGIN: "https://assistant.example.edu",
      WEB_AUTH_REDIS_URL: "rediss://:production-password@redis.example.edu:6380",
      WEB_AUTH_SESSION_ENCRYPTION_KEY: SESSION_KEY,
    });
    expect(runtime.production).toBe(true);
    expect(runtime.tokenEndpoint.origin).toBe("https://identity.example.edu");
    expect(runtime.apiDpopOrigin.origin).toBe("https://api.example.edu");
    expect(runtime.redisUrl).toBe("rediss://:production-password@redis.example.edu:6380");
  });

  it.each([
    {
      environment: {
        NODE_ENV: "production",
        WEB_AUTH_COOKIE_HMAC_KEY: COOKIE_KEY,
        WEB_AUTH_API_DPOP_ORIGIN: "https://api.example.edu",
        WEB_AUTH_SESSION_ENCRYPTION_KEY: SESSION_KEY,
        WEB_AUTH_OIDC_ISSUER: "http://identity.example.edu/realms/gopher",
        WEB_AUTH_PUBLIC_ORIGIN: "https://assistant.example.edu",
        WEB_AUTH_REDIS_URL: "rediss://:production-password@redis.example.edu",
      },
      label: "issuer downgrade",
    },
    {
      environment: {
        NODE_ENV: "production",
        WEB_AUTH_COOKIE_HMAC_KEY: COOKIE_KEY,
        WEB_AUTH_API_DPOP_ORIGIN: "https://api.example.edu",
        WEB_AUTH_SESSION_ENCRYPTION_KEY: SESSION_KEY,
        WEB_AUTH_OIDC_ISSUER: "https://identity.example.edu/realms/gopher",
        WEB_AUTH_PUBLIC_ORIGIN: "https://assistant.example.edu",
        WEB_AUTH_REDIS_URL: "redis://:production-password@redis.example.edu",
      },
      label: "Redis downgrade",
    },
    {
      environment: {
        NODE_ENV: "test",
        WEB_AUTH_REDIS_URL: "redis://:password@redis.example.edu:6379",
      },
      label: "remote plaintext Redis",
    },
    {
      environment: {
        NODE_ENV: "test",
        WEB_AUTH_REDIS_URL: "redis://:password@127.0.0.1:6379/1",
      },
      label: "Redis database path",
    },
    {
      environment: {
        NODE_ENV: "test",
        WEB_AUTH_COOKIE_HMAC_KEY: COOKIE_KEY,
        WEB_AUTH_SESSION_ENCRYPTION_KEY: COOKIE_KEY,
      },
      label: "key reuse",
    },
    {
      environment: {
        NODE_ENV: "test",
        WEB_AUTH_OIDC_ISSUER: "http://identity.example.edu/realms/gopher",
        WEB_AUTH_OIDC_TOKEN_ENDPOINT: "http://attacker.invalid/token",
      },
      label: "cross-origin endpoint",
    },
  ])("rejects unsafe configuration: $label", ({ environment }) => {
    expect(() => loadWebAuthRuntime(environment)).toThrow();
  });
});
