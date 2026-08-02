import { timingSafeEqual } from "node:crypto";

const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const LOCAL_COOKIE_KEY = Buffer.from("development-only-web-auth-cookie-hmac-key-v1", "utf8");
const LOCAL_SESSION_KEY = Buffer.from("development-only-web-auth-session-aes-key-v1!", "utf8").subarray(
  0,
  32,
);

type Environment = Readonly<Record<string, string | undefined>>;

export interface WebAuthRuntime {
  readonly apiAudience: string;
  /** Canonical resource-server origin used for DPoP htu, never an inbound Host header. */
  readonly apiDpopOrigin: URL;
  readonly authorizationEndpoint: URL;
  readonly clientId: string;
  readonly cookieHmacKey: Uint8Array;
  readonly endSessionEndpoint: URL;
  readonly issuer: string;
  readonly jwksUrl: URL;
  readonly production: boolean;
  readonly publicOrigin: URL;
  readonly redisUrl: string;
  readonly sessionEncryptionKey: Uint8Array;
  readonly tokenEndpoint: URL;
}

function environmentMode(environment: Environment): "development" | "production" | "test" {
  const value = environment["NODE_ENV"] ?? "development";
  if (value !== "development" && value !== "production" && value !== "test") {
    throw new TypeError("NODE_ENV must be development, production, or test");
  }
  return value;
}

function canonicalOrigin(value: string, name: string, production: boolean): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${name} must be an absolute URL`);
  }
  if (
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    (parsed.pathname !== "/" && parsed.pathname !== "") ||
    (production && parsed.protocol !== "https:") ||
    (!production && parsed.protocol !== "https:" && parsed.protocol !== "http:")
  ) {
    throw new TypeError(`${name} must be a credential-free canonical origin`);
  }
  parsed.pathname = "/";
  return parsed;
}

function canonicalIssuer(value: string, production: boolean): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("WEB_AUTH_OIDC_ISSUER must be an absolute URL");
  }
  if (
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.pathname === "/" ||
    parsed.pathname.endsWith("/") ||
    (production && parsed.protocol !== "https:") ||
    (!production && parsed.protocol !== "https:" && parsed.protocol !== "http:")
  ) {
    throw new TypeError("WEB_AUTH_OIDC_ISSUER must be a canonical credential-free issuer URL");
  }
  return parsed;
}

function sameIssuerOriginEndpoint(value: string, name: string, issuer: URL, production: boolean): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${name} must be an absolute URL`);
  }
  if (
    parsed.origin !== issuer.origin ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.pathname === "/" ||
    (production && parsed.protocol !== "https:")
  ) {
    throw new TypeError(`${name} must be a canonical endpoint on the issuer origin`);
  }
  return parsed;
}

function boundedIdentifier(value: string, name: string): string {
  if (!/^[A-Za-z0-9._~:-]{1,128}$/u.test(value)) {
    throw new TypeError(`${name} must be a bounded OAuth identifier`);
  }
  return value;
}

function secretKey(
  environment: Environment,
  name: "WEB_AUTH_COOKIE_HMAC_KEY" | "WEB_AUTH_SESSION_ENCRYPTION_KEY",
  local: Uint8Array,
  production: boolean,
  exactBytes: number | undefined,
): Uint8Array {
  const encoded = environment[name];
  if (encoded === undefined) {
    if (production) throw new TypeError(`${name} is required in production`);
    return new Uint8Array(local);
  }
  if (!BASE64URL.test(encoded)) throw new TypeError(`${name} must be canonical base64url`);
  const decoded = Buffer.from(encoded, "base64url");
  if (
    decoded.toString("base64url") !== encoded ||
    (exactBytes === undefined
      ? decoded.byteLength < 32 || decoded.byteLength > 64
      : decoded.byteLength !== exactBytes)
  ) {
    throw new TypeError(
      exactBytes === undefined
        ? `${name} must encode 32 through 64 bytes`
        : `${name} must encode exactly ${String(exactBytes)} bytes`,
    );
  }
  if (production && decoded.equals(Buffer.from(local))) {
    throw new TypeError(`${name} must not use the development key in production`);
  }
  return new Uint8Array(decoded);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function isLoopbackRedisHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized === "[::1]" || normalized === "::1") return true;
  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(normalized);
  return match?.slice(1).every((part) => Number(part) <= 255) ?? false;
}

function redisUrl(value: string, production: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("WEB_AUTH_REDIS_URL must be an absolute Redis URL");
  }
  if (
    (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") ||
    parsed.hash !== "" ||
    parsed.search !== "" ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    (production && parsed.protocol !== "rediss:") ||
    (parsed.protocol === "redis:" && !isLoopbackRedisHostname(parsed.hostname)) ||
    parsed.password.length === 0
  ) {
    throw new TypeError(
      "WEB_AUTH_REDIS_URL must be a password-authenticated canonical Redis URL (rediss in production)",
    );
  }
  return parsed.toString();
}

export function loadWebAuthRuntime(environment: Environment = process.env): WebAuthRuntime {
  const production = environmentMode(environment) === "production";
  if (production && environment["WEB_AUTH_API_DPOP_ORIGIN"] === undefined) {
    throw new TypeError("WEB_AUTH_API_DPOP_ORIGIN is required in production");
  }
  const issuerUrl = canonicalIssuer(
    environment["WEB_AUTH_OIDC_ISSUER"] ?? "http://127.0.0.1:8080/realms/gopher-assistant-dev",
    production,
  );
  const protocolBase = `${issuerUrl.toString()}/protocol/openid-connect`;
  const cookieHmacKey = secretKey(
    environment,
    "WEB_AUTH_COOKIE_HMAC_KEY",
    LOCAL_COOKIE_KEY,
    production,
    undefined,
  );
  const sessionEncryptionKey = secretKey(
    environment,
    "WEB_AUTH_SESSION_ENCRYPTION_KEY",
    LOCAL_SESSION_KEY,
    production,
    32,
  );
  if (sameBytes(cookieHmacKey, sessionEncryptionKey)) {
    throw new TypeError("Web auth cookie and session encryption keys must be independent");
  }

  return Object.freeze({
    apiAudience: boundedIdentifier(
      environment["WEB_AUTH_API_AUDIENCE"] ?? "gopher-api",
      "WEB_AUTH_API_AUDIENCE",
    ),
    apiDpopOrigin: canonicalOrigin(
      environment["WEB_AUTH_API_DPOP_ORIGIN"] ?? "http://127.0.0.1:4000",
      "WEB_AUTH_API_DPOP_ORIGIN",
      production,
    ),
    authorizationEndpoint: sameIssuerOriginEndpoint(
      environment["WEB_AUTH_OIDC_AUTHORIZATION_ENDPOINT"] ?? `${protocolBase}/auth`,
      "WEB_AUTH_OIDC_AUTHORIZATION_ENDPOINT",
      issuerUrl,
      production,
    ),
    clientId: boundedIdentifier(
      environment["WEB_AUTH_OIDC_CLIENT_ID"] ?? "gopher-web",
      "WEB_AUTH_OIDC_CLIENT_ID",
    ),
    cookieHmacKey,
    endSessionEndpoint: sameIssuerOriginEndpoint(
      environment["WEB_AUTH_OIDC_END_SESSION_ENDPOINT"] ?? `${protocolBase}/logout`,
      "WEB_AUTH_OIDC_END_SESSION_ENDPOINT",
      issuerUrl,
      production,
    ),
    issuer: issuerUrl.toString(),
    jwksUrl: sameIssuerOriginEndpoint(
      environment["WEB_AUTH_OIDC_JWKS_URL"] ?? `${protocolBase}/certs`,
      "WEB_AUTH_OIDC_JWKS_URL",
      issuerUrl,
      production,
    ),
    production,
    publicOrigin: canonicalOrigin(
      environment["WEB_AUTH_PUBLIC_ORIGIN"] ?? "http://localhost:3000",
      "WEB_AUTH_PUBLIC_ORIGIN",
      production,
    ),
    redisUrl: redisUrl(
      environment["WEB_AUTH_REDIS_URL"] ?? "redis://:local-redis-password-only@127.0.0.1:6379",
      production,
    ),
    sessionEncryptionKey,
    tokenEndpoint: sameIssuerOriginEndpoint(
      environment["WEB_AUTH_OIDC_TOKEN_ENDPOINT"] ?? `${protocolBase}/token`,
      "WEB_AUTH_OIDC_TOKEN_ENDPOINT",
      issuerUrl,
      production,
    ),
  });
}
