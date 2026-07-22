import { describe, expect, it } from "vitest";

import { loadApiRuntimeConfig, loadCatalogCursorHmacKey, parsePort } from "../src/runtime-config.js";

const cursorHmacKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY";

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
      cors: {
        allowedOrigins: ["http://localhost:3000"],
      },
      nodeEnv: "test",
      oidc: {
        allowedClientIds: ["gopher-web", "gopher-cli", "gopher-mcp"],
        audience: "gopher-api",
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
        API_OIDC_AUDIENCE: "gopher-api",
        API_OIDC_ISSUER: "http://127.0.0.1:8080/realms/gopher",
        API_OIDC_JWKS_URL: "http://127.0.0.1:8080/realms/gopher/protocol/openid-connect/certs",
        NODE_ENV: "production",
      }),
    ).toThrow("API OIDC endpoints must use HTTPS in production");
  });

  it("requires explicit client and HTTPS CORS allowlists in production", () => {
    const productionOidc = {
      API_CATALOG_CURSOR_HMAC_KEY: cursorHmacKey,
      API_OIDC_AUDIENCE: "gopher-api",
      API_OIDC_ISSUER: "https://identity.example.edu/realms/gopher",
      API_OIDC_JWKS_URL: "https://identity.example.edu/realms/gopher/protocol/openid-connect/certs",
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
      API_CORS_ALLOWED_ORIGINS: "https://assistant.example.edu",
      API_OIDC_ALLOWED_CLIENT_IDS: "gopher-web",
      API_OIDC_AUDIENCE: "gopher-api",
      API_OIDC_ISSUER: "https://identity.example.edu/realms/gopher",
      API_OIDC_JWKS_URL: "https://identity.example.edu/realms/gopher/protocol/openid-connect/certs",
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
