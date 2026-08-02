import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes as nodeRandomBytes,
  timingSafeEqual,
} from "node:crypto";

import type { WebAuthRuntime } from "./runtime";
import { parseDpopNonce, parseDpopPrivateJwk, type DpopPrivateJwk } from "./dpop";

export const AUTH_SESSION_COOKIE = "gopher_auth_session_v1";
export const AUTH_TRANSACTION_COOKIE = "gopher_auth_transaction_v1";
export const AUTH_TRANSACTION_TTL_SECONDS = 10 * 60;
export const AUTH_SESSION_MAX_TTL_SECONDS = 8 * 60 * 60;

const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const OPAQUE_ID_BYTES = 32;
const OPAQUE_ID_LENGTH = 43;
const HMAC_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_SEALED_RECORD_BYTES = 96 * 1_024;

export interface AuthTransactionRecord {
  readonly codeVerifier: string;
  readonly createdAt: number;
  readonly dpopPrivateJwk: DpopPrivateJwk;
  readonly nonce: string;
  readonly returnTo: string;
  readonly state: string;
}

export interface AuthSessionRecord {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: number;
  readonly authorizationServerDpopNonce: string | null;
  readonly createdAt: number;
  readonly dpopPrivateJwk: DpopPrivateJwk;
  readonly idToken: string;
  readonly issuer: string;
  readonly nonce: string;
  readonly refreshToken: string | null;
  readonly refreshTokenExpiresAt: number | null;
  readonly scopes: readonly string[];
  readonly subject: string;
}

export interface AuthRandomness {
  readonly randomBytes?: (size: number) => Uint8Array;
}

function exactCanonicalBytes(value: string, byteLength: number): Buffer | undefined {
  if (!BASE64URL.test(value)) return undefined;
  const decoded = Buffer.from(value, "base64url");
  return decoded.byteLength === byteLength && decoded.toString("base64url") === value ? decoded : undefined;
}

function hasAsciiControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}

function boundedSubject(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.isWellFormed() &&
    !hasAsciiControl(value) &&
    new TextEncoder().encode(value).byteLength <= 512
  );
}

function cookieMac(kind: "session" | "transaction", id: string, runtime: WebAuthRuntime): Buffer {
  return createHmac("sha256", runtime.cookieHmacKey)
    .update(`umn-gopher-assistant:web-auth-cookie:v1\n${kind}\n${id}`, "utf8")
    .digest();
}

export function randomOpaqueId(dependencies: AuthRandomness = {}): string {
  const bytes = dependencies.randomBytes?.(OPAQUE_ID_BYTES) ?? nodeRandomBytes(OPAQUE_ID_BYTES);
  if (bytes.byteLength !== OPAQUE_ID_BYTES) {
    throw new TypeError("The web-auth randomness source must return exactly 256 bits");
  }
  return Buffer.from(bytes).toString("base64url");
}

export function signedAuthCookie(
  kind: "session" | "transaction",
  id: string,
  runtime: WebAuthRuntime,
): string {
  if (exactCanonicalBytes(id, OPAQUE_ID_BYTES) === undefined) {
    throw new TypeError("Web-auth cookie ID is invalid");
  }
  return `v1.${id}.${cookieMac(kind, id, runtime).toString("base64url")}`;
}

export function verifySignedAuthCookie(
  kind: "session" | "transaction",
  value: string | undefined,
  runtime: WebAuthRuntime,
): string | undefined {
  if (value?.length !== 3 + OPAQUE_ID_LENGTH + 1 + 43) return undefined;
  const match = /^v1\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/u.exec(value);
  const id = match?.[1];
  const mac = match?.[2];
  if (id === undefined || mac === undefined || exactCanonicalBytes(id, OPAQUE_ID_BYTES) === undefined) {
    return undefined;
  }
  const candidate = exactCanonicalBytes(mac, HMAC_BYTES);
  const comparable = candidate ?? Buffer.alloc(HMAC_BYTES);
  return timingSafeEqual(cookieMac(kind, id, runtime), comparable) && candidate !== undefined
    ? id
    : undefined;
}

export function uniqueCookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (header === null || Buffer.byteLength(header, "utf8") > 8_192) return undefined;
  const matches: string[] = [];
  for (const raw of header.split(";")) {
    const part = raw.trim();
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator) === name) matches.push(part.slice(separator + 1));
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function cookieAttributes(
  name: string,
  value: string,
  maxAge: number,
  sameSite: "Lax" | "Strict",
  path: string,
  runtime: WebAuthRuntime,
): string {
  const attributes = [
    `${name}=${value}`,
    `Max-Age=${String(maxAge)}`,
    `Path=${path}`,
    "HttpOnly",
    `SameSite=${sameSite}`,
  ];
  if (maxAge === 0) attributes.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  if (runtime.production) attributes.push("Secure");
  return attributes.join("; ");
}

export function transactionCookie(id: string, runtime: WebAuthRuntime): string {
  return cookieAttributes(
    AUTH_TRANSACTION_COOKIE,
    signedAuthCookie("transaction", id, runtime),
    AUTH_TRANSACTION_TTL_SECONDS,
    "Lax",
    "/auth/callback",
    runtime,
  );
}

export function clearTransactionCookie(runtime: WebAuthRuntime): string {
  return cookieAttributes(AUTH_TRANSACTION_COOKIE, "", 0, "Lax", "/auth/callback", runtime);
}

export function sessionCookie(id: string, ttlSeconds: number, runtime: WebAuthRuntime): string {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > AUTH_SESSION_MAX_TTL_SECONDS) {
    throw new TypeError("Web-auth session TTL is invalid");
  }
  return cookieAttributes(
    AUTH_SESSION_COOKIE,
    signedAuthCookie("session", id, runtime),
    ttlSeconds,
    "Strict",
    "/",
    runtime,
  );
}

export function clearSessionCookie(runtime: WebAuthRuntime): string {
  return cookieAttributes(AUTH_SESSION_COOKIE, "", 0, "Strict", "/", runtime);
}

function recordAad(kind: "session" | "transaction", id: string): Buffer {
  return Buffer.from(`umn-gopher-assistant:web-auth-record:v1\n${kind}\n${id}`, "utf8");
}

export function sealAuthRecord(
  kind: "session" | "transaction",
  id: string,
  record: AuthSessionRecord | AuthTransactionRecord,
  runtime: WebAuthRuntime,
  dependencies: AuthRandomness = {},
): string {
  if (exactCanonicalBytes(id, OPAQUE_ID_BYTES) === undefined) {
    throw new TypeError("Web-auth record ID is invalid");
  }
  const plaintext = Buffer.from(JSON.stringify(record), "utf8");
  if (plaintext.byteLength < 2 || plaintext.byteLength > MAX_SEALED_RECORD_BYTES) {
    throw new TypeError("Web-auth record exceeds its size boundary");
  }
  const nonceBytes = dependencies.randomBytes?.(NONCE_BYTES) ?? nodeRandomBytes(NONCE_BYTES);
  if (nonceBytes.byteLength !== NONCE_BYTES) {
    throw new TypeError("The web-auth nonce source must return exactly 96 bits");
  }
  const nonce = Buffer.from(nonceBytes);
  try {
    const cipher = createCipheriv("aes-256-gcm", runtime.sessionEncryptionKey, nonce);
    cipher.setAAD(recordAad(kind, id));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${nonce.toString("base64url")}.${ciphertext.toString("base64url")}.${tag.toString("base64url")}`;
  } finally {
    plaintext.fill(0);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= 32 && value.length <= 16_384;
}

function boundedEpochSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1_000_000_000;
}

function parseTransaction(value: unknown): AuthTransactionRecord | undefined {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).sort().join(",") !== "codeVerifier,createdAt,dpopPrivateJwk,nonce,returnTo,state"
  ) {
    return undefined;
  }
  const dpopPrivateJwk = parseDpopPrivateJwk(value["dpopPrivateJwk"]);
  if (
    typeof value["codeVerifier"] !== "string" ||
    exactCanonicalBytes(value["codeVerifier"], 32) === undefined ||
    !boundedEpochSeconds(value["createdAt"]) ||
    dpopPrivateJwk === undefined ||
    typeof value["nonce"] !== "string" ||
    exactCanonicalBytes(value["nonce"], 32) === undefined ||
    typeof value["state"] !== "string" ||
    exactCanonicalBytes(value["state"], 32) === undefined ||
    typeof value["returnTo"] !== "string" ||
    !isSafeReturnTo(value["returnTo"])
  ) {
    return undefined;
  }
  return {
    codeVerifier: value["codeVerifier"],
    createdAt: value["createdAt"],
    dpopPrivateJwk,
    nonce: value["nonce"],
    returnTo: value["returnTo"],
    state: value["state"],
  };
}

function parseSession(value: unknown): AuthSessionRecord | undefined {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).sort().join(",") !==
      "accessToken,accessTokenExpiresAt,authorizationServerDpopNonce,createdAt,dpopPrivateJwk,idToken,issuer,nonce,refreshToken,refreshTokenExpiresAt,scopes,subject"
  ) {
    return undefined;
  }
  const refreshToken = value["refreshToken"];
  const refreshTokenExpiresAt = value["refreshTokenExpiresAt"];
  const authorizationServerDpopNonce = value["authorizationServerDpopNonce"];
  const dpopPrivateJwk = parseDpopPrivateJwk(value["dpopPrivateJwk"]);
  if (
    !boundedToken(value["accessToken"]) ||
    !boundedToken(value["idToken"]) ||
    !boundedEpochSeconds(value["accessTokenExpiresAt"]) ||
    !boundedEpochSeconds(value["createdAt"]) ||
    dpopPrivateJwk === undefined ||
    (authorizationServerDpopNonce !== null &&
      (typeof authorizationServerDpopNonce !== "string" ||
        parseDpopNonce(authorizationServerDpopNonce) === undefined)) ||
    typeof value["issuer"] !== "string" ||
    value["issuer"].length > 2_048 ||
    typeof value["nonce"] !== "string" ||
    exactCanonicalBytes(value["nonce"], 32) === undefined ||
    !boundedSubject(value["subject"]) ||
    !Array.isArray(value["scopes"]) ||
    value["scopes"].length > 64 ||
    value["scopes"].some(
      (scope) => typeof scope !== "string" || !/^[\x21\x23-\x5b\x5d-\x7e]{1,256}$/u.test(scope),
    ) ||
    (refreshToken !== null && !boundedToken(refreshToken)) ||
    (refreshTokenExpiresAt !== null && !boundedEpochSeconds(refreshTokenExpiresAt)) ||
    (refreshToken === null) !== (refreshTokenExpiresAt === null)
  ) {
    return undefined;
  }
  return {
    accessToken: value["accessToken"],
    accessTokenExpiresAt: value["accessTokenExpiresAt"],
    authorizationServerDpopNonce,
    createdAt: value["createdAt"],
    dpopPrivateJwk,
    idToken: value["idToken"],
    issuer: value["issuer"],
    nonce: value["nonce"],
    refreshToken,
    refreshTokenExpiresAt,
    scopes: Object.freeze([...new Set(value["scopes"] as string[])]),
    subject: value["subject"],
  };
}

export function openAuthRecord(
  kind: "transaction",
  id: string,
  sealed: string,
  runtime: WebAuthRuntime,
): AuthTransactionRecord | undefined;
export function openAuthRecord(
  kind: "session",
  id: string,
  sealed: string,
  runtime: WebAuthRuntime,
): AuthSessionRecord | undefined;
export function openAuthRecord(
  kind: "session" | "transaction",
  id: string,
  sealed: string,
  runtime: WebAuthRuntime,
): AuthSessionRecord | AuthTransactionRecord | undefined {
  if (
    exactCanonicalBytes(id, OPAQUE_ID_BYTES) === undefined ||
    Buffer.byteLength(sealed, "utf8") > MAX_SEALED_RECORD_BYTES * 2
  ) {
    return undefined;
  }
  const match = /^v1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{22})$/u.exec(sealed);
  if (match === null) return undefined;
  const nonce = exactCanonicalBytes(match[1] ?? "", NONCE_BYTES);
  const ciphertextText = match[2] ?? "";
  const tag = exactCanonicalBytes(match[3] ?? "", TAG_BYTES);
  if (nonce === undefined || tag === undefined || !BASE64URL.test(ciphertextText)) return undefined;
  const ciphertext = Buffer.from(ciphertextText, "base64url");
  if (
    ciphertext.byteLength < 2 ||
    ciphertext.byteLength > MAX_SEALED_RECORD_BYTES ||
    ciphertext.toString("base64url") !== ciphertextText
  ) {
    return undefined;
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", runtime.sessionEncryptionKey, nonce);
    decipher.setAAD(recordAad(kind, id));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    try {
      const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)) as unknown;
      return kind === "session" ? parseSession(parsed) : parseTransaction(parsed);
    } finally {
      plaintext.fill(0);
    }
  } catch {
    return undefined;
  }
}

function containsAsciiControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}

export function isSafeReturnTo(value: string): boolean {
  if (
    value.length < 1 ||
    value.length > 2_048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    containsAsciiControl(value)
  ) {
    return false;
  }
  try {
    const parsed = new URL(value, "https://return.invalid");
    return parsed.origin === "https://return.invalid" && parsed.username === "" && parsed.password === "";
  } catch {
    return false;
  }
}
