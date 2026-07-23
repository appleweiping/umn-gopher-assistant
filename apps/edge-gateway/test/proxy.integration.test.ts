import { createHmac } from "node:crypto";
import http, {
  type IncomingHttpHeaders,
  type OutgoingHttpHeaders,
  type RequestOptions,
  type Server,
} from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  AI_INGRESS_NETWORK_HEADER,
  AI_INGRESS_PROOF_EXPIRES_HEADER,
  AI_INGRESS_PROOF_HEADER,
  ingressProofPayload,
} from "../src/assertion.js";
import { loadGatewayRuntimeConfig } from "../src/config.js";
import { derivePrivacyNetworkId } from "../src/network-token.js";
import { createGatewayServer, type GatewayLogEvent, type GatewayServer } from "../src/proxy.js";

interface CapturedRequest {
  readonly body: string;
  readonly headers: IncomingHttpHeaders;
  readonly method: string | undefined;
  readonly url: string | undefined;
}

interface GatewayResponse {
  readonly body: string;
  readonly headers: IncomingHttpHeaders;
  readonly status: number;
}

const openServers: (GatewayServer | Server)[] = [];

async function listen(
  server: GatewayServer | Server,
  host: "127.0.0.1" | "::1" = "127.0.0.1",
): Promise<number> {
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return (server.address() as AddressInfo).port;
}

async function closeServer(server: GatewayServer | Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(async (server) => closeServer(server)));
});

function request(
  port: number,
  options: Readonly<{
    body?: string;
    headers?: OutgoingHttpHeaders;
    hostname?: string;
    method?: string;
    path?: string;
  }> = {},
): Promise<GatewayResponse> {
  return new Promise((resolve, reject) => {
    const requestOptions: RequestOptions = {
      headers: options.headers,
      hostname: options.hostname ?? "127.0.0.1",
      method: options.method ?? "GET",
      path: options.path ?? "/",
      port,
    };
    const client = http.request(requestOptions, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () =>
        resolve({
          body: Buffer.concat(chunks).toString("utf8"),
          headers: response.headers,
          status: response.statusCode ?? 0,
        }),
      );
    });
    client.once("error", reject);
    client.end(options.body);
  });
}

function captureRequest(
  responseBody = "proxied",
): Readonly<{ captured: Promise<CapturedRequest>; server: Server }> {
  let resolveCaptured: (request: CapturedRequest) => void = () => undefined;
  const captured = new Promise<CapturedRequest>((resolve) => {
    resolveCaptured = resolve;
  });
  const server = http.createServer((incoming, response) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      resolveCaptured({
        body: Buffer.concat(chunks).toString("utf8"),
        headers: incoming.headers,
        method: incoming.method,
        url: incoming.url,
      });
      response.setHeader("Connection", "keep-alive, x-upstream-private");
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("Content-Security-Policy", "default-src 'self'");
      response.setHeader("RateLimit-Limit", "12");
      response.setHeader("Set-Cookie", "edge-session=opaque; HttpOnly; SameSite=Strict");
      response.setHeader("X-UGA-Cache-Class", "public-vault-shell-v1");
      response.setHeader("X-Upstream-Private", "must-not-leak");
      response.setHeader("X-Gopher-Internal-AI-Proof", "must-not-leak");
      response.setHeader("X-Request-Id", "must-not-shadow-edge");
      response.end(responseBody);
    });
  });
  return { captured, server };
}

describe("real reverse-proxy boundary", () => {
  it("replaces forged AI assertions, strips peer/internal headers, and signs the BFF canonical", async () => {
    const upstream = captureRequest();
    const upstreamPort = await listen(upstream.server);
    const now = Date.UTC(2026, 6, 23, 12);
    const config = loadGatewayRuntimeConfig({
      EDGE_GATEWAY_WEB_ORIGIN: `http://127.0.0.1:${String(upstreamPort)}`,
      NODE_ENV: "test",
    });
    const logs: GatewayLogEvent[] = [];
    const gateway = createGatewayServer(config, {
      logger: { write: (event) => logs.push(event) },
      now: () => now,
    });
    const gatewayPort = await listen(gateway);

    const result = await request(gatewayPort, {
      body: '{"query":"library"}',
      headers: {
        Connection: "keep-alive, x-remove-me",
        "Content-Type": "application/json",
        Forwarded: "for=203.0.113.99",
        [AI_INGRESS_NETWORK_HEADER]: `v1.${Buffer.alloc(32, 1).toString("base64url")}`,
        [AI_INGRESS_PROOF_EXPIRES_HEADER]: "1999999999",
        [AI_INGRESS_PROOF_HEADER]: `v1.${Buffer.alloc(32, 2).toString("base64url")}`,
        "X-Forwarded-For": "203.0.113.99",
        "X-Gopher-Ingress-AI-Future": "must-not-leak",
        "X-Gopher-Internal-AI-Session": "must-not-leak",
        "X-Real-IP": "203.0.113.99",
        "X-Remove-Me": "must-not-leak",
        "X-Request-Id": "must-not-shadow-edge",
      },
      method: "POST",
      path: "/api/ai/query",
    });
    const seen = await upstream.captured;

    expect(result.status).toBe(200);
    expect(result.body).toBe("proxied");
    expect(result.headers["access-control-allow-origin"]).toBeUndefined();
    expect(result.headers["cache-control"]).toBe("private, no-store");
    expect(result.headers["content-security-policy"]).toBe("default-src 'self'");
    expect(result.headers["ratelimit-limit"]).toBe("12");
    expect(result.headers["set-cookie"]).toEqual(["edge-session=opaque; HttpOnly; SameSite=Strict"]);
    expect(result.headers["x-uga-cache-class"]).toBe("public-vault-shell-v1");
    expect(result.headers["x-upstream-private"]).toBeUndefined();
    expect(result.headers["x-gopher-internal-ai-proof"]).toBeUndefined();
    expect(result.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(seen.body).toBe('{"query":"library"}');
    expect(seen.method).toBe("POST");
    expect(seen.url).toBe("/api/ai/query");
    for (const header of [
      "forwarded",
      "x-forwarded-for",
      "x-gopher-ingress-ai-future",
      "x-gopher-internal-ai-session",
      "x-real-ip",
      "x-remove-me",
    ]) {
      expect(seen.headers[header]).toBeUndefined();
    }
    expect(seen.headers["x-request-id"]).toBe(result.headers["x-request-id"]);

    const expectedNetworkId = derivePrivacyNetworkId("127.0.0.1", config.networkHmacKey, now);
    expect(seen.headers["x-gopher-ingress-ai-network"]).toBe(`v1.${expectedNetworkId}`);
    const expires = Number(seen.headers["x-gopher-ingress-ai-proof-expires"]);
    const expectedProof = createHmac("sha256", config.assertionHmacKey)
      .update(ingressProofPayload(expectedNetworkId, expires), "utf8")
      .digest("base64url");
    expect(expires).toBe(Math.floor(now / 1_000) + 30);
    expect(seen.headers["x-gopher-ingress-ai-proof"]).toBe(`v1.${expectedProof}`);
    expect(JSON.stringify(logs)).not.toContain("127.0.0.1");
    expect(JSON.stringify(logs)).not.toContain("203.0.113.99");
  });

  it("keeps a real IPv4 peer token stable during a UTC day and rotates it the next day", async () => {
    const observed: string[] = [];
    const upstream = http.createServer((incoming, response) => {
      observed.push(String(incoming.headers["x-gopher-ingress-ai-network"]));
      incoming.resume();
      response.end("ok");
    });
    const upstreamPort = await listen(upstream);
    let now = Date.UTC(2026, 6, 23, 0, 0, 1);
    const config = loadGatewayRuntimeConfig({
      EDGE_GATEWAY_WEB_ORIGIN: `http://127.0.0.1:${String(upstreamPort)}`,
      NODE_ENV: "test",
    });
    const gateway = createGatewayServer(config, {
      logger: { write: () => undefined },
      now: () => now,
    });
    const gatewayPort = await listen(gateway);

    await request(gatewayPort, { body: "{}", method: "POST", path: "/api/ai/query" });
    now += 60_000;
    await request(gatewayPort, { body: "{}", method: "POST", path: "/api/ai/query" });
    now = Date.UTC(2026, 6, 24, 0, 0, 1);
    await request(gatewayPort, { body: "{}", method: "POST", path: "/api/ai/query" });

    expect(observed).toHaveLength(3);
    expect(observed[1]).toBe(observed[0]);
    expect(observed[2]).not.toBe(observed[0]);
  });

  it("derives an assertion from a real IPv6 loopback peer", async () => {
    const upstream = captureRequest();
    const upstreamPort = await listen(upstream.server);
    const now = Date.UTC(2026, 6, 23, 12);
    const config = loadGatewayRuntimeConfig({
      EDGE_GATEWAY_WEB_ORIGIN: `http://127.0.0.1:${String(upstreamPort)}`,
      NODE_ENV: "test",
    });
    const gateway = createGatewayServer(config, {
      logger: { write: () => undefined },
      now: () => now,
    });
    const gatewayPort = await listen(gateway, "::1");

    const result = await request(gatewayPort, {
      body: "{}",
      hostname: "::1",
      method: "POST",
      path: "/api/ai/query",
    });
    const seen = await upstream.captured;

    expect(result.status).toBe(200);
    expect(seen.headers["x-gopher-ingress-ai-network"]).toBe(
      `v1.${derivePrivacyNetworkId("::1", config.networkHmacKey, now)}`,
    );
  });

  it("streams request and response bodies instead of buffering them", async () => {
    let firstRequestChunk: () => void = () => undefined;
    const sawFirstRequestChunk = new Promise<void>((resolve) => {
      firstRequestChunk = resolve;
    });
    let upstreamResponseEnded = false;
    const upstream = http.createServer((incoming, response) => {
      let first = true;
      incoming.on("data", () => {
        if (first) {
          first = false;
          firstRequestChunk();
        }
      });
      incoming.on("end", () => {
        response.write("first-");
        setTimeout(() => {
          upstreamResponseEnded = true;
          response.end("second");
        }, 60);
      });
    });
    const upstreamPort = await listen(upstream);
    const config = loadGatewayRuntimeConfig({
      EDGE_GATEWAY_WEB_ORIGIN: `http://127.0.0.1:${String(upstreamPort)}`,
      NODE_ENV: "test",
    });
    const gateway = createGatewayServer(config, { logger: { write: () => undefined } });
    const gatewayPort = await listen(gateway);

    const streamed = new Promise<GatewayResponse>((resolve, reject) => {
      const client = http.request(
        {
          hostname: "127.0.0.1",
          method: "POST",
          path: "/stream",
          port: gatewayPort,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let first = true;
          response.on("data", (chunk: Buffer) => {
            if (first) {
              first = false;
              expect(upstreamResponseEnded).toBe(false);
            }
            chunks.push(chunk);
          });
          response.on("end", () =>
            resolve({
              body: Buffer.concat(chunks).toString("utf8"),
              headers: response.headers,
              status: response.statusCode ?? 0,
            }),
          );
        },
      );
      client.once("error", reject);
      client.write("first-request-");
      void sawFirstRequestChunk.then(() => client.end("second-request"));
    });

    const result = await streamed;
    expect(result.status).toBe(200);
    expect(result.body).toBe("first-second");
  });

  it("preserves complete partial-content semantics for streamed assets", async () => {
    const upstream = http.createServer((incoming, response) => {
      expect(incoming.headers.range).toBe("bytes=0-3");
      incoming.resume();
      response.writeHead(206, {
        "Accept-Ranges": "bytes",
        "Content-Length": "4",
        "Content-Range": "bytes 0-3/8",
        "Content-Type": "application/octet-stream",
      });
      response.end("abcd");
    });
    const upstreamPort = await listen(upstream);
    const config = loadGatewayRuntimeConfig({
      EDGE_GATEWAY_WEB_ORIGIN: `http://127.0.0.1:${String(upstreamPort)}`,
      NODE_ENV: "test",
    });
    const gateway = createGatewayServer(config, { logger: { write: () => undefined } });
    const gatewayPort = await listen(gateway);

    const result = await request(gatewayPort, {
      headers: { Range: "bytes=0-3" },
      path: "/world/tile.glb",
    });

    expect(result.status).toBe(206);
    expect(result.body).toBe("abcd");
    expect(result.headers["accept-ranges"]).toBe("bytes");
    expect(result.headers["content-length"]).toBe("4");
    expect(result.headers["content-range"]).toBe("bytes 0-3/8");
    expect(result.headers["content-type"]).toBe("application/octet-stream");
  });

  it("rejects non-standard upstream status codes instead of reflecting them", async () => {
    const upstream = http.createServer((incoming, response) => {
      incoming.resume();
      response.statusCode = 700;
      response.end("invalid status");
    });
    const upstreamPort = await listen(upstream);
    const config = loadGatewayRuntimeConfig({
      EDGE_GATEWAY_WEB_ORIGIN: `http://127.0.0.1:${String(upstreamPort)}`,
      NODE_ENV: "test",
    });
    const gateway = createGatewayServer(config, { logger: { write: () => undefined } });
    const gatewayPort = await listen(gateway);

    const result = await request(gatewayPort, { path: "/invalid-status" });

    expect(result.status).toBe(502);
    expect(result.body).toBe("invalid status");
  });

  it("fails closed before contacting Web when assertion generation cannot be trusted", async () => {
    let upstreamHits = 0;
    const upstream = http.createServer((incoming, response) => {
      upstreamHits += 1;
      incoming.resume();
      response.end("unexpected");
    });
    const upstreamPort = await listen(upstream);
    const config = loadGatewayRuntimeConfig({
      EDGE_GATEWAY_WEB_ORIGIN: `http://127.0.0.1:${String(upstreamPort)}`,
      NODE_ENV: "test",
    });
    const gateway = createGatewayServer(config, {
      logger: { write: () => undefined },
      now: () => Number.NaN,
    });
    const gatewayPort = await listen(gateway);

    const result = await request(gatewayPort, {
      body: "{}",
      method: "POST",
      path: "/api/ai/query",
    });

    expect(result.status).toBe(503);
    expect(upstreamHits).toBe(0);
    expect(result.body).not.toContain("NaN");
  });

  it("separates process liveness from bounded internal-Web readiness", async () => {
    const upstream = http.createServer((incoming, response) => {
      expect(incoming.method).toBe("HEAD");
      expect(incoming.url).toBe("/internal-ready");
      response.writeHead(204);
      response.end();
    });
    const upstreamPort = await listen(upstream);
    const config = loadGatewayRuntimeConfig({
      EDGE_GATEWAY_WEB_ORIGIN: `http://127.0.0.1:${String(upstreamPort)}`,
      EDGE_GATEWAY_WEB_READINESS_PATH: "/internal-ready",
      NODE_ENV: "test",
    });
    const gateway = createGatewayServer(config, { logger: { write: () => undefined } });
    const gatewayPort = await listen(gateway);

    expect((await request(gatewayPort, { path: "/healthz" })).status).toBe(200);
    expect((await request(gatewayPort, { path: "/readyz" })).status).toBe(200);

    await closeServer(upstream);
    const unavailable = await request(gatewayPort, { path: "/readyz" });
    expect(unavailable.status).toBe(503);
    expect(unavailable.body).toBe('{"status":"unavailable"}');
  });

  it("bounds request headers at the parser and rejects upgrades locally", async () => {
    const upstream = captureRequest();
    const upstreamPort = await listen(upstream.server);
    const config = loadGatewayRuntimeConfig({
      EDGE_GATEWAY_MAX_HEADER_BYTES: "8192",
      EDGE_GATEWAY_WEB_ORIGIN: `http://127.0.0.1:${String(upstreamPort)}`,
      NODE_ENV: "test",
    });
    const gateway = createGatewayServer(config, { logger: { write: () => undefined } });
    const gatewayPort = await listen(gateway);

    const rawResponse = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(gatewayPort, "127.0.0.1");
      const chunks: Buffer[] = [];
      socket.once("connect", () => {
        socket.write(`GET / HTTP/1.1\r\nHost: localhost\r\nX-Oversized: ${"a".repeat(9_000)}\r\n\r\n`);
      });
      socket.on("data", (chunk) => chunks.push(chunk));
      socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      socket.once("error", reject);
    });
    expect(rawResponse).toMatch(/^HTTP\/1\.1 431 /u);

    const upgradeResponse = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(gatewayPort, "127.0.0.1");
      const chunks: Buffer[] = [];
      socket.once("connect", () => {
        socket.write(
          "GET /socket HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
        );
      });
      socket.on("data", (chunk) => chunks.push(chunk));
      socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      socket.once("error", reject);
    });
    expect(upgradeResponse).toMatch(/^HTTP\/1\.1 426 /u);
  });

  it("rejects unexpected public Host values without reaching the internal Web origin", async () => {
    let upstreamHits = 0;
    const upstream = http.createServer((_incoming, response) => {
      upstreamHits += 1;
      response.end("unexpected");
    });
    const upstreamPort = await listen(upstream);
    const base = loadGatewayRuntimeConfig({
      EDGE_GATEWAY_WEB_ORIGIN: `http://127.0.0.1:${String(upstreamPort)}`,
      NODE_ENV: "test",
    });
    const gateway = createGatewayServer(
      { ...base, publicOrigin: new URL("https://assistant.example.edu") },
      { logger: { write: () => undefined } },
    );
    const gatewayPort = await listen(gateway);

    const result = await request(gatewayPort, {
      headers: { Host: "attacker.example" },
      path: "/today",
    });
    expect(result.status).toBe(421);
    expect(upstreamHits).toBe(0);
  });
});
