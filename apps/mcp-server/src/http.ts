import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { JoseAccessTokenVerifier, parseDpopAccessToken } from "./auth.js";
import type { AccessTokenVerifier, VerifiedAccessIdentity } from "./auth.js";
import { isPermittedProtocolVersion } from "./config.js";
import type { McpServerConfig } from "./config.js";
import { BoundedFixedWindowRateLimiter, ConcurrencyGate, resolveClientAddress } from "./limits.js";
import { createProtocolServer, MCP_TOOL_CATALOG, McpToolService } from "./tools.js";
import { DpopVerificationError, RedisDpopProofVerifier, type DpopProofVerifier } from "./dpop.js";

const serviceName = "gopher-mcp-server";
const serviceVersion = "0.1.0";

export interface McpServerLogger {
  error(event: string): void;
}

export interface CreateMcpHttpApplicationOptions {
  readonly config: McpServerConfig;
  readonly dpopVerifier?: DpopProofVerifier;
  readonly fetch?: typeof fetch;
  readonly logger?: McpServerLogger;
  readonly tokenVerifier?: AccessTokenVerifier;
}

export interface McpHttpApplication {
  readonly diagnostics: {
    readonly activeRequests: number;
    readonly activeTransports: number;
    readonly rateLimitEntries: number;
  };
  close(): Promise<void>;
  handle(request: IncomingMessage, response: ServerResponse): Promise<void>;
}

class RequestBodyError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("Request body rejected");
    this.name = "RequestBodyError";
    this.status = status;
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent || response.writableEnded) return;
  const serialized = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Length", Buffer.byteLength(serialized));
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(serialized);
}

function sendEmpty(response: ServerResponse, status: number): void {
  if (response.headersSent || response.writableEnded) return;
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Length", "0");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end();
}

function singleHeader(request: IncomingMessage, name: string): string | undefined {
  const matches: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name.toLowerCase()) {
      const value = request.rawHeaders[index + 1];
      if (value !== undefined) matches.push(value);
    }
  }
  if (matches.length > 1) throw new RequestBodyError(400);
  return matches[0];
}

function setCorsHeaders(response: ServerResponse, origin: string): void {
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader(
    "Access-Control-Expose-Headers",
    "dpop-nonce, mcp-protocol-version, retry-after, www-authenticate",
  );
  response.setHeader("Vary", "Origin");
}

function requestMayHaveUnreadBody(request: IncomingMessage): boolean {
  const contentLength = request.headers["content-length"];
  return (
    request.headers["transfer-encoding"] !== undefined ||
    (contentLength !== undefined && contentLength !== "0")
  );
}

function closeConnectionAfterResponse(request: IncomingMessage, response: ServerResponse): void {
  if (!response.headersSent) response.setHeader("Connection", "close");
  response.shouldKeepAlive = false;
  const socket = request.socket;
  const close = () => {
    if (socket.destroyed) return;
    socket.end();
    const forceClose = setTimeout(() => socket.destroy(), 250);
    forceClose.unref();
    socket.once("close", () => clearTimeout(forceClose));
  };
  if (response.writableFinished) close();
  else response.once("finish", close);
}

function sendJsonBeforeBody(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  if (requestMayHaveUnreadBody(request)) closeConnectionAfterResponse(request, response);
  sendJson(response, status, body);
}

function sendEmptyBeforeBody(request: IncomingMessage, response: ServerResponse, status: number): void {
  if (requestMayHaveUnreadBody(request)) closeConnectionAfterResponse(request, response);
  sendEmpty(response, status);
}

function sendRateLimited(
  request: IncomingMessage,
  response: ServerResponse,
  retryAfterSeconds: number,
): void {
  closeConnectionAfterResponse(request, response);
  response.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfterSeconds))));
  sendJson(response, 429, { error: "rate_limited" });
}

function acceptsStreamableHttp(request: IncomingMessage): boolean {
  const accepted = (request.headers.accept ?? "")
    .split(",")
    .map((value) => value.split(";", 1)[0]?.trim().toLowerCase());
  return accepted.includes("application/json") && accepted.includes("text/event-stream");
}

function isJsonContentType(request: IncomingMessage): boolean {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  return contentType === "application/json";
}

function extractInitializeProtocolVersions(body: unknown): readonly string[] {
  const messages = Array.isArray(body) ? body : [body];
  const versions: string[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const record = message as Record<string, unknown>;
    if (record["method"] !== "initialize") continue;
    const params = record["params"];
    if (!params || typeof params !== "object") continue;
    const version = (params as Record<string, unknown>)["protocolVersion"];
    if (typeof version === "string") versions.push(version);
  }
  return versions;
}

async function readJsonBody(request: IncomingMessage, config: McpServerConfig): Promise<unknown> {
  const declaredLength = request.headers["content-length"];
  if (declaredLength !== undefined) {
    const numericLength = Number(declaredLength);
    if (!Number.isSafeInteger(numericLength) || numericLength < 0) throw new RequestBodyError(400);
    if (numericLength > config.maxBodyBytes) throw new RequestBodyError(413);
  }

  return new Promise((resolve, reject) => {
    let byteLength = 0;
    const chunks: Buffer[] = [];
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeout);
      request.off("aborted", onAborted);
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAborted = () => finish(() => reject(new RequestBodyError(400)));
    const onError = () => finish(() => reject(new RequestBodyError(400)));
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += buffer.byteLength;
      if (byteLength > config.maxBodyBytes) {
        finish(() => reject(new RequestBodyError(413)));
        request.resume();
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => {
      finish(() => {
        if (byteLength === 0) {
          reject(new RequestBodyError(400));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks, byteLength).toString("utf8")) as unknown);
        } catch {
          reject(new RequestBodyError(400));
        }
      });
    };
    const timeout = setTimeout(() => {
      finish(() => reject(new RequestBodyError(408)));
      request.resume();
    }, config.bodyTimeoutMs);
    timeout.unref();
    request.on("aborted", onAborted);
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
  });
}

function dpopChallenge(
  config: McpServerConfig,
  error?: "invalid_dpop_proof" | "invalid_token" | "use_dpop_nonce",
): string {
  const parameters = [
    `resource_metadata="${config.resourceMetadataUrl.toString()}"`,
    `scope="${config.requiredScopes.join(" ")}"`,
  ];
  if (error !== undefined) parameters.push(`error="${error}"`);
  return `DPoP ${parameters.join(", ")}`;
}

function protectedResourceMetadata(config: McpServerConfig): Record<string, unknown> {
  if (config.auth.mode !== "oauth") {
    return {
      authorization_servers: [],
      bearer_methods_supported: [],
      resource: config.resourceUrl.toString(),
      resource_name: "UMN Gopher Assistant MCP (local authless test)",
      scopes_supported: [],
    };
  }
  return {
    authorization_servers: [config.auth.authorizationServer],
    bearer_methods_supported: [],
    dpop_signing_alg_values_supported: ["ES256"],
    resource: config.resourceUrl.toString(),
    resource_name: "UMN Gopher Assistant MCP",
    scopes_supported: [...config.requiredScopes],
  };
}

type AuthenticationOutcome =
  | { readonly accepted: false }
  | { readonly accepted: true; readonly identity?: VerifiedAccessIdentity };

async function authenticate(
  request: IncomingMessage,
  response: ServerResponse,
  config: McpServerConfig,
  verifier: AccessTokenVerifier | undefined,
  proofVerifier: DpopProofVerifier | undefined,
): Promise<AuthenticationOutcome> {
  if (config.auth.mode === "none") return { accepted: true };
  const authorization = singleHeader(request, "authorization");
  try {
    const token = parseDpopAccessToken(authorization);
    if (verifier === undefined || proofVerifier === undefined) {
      throw new Error("Missing OAuth verifier");
    }
    const identity = await verifier.verify(token);
    const proof = singleHeader(request, "dpop");
    if (proof === undefined) throw new DpopVerificationError("invalid");
    await proofVerifier.verify({
      accessToken: token,
      identity,
      method: request.method ?? "",
      proof,
    });
    return { accepted: true, identity };
  } catch (error) {
    if (error instanceof DpopVerificationError && error.kind === "unavailable") {
      sendJsonBeforeBody(request, response, 503, {
        error: "dpop_replay_protection_unavailable",
      });
      return { accepted: false };
    }
    const challengeError =
      error instanceof DpopVerificationError
        ? error.kind === "nonce"
          ? "use_dpop_nonce"
          : "invalid_dpop_proof"
        : authorization === undefined
          ? undefined
          : "invalid_token";
    response.setHeader("WWW-Authenticate", dpopChallenge(config, challengeError));
    if (error instanceof DpopVerificationError && error.kind === "nonce" && error.nonce !== undefined) {
      response.setHeader("DPoP-Nonce", error.nonce);
    }
    sendJsonBeforeBody(request, response, 401, { error: "unauthorized" });
    return { accepted: false };
  }
}

export function createMcpHttpApplication(options: CreateMcpHttpApplicationOptions): McpHttpApplication {
  const { config } = options;
  const logger = options.logger ?? { error: () => undefined };
  const verifier =
    config.auth.mode === "oauth" ? (options.tokenVerifier ?? new JoseAccessTokenVerifier(config)) : undefined;
  const proofVerifier =
    config.auth.mode === "oauth" ? (options.dpopVerifier ?? new RedisDpopProofVerifier(config)) : undefined;
  const toolService = new McpToolService({
    apiBaseUrl: config.apiBaseUrl,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    upstreamTimeoutMs: config.upstreamTimeoutMs,
  });
  const concurrencyGate = new ConcurrencyGate(config.limits.globalConcurrency);
  const rateLimiter = new BoundedFixedWindowRateLimiter({
    maxEntries: config.limits.maxTrackedKeys,
    windowMs: config.limits.windowMs,
  });
  let activeTransports = 0;

  const application: McpHttpApplication = {
    close: async () => {
      await proofVerifier?.close?.();
    },
    diagnostics: {
      get activeRequests() {
        return concurrencyGate.active;
      },
      get activeTransports() {
        return activeTransports;
      },
      get rateLimitEntries() {
        return rateLimiter.size;
      },
    },
    async handle(request, response) {
      try {
        const host = singleHeader(request, "host")?.toLowerCase();
        if (host !== config.expectedHost) {
          sendJsonBeforeBody(request, response, 421, { error: "misdirected_request" });
          return;
        }

        const origin = singleHeader(request, "origin");
        if (origin !== undefined) {
          let canonicalOrigin: string;
          try {
            canonicalOrigin = new URL(origin).origin;
          } catch {
            sendJsonBeforeBody(request, response, 403, { error: "origin_not_allowed" });
            return;
          }
          if (origin !== canonicalOrigin || !config.allowedOrigins.has(canonicalOrigin)) {
            sendJsonBeforeBody(request, response, 403, { error: "origin_not_allowed" });
            return;
          }
          setCorsHeaders(response, canonicalOrigin);
        }

        const clientAddress = resolveClientAddress(
          request.socket.remoteAddress,
          singleHeader(request, "x-forwarded-for"),
          config.trustedProxyIps,
        );
        const networkDecision = rateLimiter.consume([
          { key: `network:${clientAddress}`, limit: config.limits.networkRequestsPerWindow },
        ]);
        if (!networkDecision.allowed) {
          sendRateLimited(request, response, networkDecision.retryAfterSeconds);
          return;
        }

        const releaseRequest = concurrencyGate.tryAcquire();
        if (releaseRequest === undefined) {
          sendRateLimited(request, response, 1);
          return;
        }
        try {
          const requestTarget = request.url ?? "";
          if (
            !requestTarget.startsWith("/") ||
            requestTarget.startsWith("//") ||
            requestTarget.includes("\\")
          ) {
            sendJsonBeforeBody(request, response, 400, { error: "invalid_request_target" });
            return;
          }
          const url = new URL(requestTarget, config.resourceUrl.origin);
          if (url.search || url.hash) {
            sendJsonBeforeBody(request, response, 404, { error: "not_found" });
            return;
          }

          if (url.pathname === "/healthz") {
            if (request.method !== "GET") {
              response.setHeader("Allow", "GET");
              sendEmptyBeforeBody(request, response, 405);
              return;
            }
            sendJsonBeforeBody(request, response, 200, {
              service: serviceName,
              status: "ok",
              version: serviceVersion,
            });
            return;
          }
          if (url.pathname === "/readyz") {
            if (request.method !== "GET") {
              response.setHeader("Allow", "GET");
              sendEmptyBeforeBody(request, response, 405);
              return;
            }
            let replayProtectionReady = true;
            try {
              replayProtectionReady = (await proofVerifier?.ready?.()) ?? true;
            } catch {
              replayProtectionReady = false;
            }
            if (!replayProtectionReady) {
              sendJsonBeforeBody(request, response, 503, {
                dependency: "dpop_replay_store",
                service: serviceName,
                status: "not_ready",
              });
              return;
            }
            sendJsonBeforeBody(request, response, 200, {
              auth: config.auth.mode,
              service: serviceName,
              status: "ready",
              tools: MCP_TOOL_CATALOG.length,
            });
            return;
          }
          if (url.pathname === config.resourceMetadataUrl.pathname) {
            if (request.method !== "GET") {
              response.setHeader("Allow", "GET");
              sendEmptyBeforeBody(request, response, 405);
              return;
            }
            sendJsonBeforeBody(request, response, 200, protectedResourceMetadata(config));
            return;
          }
          if (url.pathname !== config.resourceUrl.pathname) {
            sendJsonBeforeBody(request, response, 404, { error: "not_found" });
            return;
          }

          if (request.method === "OPTIONS") {
            if (origin === undefined) {
              sendJsonBeforeBody(request, response, 400, { error: "origin_required" });
              return;
            }
            response.setHeader(
              "Access-Control-Allow-Headers",
              "authorization, content-type, dpop, mcp-protocol-version",
            );
            response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
            response.setHeader("Access-Control-Max-Age", "600");
            sendEmptyBeforeBody(request, response, 204);
            return;
          }
          if (request.method !== "POST") {
            response.setHeader("Allow", "POST, OPTIONS");
            sendEmptyBeforeBody(request, response, 405);
            return;
          }
          if (!acceptsStreamableHttp(request)) {
            sendJsonBeforeBody(request, response, 406, { error: "not_acceptable" });
            return;
          }
          if (!isJsonContentType(request) || request.headers["content-encoding"] !== undefined) {
            sendJsonBeforeBody(request, response, 415, { error: "unsupported_media_type" });
            return;
          }
          if (singleHeader(request, "mcp-session-id") !== undefined) {
            sendJsonBeforeBody(request, response, 400, {
              error: "stateless_server_rejects_session_id",
            });
            return;
          }
          const authentication = await authenticate(request, response, config, verifier, proofVerifier);
          if (!authentication.accepted) return;

          if (authentication.identity !== undefined) {
            const identityCharges = [
              {
                key: `subject:${authentication.identity.subject}`,
                limit: config.limits.subjectRequestsPerWindow,
              },
              {
                key: `client:${authentication.identity.clientId}`,
                limit: config.limits.clientRequestsPerWindow,
              },
            ];
            const identityDecision = rateLimiter.consume(identityCharges);
            if (!identityDecision.allowed) {
              sendRateLimited(request, response, identityDecision.retryAfterSeconds);
              return;
            }
          }

          let body: unknown;
          try {
            body = await readJsonBody(request, config);
          } catch (error) {
            const status = error instanceof RequestBodyError ? error.status : 400;
            if (status === 408 || status === 413) {
              closeConnectionAfterResponse(request, response);
              request.resume();
            }
            sendJson(response, status, { error: "invalid_request_body" });
            return;
          }

          const protocolHeader = singleHeader(request, "mcp-protocol-version");
          if (protocolHeader !== undefined && !isPermittedProtocolVersion(config, protocolHeader)) {
            sendJson(response, 400, { error: "unsupported_mcp_protocol_version" });
            return;
          }
          const initializeVersions = extractInitializeProtocolVersions(body);
          if (initializeVersions.some((version) => !isPermittedProtocolVersion(config, version))) {
            sendJson(response, 400, { error: "unsupported_mcp_protocol_version" });
            return;
          }
          if (initializeVersions.length === 0 && protocolHeader === undefined) {
            sendJson(response, 400, { error: "mcp_protocol_version_required" });
            return;
          }

          const protocolServer = createProtocolServer(toolService);
          const transport = new StreamableHTTPServerTransport({
            enableJsonResponse: true,
          });
          activeTransports += 1;
          try {
            // SDK 1.29 compiles its optional Transport callbacks without
            // exactOptionalPropertyTypes. The concrete class is compatible at
            // runtime; isolate that declaration mismatch at this boundary.
            type ProtocolTransport = Parameters<typeof protocolServer.connect>[0];
            await protocolServer.connect(transport as unknown as ProtocolTransport);
            await transport.handleRequest(request, response, body);
          } catch {
            logger.error("mcp_request_failed");
            sendJson(response, 500, {
              error: { code: -32603, message: "Internal server error" },
              id: null,
              jsonrpc: "2.0",
            });
          } finally {
            try {
              await protocolServer.close();
            } catch {
              logger.error("mcp_transport_cleanup_failed");
            }
            activeTransports -= 1;
          }
        } finally {
          releaseRequest();
        }
      } catch {
        logger.error("http_boundary_rejected");
        sendJsonBeforeBody(request, response, 400, { error: "invalid_request" });
      }
    },
  };
  return application;
}

export function createMcpHttpServer(options: CreateMcpHttpApplicationOptions): {
  readonly application: McpHttpApplication;
  readonly server: Server;
} {
  const application = createMcpHttpApplication(options);
  const server = createServer({ maxHeaderSize: 16_384 }, (request, response) => {
    void application.handle(request, response);
  });
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.requestTimeout = options.config.bodyTimeoutMs + options.config.upstreamTimeoutMs + 5_000;
  server.once("close", () => {
    void application.close();
  });
  return { application, server };
}
