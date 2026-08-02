// @vitest-environment node

import { decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";

import {
  createDpopProof,
  canonicalizeDpopHtu,
  dpopThumbprint,
  isDpopNonceChallenge,
  parseDpopNonce,
  parseDpopPrivateJwk,
  publicDpopJwk,
} from "../lib/auth/dpop";
import { TEST_DPOP_JKT, TEST_DPOP_PRIVATE_JWK } from "./dpop-fixture";

describe("web DPoP proof construction", () => {
  it("signs exact ES256 proofs, strips query and fragment, binds the token, and never reuses jti", async () => {
    const target = "https://api.example.edu/v1/personal/vault?secret=query#fragment";
    const first = await createDpopProof({
      accessToken: "access-token-one",
      htm: "GET",
      htu: target,
      nonce: "resource-nonce-123",
      now: () => 1_750_000_000_000,
      privateJwk: TEST_DPOP_PRIVATE_JWK,
    });
    const second = await createDpopProof({
      accessToken: "access-token-one",
      htm: "GET",
      htu: target,
      nonce: "resource-nonce-123",
      now: () => 1_750_000_000_000,
      privateJwk: TEST_DPOP_PRIVATE_JWK,
    });

    expect(first).not.toBe(second);
    expect(Object.keys(decodeProtectedHeader(first)).sort()).toEqual(["alg", "jwk", "typ"]);
    expect(decodeProtectedHeader(first)).toEqual({
      alg: "ES256",
      jwk: publicDpopJwk(TEST_DPOP_PRIVATE_JWK),
      typ: "dpop+jwt",
    });

    const publicKey = await importJWK(publicDpopJwk(TEST_DPOP_PRIVATE_JWK), "ES256");
    const firstPayload = (await jwtVerify(first, publicKey, { algorithms: ["ES256"], typ: "dpop+jwt" }))
      .payload;
    const secondPayload = (await jwtVerify(second, publicKey, { algorithms: ["ES256"], typ: "dpop+jwt" }))
      .payload;
    expect(firstPayload).toMatchObject({
      ath: "qg8_q0yB_6ya4MQPWAr6Zfz28AicLtK-VAgPpFuMut4",
      htm: "GET",
      htu: "https://api.example.edu/v1/personal/vault",
      iat: 1_750_000_000,
      nonce: "resource-nonce-123",
    });
    expect(firstPayload.jti).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(secondPayload.jti).not.toBe(firstPayload.jti);
  });

  it("uses the RFC 7638 public-key thumbprint and rejects non-canonical private keys", async () => {
    await expect(dpopThumbprint(TEST_DPOP_PRIVATE_JWK)).resolves.toBe(TEST_DPOP_JKT);
    expect(parseDpopPrivateJwk({ ...TEST_DPOP_PRIVATE_JWK, kid: "substitution" })).toBeUndefined();
    expect(parseDpopPrivateJwk({ ...TEST_DPOP_PRIVATE_JWK, d: "not-canonical" })).toBeUndefined();
    expect(parseDpopPrivateJwk(publicDpopJwk(TEST_DPOP_PRIVATE_JWK))).toBeUndefined();
  });

  it("recognizes case-insensitive DPoP nonce errors among multiple challenges and parameters", () => {
    for (const authenticate of [
      'dpop realm="api", error="use_dpop_nonce", error_description="retry"',
      'Bearer realm="legacy", DPoP realm="api", error=use_dpop_nonce, ext="value"',
      'Newauth title="comma, inside quote", dPoP error="use_dpop_nonce"',
    ]) {
      const response = new Response(null, {
        headers: {
          "DPoP-Nonce": "resource-nonce-123",
          "WWW-Authenticate": authenticate,
        },
        status: 401,
      });
      expect(isDpopNonceChallenge(response)).toBe("resource-nonce-123");
    }
    expect(
      isDpopNonceChallenge(
        new Response(null, {
          headers: {
            "DPoP-Nonce": "resource-nonce-123",
            "WWW-Authenticate": 'Bearer error="use_dpop_nonce"',
          },
          status: 401,
        }),
      ),
    ).toBeUndefined();
  });

  it.each([
    ["HTTPS://EXAMPLE.COM:443", "https://example.com/"],
    ["https://example.com/%7euser/%41/%2f/%ab?ignored=query#ignored", "https://example.com/~user/A/%2F/%AB"],
    ["https://example.com/a/./b/../c", "https://example.com/a/c"],
    ["https://bücher.example:443", "https://xn--bcher-kva.example/"],
  ])("normalizes RFC 3986 htu %s", (value, expected) => {
    expect(canonicalizeDpopHtu(value)).toBe(expected);
  });

  it("accepts bounded NQCHAR nonces and rejects quote, backslash, and whitespace", () => {
    expect(parseDpopNonce("!")).toBe("!");
    expect(parseDpopNonce("#[]~")).toBe("#[]~");
    expect(parseDpopNonce('bad"nonce')).toBeUndefined();
    expect(parseDpopNonce("bad\\nonce")).toBeUndefined();
    expect(parseDpopNonce("bad nonce")).toBeUndefined();
  });
});
