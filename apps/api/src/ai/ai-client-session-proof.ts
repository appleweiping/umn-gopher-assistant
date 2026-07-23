import { createHmac, timingSafeEqual } from "node:crypto";

export const AI_INTERNAL_SESSION_HEADER = "x-gopher-internal-ai-session";
export const AI_INTERNAL_NETWORK_HEADER = "x-gopher-internal-ai-network";
export const AI_INTERNAL_PROOF_EXPIRES_HEADER = "x-gopher-internal-ai-proof-expires";
export const AI_INTERNAL_PROOF_HEADER = "x-gopher-internal-ai-proof";

const SESSION_HEADER = /^v1\.([A-Za-z0-9_-]{22})$/u;
const NETWORK_HEADER = /^v1\.([A-Za-z0-9_-]{43})$/u;
const PROOF_HEADER = /^v1\.([A-Za-z0-9_-]{43})$/u;
const EXPIRES_HEADER = /^[1-9]\d{9}$/u;
const TRACE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const SESSION_BYTES = 16;
const NETWORK_ID_BYTES = 32;
const HMAC_BYTES = 32;
const MAX_PROOF_LIFETIME_SECONDS = 60;

export type AiInternalHeaders = Readonly<Record<string, string | readonly string[] | string[] | undefined>>;

function soleHeader(value: string | readonly string[] | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function canonicalBytes(value: string, length: number): Buffer | undefined {
  if (!BASE64URL.test(value)) return undefined;
  const decoded = Buffer.from(value, "base64url");
  return decoded.byteLength === length && decoded.toString("base64url") === value ? decoded : undefined;
}

function proofPayload(traceId: string, sessionId: string, networkId: string, expiresAt: number): string {
  return `umn-gopher-assistant:ai-bff-proof:v2\n${traceId}\n${sessionId}\n${networkId}\n${String(expiresAt)}`;
}

function constantTimeProofMatches(candidate: string, expected: Buffer): boolean {
  const match = PROOF_HEADER.exec(candidate);
  const candidateBytes = match?.[1] === undefined ? undefined : canonicalBytes(match[1], HMAC_BYTES);
  const comparable = candidateBytes ?? Buffer.alloc(HMAC_BYTES);
  return timingSafeEqual(expected, comparable) && candidateBytes !== undefined;
}

export interface VerifiedAiBffClientIdentity {
  readonly networkId: string;
  readonly sessionId: string;
}

export function verifiedAiBffClientIdentity(
  headers: AiInternalHeaders,
  traceId: string,
  proofHmacKey: Uint8Array,
  nowMilliseconds: number = Date.now(),
): VerifiedAiBffClientIdentity | undefined {
  const sessionMatch = SESSION_HEADER.exec(soleHeader(headers[AI_INTERNAL_SESSION_HEADER]) ?? "");
  const networkMatch = NETWORK_HEADER.exec(soleHeader(headers[AI_INTERNAL_NETWORK_HEADER]) ?? "");
  const expiresText = soleHeader(headers[AI_INTERNAL_PROOF_EXPIRES_HEADER]);
  const proof = soleHeader(headers[AI_INTERNAL_PROOF_HEADER]);
  const sessionId = sessionMatch?.[1];
  const networkId = networkMatch?.[1];
  if (
    sessionId === undefined ||
    networkId === undefined ||
    expiresText === undefined ||
    proof === undefined ||
    !EXPIRES_HEADER.test(expiresText) ||
    !TRACE_ID.test(traceId) ||
    !Number.isFinite(nowMilliseconds) ||
    nowMilliseconds < 0 ||
    canonicalBytes(sessionId, SESSION_BYTES) === undefined ||
    canonicalBytes(networkId, NETWORK_ID_BYTES) === undefined
  ) {
    return undefined;
  }
  const now = Math.floor(nowMilliseconds / 1_000);
  const expiresAt = Number(expiresText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + MAX_PROOF_LIFETIME_SECONDS) {
    return undefined;
  }
  const expected = createHmac("sha256", proofHmacKey)
    .update(proofPayload(traceId, sessionId, networkId, expiresAt), "utf8")
    .digest();
  return constantTimeProofMatches(proof, expected) ? { networkId, sessionId } : undefined;
}
