import { randomUUID } from "node:crypto";
import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type RequestOptions,
  type ServerResponse,
} from "node:http";
import https from "node:https";

import {
  AI_INGRESS_NETWORK_HEADER,
  AI_INGRESS_PROOF_EXPIRES_HEADER,
  AI_INGRESS_PROOF_HEADER,
  createIngressAssertionHeaders,
} from "./assertion.js";
import type { GatewayRuntimeConfig } from "./config.js";
import { derivePrivacyNetworkId } from "./network-token.js";

const AI_QUERY_TARGET = "/api/ai/query";
const MAX_REQUEST_TARGET_BYTES = 8_192;
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const FORWARDING_HEADERS = new Set([
  "cf-connecting-ip",
  "client-ip",
  "fastly-client-ip",
  "fly-client-ip",
  "forwarded",
  "true-client-ip",
  "via",
  "x-client-ip",
  "x-cluster-client-ip",
  "x-envoy-external-address",
  "x-original-forwarded-for",
  "x-real-ip",
]);

export interface GatewayLogEvent {
  readonly durationMs: number;
  readonly event: "request";
  readonly method: string;
  readonly requestId: string;
  readonly route: "ai-query" | "health" | "readiness" | "web";
  readonly status: number;
}

export interface GatewayLogger {
  write(event: GatewayLogEvent): void;
}

export interface GatewayDependencies {
  readonly logger?: GatewayLogger;
  readonly now?: () => number;
  readonly tlsMaterial?: Readonly<{ certificate: Buffer | string; privateKey: Buffer | string }>;
}

export type GatewayServer = ReturnType<typeof http.createServer> | ReturnType<typeof https.createServer>;

function connectionTokens(headers: IncomingHttpHeaders): ReadonlySet<string> {
  const values = headers.connection;
  const joined = Array.isArray(values) ? values.join(",") : (values ?? "");
  const tokens = new Set<string>();
  for (const raw of joined.split(",")) {
    const value = raw.trim().toLowerCase();
    if (TOKEN.test(value)) tokens.add(value);
  }
  return tokens;
}

function isPrivateAiHeader(name: string): boolean {
  return name.startsWith("x-gopher-ingress-ai-") || name.startsWith("x-gopher-internal-ai-");
}

function isForwardingHeader(name: string): boolean {
  return name.startsWith("x-forwarded-") || FORWARDING_HEADERS.has(name);
}

function appendRawHeader(headers: string[], name: string, value: string | readonly string[]): void {
  if (typeof value === "string") {
    headers.push(name, value);
    return;
  }
  for (const item of value) headers.push(name, item);
}

function sanitizedRequestHeaders(headers: IncomingHttpHeaders): string[] {
  const connectionSpecific = connectionTokens(headers);
  const sanitized: string[] = [];
  for (const [rawName, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const name = rawName.toLowerCase();
    if (
      HOP_BY_HOP.has(name) ||
      connectionSpecific.has(name) ||
      isPrivateAiHeader(name) ||
      isForwardingHeader(name) ||
      name === "expect" ||
      name === "host" ||
      name === "x-request-id"
    ) {
      continue;
    }
    appendRawHeader(sanitized, name, value);
  }
  return sanitized;
}

function applyAllowedResponseHeaders(response: ServerResponse, headers: IncomingHttpHeaders): void {
  const connectionSpecific = connectionTokens(headers);
  for (const [rawName, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const name = rawName.toLowerCase();
    if (
      HOP_BY_HOP.has(name) ||
      connectionSpecific.has(name) ||
      isPrivateAiHeader(name) ||
      name === "server" ||
      name === "x-powered-by" ||
      name === "x-request-id"
    ) {
      continue;
    }

    switch (name) {
      case "accept-ranges":
        response.setHeader("Accept-Ranges", value);
        break;
      case "allow":
        response.setHeader("Allow", value);
        break;
      case "cache-control":
        response.setHeader("Cache-Control", value);
        break;
      case "content-disposition":
        response.setHeader("Content-Disposition", value);
        break;
      case "content-encoding":
        response.setHeader("Content-Encoding", value);
        break;
      case "content-language":
        response.setHeader("Content-Language", value);
        break;
      case "content-length":
        response.setHeader("Content-Length", value);
        break;
      case "content-location":
        response.setHeader("Content-Location", value);
        break;
      case "content-range":
        response.setHeader("Content-Range", value);
        break;
      case "content-security-policy":
        response.setHeader("Content-Security-Policy", value);
        break;
      case "content-security-policy-report-only":
        response.setHeader("Content-Security-Policy-Report-Only", value);
        break;
      case "content-type":
        response.setHeader("Content-Type", value);
        break;
      case "cross-origin-embedder-policy":
        response.setHeader("Cross-Origin-Embedder-Policy", value);
        break;
      case "cross-origin-opener-policy":
        response.setHeader("Cross-Origin-Opener-Policy", value);
        break;
      case "cross-origin-resource-policy":
        response.setHeader("Cross-Origin-Resource-Policy", value);
        break;
      case "date":
        response.setHeader("Date", value);
        break;
      case "deprecation":
        response.setHeader("Deprecation", value);
        break;
      case "etag":
        response.setHeader("ETag", value);
        break;
      case "expires":
        response.setHeader("Expires", value);
        break;
      case "last-modified":
        response.setHeader("Last-Modified", value);
        break;
      case "link":
        response.setHeader("Link", value);
        break;
      case "location":
        response.setHeader("Location", value);
        break;
      case "permissions-policy":
        response.setHeader("Permissions-Policy", value);
        break;
      case "ratelimit-limit":
        response.setHeader("RateLimit-Limit", value);
        break;
      case "ratelimit-remaining":
        response.setHeader("RateLimit-Remaining", value);
        break;
      case "ratelimit-reset":
        response.setHeader("RateLimit-Reset", value);
        break;
      case "referrer-policy":
        response.setHeader("Referrer-Policy", value);
        break;
      case "reporting-endpoints":
        response.setHeader("Reporting-Endpoints", value);
        break;
      case "retry-after":
        response.setHeader("Retry-After", value);
        break;
      case "server-timing":
        response.setHeader("Server-Timing", value);
        break;
      case "service-worker-allowed":
        response.setHeader("Service-Worker-Allowed", value);
        break;
      case "set-cookie":
        response.setHeader("Set-Cookie", value);
        break;
      case "strict-transport-security":
        response.setHeader("Strict-Transport-Security", value);
        break;
      case "sunset":
        response.setHeader("Sunset", value);
        break;
      case "vary":
        response.setHeader("Vary", value);
        break;
      case "www-authenticate":
        response.setHeader("WWW-Authenticate", value);
        break;
      case "x-action-redirect":
        response.setHeader("X-Action-Redirect", value);
        break;
      case "x-action-revalidated":
        response.setHeader("X-Action-Revalidated", value);
        break;
      case "x-content-type-options":
        response.setHeader("X-Content-Type-Options", value);
        break;
      case "x-dns-prefetch-control":
        response.setHeader("X-DNS-Prefetch-Control", value);
        break;
      case "x-frame-options":
        response.setHeader("X-Frame-Options", value);
        break;
      case "x-nextjs-postponed":
        response.setHeader("X-Nextjs-Postponed", value);
        break;
      case "x-nextjs-stale-time":
        response.setHeader("X-Nextjs-Stale-Time", value);
        break;
      case "x-ratelimit-limit":
        response.setHeader("X-RateLimit-Limit", value);
        break;
      case "x-ratelimit-remaining":
        response.setHeader("X-RateLimit-Remaining", value);
        break;
      case "x-ratelimit-reset":
        response.setHeader("X-RateLimit-Reset", value);
        break;
      case "x-robots-tag":
        response.setHeader("X-Robots-Tag", value);
        break;
      case "x-uga-cache-class":
        response.setHeader("X-UGA-Cache-Class", value);
        break;
    }
  }
}

function validatedTarget(
  rawTarget: string | undefined,
): Readonly<{ pathname: string; target: string }> | undefined {
  let hasUnsafeCharacter = false;
  if (rawTarget !== undefined) {
    for (const character of rawTarget) {
      const codePoint = character.codePointAt(0) ?? 0;
      if (codePoint <= 0x1f || codePoint === 0x7f || character === "\\") {
        hasUnsafeCharacter = true;
        break;
      }
    }
  }
  if (
    rawTarget === undefined ||
    Buffer.byteLength(rawTarget, "utf8") > MAX_REQUEST_TARGET_BYTES ||
    !rawTarget.startsWith("/") ||
    rawTarget.startsWith("//") ||
    rawTarget.includes("#") ||
    hasUnsafeCharacter
  ) {
    return undefined;
  }
  try {
    const parsed = new URL(rawTarget, "http://edge-gateway.invalid");
    if (parsed.origin !== "http://edge-gateway.invalid") return undefined;
    return { pathname: parsed.pathname, target: rawTarget };
  } catch {
    return undefined;
  }
}

function routeKind(method: string, target: string): GatewayLogEvent["route"] {
  if (method === "POST" && target === AI_QUERY_TARGET) return "ai-query";
  if (target === "/healthz") return "health";
  return target === "/readyz" ? "readiness" : "web";
}

function validatedUpstreamStatus(statusCode: number | undefined): number {
  return statusCode !== undefined && Number.isInteger(statusCode) && statusCode >= 200 && statusCode <= 599
    ? statusCode
    : 502;
}

function problem(
  response: ServerResponse,
  status: 400 | 421 | 426 | 431 | 502 | 503 | 504,
  title: string,
  requestId: string,
): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  const body = Buffer.from(
    JSON.stringify({
      status,
      title,
      traceId: requestId,
      type: "about:blank",
    }),
    "utf8",
  );
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": String(body.byteLength),
    "Content-Type": "application/problem+json",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": requestId,
  });
  response.end(body);
}

function health(response: ServerResponse, requestId: string): void {
  const body = Buffer.from('{"status":"ok"}', "utf8");
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Length": String(body.byteLength),
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": requestId,
  });
  response.end(body);
}

function readinessResponse(response: ServerResponse, requestId: string, ready: boolean): void {
  const body = Buffer.from(ready ? '{"status":"ready"}' : '{"status":"unavailable"}', "utf8");
  response.writeHead(ready ? 200 : 503, {
    "Cache-Control": "no-store",
    "Content-Length": String(body.byteLength),
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": requestId,
  });
  response.end(body);
}

function probeReadiness(config: GatewayRuntimeConfig, response: ServerResponse, requestId: string): void {
  const transport = config.webOrigin.protocol === "https:" ? https : http;
  const options: RequestOptions & { servername?: string } = {
    headers: {
      host: config.publicOrigin?.host ?? config.webOrigin.host,
      "user-agent": "umn-gopher-edge-readiness/1",
    },
    hostname: config.webOrigin.hostname,
    maxHeaderSize: config.maxHeaderBytes,
    method: "HEAD",
    path: config.readinessPath,
    port: config.webOrigin.port,
    protocol: config.webOrigin.protocol,
  };
  if (config.webOrigin.protocol === "https:") options.servername = config.webOrigin.hostname;
  let completed = false;
  const finish = (ready: boolean): void => {
    if (completed) return;
    completed = true;
    readinessResponse(response, requestId, ready);
  };
  const probe = transport.request(options, (upstreamResponse) => {
    const ready = (upstreamResponse.statusCode ?? 500) < 500;
    upstreamResponse.resume();
    finish(ready);
  });
  probe.setTimeout(config.readinessTimeoutMs, () => probe.destroy());
  probe.once("error", () => finish(false));
  response.once("close", () => probe.destroy());
  probe.end();
}

function isExpectedPublicHost(request: IncomingMessage, config: GatewayRuntimeConfig): boolean {
  if (config.publicOrigin === undefined) return true;
  const host = request.headers.host;
  return typeof host === "string" && host.toLowerCase() === config.publicOrigin.host.toLowerCase();
}

function proxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  target: Readonly<{ pathname: string; target: string }>,
  config: GatewayRuntimeConfig,
  dependencies: GatewayDependencies,
  requestId: string,
): void {
  const method = request.method ?? "GET";
  const outgoingHeaders = sanitizedRequestHeaders(request.headers);
  appendRawHeader(outgoingHeaders, "Host", config.publicOrigin?.host ?? config.webOrigin.host);
  appendRawHeader(outgoingHeaders, "X-Request-Id", requestId);
  if (config.publicOrigin !== undefined) {
    appendRawHeader(outgoingHeaders, "X-Forwarded-Host", config.publicOrigin.host);
    appendRawHeader(outgoingHeaders, "X-Forwarded-Proto", config.publicOrigin.protocol.slice(0, -1));
  }

  if (method === "POST" && target.target === AI_QUERY_TARGET) {
    try {
      const remoteAddress = request.socket.remoteAddress;
      if (remoteAddress === undefined) throw new TypeError("The peer socket address is unavailable");
      const now = dependencies.now?.() ?? Date.now();
      const networkId = derivePrivacyNetworkId(remoteAddress, config.networkHmacKey, now);
      const assertion = createIngressAssertionHeaders(networkId, config.assertionHmacKey, now);
      appendRawHeader(outgoingHeaders, AI_INGRESS_NETWORK_HEADER, assertion[AI_INGRESS_NETWORK_HEADER]);
      appendRawHeader(
        outgoingHeaders,
        AI_INGRESS_PROOF_EXPIRES_HEADER,
        assertion[AI_INGRESS_PROOF_EXPIRES_HEADER],
      );
      appendRawHeader(outgoingHeaders, AI_INGRESS_PROOF_HEADER, assertion[AI_INGRESS_PROOF_HEADER]);
    } catch {
      request.resume();
      problem(response, 503, "Trusted ingress assertion unavailable", requestId);
      return;
    }
  }

  const transport = config.webOrigin.protocol === "https:" ? https : http;
  const options: RequestOptions & { servername?: string } = {
    headers: outgoingHeaders,
    hostname: config.webOrigin.hostname,
    maxHeaderSize: config.maxHeaderBytes,
    method,
    path: target.target,
    port: config.webOrigin.port,
    protocol: config.webOrigin.protocol,
  };
  if (config.webOrigin.protocol === "https:") options.servername = config.webOrigin.hostname;

  let responseStarted = false;
  let timedOut = false;
  let failureHandled = false;
  const upstream = transport.request(options);
  const fail = (): void => {
    if (failureHandled) return;
    failureHandled = true;
    if (responseStarted) {
      response.destroy();
    } else {
      request.resume();
      problem(response, timedOut ? 504 : 502, timedOut ? "Gateway timeout" : "Bad gateway", requestId);
    }
  };

  upstream.setTimeout(config.upstreamInactivityTimeoutMs, () => {
    timedOut = true;
    upstream.destroy();
  });
  upstream.once("error", fail);
  request.once("aborted", () => upstream.destroy());
  response.once("close", () => {
    if (!response.writableFinished) upstream.destroy();
  });

  upstream.once("response", (upstreamResponse) => {
    responseStarted = true;
    upstreamResponse.setTimeout(config.upstreamInactivityTimeoutMs, () => {
      timedOut = true;
      upstreamResponse.destroy();
    });
    upstreamResponse.once("aborted", fail);
    upstreamResponse.once("error", fail);
    applyAllowedResponseHeaders(response, upstreamResponse.headers);
    response.setHeader("X-Request-Id", requestId);
    response.statusCode = validatedUpstreamStatus(upstreamResponse.statusCode);
    response.flushHeaders();
    upstreamResponse.pipe(response);
  });
  request.pipe(upstream);
}

function safeDefaultLogger(): GatewayLogger {
  return {
    write(event) {
      process.stdout.write(`${JSON.stringify(event)}\n`);
    },
  };
}

export function createGatewayServer(
  config: GatewayRuntimeConfig,
  dependencies: GatewayDependencies = {},
): GatewayServer {
  const logger = dependencies.logger ?? safeDefaultLogger();
  const handler = (request: IncomingMessage, response: ServerResponse): void => {
    const started = performance.now();
    const requestId = randomUUID();
    const method = request.method ?? "GET";
    const target = validatedTarget(request.url);
    const route = routeKind(method, target?.target ?? "");
    let logged = false;
    const log = (): void => {
      if (logged) return;
      logged = true;
      logger.write({
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        event: "request",
        method,
        requestId,
        route,
        status: response.statusCode,
      });
    };
    response.once("finish", log);
    response.once("close", log);

    if (target === undefined) {
      request.resume();
      problem(response, 400, "Bad request", requestId);
      return;
    }
    if (target.target === "/healthz") {
      request.resume();
      if (method === "GET") health(response, requestId);
      else problem(response, 400, "Health check requires GET", requestId);
      return;
    }
    if (target.target === "/readyz") {
      request.resume();
      if (method === "GET") probeReadiness(config, response, requestId);
      else problem(response, 400, "Readiness check requires GET", requestId);
      return;
    }
    if (!isExpectedPublicHost(request, config)) {
      request.resume();
      problem(response, 421, "Misdirected request", requestId);
      return;
    }
    proxyRequest(request, response, target, config, dependencies, requestId);
  };

  const serverOptions = {
    headersTimeout: config.headersTimeoutMs,
    keepAliveTimeout: config.keepAliveTimeoutMs,
    maxHeaderSize: config.maxHeaderBytes,
    requestTimeout: config.requestTimeoutMs,
  };
  const server =
    config.tls.mode === "direct"
      ? https.createServer(
          {
            ...serverOptions,
            cert: dependencies.tlsMaterial?.certificate,
            honorCipherOrder: true,
            key: dependencies.tlsMaterial?.privateKey,
            maxVersion: "TLSv1.3",
            minVersion: "TLSv1.2",
          },
          handler,
        )
      : http.createServer(serverOptions, handler);
  if (config.tls.mode === "direct" && dependencies.tlsMaterial === undefined) {
    throw new TypeError("Direct TLS key material was not loaded");
  }
  server.maxHeadersCount = config.maxHeadersCount;
  server.on("clientError", (_error, socket) => {
    if (socket.writable) {
      socket.end(
        "HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
    }
  });
  server.on("upgrade", (_request, socket) => {
    socket.end("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  });
  return server;
}
