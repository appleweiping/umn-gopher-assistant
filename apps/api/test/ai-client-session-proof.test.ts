import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  AI_INTERNAL_PROOF_EXPIRES_HEADER,
  AI_INTERNAL_PROOF_HEADER,
  AI_INTERNAL_NETWORK_HEADER,
  AI_INTERNAL_SESSION_HEADER,
  verifiedAiBffClientIdentity,
  type AiInternalHeaders,
} from "../src/ai/ai-client-session-proof.js";

const now = Date.UTC(2026, 6, 23, 0, 0, 0);
const nowSeconds = Math.floor(now / 1_000);
const key = new Uint8Array(32).fill(7);
const sessionId = Buffer.alloc(16, 3).toString("base64url");
const networkId = Buffer.alloc(32, 4).toString("base64url");

function proofHeaders(
  traceId: string,
  expiresAt = nowSeconds + 30,
  id = sessionId,
  network = networkId,
): Record<string, string> {
  const signature = createHmac("sha256", key)
    .update(
      `umn-gopher-assistant:ai-bff-proof:v2\n${traceId}\n${id}\n${network}\n${String(expiresAt)}`,
      "utf8",
    )
    .digest("base64url");
  return {
    [AI_INTERNAL_NETWORK_HEADER]: `v1.${network}`,
    [AI_INTERNAL_PROOF_EXPIRES_HEADER]: String(expiresAt),
    [AI_INTERNAL_PROOF_HEADER]: `v1.${signature}`,
    [AI_INTERNAL_SESSION_HEADER]: `v1.${id}`,
  };
}

describe("AI BFF client-session proof", () => {
  it("accepts a canonical proof bound to one session, network, trace, and short expiry", () => {
    expect(
      verifiedAiBffClientIdentity(proofHeaders("trace-proof-valid"), "trace-proof-valid", key, now),
    ).toEqual({ networkId, sessionId });
  });

  it("rejects tampering, network substitution, cross-trace replay, expiration, and excessive lifetime", () => {
    const valid = proofHeaders("trace-proof-original");
    const validProof = valid[AI_INTERNAL_PROOF_HEADER] ?? "";
    const tampered = {
      ...valid,
      [AI_INTERNAL_PROOF_HEADER]: `${validProof.slice(0, -1)}${validProof.endsWith("A") ? "B" : "A"}`,
    };
    expect(verifiedAiBffClientIdentity(tampered, "trace-proof-original", key, now)).toBeUndefined();
    expect(verifiedAiBffClientIdentity(valid, "trace-proof-replayed", key, now)).toBeUndefined();
    expect(
      verifiedAiBffClientIdentity(
        { ...valid, [AI_INTERNAL_NETWORK_HEADER]: `v1.${Buffer.alloc(32, 5).toString("base64url")}` },
        "trace-proof-original",
        key,
        now,
      ),
    ).toBeUndefined();
    expect(
      verifiedAiBffClientIdentity(
        proofHeaders("trace-proof-expired", nowSeconds - 1),
        "trace-proof-expired",
        key,
        now,
      ),
    ).toBeUndefined();
    expect(
      verifiedAiBffClientIdentity(
        proofHeaders("trace-proof-too-long", nowSeconds + 61),
        "trace-proof-too-long",
        key,
        now,
      ),
    ).toBeUndefined();
  });

  it("rejects missing, duplicated, malformed, and non-canonical internal headers", () => {
    expect(verifiedAiBffClientIdentity({}, "trace-proof-missing", key, now)).toBeUndefined();
    const duplicate: AiInternalHeaders = {
      ...proofHeaders("trace-proof-duplicate"),
      [AI_INTERNAL_SESSION_HEADER]: [`v1.${sessionId}`, `v1.${sessionId}`],
    };
    expect(verifiedAiBffClientIdentity(duplicate, "trace-proof-duplicate", key, now)).toBeUndefined();
    const duplicateNetwork: AiInternalHeaders = {
      ...proofHeaders("trace-network-duplicate"),
      [AI_INTERNAL_NETWORK_HEADER]: [`v1.${networkId}`, `v1.${networkId}`],
    };
    expect(
      verifiedAiBffClientIdentity(duplicateNetwork, "trace-network-duplicate", key, now),
    ).toBeUndefined();
    expect(
      verifiedAiBffClientIdentity(
        {
          ...proofHeaders("trace-proof-malformed"),
          [AI_INTERNAL_SESSION_HEADER]: "v1.not-a-128-bit-session",
        },
        "trace-proof-malformed",
        key,
        now,
      ),
    ).toBeUndefined();
  });
});
