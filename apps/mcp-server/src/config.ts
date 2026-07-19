import { normalizeIpAddress } from "./limits.js";

const AUTHORIZATION_SPEC_VERSIONS = ["2025-03-26", "2025-06-18", "2025-11-25"] as const;
const MCP_PROTOCOL_VERSIONS = ["2024-11-05", ...AUTHORIZATION_SPEC_VERSIONS] as const;

export type AuthorizationSpecVersion = (typeof AUTHORIZATION_SPEC_VERSIONS)[number];
export type McpProtocolVersion = (typeof MCP_PROTOCOL_VERSIONS)[number];

export interface OAuthConfig {
  readonly authorizationServer: string;
  readonly issuer: string;
  readonly jwksUrl: URL;
  readonly mode: "oauth";
}

export interface AuthlessConfig {
  readonly mode: "none";
}

export interface McpServerConfig {
  readonly allowedOrigins: ReadonlySet<string>;
  readonly apiBaseUrl: URL;
  readonly authorizationSpecVersion: AuthorizationSpecVersion;
  readonly auth: AuthlessConfig | OAuthConfig;
  readonly bindHost: string;
  readonly bodyTimeoutMs: number;
  readonly expectedHost: string;
  readonly maxBodyBytes: number;
  readonly limits: {
    readonly clientRequestsPerWindow: number;
    readonly globalConcurrency: number;
    readonly maxTrackedKeys: number;
    readonly networkRequestsPerWindow: number;
    readonly subjectRequestsPerWindow: number;
    readonly windowMs: number;
  };
  readonly nodeEnv: "development" | "production" | "test";
  readonly permittedProtocolVersions: ReadonlySet<McpProtocolVersion>;
  readonly port: number;
  readonly requiredScopes: readonly ["campus:read"];
  readonly resourceMetadataUrl: URL;
  readonly resourceUrl: URL;
  readonly rfc8707Reviewed: boolean;
  readonly trustedProxyIps: ReadonlySet<string>;
  readonly upstreamTimeoutMs: number;
}

type Environment = Readonly<Record<string, string | undefined>>;

function parseInteger(
  environment: Environment,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const raw = environment[name];
  if (raw !== undefined && !/^(?:0|[1-9][0-9]*)$/u.test(raw)) {
    throw new TypeError(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  const value = raw === undefined ? defaultValue : Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function parseTrustedProxyIps(environment: Environment): ReadonlySet<string> {
  const raw = environment["MCP_TRUSTED_PROXY_IPS"];
  if (raw === undefined || raw === "") return new Set();
  const proxies = new Set<string>();
  for (const value of raw.split(",")) {
    const address = normalizeIpAddress(value.trim());
    if (address === undefined || value.trim().length === 0) {
      throw new TypeError("MCP_TRUSTED_PROXY_IPS must contain only exact IPv4 or IPv6 addresses");
    }
    if (proxies.has(address)) {
      throw new TypeError("MCP_TRUSTED_PROXY_IPS must not contain duplicate addresses");
    }
    proxies.add(address);
  }
  if (proxies.size > 32) {
    throw new TypeError("MCP_TRUSTED_PROXY_IPS may contain at most 32 exact addresses");
  }
  return proxies;
}

function parseBoolean(environment: Environment, name: string, defaultValue = false): boolean {
  const raw = environment[name];
  if (raw === undefined) return defaultValue;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new TypeError(`${name} must be exactly true or false`);
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "[::1]" || normalized === "::1") return true;
  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(normalized);
  return match?.slice(1).every((part) => Number(part) <= 255) ?? false;
}

function parseHttpUrl(raw: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError(`${name} must be an absolute HTTP or HTTPS URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`${name} must use HTTP or HTTPS`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError(`${name} must not contain credentials, a query, or a fragment`);
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw new TypeError(`${name} may use HTTP only on an explicit loopback address`);
  }
  return url;
}

function parseOrigin(raw: string): string {
  const url = parseHttpUrl(raw.trim(), "MCP_ALLOWED_ORIGINS entry");
  if (url.pathname !== "/") {
    throw new TypeError("MCP_ALLOWED_ORIGINS entries must be origins without paths");
  }
  return url.origin;
}

function parseHost(raw: string): string {
  let url: URL;
  try {
    url = new URL(`http://${raw}`);
  } catch {
    throw new TypeError("MCP_EXPECTED_HOST must be one authority value");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new TypeError("MCP_EXPECTED_HOST must be one authority value");
  }
  return url.host.toLowerCase();
}

function parseNodeEnvironment(raw: string | undefined): McpServerConfig["nodeEnv"] {
  const value = raw ?? "development";
  if (value !== "development" && value !== "production" && value !== "test") {
    throw new TypeError("NODE_ENV must be development, production, or test");
  }
  return value;
}

function parseAuthorizationSpecVersion(raw: string | undefined): AuthorizationSpecVersion {
  const value = raw ?? "2025-03-26";
  if (!AUTHORIZATION_SPEC_VERSIONS.includes(value as AuthorizationSpecVersion)) {
    throw new TypeError(
      `MCP_AUTHORIZATION_SPEC_VERSION must be one of ${AUTHORIZATION_SPEC_VERSIONS.join(", ")}`,
    );
  }
  return value as AuthorizationSpecVersion;
}

function preserveExactUrl(raw: string, name: string): string {
  if (raw.trim() !== raw) throw new TypeError(`${name} must not contain surrounding whitespace`);
  return raw;
}

function defaultJwksUrl(issuerUrl: URL): string {
  const path = `${issuerUrl.pathname.replace(/\/+$/u, "")}/protocol/openid-connect/certs`;
  return new URL(path, issuerUrl.origin).toString();
}

function assertProductionUrl(url: URL, name: string): void {
  if (url.protocol !== "https:") throw new TypeError(`${name} must use HTTPS in production`);
}

export function loadMcpServerConfig(environment: Environment = process.env): McpServerConfig {
  const nodeEnv = parseNodeEnvironment(environment["NODE_ENV"]);
  const port = parseInteger(environment, "MCP_PORT", 4100, 1, 65_535);
  const bindHost = environment["MCP_BIND_HOST"] ?? "127.0.0.1";
  const resourceUrl = parseHttpUrl(
    environment["MCP_RESOURCE_URL"] ?? `http://127.0.0.1:${port}/mcp`,
    "MCP_RESOURCE_URL",
  );
  if (resourceUrl.pathname !== "/mcp") {
    throw new TypeError("MCP_RESOURCE_URL must use the canonical /mcp path");
  }

  const expectedHost = parseHost(environment["MCP_EXPECTED_HOST"] ?? resourceUrl.host);
  const resourceMetadataUrl = new URL(
    `/.well-known/oauth-protected-resource${resourceUrl.pathname}`,
    resourceUrl.origin,
  );
  const allowedOriginsRaw = environment["MCP_ALLOWED_ORIGINS"];
  const allowedOrigins = new Set(
    allowedOriginsRaw === undefined
      ? [resourceUrl.origin]
      : allowedOriginsRaw
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean)
          .map(parseOrigin),
  );
  if (allowedOrigins.size === 0) {
    throw new TypeError("MCP_ALLOWED_ORIGINS must contain at least one exact origin");
  }

  const apiBaseUrl = parseHttpUrl(
    environment["GOPHER_API_BASE_URL"] ?? "http://127.0.0.1:4000/",
    "GOPHER_API_BASE_URL",
  );
  const authorizationSpecVersion = parseAuthorizationSpecVersion(
    environment["MCP_AUTHORIZATION_SPEC_VERSION"],
  );
  const rfc8707Reviewed = parseBoolean(environment, "MCP_RFC8707_REVIEWED");
  if (authorizationSpecVersion !== "2025-03-26" && !rfc8707Reviewed) {
    throw new TypeError(
      "MCP authorization specifications newer than 2025-03-26 require MCP_RFC8707_REVIEWED=true",
    );
  }

  const maxProtocolIndex = MCP_PROTOCOL_VERSIONS.indexOf(authorizationSpecVersion);
  const permittedProtocolVersions = new Set(MCP_PROTOCOL_VERSIONS.slice(0, maxProtocolIndex + 1));
  const authMode = environment["MCP_AUTH_MODE"] ?? "oauth";
  let auth: McpServerConfig["auth"];

  if (authMode === "none") {
    if (!parseBoolean(environment, "MCP_ALLOW_AUTHLESS_LOOPBACK_TEST")) {
      throw new TypeError(
        "MCP_AUTH_MODE=none requires the explicit MCP_ALLOW_AUTHLESS_LOOPBACK_TEST=true gate",
      );
    }
    if (
      nodeEnv === "production" ||
      !isLoopbackHostname(bindHost) ||
      !isLoopbackHostname(resourceUrl.hostname)
    ) {
      throw new TypeError("Authless MCP is restricted to non-production explicit loopback tests");
    }
    auth = { mode: "none" };
  } else if (authMode === "oauth") {
    const defaultIssuer = "http://127.0.0.1:8080/realms/gopher-assistant-dev";
    if (nodeEnv === "production" && environment["MCP_OAUTH_ISSUER"] === undefined) {
      throw new TypeError("MCP_OAUTH_ISSUER is required in production");
    }
    const issuerRaw = environment["MCP_OAUTH_ISSUER"] ?? defaultIssuer;
    const issuerUrl = parseHttpUrl(issuerRaw, "MCP_OAUTH_ISSUER");
    const issuer = preserveExactUrl(issuerRaw, "MCP_OAUTH_ISSUER");
    const authorizationServerRaw = environment["MCP_AUTHORIZATION_SERVER"] ?? issuer;
    const authorizationServerUrl = parseHttpUrl(authorizationServerRaw, "MCP_AUTHORIZATION_SERVER");
    const authorizationServer = preserveExactUrl(authorizationServerRaw, "MCP_AUTHORIZATION_SERVER");
    const jwksUrl = parseHttpUrl(
      environment["MCP_OAUTH_JWKS_URL"] ?? defaultJwksUrl(issuerUrl),
      "MCP_OAUTH_JWKS_URL",
    );
    if (jwksUrl.origin !== issuerUrl.origin) {
      throw new TypeError("MCP_OAUTH_JWKS_URL must share the issuer origin");
    }
    if (nodeEnv === "production") {
      assertProductionUrl(resourceUrl, "MCP_RESOURCE_URL");
      assertProductionUrl(issuerUrl, "MCP_OAUTH_ISSUER");
      assertProductionUrl(authorizationServerUrl, "MCP_AUTHORIZATION_SERVER");
      assertProductionUrl(jwksUrl, "MCP_OAUTH_JWKS_URL");
      assertProductionUrl(apiBaseUrl, "GOPHER_API_BASE_URL");
    }
    auth = { authorizationServer, issuer, jwksUrl, mode: "oauth" };
  } else {
    throw new TypeError("MCP_AUTH_MODE must be oauth or none");
  }

  return {
    allowedOrigins,
    apiBaseUrl,
    authorizationSpecVersion,
    auth,
    bindHost,
    bodyTimeoutMs: parseInteger(environment, "MCP_BODY_TIMEOUT_MS", 10_000, 100, 60_000),
    expectedHost,
    maxBodyBytes: parseInteger(environment, "MCP_MAX_BODY_BYTES", 1_048_576, 1_024, 10_485_760),
    limits: {
      clientRequestsPerWindow: parseInteger(environment, "MCP_CLIENT_REQUESTS_PER_WINDOW", 240, 1, 50_000),
      globalConcurrency: parseInteger(environment, "MCP_GLOBAL_CONCURRENCY", 32, 1, 256),
      maxTrackedKeys: parseInteger(environment, "MCP_RATE_LIMIT_MAX_KEYS", 10_000, 100, 100_000),
      networkRequestsPerWindow: parseInteger(environment, "MCP_NETWORK_REQUESTS_PER_WINDOW", 120, 1, 10_000),
      subjectRequestsPerWindow: parseInteger(environment, "MCP_SUBJECT_REQUESTS_PER_WINDOW", 60, 1, 10_000),
      windowMs: parseInteger(environment, "MCP_RATE_LIMIT_WINDOW_MS", 60_000, 1_000, 3_600_000),
    },
    nodeEnv,
    permittedProtocolVersions,
    port,
    requiredScopes: ["campus:read"],
    resourceMetadataUrl,
    resourceUrl,
    rfc8707Reviewed,
    trustedProxyIps: parseTrustedProxyIps(environment),
    upstreamTimeoutMs: parseInteger(environment, "MCP_UPSTREAM_TIMEOUT_MS", 10_000, 100, 60_000),
  };
}

export function isPermittedProtocolVersion(
  config: McpServerConfig,
  value: string,
): value is McpProtocolVersion {
  return config.permittedProtocolVersions.has(value as McpProtocolVersion);
}

export function isExplicitLoopback(hostname: string): boolean {
  return isLoopbackHostname(hostname);
}
