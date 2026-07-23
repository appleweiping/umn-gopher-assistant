import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { isAbsolute } from "node:path";

const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const LOCAL_ASSERTION_KEY = Buffer.from("development-only-ai-ingress-network-hmac-key-v1", "utf8");
const LOCAL_NETWORK_KEY = Buffer.from("development-only-edge-ai-network-hmac-key-v1", "utf8");

type Environment = Readonly<Record<string, string | undefined>>;

export interface GatewayRuntimeConfig {
  readonly assertionHmacKey: Uint8Array;
  readonly headersTimeoutMs: number;
  readonly keepAliveTimeoutMs: number;
  readonly listenHost: string;
  readonly listenPort: number;
  readonly maxHeaderBytes: number;
  readonly maxHeadersCount: number;
  readonly networkHmacKey: Uint8Array;
  readonly production: boolean;
  readonly publicOrigin: URL | undefined;
  readonly readinessPath: string;
  readonly readinessTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly shutdownGraceMs: number;
  readonly tls:
    | Readonly<{ mode: "disabled" }>
    | Readonly<{ certificateFile: string; keyFile: string; mode: "direct" }>;
  readonly upstreamInactivityTimeoutMs: number;
  readonly webOrigin: URL;
}

function environmentMode(environment: Environment): "development" | "production" | "test" {
  const value = environment["NODE_ENV"] ?? "development";
  if (value !== "development" && value !== "production" && value !== "test") {
    throw new TypeError("NODE_ENV must be development, production, or test");
  }
  return value;
}

function integerSetting(
  environment: Environment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = environment[name];
  if (value === undefined) return fallback;
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) throw new TypeError(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TypeError(`${name} must be between ${String(minimum)} and ${String(maximum)}`);
  }
  return parsed;
}

function hmacKey(
  environment: Environment,
  name: "EDGE_GATEWAY_NETWORK_HMAC_KEY" | "GOPHER_AI_INGRESS_ASSERTION_HMAC_KEY",
  fallback: Uint8Array,
  production: boolean,
): Uint8Array {
  const encoded = environment[name];
  if (encoded === undefined) {
    if (production) throw new TypeError(`${name} is required in production`);
    return new Uint8Array(fallback);
  }
  if (!BASE64URL.test(encoded)) throw new TypeError(`${name} must be canonical base64url`);
  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.toString("base64url") !== encoded || decoded.byteLength < 32 || decoded.byteLength > 64) {
    throw new TypeError(`${name} must encode 32 through 64 bytes as canonical unpadded base64url`);
  }
  if (production && decoded.equals(Buffer.from(fallback))) {
    throw new TypeError(`${name} must not use the fixed development key in production`);
  }
  return new Uint8Array(decoded);
}

function sameKey(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function originSetting(
  raw: string,
  name: "EDGE_GATEWAY_PUBLIC_ORIGIN" | "EDGE_GATEWAY_WEB_ORIGIN",
  protocols: ReadonlySet<string>,
): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError(`${name} must be an absolute URL`);
  }
  if (
    !protocols.has(parsed.protocol) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new TypeError(`${name} must be a credential-free origin using an allowed protocol`);
  }
  return parsed;
}

function tlsSetting(environment: Environment, production: boolean): GatewayRuntimeConfig["tls"] {
  const mode = environment["EDGE_GATEWAY_TLS_MODE"] ?? (production ? "direct" : "disabled");
  if (mode === "disabled") {
    if (production) throw new TypeError("EDGE_GATEWAY_TLS_MODE=direct is required in production");
    return { mode };
  }
  if (mode !== "direct") throw new TypeError("EDGE_GATEWAY_TLS_MODE must be disabled or direct");
  const certificateFile = environment["EDGE_GATEWAY_TLS_CERT_FILE"];
  const keyFile = environment["EDGE_GATEWAY_TLS_KEY_FILE"];
  if (
    certificateFile === undefined ||
    keyFile === undefined ||
    !isAbsolute(certificateFile) ||
    !isAbsolute(keyFile)
  ) {
    throw new TypeError("Direct TLS requires absolute certificate and private-key file paths");
  }
  return { certificateFile, keyFile, mode };
}

function readinessPath(environment: Environment): string {
  const value = environment["EDGE_GATEWAY_WEB_READINESS_PATH"] ?? "/";
  let hasUnsafeCharacter = false;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f || character === "\\") {
      hasUnsafeCharacter = true;
      break;
    }
  }
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("?") ||
    value.includes("#") ||
    hasUnsafeCharacter ||
    Buffer.byteLength(value, "utf8") > 1_024
  ) {
    throw new TypeError("EDGE_GATEWAY_WEB_READINESS_PATH must be a bounded absolute path");
  }
  return value;
}

function listenHost(environment: Environment, production: boolean): string {
  const value = environment["EDGE_GATEWAY_LISTEN_HOST"] ?? (production ? "0.0.0.0" : "127.0.0.1");
  const hostname =
    /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/u;
  if (value !== value.trim() || (isIP(value) === 0 && !hostname.test(value))) {
    throw new TypeError("EDGE_GATEWAY_LISTEN_HOST must be a canonical IP address or DNS hostname");
  }
  return value;
}

export function loadGatewayRuntimeConfig(environment: Environment = process.env): GatewayRuntimeConfig {
  const production = environmentMode(environment) === "production";
  const assertionHmacKey = hmacKey(
    environment,
    "GOPHER_AI_INGRESS_ASSERTION_HMAC_KEY",
    LOCAL_ASSERTION_KEY,
    production,
  );
  const networkHmacKey = hmacKey(environment, "EDGE_GATEWAY_NETWORK_HMAC_KEY", LOCAL_NETWORK_KEY, production);
  if (sameKey(assertionHmacKey, networkHmacKey)) {
    throw new TypeError("Network-token and ingress-assertion HMAC keys must be independent");
  }

  const webOriginText = environment["EDGE_GATEWAY_WEB_ORIGIN"];
  if (production && webOriginText === undefined) {
    throw new TypeError("EDGE_GATEWAY_WEB_ORIGIN is required in production");
  }
  const webOrigin = originSetting(
    webOriginText ?? "http://127.0.0.1:3000",
    "EDGE_GATEWAY_WEB_ORIGIN",
    new Set(["http:", "https:"]),
  );

  const publicOriginText = environment["EDGE_GATEWAY_PUBLIC_ORIGIN"];
  if (production && publicOriginText === undefined) {
    throw new TypeError("EDGE_GATEWAY_PUBLIC_ORIGIN is required in production");
  }
  const publicOrigin =
    publicOriginText === undefined
      ? undefined
      : originSetting(
          publicOriginText,
          "EDGE_GATEWAY_PUBLIC_ORIGIN",
          new Set(production ? ["https:"] : ["http:", "https:"]),
        );
  if (publicOrigin?.origin === webOrigin.origin) {
    throw new TypeError("Public and internal Web origins must be different");
  }

  const requestTimeoutMs = integerSetting(
    environment,
    "EDGE_GATEWAY_REQUEST_TIMEOUT_MS",
    60_000,
    5_000,
    300_000,
  );
  const headersTimeoutMs = integerSetting(
    environment,
    "EDGE_GATEWAY_HEADERS_TIMEOUT_MS",
    10_000,
    1_000,
    60_000,
  );
  if (headersTimeoutMs > requestTimeoutMs) {
    throw new TypeError("EDGE_GATEWAY_HEADERS_TIMEOUT_MS must not exceed the request timeout");
  }

  return {
    assertionHmacKey,
    headersTimeoutMs,
    keepAliveTimeoutMs: integerSetting(
      environment,
      "EDGE_GATEWAY_KEEP_ALIVE_TIMEOUT_MS",
      5_000,
      1_000,
      60_000,
    ),
    listenHost: listenHost(environment, production),
    listenPort: integerSetting(environment, "EDGE_GATEWAY_PORT", 8080, 1, 65_535),
    maxHeaderBytes: integerSetting(environment, "EDGE_GATEWAY_MAX_HEADER_BYTES", 16_384, 8_192, 65_536),
    maxHeadersCount: integerSetting(environment, "EDGE_GATEWAY_MAX_HEADERS_COUNT", 100, 20, 200),
    networkHmacKey,
    production,
    publicOrigin,
    readinessPath: readinessPath(environment),
    readinessTimeoutMs: integerSetting(environment, "EDGE_GATEWAY_READINESS_TIMEOUT_MS", 2_000, 250, 10_000),
    requestTimeoutMs,
    shutdownGraceMs: integerSetting(environment, "EDGE_GATEWAY_SHUTDOWN_GRACE_MS", 10_000, 1_000, 60_000),
    tls: tlsSetting(environment, production),
    upstreamInactivityTimeoutMs: integerSetting(
      environment,
      "EDGE_GATEWAY_UPSTREAM_INACTIVITY_TIMEOUT_MS",
      30_000,
      1_000,
      300_000,
    ),
    webOrigin,
  };
}
