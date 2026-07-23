import { createHmac, randomBytes as nodeRandomBytes, timingSafeEqual } from "node:crypto";

export const AI_INTERNAL_SESSION_HEADER = "X-Gopher-Internal-AI-Session";
export const AI_INTERNAL_NETWORK_HEADER = "X-Gopher-Internal-AI-Network";
export const AI_INTERNAL_PROOF_EXPIRES_HEADER = "X-Gopher-Internal-AI-Proof-Expires";
export const AI_INTERNAL_PROOF_HEADER = "X-Gopher-Internal-AI-Proof";
export const AI_INGRESS_NETWORK_HEADER = "X-Gopher-Ingress-AI-Network";
export const AI_INGRESS_PROOF_EXPIRES_HEADER = "X-Gopher-Ingress-AI-Proof-Expires";
export const AI_INGRESS_PROOF_HEADER = "X-Gopher-Ingress-AI-Proof";
export const AI_SESSION_COOKIE_NAME = "gopher_ai_session_v1";

const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const COOKIE_VALUE = /^v1\.([1-9]\d{9})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/u;
const NETWORK_HEADER_VALUE = /^v1\.([A-Za-z0-9_-]{43})$/u;
const PROOF_HEADER_VALUE = /^v1\.([A-Za-z0-9_-]{43})$/u;
const PROOF_EXPIRES_VALUE = /^[1-9]\d{9}$/u;
const TRACE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const SESSION_BYTES = 16;
const HMAC_BYTES = 32;
const NETWORK_ID_BYTES = 32;
const COOKIE_TTL_SECONDS = 24 * 60 * 60;
const PROOF_TTL_SECONDS = 30;
const MAX_INGRESS_PROOF_TTL_SECONDS = 60;
const MAX_COOKIE_HEADER_BYTES = 4_096;
const LOCAL_COOKIE_KEY = Buffer.from("development-only-web-ai-session-cookie-hmac-key-v1", "utf8");
const LOCAL_PROOF_KEY = Buffer.from("development-only-ai-bff-core-proof-hmac-key-v1", "utf8");
const LOCAL_INGRESS_KEY = Buffer.from("development-only-ai-ingress-network-hmac-key-v1", "utf8");

type Environment = Readonly<Record<string, string | undefined>>;

export interface AiSessionRuntime {
  readonly cookieHmacKey: Uint8Array;
  readonly ingressHmacKey: Uint8Array;
  readonly proofHmacKey: Uint8Array;
  readonly production: boolean;
}

export interface AiSessionDependencies {
  readonly now?: () => number;
  readonly randomBytes?: (size: number) => Uint8Array;
}

export interface AiSessionResolution {
  readonly sessionId: string;
  readonly setCookie: string | undefined;
}

function nodeEnvironment(environment: Environment): "development" | "production" | "test" {
  const value = environment["NODE_ENV"] ?? "development";
  if (value !== "development" && value !== "production" && value !== "test") {
    throw new TypeError("NODE_ENV must be development, production, or test");
  }
  return value;
}

function hmacKey(
  environment: Environment,
  name:
    | "GOPHER_AI_SESSION_COOKIE_HMAC_KEY"
    | "GOPHER_AI_INGRESS_ASSERTION_HMAC_KEY"
    | "INTERNAL_AI_BFF_PROOF_HMAC_KEY",
  localDefault: Uint8Array,
  production: boolean,
): Uint8Array {
  const encoded = environment[name];
  if (encoded === undefined) {
    if (production) throw new TypeError(`${name} is required in production`);
    return new Uint8Array(localDefault);
  }
  if (!BASE64URL.test(encoded)) throw new TypeError(`${name} must be canonical base64url`);
  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.toString("base64url") !== encoded || decoded.byteLength < 32 || decoded.byteLength > 64) {
    throw new TypeError(`${name} must be canonical base64url encoding of 32 through 64 bytes`);
  }
  if (production && decoded.equals(Buffer.from(localDefault))) {
    throw new TypeError(`${name} must not use the fixed development key in production`);
  }
  return new Uint8Array(decoded);
}

function sameKey(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export function loadAiSessionRuntime(environment: Environment = process.env): AiSessionRuntime {
  const production = nodeEnvironment(environment) === "production";
  const cookieHmacKey = hmacKey(
    environment,
    "GOPHER_AI_SESSION_COOKIE_HMAC_KEY",
    LOCAL_COOKIE_KEY,
    production,
  );
  const proofHmacKey = hmacKey(environment, "INTERNAL_AI_BFF_PROOF_HMAC_KEY", LOCAL_PROOF_KEY, production);
  const ingressHmacKey = hmacKey(
    environment,
    "GOPHER_AI_INGRESS_ASSERTION_HMAC_KEY",
    LOCAL_INGRESS_KEY,
    production,
  );
  if (
    sameKey(cookieHmacKey, proofHmacKey) ||
    sameKey(cookieHmacKey, ingressHmacKey) ||
    sameKey(proofHmacKey, ingressHmacKey)
  ) {
    throw new TypeError("AI cookie, BFF proof, and ingress assertion HMAC keys must be independent");
  }
  return { cookieHmacKey, ingressHmacKey, production, proofHmacKey };
}

function canonicalBytes(value: string, length: number): Buffer | undefined {
  if (!BASE64URL.test(value)) return undefined;
  const decoded = Buffer.from(value, "base64url");
  return decoded.byteLength === length && decoded.toString("base64url") === value ? decoded : undefined;
}

function hmac(payload: string, key: Uint8Array): Buffer {
  return createHmac("sha256", key).update(payload, "utf8").digest();
}

function cookiePayload(expiresAt: number, sessionId: string): string {
  return `umn-gopher-assistant:ai-session-cookie:v1\n${String(expiresAt)}\n${sessionId}`;
}

function proofPayload(traceId: string, sessionId: string, networkId: string, expiresAt: number): string {
  return `umn-gopher-assistant:ai-bff-proof:v2\n${traceId}\n${sessionId}\n${networkId}\n${String(expiresAt)}`;
}

function ingressProofPayload(networkId: string, expiresAt: number): string {
  return `umn-gopher-assistant:ai-ingress-network:v1\nPOST\n/api/ai/query\n${networkId}\n${String(expiresAt)}`;
}

function constantTimeMacMatches(candidate: string, expected: Buffer): boolean {
  const candidateBytes = canonicalBytes(candidate, HMAC_BYTES);
  const comparable = candidateBytes ?? Buffer.alloc(HMAC_BYTES);
  return timingSafeEqual(expected, comparable) && candidateBytes !== undefined;
}

function nowSeconds(dependencies: AiSessionDependencies): number {
  const milliseconds = dependencies.now?.() ?? Date.now();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new TypeError("AI session clock is invalid");
  return Math.floor(milliseconds / 1_000);
}

function sessionCookieValue(request: Request): string | undefined {
  const header = request.headers.get("cookie");
  if (header === null || Buffer.byteLength(header, "utf8") > MAX_COOKIE_HEADER_BYTES) return undefined;
  const values: string[] = [];
  for (const rawPart of header.split(";")) {
    const part = rawPart.trim();
    const separator = part.indexOf("=");
    if (separator < 1 || part.slice(0, separator) !== AI_SESSION_COOKIE_NAME) continue;
    values.push(part.slice(separator + 1));
  }
  return values.length === 1 ? values[0] : undefined;
}

function verifiedSessionId(
  value: string | undefined,
  now: number,
  cookieHmacKey: Uint8Array,
): string | undefined {
  if (value === undefined) return undefined;
  const match = COOKIE_VALUE.exec(value);
  if (match === null) return undefined;
  const expiresAtText = match[1];
  const sessionId = match[2];
  const signature = match[3];
  if (expiresAtText === undefined || sessionId === undefined || signature === undefined) return undefined;
  const expiresAt = Number(expiresAtText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + COOKIE_TTL_SECONDS) {
    return undefined;
  }
  if (canonicalBytes(sessionId, SESSION_BYTES) === undefined) return undefined;
  const expected = hmac(cookiePayload(expiresAt, sessionId), cookieHmacKey);
  return constantTimeMacMatches(signature, expected) ? sessionId : undefined;
}

function issueSession(
  now: number,
  runtime: AiSessionRuntime,
  dependencies: AiSessionDependencies,
): AiSessionResolution {
  const random = dependencies.randomBytes?.(SESSION_BYTES) ?? nodeRandomBytes(SESSION_BYTES);
  if (random.byteLength !== SESSION_BYTES) {
    throw new TypeError("AI session randomness source must return exactly 128 bits");
  }
  const sessionId = Buffer.from(random).toString("base64url");
  const expiresAt = now + COOKIE_TTL_SECONDS;
  const signature = hmac(cookiePayload(expiresAt, sessionId), runtime.cookieHmacKey).toString("base64url");
  const value = `v1.${String(expiresAt)}.${sessionId}.${signature}`;
  const attributes = [
    `${AI_SESSION_COOKIE_NAME}=${value}`,
    `Max-Age=${String(COOKIE_TTL_SECONDS)}`,
    `Expires=${new Date(expiresAt * 1_000).toUTCString()}`,
    "Path=/api/ai",
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (runtime.production) attributes.push("Secure");
  return { sessionId, setCookie: attributes.join("; ") };
}

export function establishAiSession(
  request: Request,
  runtime: AiSessionRuntime,
  dependencies: AiSessionDependencies = {},
): AiSessionResolution {
  const now = nowSeconds(dependencies);
  const existing = verifiedSessionId(sessionCookieValue(request), now, runtime.cookieHmacKey);
  return existing === undefined
    ? issueSession(now, runtime, dependencies)
    : { sessionId: existing, setCookie: undefined };
}

export function resolveAiNetworkId(
  request: Request,
  sessionId: string,
  runtime: AiSessionRuntime,
  dependencies: Pick<AiSessionDependencies, "now"> = {},
): string {
  const now = nowSeconds(dependencies);
  const networkMatch = NETWORK_HEADER_VALUE.exec(request.headers.get(AI_INGRESS_NETWORK_HEADER) ?? "");
  const expiresText = request.headers.get(AI_INGRESS_PROOF_EXPIRES_HEADER);
  const proofMatch = PROOF_HEADER_VALUE.exec(request.headers.get(AI_INGRESS_PROOF_HEADER) ?? "");
  const networkId = networkMatch?.[1];
  const proof = proofMatch?.[1];
  if (
    networkId !== undefined &&
    proof !== undefined &&
    expiresText !== null &&
    PROOF_EXPIRES_VALUE.test(expiresText) &&
    canonicalBytes(networkId, NETWORK_ID_BYTES) !== undefined
  ) {
    const expiresAt = Number(expiresText);
    if (
      Number.isSafeInteger(expiresAt) &&
      expiresAt > now &&
      expiresAt <= now + MAX_INGRESS_PROOF_TTL_SECONDS
    ) {
      const expected = hmac(ingressProofPayload(networkId, expiresAt), runtime.ingressHmacKey);
      if (constantTimeMacMatches(proof, expected)) return networkId;
    }
  }
  if (runtime.production) {
    throw new TypeError("A valid trusted-ingress AI network assertion is required in production");
  }
  if (canonicalBytes(sessionId, SESSION_BYTES) === undefined) throw new TypeError("AI session ID is invalid");
  return hmac(
    `umn-gopher-assistant:ai-development-network:v1\n${sessionId}`,
    runtime.ingressHmacKey,
  ).toString("base64url");
}

export function aiInternalProofHeaders(
  sessionId: string,
  networkId: string,
  traceId: string,
  runtime: AiSessionRuntime,
  dependencies: Pick<AiSessionDependencies, "now"> = {},
): Readonly<Record<string, string>> {
  if (
    canonicalBytes(sessionId, SESSION_BYTES) === undefined ||
    canonicalBytes(networkId, NETWORK_ID_BYTES) === undefined ||
    !TRACE_ID.test(traceId)
  ) {
    throw new TypeError("AI proof inputs are invalid");
  }
  const expiresAt = nowSeconds(dependencies) + PROOF_TTL_SECONDS;
  const signature = hmac(
    proofPayload(traceId, sessionId, networkId, expiresAt),
    runtime.proofHmacKey,
  ).toString("base64url");
  return {
    [AI_INTERNAL_NETWORK_HEADER]: `v1.${networkId}`,
    [AI_INTERNAL_PROOF_EXPIRES_HEADER]: String(expiresAt),
    [AI_INTERNAL_PROOF_HEADER]: `v1.${signature}`,
    [AI_INTERNAL_SESSION_HEADER]: `v1.${sessionId}`,
  };
}
