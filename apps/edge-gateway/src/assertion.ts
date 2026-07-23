import { createHmac } from "node:crypto";

export const AI_INGRESS_NETWORK_HEADER = "X-Gopher-Ingress-AI-Network";
export const AI_INGRESS_PROOF_EXPIRES_HEADER = "X-Gopher-Ingress-AI-Proof-Expires";
export const AI_INGRESS_PROOF_HEADER = "X-Gopher-Ingress-AI-Proof";

const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const NETWORK_ID_BYTES = 32;
const PROOF_TTL_SECONDS = 30;

export interface IngressAssertionHeaders {
  readonly [AI_INGRESS_NETWORK_HEADER]: string;
  readonly [AI_INGRESS_PROOF_EXPIRES_HEADER]: string;
  readonly [AI_INGRESS_PROOF_HEADER]: string;
}

function canonicalBytes(value: string, expectedLength: number): Buffer | undefined {
  if (!BASE64URL.test(value)) return undefined;
  const decoded = Buffer.from(value, "base64url");
  return decoded.byteLength === expectedLength && decoded.toString("base64url") === value
    ? decoded
    : undefined;
}

export function ingressProofPayload(networkId: string, expiresAt: number): string {
  if (
    canonicalBytes(networkId, NETWORK_ID_BYTES) === undefined ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt < 1_000_000_000 ||
    expiresAt > 9_999_999_999
  ) {
    throw new TypeError("Trusted-ingress assertion inputs are invalid");
  }
  return `umn-gopher-assistant:ai-ingress-network:v1\nPOST\n/api/ai/query\n${networkId}\n${String(expiresAt)}`;
}

export function createIngressAssertionHeaders(
  networkId: string,
  assertionHmacKey: Uint8Array,
  nowMilliseconds: number = Date.now(),
): IngressAssertionHeaders {
  if (!Number.isFinite(nowMilliseconds) || nowMilliseconds < 0) {
    throw new TypeError("Trusted-ingress assertion clock is invalid");
  }
  if (assertionHmacKey.byteLength < 32 || assertionHmacKey.byteLength > 64) {
    throw new TypeError("Trusted-ingress assertion key is invalid");
  }

  const expiresAt = Math.floor(nowMilliseconds / 1_000) + PROOF_TTL_SECONDS;
  const signature = createHmac("sha256", assertionHmacKey)
    .update(ingressProofPayload(networkId, expiresAt), "utf8")
    .digest("base64url");
  return {
    [AI_INGRESS_NETWORK_HEADER]: `v1.${networkId}`,
    [AI_INGRESS_PROOF_EXPIRES_HEADER]: String(expiresAt),
    [AI_INGRESS_PROOF_HEADER]: `v1.${signature}`,
  };
}
