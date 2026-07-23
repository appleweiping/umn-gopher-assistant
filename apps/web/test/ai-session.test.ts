// @vitest-environment node

import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  AI_INGRESS_NETWORK_HEADER,
  AI_INGRESS_PROOF_EXPIRES_HEADER,
  AI_INGRESS_PROOF_HEADER,
  AI_INTERNAL_NETWORK_HEADER,
  AI_INTERNAL_PROOF_HEADER,
  AI_SESSION_COOKIE_NAME,
  aiInternalProofHeaders,
  establishAiSession,
  loadAiSessionRuntime,
  resolveAiNetworkId,
} from "../lib/ai/session";

const now = Date.UTC(2026, 6, 23, 0, 0, 0);
const key = (byte: number) => Buffer.alloc(32, byte).toString("base64url");
const productionEnvironment = {
  GOPHER_AI_INGRESS_ASSERTION_HMAC_KEY: key(3),
  GOPHER_AI_SESSION_COOKIE_HMAC_KEY: key(1),
  INTERNAL_AI_BFF_PROOF_HMAC_KEY: key(2),
  NODE_ENV: "production",
} as const;
const request = (cookie?: string, extraHeaders: HeadersInit = {}) => {
  const headers = new Headers(extraHeaders);
  if (cookie !== undefined) headers.set("Cookie", cookie);
  return new Request("https://assistant.example/api/ai/query", { headers, method: "POST" });
};

function ingressHeaders(
  networkId: string,
  expiresAt: number,
  hmacKey = Buffer.from(productionEnvironment.GOPHER_AI_INGRESS_ASSERTION_HMAC_KEY, "base64url"),
): Record<string, string> {
  const proof = createHmac("sha256", hmacKey)
    .update(
      `umn-gopher-assistant:ai-ingress-network:v1\nPOST\n/api/ai/query\n${networkId}\n${String(expiresAt)}`,
      "utf8",
    )
    .digest("base64url");
  return {
    [AI_INGRESS_NETWORK_HEADER]: `v1.${networkId}`,
    [AI_INGRESS_PROOF_EXPIRES_HEADER]: String(expiresAt),
    [AI_INGRESS_PROOF_HEADER]: `v1.${proof}`,
  };
}

describe("AI BFF anonymous session", () => {
  it("requires strong independent production secrets without returning their values", () => {
    expect(() => loadAiSessionRuntime({ NODE_ENV: "production" })).toThrow(
      "GOPHER_AI_SESSION_COOKIE_HMAC_KEY is required",
    );
    expect(() =>
      loadAiSessionRuntime({
        GOPHER_AI_SESSION_COOKIE_HMAC_KEY: key(1),
        NODE_ENV: "production",
      }),
    ).toThrow("INTERNAL_AI_BFF_PROOF_HMAC_KEY is required");
    expect(() =>
      loadAiSessionRuntime({
        GOPHER_AI_SESSION_COOKIE_HMAC_KEY: key(1),
        INTERNAL_AI_BFF_PROOF_HMAC_KEY: key(2),
        NODE_ENV: "production",
      }),
    ).toThrow("GOPHER_AI_INGRESS_ASSERTION_HMAC_KEY is required");
    expect(() =>
      loadAiSessionRuntime({
        GOPHER_AI_SESSION_COOKIE_HMAC_KEY: "c2hvcnQ",
        INTERNAL_AI_BFF_PROOF_HMAC_KEY: key(2),
        NODE_ENV: "production",
      }),
    ).toThrow("32 through 64 bytes");
    expect(() =>
      loadAiSessionRuntime({
        GOPHER_AI_SESSION_COOKIE_HMAC_KEY: Buffer.from(
          "development-only-web-ai-session-cookie-hmac-key-v1",
        ).toString("base64url"),
        INTERNAL_AI_BFF_PROOF_HMAC_KEY: key(2),
        NODE_ENV: "production",
      }),
    ).toThrow("fixed development key");
    expect(() =>
      loadAiSessionRuntime({
        GOPHER_AI_SESSION_COOKIE_HMAC_KEY: key(1),
        GOPHER_AI_INGRESS_ASSERTION_HMAC_KEY: key(3),
        INTERNAL_AI_BFF_PROOF_HMAC_KEY: key(1),
        NODE_ENV: "production",
      }),
    ).toThrow("must be independent");
    expect(() =>
      loadAiSessionRuntime({
        GOPHER_AI_INGRESS_ASSERTION_HMAC_KEY: key(1),
        GOPHER_AI_SESSION_COOKIE_HMAC_KEY: key(1),
        INTERNAL_AI_BFF_PROOF_HMAC_KEY: key(2),
        NODE_ENV: "production",
      }),
    ).toThrow("must be independent");
  });

  it("issues and verifies a strict, expiring 128-bit HttpOnly cookie", () => {
    const runtime = loadAiSessionRuntime({ NODE_ENV: "test" });
    const issued = establishAiSession(request(), runtime, {
      now: () => now,
      randomBytes: () => new Uint8Array(16).fill(7),
    });
    expect(issued.sessionId).toMatch(/^[A-Za-z0-9_-]{22}$/u);
    expect(issued.setCookie).toContain(`${AI_SESSION_COOKIE_NAME}=v1.`);
    expect(issued.setCookie).toContain("Path=/api/ai");
    expect(issued.setCookie).toContain("HttpOnly");
    expect(issued.setCookie).toContain("SameSite=Strict");
    expect(issued.setCookie).toContain("Max-Age=86400");
    expect(issued.setCookie).not.toContain("Secure");

    const cookie = issued.setCookie?.split(";", 1)[0];
    expect(cookie).toBeDefined();
    const reused = establishAiSession(request(cookie), runtime, { now: () => now + 1_000 });
    expect(reused).toEqual({ sessionId: issued.sessionId, setCookie: undefined });

    const tampered = `${cookie?.slice(0, -1)}${cookie?.endsWith("A") === true ? "B" : "A"}`;
    const replaced = establishAiSession(request(tampered), runtime, {
      now: () => now + 1_000,
      randomBytes: () => new Uint8Array(16).fill(8),
    });
    expect(replaced.sessionId).not.toBe(issued.sessionId);
    expect(replaced.setCookie).toBeDefined();

    const expired = establishAiSession(request(cookie), runtime, {
      now: () => now + 86_401_000,
      randomBytes: () => new Uint8Array(16).fill(9),
    });
    expect(expired.sessionId).not.toBe(issued.sessionId);
    expect(expired.setCookie).toBeDefined();
  });

  it("rejects duplicate cookies and binds short-lived proofs to the trace ID", () => {
    const runtime = loadAiSessionRuntime({ NODE_ENV: "test" });
    const issued = establishAiSession(request(), runtime, {
      now: () => now,
      randomBytes: () => new Uint8Array(16).fill(3),
    });
    const cookie = issued.setCookie?.split(";", 1)[0];
    const duplicate = establishAiSession(request(`${cookie}; ${cookie}`), runtime, {
      now: () => now + 1_000,
      randomBytes: () => new Uint8Array(16).fill(4),
    });
    expect(duplicate.sessionId).not.toBe(issued.sessionId);

    const networkId = Buffer.alloc(32, 5).toString("base64url");
    const first = aiInternalProofHeaders(issued.sessionId, networkId, "trace-session-one", runtime, {
      now: () => now,
    });
    const second = aiInternalProofHeaders(issued.sessionId, networkId, "trace-session-two", runtime, {
      now: () => now,
    });
    expect(first[AI_INTERNAL_NETWORK_HEADER]).toBe(`v1.${networkId}`);
    expect(first[AI_INTERNAL_PROOF_HEADER]).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/u);
    expect(first[AI_INTERNAL_PROOF_HEADER]).not.toBe(second[AI_INTERNAL_PROOF_HEADER]);
  });

  it("adds Secure to production cookies", () => {
    const runtime = loadAiSessionRuntime(productionEnvironment);
    const issued = establishAiSession(request(), runtime, {
      now: () => now,
      randomBytes: () => new Uint8Array(16).fill(1),
    });
    expect(issued.setCookie).toContain("; Secure");
  });

  it("accepts only a canonical short-lived trusted-ingress network assertion in production", () => {
    const runtime = loadAiSessionRuntime(productionEnvironment);
    const sessionId = Buffer.alloc(16, 1).toString("base64url");
    const networkId = Buffer.alloc(32, 6).toString("base64url");
    const expiresAt = Math.floor(now / 1_000) + 30;
    expect(
      resolveAiNetworkId(request(undefined, ingressHeaders(networkId, expiresAt)), sessionId, runtime, {
        now: () => now,
      }),
    ).toBe(networkId);

    const forged = ingressHeaders(networkId, expiresAt, Buffer.alloc(32, 99));
    expect(() =>
      resolveAiNetworkId(request(undefined, forged), sessionId, runtime, { now: () => now }),
    ).toThrow("trusted-ingress");
    expect(() =>
      resolveAiNetworkId(
        request(undefined, ingressHeaders(networkId, Math.floor(now / 1_000) - 1)),
        sessionId,
        runtime,
        { now: () => now },
      ),
    ).toThrow("trusted-ingress");
    expect(() =>
      resolveAiNetworkId(
        request(undefined, {
          ...ingressHeaders(networkId, expiresAt),
          [AI_INGRESS_NETWORK_HEADER]: `v1.${networkId}, v1.${networkId}`,
        }),
        sessionId,
        runtime,
        { now: () => now },
      ),
    ).toThrow("trusted-ingress");
  });

  it("uses an explicit degraded session-derived network identity outside production", () => {
    const runtime = loadAiSessionRuntime({ NODE_ENV: "test" });
    const firstSession = Buffer.alloc(16, 1).toString("base64url");
    const secondSession = Buffer.alloc(16, 2).toString("base64url");
    const first = resolveAiNetworkId(request(), firstSession, runtime, { now: () => now });
    const repeated = resolveAiNetworkId(request(), firstSession, runtime, { now: () => now });
    const second = resolveAiNetworkId(request(), secondSession, runtime, { now: () => now });

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(repeated).toBe(first);
    expect(second).not.toBe(first);
  });
});
