import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  AI_INGRESS_NETWORK_HEADER,
  AI_INGRESS_PROOF_EXPIRES_HEADER,
  AI_INGRESS_PROOF_HEADER,
  createIngressAssertionHeaders,
  ingressProofPayload,
} from "../src/assertion.js";

const KEY = Buffer.alloc(32, 0x4a);
const NETWORK_ID = Buffer.alloc(32, 0x6b).toString("base64url");

describe("trusted-ingress assertion", () => {
  it("matches the Web BFF v1 canonical contract exactly", () => {
    const now = Date.UTC(2026, 6, 23, 1, 2, 3);
    const expiresAt = Math.floor(now / 1_000) + 30;
    const canonical = [
      "umn-gopher-assistant:ai-ingress-network:v1",
      "POST",
      "/api/ai/query",
      NETWORK_ID,
      String(expiresAt),
    ].join("\n");
    const expected = createHmac("sha256", KEY).update(canonical, "utf8").digest("base64url");

    expect(ingressProofPayload(NETWORK_ID, expiresAt)).toBe(canonical);
    expect(createIngressAssertionHeaders(NETWORK_ID, KEY, now)).toEqual({
      [AI_INGRESS_NETWORK_HEADER]: `v1.${NETWORK_ID}`,
      [AI_INGRESS_PROOF_EXPIRES_HEADER]: String(expiresAt),
      [AI_INGRESS_PROOF_HEADER]: `v1.${expected}`,
    });
  });

  it("rejects malformed network identifiers, keys, and clocks", () => {
    expect(() => createIngressAssertionHeaders("not-canonical", KEY, Date.now())).toThrow(TypeError);
    expect(() => createIngressAssertionHeaders(NETWORK_ID, Buffer.alloc(31), Date.now())).toThrow(TypeError);
    expect(() => createIngressAssertionHeaders(NETWORK_ID, KEY, Number.NaN)).toThrow(TypeError);
  });
});
