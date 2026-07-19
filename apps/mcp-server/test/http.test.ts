import { request as httpRequest } from "node:http";
import { createConnection } from "node:net";
import type { AddressInfo, Socket } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import type { AccessTokenVerifier } from "../src/auth.js";
import { loadMcpServerConfig } from "../src/config.js";
import type { McpServerConfig } from "../src/config.js";
import { createMcpHttpServer } from "../src/http.js";

const campus = {
  academicCalendarCampusId: "tc",
  academicInstitutionCode: "UMNTC",
  city: { en: "Minneapolis", "zh-CN": "明尼阿波利斯" },
  id: "tc",
  name: { en: "Twin Cities", "zh-CN": "双城校区" },
  officialStatus: "UNVERIFIED",
  sourceUrl: "https://twin-cities.umn.edu/",
  timeZone: "America/Chicago",
};

const source = {
  attribution: "Synthetic test fixture",
  cachePolicy: "METADATA_ONLY",
  campusIds: ["tc"],
  freshnessState: "FRESH",
  id: "test-source",
  lastCheckedAt: "2026-07-19T00:00:00.000Z",
  licenseStatus: "DEEPLINK_ONLY",
  name: { en: "Test source", "zh-CN": "测试来源" },
  officialStatus: "UNVERIFIED",
  publisher: "Fixture publisher",
  sourceUrl: "https://example.edu/source",
  verificationState: "schematic",
};

function authlessConfig(overrides: Readonly<Record<string, string | undefined>> = {}): McpServerConfig {
  return loadMcpServerConfig({
    MCP_ALLOW_AUTHLESS_LOOPBACK_TEST: "true",
    MCP_AUTH_MODE: "none",
    MCP_RESOURCE_URL: "http://127.0.0.1:4100/mcp",
    NODE_ENV: "test",
    ...overrides,
  });
}

function oauthConfig(overrides: Readonly<Record<string, string | undefined>> = {}): McpServerConfig {
  return loadMcpServerConfig({
    MCP_AUTH_MODE: "oauth",
    MCP_OAUTH_ISSUER: "http://127.0.0.1:8080/realms/gopher-assistant-dev",
    MCP_RESOURCE_URL: "http://127.0.0.1:4100/mcp",
    NODE_ENV: "test",
    ...overrides,
  });
}

interface StartedServer {
  readonly application: ReturnType<typeof createMcpHttpServer>["application"];
  readonly port: number;
  close(): Promise<void>;
  request(options: {
    readonly body?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly method?: string;
    readonly path: string;
  }): Promise<{
    readonly body: string;
    readonly headers: NodeJS.Dict<string | string[]>;
    readonly status: number;
  }>;
}

const openServers: StartedServer[] = [];

async function startServer(options: {
  readonly config: McpServerConfig;
  readonly fetch?: typeof fetch;
  readonly tokenVerifier?: AccessTokenVerifier;
}): Promise<StartedServer> {
  const created = createMcpHttpServer(options);
  await new Promise<void>((resolve, reject) => {
    created.server.once("error", reject);
    created.server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = created.server.address() as AddressInfo;
  const started: StartedServer = {
    application: created.application,
    close: () =>
      new Promise<void>((resolve, reject) => {
        created.server.close((error) => (error ? reject(error) : resolve()));
      }),
    port: address.port,
    request: (requestOptions) =>
      new Promise((resolve, reject) => {
        const actual = httpRequest(
          {
            headers: {
              Host: options.config.expectedHost,
              ...requestOptions.headers,
            },
            host: "127.0.0.1",
            method: requestOptions.method ?? "GET",
            path: requestOptions.path,
            port: address.port,
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("end", () =>
              resolve({
                body: Buffer.concat(chunks).toString("utf8"),
                headers: response.headers,
                status: response.statusCode ?? 0,
              }),
            );
          },
        );
        actual.on("error", reject);
        if (requestOptions.body !== undefined) actual.write(requestOptions.body);
        actual.end();
      }),
  };
  openServers.push(started);
  return started;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function openSlowRequest(
  server: StartedServer,
  requestHead: string,
  partialBody: string,
): {
  readonly closed: Promise<string>;
  readonly socket: Socket;
} {
  const socket = createConnection({ host: "127.0.0.1", port: server.port });
  const chunks: Buffer[] = [];
  const closed = new Promise<string>((resolve, reject) => {
    socket.once("connect", () => socket.write(`${requestHead}\r\n\r\n${partialBody}`));
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("error", reject);
    socket.once("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
  return { closed, socket };
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(async (server) => server.close()));
});

const mcpHeaders = {
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
} as const;

function initializeBody(version = "2025-03-26"): string {
  return JSON.stringify({
    id: 1,
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      capabilities: {},
      clientInfo: { name: "mcp-test", version: "1.0.0" },
      protocolVersion: version,
    },
  });
}

describe("MCP HTTP boundary", () => {
  it("serves separate health and readiness endpoints", async () => {
    const server = await startServer({ config: authlessConfig() });

    const health = await server.request({ path: "/healthz" });
    const readiness = await server.request({ path: "/readyz" });

    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toEqual({
      service: "gopher-mcp-server",
      status: "ok",
      version: "0.1.0",
    });
    expect(JSON.parse(readiness.body)).toEqual({
      auth: "none",
      service: "gopher-mcp-server",
      status: "ready",
      tools: 3,
    });
  });

  it("applies the pre-auth budget to health, metadata, preflight, 404, and early errors", async () => {
    const server = await startServer({
      config: authlessConfig({ MCP_NETWORK_REQUESTS_PER_WINDOW: "5" }),
    });

    expect((await server.request({ path: "/healthz" })).status).toBe(200);
    expect((await server.request({ path: "/.well-known/oauth-protected-resource/mcp" })).status).toBe(200);
    expect(
      (
        await server.request({
          headers: { Origin: "http://127.0.0.1:4100" },
          method: "OPTIONS",
          path: "/mcp",
        })
      ).status,
    ).toBe(204);
    expect((await server.request({ path: "/missing" })).status).toBe(404);
    expect(
      (
        await server.request({
          body: initializeBody(),
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          method: "POST",
          path: "/mcp",
        })
      ).status,
    ).toBe(406);
    const rejected = await server.request({ path: "/readyz" });

    expect(rejected.status).toBe(429);
    expect(Number(rejected.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(server.application.diagnostics.rateLimitEntries).toBe(1);
  });

  it("counts a real slow MCP upload against global concurrency and closes it on deadline", async () => {
    const server = await startServer({
      config: authlessConfig({
        MCP_BODY_TIMEOUT_MS: "100",
        MCP_GLOBAL_CONCURRENCY: "1",
        MCP_NETWORK_REQUESTS_PER_WINDOW: "20",
      }),
    });
    const slow = openSlowRequest(
      server,
      [
        "POST /mcp HTTP/1.1",
        `Host: ${authlessConfig().expectedHost}`,
        "Accept: application/json, text/event-stream",
        "Content-Type: application/json",
        "Content-Length: 1000",
      ].join("\r\n"),
      "{",
    );

    try {
      await waitUntil(() => server.application.diagnostics.activeRequests === 1);
      const competingHealth = await server.request({ path: "/healthz" });
      expect(competingHealth.status).toBe(429);
      expect(server.application.diagnostics.activeRequests).toBe(1);

      const wireResponse = await Promise.race([
        slow.closed,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Slow MCP socket was not closed")), 2_000),
        ),
      ]);
      expect(wireResponse).toContain("408 Request Timeout");
      await waitUntil(() => server.application.diagnostics.activeRequests === 0);
    } finally {
      slow.socket.destroy();
    }
  });

  it("closes an unread slow body on an early health response and still charges its budget", async () => {
    const server = await startServer({
      config: authlessConfig({ MCP_NETWORK_REQUESTS_PER_WINDOW: "1" }),
    });
    const slow = openSlowRequest(
      server,
      [
        "GET /healthz HTTP/1.1",
        `Host: ${authlessConfig().expectedHost}`,
        "Content-Length: 1000000",
        "Connection: keep-alive",
      ].join("\r\n"),
      "x",
    );

    try {
      const wireResponse = await Promise.race([
        slow.closed,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Unread health body held the socket open")), 1_000),
        ),
      ]);
      expect(wireResponse).toContain("200 OK");
      expect(wireResponse.toLowerCase()).toContain("connection: close");
      expect((await server.request({ path: "/readyz" })).status).toBe(429);
      expect(server.application.diagnostics.activeRequests).toBe(0);
    } finally {
      slow.socket.destroy();
    }
  });

  it("serves canonical RFC 9728 metadata and challenges unauthenticated MCP requests", async () => {
    const verifier: AccessTokenVerifier = {
      verify: async () => {
        throw new Error("secret verifier detail");
      },
    };
    const server = await startServer({ config: oauthConfig(), tokenVerifier: verifier });

    const metadata = await server.request({ path: "/.well-known/oauth-protected-resource/mcp" });
    const unauthorized = await server.request({
      body: initializeBody(),
      headers: mcpHeaders,
      method: "POST",
      path: "/mcp",
    });

    expect(metadata.status).toBe(200);
    expect(JSON.parse(metadata.body)).toMatchObject({
      authorization_servers: ["http://127.0.0.1:8080/realms/gopher-assistant-dev"],
      bearer_methods_supported: ["header"],
      resource: "http://127.0.0.1:4100/mcp",
      scopes_supported: ["campus:read"],
    });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers["www-authenticate"]).toContain(
      'resource_metadata="http://127.0.0.1:4100/.well-known/oauth-protected-resource/mcp"',
    );
    expect(unauthorized.headers["www-authenticate"]).toContain('scope="campus:read"');
    expect(unauthorized.body).not.toContain("secret verifier detail");
  });

  it("rejects forged bearer credentials at the HTTP boundary", async () => {
    const verifier: AccessTokenVerifier = {
      verify: async () => {
        throw new Error("signature invalid: never expose this");
      },
    };
    const server = await startServer({ config: oauthConfig(), tokenVerifier: verifier });
    const response = await server.request({
      body: initializeBody(),
      headers: { ...mcpHeaders, Authorization: `Bearer ${"a".repeat(64)}` },
      method: "POST",
      path: "/mcp",
    });

    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toContain('error="invalid_token"');
    expect(response.body).not.toContain("signature invalid");
    expect(server.application.diagnostics.activeRequests).toBe(0);
  });

  it("enforces Host, Origin, media negotiation, method, and body-size boundaries", async () => {
    const server = await startServer({ config: authlessConfig({ MCP_MAX_BODY_BYTES: "1024" }) });

    const badHost = await server.request({ headers: { Host: "evil.example" }, path: "/healthz" });
    const badOrigin = await server.request({
      body: initializeBody(),
      headers: { ...mcpHeaders, Origin: "https://evil.example" },
      method: "POST",
      path: "/mcp",
    });
    const wrongAccept = await server.request({
      body: initializeBody(),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      method: "POST",
      path: "/mcp",
    });
    const wrongMethod = await server.request({ method: "GET", path: "/mcp" });
    const tooLarge = await server.request({
      body: JSON.stringify({ value: "x".repeat(1_100) }),
      headers: mcpHeaders,
      method: "POST",
      path: "/mcp",
    });

    expect(badHost.status).toBe(421);
    expect(badOrigin.status).toBe(403);
    expect(wrongAccept.status).toBe(406);
    expect(wrongMethod.status).toBe(405);
    expect(tooLarge.status).toBe(413);
  });

  it("rejects newer protocol claims until RFC 8707 capability is reviewed", async () => {
    const server = await startServer({ config: authlessConfig() });
    const response = await server.request({
      body: initializeBody("2025-11-25"),
      headers: mcpHeaders,
      method: "POST",
      path: "/mcp",
    });

    expect(response.status).toBe(400);
    expect(response.body).toContain("unsupported_mcp_protocol_version");
  });

  it("lists exactly three read-only tools and cleans up stateless transports", async () => {
    const server = await startServer({ config: authlessConfig() });
    const response = await server.request({
      body: JSON.stringify({ id: 2, jsonrpc: "2.0", method: "tools/list", params: {} }),
      headers: { ...mcpHeaders, "MCP-Protocol-Version": "2025-03-26" },
      method: "POST",
      path: "/mcp",
    });

    expect(response.status).toBe(200);
    const body = JSON.parse(response.body) as {
      readonly result: {
        readonly tools: readonly {
          readonly annotations: { readonly destructiveHint: boolean; readonly readOnlyHint: boolean };
          readonly name: string;
          readonly outputSchema: { readonly type: string };
        }[];
      };
    };
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "campuses_list",
      "sources_list",
      "world_manifest_get",
    ]);
    for (const tool of body.result.tools) {
      expect(tool.annotations).toMatchObject({ destructiveHint: false, readOnlyHint: true });
      expect(tool.outputSchema.type).toBe("object");
    }
    expect(server.application.diagnostics.activeTransports).toBe(0);
  });

  it("returns structured tool output without downstream credentials", async () => {
    let downstreamAuthorization: string | null | undefined;
    const server = await startServer({
      config: authlessConfig(),
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        downstreamAuthorization = request.headers.get("authorization");
        return new Response(JSON.stringify([campus]), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      },
    });
    const response = await server.request({
      body: JSON.stringify({
        id: 3,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: {}, name: "campuses_list" },
      }),
      headers: { ...mcpHeaders, "MCP-Protocol-Version": "2025-03-26" },
      method: "POST",
      path: "/mcp",
    });

    expect(response.status).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.result.structuredContent.campuses).toEqual([campus]);
    expect(body.result.content[0].type).toBe("text");
    expect(downstreamAuthorization).toBeNull();
    expect(server.application.diagnostics.activeTransports).toBe(0);
  });

  it("discards an accepted inbound MCP token instead of forwarding it downstream", async () => {
    const inboundToken = "a".repeat(64);
    let verifiedToken: string | undefined;
    let downstreamAuthorization: string | null | undefined;
    const server = await startServer({
      config: oauthConfig(),
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        downstreamAuthorization = request.headers.get("authorization");
        return new Response(JSON.stringify([campus]), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      },
      tokenVerifier: {
        verify: async (token) => {
          verifiedToken = token;
          return {
            expiresAt: Math.floor(Date.now() / 1000) + 300,
            scopes: new Set(["campus:read"]),
            subject: "test-user",
          };
        },
      },
    });
    const response = await server.request({
      body: JSON.stringify({
        id: 4,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: {}, name: "campuses_list" },
      }),
      headers: {
        ...mcpHeaders,
        Authorization: `Bearer ${inboundToken}`,
        "MCP-Protocol-Version": "2025-03-26",
      },
      method: "POST",
      path: "/mcp",
    });

    expect(response.status).toBe(200);
    expect(verifiedToken).toBe(inboundToken);
    expect(downstreamAuthorization).toBeNull();
    expect(response.body).not.toContain(inboundToken);
  });

  it("returns a redacted protocol error for extra fields and invalid HTTPS/date-time output", async () => {
    async function invokeTool(
      upstreamBody: unknown,
      name: "campuses_list" | "sources_list",
    ): Promise<string> {
      const server = await startServer({
        config: authlessConfig(),
        fetch: async () =>
          new Response(JSON.stringify(upstreamBody), {
            headers: { "content-type": "application/json" },
            status: 200,
          }),
      });
      const response = await server.request({
        body: JSON.stringify({
          id: 5,
          jsonrpc: "2.0",
          method: "tools/call",
          params: { arguments: {}, name },
        }),
        headers: { ...mcpHeaders, "MCP-Protocol-Version": "2025-03-26" },
        method: "POST",
        path: "/mcp",
      });
      expect(response.status).toBe(200);
      return response.body;
    }

    const secret = "private-upstream-field";
    const extraFieldResponse = await invokeTool([{ ...campus, internalSecret: secret }], "campuses_list");
    const invalidHttpsResponse = await invokeTool(
      [{ ...campus, sourceUrl: "http://example.edu/not-https" }],
      "campuses_list",
    );
    const invalidDateResponse = await invokeTool(
      { items: [{ ...source, lastCheckedAt: "not-a-date-time" }], nextCursor: null },
      "sources_list",
    );

    for (const body of [extraFieldResponse, invalidHttpsResponse, invalidDateResponse]) {
      const parsed = JSON.parse(body) as {
        readonly result: {
          readonly isError: boolean;
          readonly structuredContent: { readonly error: { readonly code: string } };
        };
      };
      expect(parsed.result.isError).toBe(true);
      expect(parsed.result.structuredContent.error.code).toBe("upstream_protocol_error");
      expect(body).not.toContain(secret);
    }
  });

  it("rejects stateful session identifiers on the stateless endpoint", async () => {
    const server = await startServer({ config: authlessConfig() });
    const response = await server.request({
      body: initializeBody(),
      headers: { ...mcpHeaders, "MCP-Session-Id": "forged-session" },
      method: "POST",
      path: "/mcp",
    });

    expect(response.status).toBe(400);
    expect(server.application.diagnostics.activeTransports).toBe(0);
  });

  it("rejects excess global concurrency before reading another request body", async () => {
    let enterVerification: (() => void) | undefined;
    let releaseVerification: (() => void) | undefined;
    const verificationEntered = new Promise<void>((resolve) => {
      enterVerification = resolve;
    });
    const verificationHold = new Promise<void>((resolve) => {
      releaseVerification = resolve;
    });
    let verificationCalls = 0;
    const server = await startServer({
      config: oauthConfig({
        MCP_GLOBAL_CONCURRENCY: "1",
        MCP_NETWORK_REQUESTS_PER_WINDOW: "20",
      }),
      tokenVerifier: {
        verify: async () => {
          verificationCalls += 1;
          enterVerification?.();
          await verificationHold;
          return {
            clientId: "client-a",
            expiresAt: Math.floor(Date.now() / 1_000) + 300,
            scopes: new Set(["campus:read"]),
            subject: "subject-a",
          };
        },
      },
    });
    const first = server.request({
      body: initializeBody(),
      headers: { ...mcpHeaders, Authorization: `Bearer ${"a".repeat(64)}` },
      method: "POST",
      path: "/mcp",
    });
    await verificationEntered;

    const rejected = await server.request({
      body: "{this body must not be parsed",
      headers: { ...mcpHeaders, Authorization: `Bearer ${"b".repeat(64)}` },
      method: "POST",
      path: "/mcp",
    });

    expect(rejected.status).toBe(429);
    expect(rejected.headers["retry-after"]).toBe("1");
    expect(rejected.body).toContain("rate_limited");
    expect(verificationCalls).toBe(1);
    expect(server.application.diagnostics.activeRequests).toBe(1);

    releaseVerification?.();
    expect((await first).status).toBe(200);
    expect(server.application.diagnostics.activeRequests).toBe(0);
  });

  it("rate-limits the no-token pre-authentication path before parsing invalid JSON", async () => {
    let verificationCalls = 0;
    const server = await startServer({
      config: oauthConfig({ MCP_NETWORK_REQUESTS_PER_WINDOW: "1" }),
      tokenVerifier: {
        verify: async () => {
          verificationCalls += 1;
          throw new Error("must not run without a bearer token");
        },
      },
    });
    const first = await server.request({
      body: initializeBody(),
      headers: mcpHeaders,
      method: "POST",
      path: "/mcp",
    });
    const second = await server.request({
      body: "{invalid-json",
      headers: mcpHeaders,
      method: "POST",
      path: "/mcp",
    });

    expect(first.status).toBe(401);
    expect(second.status).toBe(429);
    expect(Number(second.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(Number(second.headers["retry-after"])).toBeLessThanOrEqual(60);
    expect(second.body).toBe('{"error":"rate_limited"}');
    expect(verificationCalls).toBe(0);
  });

  it("isolates verified subjects and rejects a limited subject before body parsing", async () => {
    const server = await startServer({
      config: oauthConfig({
        MCP_CLIENT_REQUESTS_PER_WINDOW: "20",
        MCP_NETWORK_REQUESTS_PER_WINDOW: "20",
        MCP_SUBJECT_REQUESTS_PER_WINDOW: "1",
      }),
      tokenVerifier: {
        verify: async (token) => ({
          clientId: "shared-client",
          expiresAt: Math.floor(Date.now() / 1_000) + 300,
          scopes: new Set(["campus:read"]),
          subject: token.startsWith("a") ? "subject-a" : "subject-b",
        }),
      },
    });
    const authorization = (value: string) => ({
      ...mcpHeaders,
      Authorization: `Bearer ${value.repeat(64)}`,
    });

    expect(
      (
        await server.request({
          body: initializeBody(),
          headers: authorization("a"),
          method: "POST",
          path: "/mcp",
        })
      ).status,
    ).toBe(200);
    const repeated = await server.request({
      body: "{invalid-json",
      headers: authorization("a"),
      method: "POST",
      path: "/mcp",
    });
    expect(repeated.status).toBe(429);
    expect(
      (
        await server.request({
          body: initializeBody(),
          headers: authorization("b"),
          method: "POST",
          path: "/mcp",
        })
      ).status,
    ).toBe(200);
  });

  it("shares the verified client limit across subjects", async () => {
    const server = await startServer({
      config: oauthConfig({
        MCP_CLIENT_REQUESTS_PER_WINDOW: "1",
        MCP_NETWORK_REQUESTS_PER_WINDOW: "20",
        MCP_SUBJECT_REQUESTS_PER_WINDOW: "20",
      }),
      tokenVerifier: {
        verify: async (token) => ({
          clientId: token.startsWith("c") ? "other-client" : "shared-client",
          expiresAt: Math.floor(Date.now() / 1_000) + 300,
          scopes: new Set(["campus:read"]),
          subject: `subject-${token[0]}`,
        }),
      },
    });
    const invoke = (token: string) =>
      server.request({
        body: initializeBody(),
        headers: { ...mcpHeaders, Authorization: `Bearer ${token.repeat(64)}` },
        method: "POST",
        path: "/mcp",
      });

    expect((await invoke("a")).status).toBe(200);
    expect((await invoke("b")).status).toBe(429);
    expect((await invoke("c")).status).toBe(200);
  });

  it("ignores spoofed forwarding headers unless the immediate proxy is explicitly trusted", async () => {
    const untrusted = await startServer({
      config: oauthConfig({ MCP_NETWORK_REQUESTS_PER_WINDOW: "1" }),
    });
    const unauthenticated = (server: StartedServer, forwardedFor: string) =>
      server.request({
        body: initializeBody(),
        headers: { ...mcpHeaders, "X-Forwarded-For": forwardedFor },
        method: "POST",
        path: "/mcp",
      });

    expect((await unauthenticated(untrusted, "198.51.100.10")).status).toBe(401);
    expect((await unauthenticated(untrusted, "198.51.100.11")).status).toBe(429);

    const trusted = await startServer({
      config: oauthConfig({
        MCP_NETWORK_REQUESTS_PER_WINDOW: "1",
        MCP_TRUSTED_PROXY_IPS: "127.0.0.1",
      }),
    });
    expect((await unauthenticated(trusted, "198.51.100.10")).status).toBe(401);
    expect((await unauthenticated(trusted, "198.51.100.11")).status).toBe(401);
  });
});
