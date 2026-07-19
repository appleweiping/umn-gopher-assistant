import { describe, expect, it } from "vitest";

import { loadMcpServerConfig } from "../src/config.js";

const baseEnvironment = {
  MCP_ALLOW_AUTHLESS_LOOPBACK_TEST: "true",
  MCP_AUTH_MODE: "none",
  MCP_RESOURCE_URL: "http://127.0.0.1:4100/mcp",
  NODE_ENV: "test",
} as const;

describe("MCP server configuration", () => {
  it("defaults to loopback and derives canonical path-aware resource metadata", () => {
    const config = loadMcpServerConfig(baseEnvironment);

    expect(config.bindHost).toBe("127.0.0.1");
    expect(config.expectedHost).toBe("127.0.0.1:4100");
    expect(config.resourceMetadataUrl.toString()).toBe(
      "http://127.0.0.1:4100/.well-known/oauth-protected-resource/mcp",
    );
    expect([...config.permittedProtocolVersions]).toEqual(["2024-11-05", "2025-03-26"]);
    expect(config.limits).toMatchObject({
      clientRequestsPerWindow: 240,
      globalConcurrency: 32,
      maxTrackedKeys: 10_000,
      networkRequestsPerWindow: 120,
      subjectRequestsPerWindow: 60,
      windowMs: 60_000,
    });
    expect([...config.trustedProxyIps]).toEqual([]);
  });

  it("rejects authless mode unless the explicit non-production loopback gate is satisfied", () => {
    expect(() =>
      loadMcpServerConfig({ ...baseEnvironment, MCP_ALLOW_AUTHLESS_LOOPBACK_TEST: undefined }),
    ).toThrow(/explicit/u);
    expect(() => loadMcpServerConfig({ ...baseEnvironment, NODE_ENV: "production" })).toThrow(
      /Authless MCP/u,
    );
    expect(() => loadMcpServerConfig({ ...baseEnvironment, MCP_BIND_HOST: "0.0.0.0" })).toThrow(/loopback/u);
  });

  it("gates newer authorization specifications on reviewed RFC 8707 capability", () => {
    expect(() =>
      loadMcpServerConfig({
        ...baseEnvironment,
        MCP_AUTHORIZATION_SPEC_VERSION: "2025-11-25",
      }),
    ).toThrow(/MCP_RFC8707_REVIEWED=true/u);

    const reviewed = loadMcpServerConfig({
      ...baseEnvironment,
      MCP_AUTHORIZATION_SPEC_VERSION: "2025-11-25",
      MCP_RFC8707_REVIEWED: "true",
    });
    expect([...reviewed.permittedProtocolVersions]).toContain("2025-11-25");
  });

  it("rejects unsafe URLs, wildcard origins, and noncanonical resource paths", () => {
    expect(() =>
      loadMcpServerConfig({ ...baseEnvironment, MCP_RESOURCE_URL: "http://example.com/mcp" }),
    ).toThrow(/loopback/u);
    expect(() =>
      loadMcpServerConfig({ ...baseEnvironment, MCP_RESOURCE_URL: "http://127.0.0.1:4100/other" }),
    ).toThrow(/canonical/u);
    expect(() => loadMcpServerConfig({ ...baseEnvironment, MCP_ALLOWED_ORIGINS: "*" })).toThrow(/absolute/u);
  });

  it("requires production OAuth URLs and the API to use HTTPS", () => {
    expect(() =>
      loadMcpServerConfig({
        MCP_AUTH_MODE: "oauth",
        MCP_OAUTH_ISSUER: "https://identity.example.edu/realms/gopher",
        MCP_RESOURCE_URL: "https://assistant.example.edu/mcp",
        NODE_ENV: "production",
      }),
    ).toThrow(/GOPHER_API_BASE_URL must use HTTPS/u);

    const config = loadMcpServerConfig({
      GOPHER_API_BASE_URL: "https://api.example.edu/",
      MCP_AUTH_MODE: "oauth",
      MCP_AUTHORIZATION_SERVER: "https://identity.example.edu/realms/gopher",
      MCP_OAUTH_ISSUER: "https://identity.example.edu/realms/gopher",
      MCP_RESOURCE_URL: "https://assistant.example.edu/mcp",
      NODE_ENV: "production",
    });
    expect(config.auth.mode).toBe("oauth");
  });

  it("preserves exact root issuer spelling with and without a trailing slash", () => {
    const withoutSlash = loadMcpServerConfig({
      MCP_AUTH_MODE: "oauth",
      MCP_OAUTH_ISSUER: "https://issuer.example",
      MCP_RESOURCE_URL: "http://127.0.0.1:4100/mcp",
      NODE_ENV: "test",
    });
    const withSlash = loadMcpServerConfig({
      MCP_AUTH_MODE: "oauth",
      MCP_OAUTH_ISSUER: "https://issuer.example/",
      MCP_RESOURCE_URL: "http://127.0.0.1:4100/mcp",
      NODE_ENV: "test",
    });

    expect(withoutSlash.auth).toMatchObject({
      authorizationServer: "https://issuer.example",
      issuer: "https://issuer.example",
    });
    expect(withSlash.auth).toMatchObject({
      authorizationServer: "https://issuer.example/",
      issuer: "https://issuer.example/",
    });
    expect(withoutSlash.auth.mode === "oauth" && withoutSlash.auth.jwksUrl.toString()).toBe(
      "https://issuer.example/protocol/openid-connect/certs",
    );
    expect(withSlash.auth.mode === "oauth" && withSlash.auth.jwksUrl.toString()).toBe(
      "https://issuer.example/protocol/openid-connect/certs",
    );
  });

  it("strictly parses bounded limit settings and exact trusted proxy IPs", () => {
    const config = loadMcpServerConfig({
      ...baseEnvironment,
      MCP_CLIENT_REQUESTS_PER_WINDOW: "25",
      MCP_GLOBAL_CONCURRENCY: "4",
      MCP_NETWORK_REQUESTS_PER_WINDOW: "10",
      MCP_RATE_LIMIT_MAX_KEYS: "200",
      MCP_RATE_LIMIT_WINDOW_MS: "5000",
      MCP_SUBJECT_REQUESTS_PER_WINDOW: "5",
      MCP_TRUSTED_PROXY_IPS: "127.0.0.1,::1",
    });

    expect(config.limits).toEqual({
      clientRequestsPerWindow: 25,
      globalConcurrency: 4,
      maxTrackedKeys: 200,
      networkRequestsPerWindow: 10,
      subjectRequestsPerWindow: 5,
      windowMs: 5_000,
    });
    expect([...config.trustedProxyIps]).toEqual(["127.0.0.1", "::1"]);

    for (const invalid of [" 4", "4.0", "1e2", "0", "257"]) {
      expect(() => loadMcpServerConfig({ ...baseEnvironment, MCP_GLOBAL_CONCURRENCY: invalid })).toThrow(
        /MCP_GLOBAL_CONCURRENCY/u,
      );
    }
    expect(() => loadMcpServerConfig({ ...baseEnvironment, MCP_RATE_LIMIT_MAX_KEYS: "100001" })).toThrow(
      /MCP_RATE_LIMIT_MAX_KEYS/u,
    );
    for (const [name, value] of [
      ["MCP_CLIENT_REQUESTS_PER_WINDOW", "50001"],
      ["MCP_NETWORK_REQUESTS_PER_WINDOW", "10001"],
      ["MCP_RATE_LIMIT_WINDOW_MS", "999"],
      ["MCP_RATE_LIMIT_WINDOW_MS", "3600001"],
      ["MCP_SUBJECT_REQUESTS_PER_WINDOW", "10001"],
    ] as const) {
      expect(() => loadMcpServerConfig({ ...baseEnvironment, [name]: value })).toThrow(name);
    }
    expect(() =>
      loadMcpServerConfig({ ...baseEnvironment, MCP_TRUSTED_PROXY_IPS: "proxy.example.edu" }),
    ).toThrow(/MCP_TRUSTED_PROXY_IPS/u);
    expect(() =>
      loadMcpServerConfig({ ...baseEnvironment, MCP_TRUSTED_PROXY_IPS: "127.0.0.1,127.0.0.1" }),
    ).toThrow(/duplicate/u);
  });
});
