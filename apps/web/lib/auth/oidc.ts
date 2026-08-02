import { createHash } from "node:crypto";

import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

import type { WebAuthRuntime } from "./runtime";
import { createDpopProof, dpopThumbprint, parseDpopNonce, type DpopPrivateJwk } from "./dpop";
import {
  AUTH_SESSION_MAX_TTL_SECONDS,
  type AuthSessionRecord,
  type AuthTransactionRecord,
} from "./session-records";

const ACCESS_TOKEN_TYPE = "at+jwt";
const MAX_TOKEN_BYTES = 16_384;
const MAX_TOKEN_RESPONSE_BYTES = 128 * 1_024;
const TOKEN_TIMEOUT_MS = 8_000;
const MAX_TOKEN_LIFETIME_SECONDS = 10 * 60;
const REQUIRED_SCOPES = ["campus:read", "personal:read", "personal:write"] as const;
const CLIENT_ID = /^[A-Za-z0-9._~:-]{1,128}$/u;
const JTI = /^[A-Za-z0-9._~:-]{8,128}$/u;
const SCOPE = /^[\x21\x23-\x5b\x5d-\x7e]+(?: [\x21\x23-\x5b\x5d-\x7e]+)*$/u;

export interface OidcDependencies {
  readonly fetch?: typeof fetch;
  readonly keyResolver?: JWTVerifyGetKey;
  readonly now?: () => number;
}

export interface ValidatedSession {
  readonly record: AuthSessionRecord;
  readonly ttlSeconds: number;
}

class OidcProtocolError extends Error {
  constructor() {
    super("OIDC protocol validation failed");
    this.name = "OidcProtocolError";
  }
}

function nowSeconds(dependencies: OidcDependencies): number {
  const milliseconds = dependencies.now?.() ?? Date.now();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new OidcProtocolError();
  return Math.floor(milliseconds / 1_000);
}

function exactAudience(payload: JWTPayload, expected: string): boolean {
  return typeof payload.aud === "string"
    ? payload.aud === expected
    : Array.isArray(payload.aud) && payload.aud.length === 1 && payload.aud[0] === expected;
}

function hasAsciiControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}

function isBoundedSubject(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.isWellFormed() &&
    !hasAsciiControl(value) &&
    new TextEncoder().encode(value).byteLength <= 512
  );
}

function boundedLifetime(
  payload: JWTPayload,
  now: number,
): asserts payload is JWTPayload & {
  exp: number;
  iat: number;
  sub: string;
} {
  if (
    typeof payload.exp !== "number" ||
    !Number.isSafeInteger(payload.exp) ||
    typeof payload.iat !== "number" ||
    !Number.isSafeInteger(payload.iat) ||
    payload.exp <= now ||
    payload.iat > now + 5 ||
    payload.exp <= payload.iat ||
    payload.exp - payload.iat > MAX_TOKEN_LIFETIME_SECONDS ||
    !isBoundedSubject(payload.sub)
  ) {
    throw new OidcProtocolError();
  }
}

function tokenClientMatches(payload: JWTPayload, clientId: string): boolean {
  const azp = payload["azp"];
  const profileClientId = payload["client_id"];
  if (
    (azp !== undefined && (typeof azp !== "string" || !CLIENT_ID.test(azp))) ||
    (profileClientId !== undefined &&
      (typeof profileClientId !== "string" || !CLIENT_ID.test(profileClientId))) ||
    (azp !== undefined && profileClientId !== undefined && azp !== profileClientId)
  ) {
    return false;
  }
  return (azp ?? profileClientId) === clientId;
}

function parseScopes(payload: JWTPayload): readonly string[] {
  const value = payload["scope"];
  if (typeof value !== "string" || value.length > 2_048 || !SCOPE.test(value)) {
    throw new OidcProtocolError();
  }
  const scopes = Object.freeze([...new Set(value.split(" "))]);
  if (scopes.length > 64 || !REQUIRED_SCOPES.every((scope) => scopes.includes(scope))) {
    throw new OidcProtocolError();
  }
  return scopes;
}

function keyResolver(runtime: WebAuthRuntime, dependencies: OidcDependencies): JWTVerifyGetKey {
  return (
    dependencies.keyResolver ??
    createRemoteJWKSet(runtime.jwksUrl, {
      cacheMaxAge: 10 * 60_000,
      cooldownDuration: 30_000,
      timeoutDuration: 5_000,
    })
  );
}

async function validateIdToken(
  token: string,
  nonce: string,
  requireNonce: boolean,
  runtime: WebAuthRuntime,
  dependencies: OidcDependencies,
): Promise<{ readonly expiresAt: number; readonly subject: string }> {
  if (token.length < 32 || token.length > MAX_TOKEN_BYTES) throw new OidcProtocolError();
  const now = nowSeconds(dependencies);
  try {
    const { payload, protectedHeader } = await jwtVerify(token, keyResolver(runtime, dependencies), {
      algorithms: ["RS256"],
      audience: runtime.clientId,
      clockTolerance: 5,
      issuer: runtime.issuer,
      requiredClaims: requireNonce ? ["sub", "exp", "iat", "nonce"] : ["sub", "exp", "iat"],
    });
    boundedLifetime(payload, now);
    const returnedNonce = payload["nonce"];
    if (
      (protectedHeader.typ !== undefined && protectedHeader.typ !== "JWT") ||
      !exactAudience(payload, runtime.clientId) ||
      (requireNonce ? returnedNonce !== nonce : returnedNonce !== undefined && returnedNonce !== nonce) ||
      (payload["azp"] !== undefined && payload["azp"] !== runtime.clientId)
    ) {
      throw new OidcProtocolError();
    }
    return { expiresAt: payload.exp, subject: payload.sub };
  } catch {
    throw new OidcProtocolError();
  }
}

async function validateAccessToken(
  token: string,
  expectedSubject: string,
  expectedDpopJkt: string,
  runtime: WebAuthRuntime,
  dependencies: OidcDependencies,
): Promise<{ readonly expiresAt: number; readonly scopes: readonly string[] }> {
  if (token.length < 32 || token.length > MAX_TOKEN_BYTES) throw new OidcProtocolError();
  const now = nowSeconds(dependencies);
  try {
    const { payload, protectedHeader } = await jwtVerify(token, keyResolver(runtime, dependencies), {
      algorithms: ["RS256"],
      audience: runtime.apiAudience,
      clockTolerance: 5,
      issuer: runtime.issuer,
      requiredClaims: ["sub", "exp", "iat", "jti"],
    });
    boundedLifetime(payload, now);
    if (
      protectedHeader.typ !== ACCESS_TOKEN_TYPE ||
      !exactAudience(payload, runtime.apiAudience) ||
      payload.sub !== expectedSubject ||
      !tokenClientMatches(payload, runtime.clientId) ||
      typeof payload.jti !== "string" ||
      !JTI.test(payload.jti) ||
      typeof payload["cnf"] !== "object" ||
      payload["cnf"] === null ||
      Array.isArray(payload["cnf"]) ||
      (payload["cnf"] as { readonly jkt?: unknown }).jkt !== expectedDpopJkt
    ) {
      throw new OidcProtocolError();
    }
    return { expiresAt: payload.exp, scopes: parseScopes(payload) };
  } catch {
    throw new OidcProtocolError();
  }
}

async function readBoundedJson(response: Response): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "")) {
    await response.body?.cancel();
    throw new OidcProtocolError();
  }
  const declared = response.headers.get("content-length");
  if (declared !== null && /^\d+$/u.test(declared) && Number(declared) > MAX_TOKEN_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new OidcProtocolError();
  }
  if (response.body === null) throw new OidcProtocolError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_TOKEN_RESPONSE_BYTES) {
        await reader.cancel("OIDC token response exceeded its size limit");
        throw new OidcProtocolError();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new OidcProtocolError();
    return parsed as Record<string, unknown>;
  } catch {
    throw new OidcProtocolError();
  }
}

async function tokenRequest(
  parameters: URLSearchParams,
  privateJwk: DpopPrivateJwk,
  previousNonce: string | null,
  runtime: WebAuthRuntime,
  dependencies: OidcDependencies,
): Promise<{
  readonly authorizationServerDpopNonce: string | null;
  readonly body: Record<string, unknown>;
}> {
  let nonce = previousNonce;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
    try {
      const proof = await createDpopProof({
        htm: "POST",
        htu: runtime.tokenEndpoint,
        ...(nonce === null ? {} : { nonce }),
        privateJwk,
        ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      });
      const response = await (dependencies.fetch ?? fetch)(runtime.tokenEndpoint, {
        body: new URLSearchParams(parameters),
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          DPoP: proof,
        },
        method: "POST",
        redirect: "error",
        signal: controller.signal,
      });
      const body = await readBoundedJson(response);
      const returnedNonce = parseDpopNonce(response.headers.get("dpop-nonce"));
      if (response.ok) {
        return {
          authorizationServerDpopNonce: returnedNonce ?? nonce,
          body,
        };
      }
      if (
        attempt === 0 &&
        response.status === 400 &&
        body["error"] === "use_dpop_nonce" &&
        returnedNonce !== undefined
      ) {
        nonce = returnedNonce;
        continue;
      }
      throw new OidcProtocolError();
    } catch {
      throw new OidcProtocolError();
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new OidcProtocolError();
}

function tokenString(value: unknown): string {
  if (typeof value !== "string" || value.length < 32 || value.length > MAX_TOKEN_BYTES) {
    throw new OidcProtocolError();
  }
  return value;
}

function optionalRefreshExpiry(
  response: Record<string, unknown>,
  now: number,
  hasRefreshToken: boolean,
  previous: number | null = null,
): number | null {
  if (!hasRefreshToken) return null;
  const value = response["refresh_expires_in"];
  if (value === undefined) {
    return previous !== null && previous > now
      ? Math.min(previous, now + AUTH_SESSION_MAX_TTL_SECONDS)
      : now + AUTH_SESSION_MAX_TTL_SECONDS;
  }
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new OidcProtocolError();
  return now + Math.min(value as number, AUTH_SESSION_MAX_TTL_SECONDS);
}

function sessionTtl(record: AuthSessionRecord, now: number): number {
  const expiresAt = record.refreshTokenExpiresAt ?? record.accessTokenExpiresAt;
  const ttl = expiresAt - now;
  if (!Number.isSafeInteger(ttl) || ttl < 1) throw new OidcProtocolError();
  return Math.min(ttl, AUTH_SESSION_MAX_TTL_SECONDS);
}

export async function authorizationRedirect(
  transaction: AuthTransactionRecord,
  runtime: WebAuthRuntime,
): Promise<URL> {
  const challenge = createHash("sha256").update(transaction.codeVerifier, "ascii").digest("base64url");
  const url = new URL(runtime.authorizationEndpoint);
  url.search = new URLSearchParams({
    client_id: runtime.clientId,
    code_challenge: challenge,
    code_challenge_method: "S256",
    dpop_jkt: await dpopThumbprint(transaction.dpopPrivateJwk),
    nonce: transaction.nonce,
    redirect_uri: new URL("/auth/callback", runtime.publicOrigin).toString(),
    response_mode: "query",
    response_type: "code",
    scope: `openid ${REQUIRED_SCOPES.join(" ")}`,
    state: transaction.state,
  }).toString();
  return url;
}

export async function exchangeAuthorizationCode(
  code: string,
  transaction: AuthTransactionRecord,
  runtime: WebAuthRuntime,
  dependencies: OidcDependencies = {},
): Promise<ValidatedSession> {
  if (!/^[A-Za-z0-9._~-]{16,4096}$/u.test(code)) throw new OidcProtocolError();
  const tokenResponse = await tokenRequest(
    new URLSearchParams({
      client_id: runtime.clientId,
      code,
      code_verifier: transaction.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: new URL("/auth/callback", runtime.publicOrigin).toString(),
    }),
    transaction.dpopPrivateJwk,
    null,
    runtime,
    dependencies,
  );
  const response = tokenResponse.body;
  if (response["token_type"] !== "DPoP") throw new OidcProtocolError();
  const idToken = tokenString(response["id_token"]);
  const accessToken = tokenString(response["access_token"]);
  const identity = await validateIdToken(idToken, transaction.nonce, true, runtime, dependencies);
  const keyThumbprint = await dpopThumbprint(transaction.dpopPrivateJwk);
  const access = await validateAccessToken(
    accessToken,
    identity.subject,
    keyThumbprint,
    runtime,
    dependencies,
  );
  const now = nowSeconds(dependencies);
  const refreshToken =
    response["refresh_token"] === undefined ? null : tokenString(response["refresh_token"]);
  const record: AuthSessionRecord = {
    accessToken,
    accessTokenExpiresAt: access.expiresAt,
    authorizationServerDpopNonce: tokenResponse.authorizationServerDpopNonce,
    createdAt: now,
    dpopPrivateJwk: transaction.dpopPrivateJwk,
    idToken,
    issuer: runtime.issuer,
    nonce: transaction.nonce,
    refreshToken,
    refreshTokenExpiresAt: optionalRefreshExpiry(response, now, refreshToken !== null),
    scopes: access.scopes,
    subject: identity.subject,
  };
  return { record, ttlSeconds: sessionTtl(record, now) };
}

export async function refreshAuthSession(
  session: AuthSessionRecord,
  runtime: WebAuthRuntime,
  dependencies: OidcDependencies = {},
): Promise<ValidatedSession> {
  const now = nowSeconds(dependencies);
  if (
    session.issuer !== runtime.issuer ||
    session.refreshToken === null ||
    session.refreshTokenExpiresAt === null ||
    session.refreshTokenExpiresAt <= now
  ) {
    throw new OidcProtocolError();
  }
  const tokenResponse = await tokenRequest(
    new URLSearchParams({
      client_id: runtime.clientId,
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
    }),
    session.dpopPrivateJwk,
    session.authorizationServerDpopNonce,
    runtime,
    dependencies,
  );
  const response = tokenResponse.body;
  if (response["token_type"] !== "DPoP") throw new OidcProtocolError();
  const accessToken = tokenString(response["access_token"]);
  const access = await validateAccessToken(
    accessToken,
    session.subject,
    await dpopThumbprint(session.dpopPrivateJwk),
    runtime,
    dependencies,
  );
  const idToken = response["id_token"] === undefined ? session.idToken : tokenString(response["id_token"]);
  if (response["id_token"] !== undefined) {
    // OIDC Core permits a refreshed ID token to omit nonce. If the provider
    // includes one, it must still match the nonce from the original flow.
    const identity = await validateIdToken(idToken, session.nonce, false, runtime, dependencies);
    if (identity.subject !== session.subject) throw new OidcProtocolError();
  }
  const refreshToken =
    response["refresh_token"] === undefined ? session.refreshToken : tokenString(response["refresh_token"]);
  const record: AuthSessionRecord = {
    ...session,
    accessToken,
    accessTokenExpiresAt: access.expiresAt,
    authorizationServerDpopNonce: tokenResponse.authorizationServerDpopNonce,
    idToken,
    refreshToken,
    refreshTokenExpiresAt: optionalRefreshExpiry(response, now, true, session.refreshTokenExpiresAt),
    scopes: access.scopes,
  };
  return { record, ttlSeconds: sessionTtl(record, now) };
}
