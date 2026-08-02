import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";

import {
  canonicalizeDpopHtu,
  createDpopProof,
  dpopThumbprint,
  generateDpopPrivateJwk,
  publicDpopJwk,
  parseDpopNonce,
  validateDpopCredential,
} from "../src/index.js";
import {
  TEST_DPOP_CREDENTIAL,
  TEST_DPOP_JKT,
  TEST_DPOP_PRIVATE_JWK,
  testAccessToken,
} from "./dpop-fixture.js";

describe("SDK RFC 9449 primitives", () => {
  it("validates the token/key binding and rejects missing or mismatched keys", async () => {
    await expect(validateDpopCredential(TEST_DPOP_CREDENTIAL)).resolves.toEqual(TEST_DPOP_CREDENTIAL);
    await expect(dpopThumbprint(TEST_DPOP_PRIVATE_JWK)).resolves.toBe(TEST_DPOP_JKT);
    await expect(
      validateDpopCredential({
        accessToken: testAccessToken("x".repeat(43)),
        privateJwk: TEST_DPOP_PRIVATE_JWK,
      }),
    ).rejects.toThrow(/not bound/u);
    await expect(validateDpopCredential({ accessToken: testAccessToken() })).rejects.toThrow(/credential/u);
    await expect(
      validateDpopCredential({
        accessToken: testAccessToken(TEST_DPOP_JKT, {
          "urn:example:key-policy": "device-bound",
        }),
        privateJwk: TEST_DPOP_PRIVATE_JWK,
      }),
    ).resolves.toBeDefined();
  });

  it("signs a fresh exact ES256 proof with normalized htu and ath", async () => {
    const proof = await createDpopProof({
      accessToken: TEST_DPOP_CREDENTIAL.accessToken,
      htm: "GET",
      htu: "HTTPS://BÜCHER.example:443/a/./%7euser/%2f?ignored=yes#ignored",
      nonce: "resource-nonce-123",
      now: () => 2_100_000_000_000,
      privateJwk: TEST_DPOP_PRIVATE_JWK,
    });
    expect(decodeProtectedHeader(proof)).toEqual({
      alg: "ES256",
      jwk: publicDpopJwk(TEST_DPOP_PRIVATE_JWK),
      typ: "dpop+jwt",
    });
    const key = await importJWK(publicDpopJwk(TEST_DPOP_PRIVATE_JWK), "ES256");
    const payload = (await jwtVerify(proof, key, { algorithms: ["ES256"], typ: "dpop+jwt" })).payload;
    expect(payload).toMatchObject({
      htm: "GET",
      htu: "https://xn--bcher-kva.example/a/~user/%2F",
      iat: 2_100_000_000,
      nonce: "resource-nonce-123",
    });
    expect(payload["ath"]).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(decodeJwt(proof).jti).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("accepts a bounded Unicode proof jti", async () => {
    const proof = await createDpopProof({
      htm: "GET",
      htu: "https://example.edu/v1/campuses",
      jti: "短😀",
      privateJwk: TEST_DPOP_PRIVATE_JWK,
    });
    expect(decodeJwt(proof).jti).toBe("短😀");
  });

  it.each(["", "bad\u0000jti", "😀".repeat(65), "\uD800"])("rejects an unsafe proof jti %#", async (jti) => {
    await expect(
      createDpopProof({
        htm: "GET",
        htu: "https://example.edu/v1/campuses",
        jti,
        privateJwk: TEST_DPOP_PRIVATE_JWK,
      }),
    ).rejects.toThrow("DPoP proof input is invalid");
  });

  it("rejects shape-valid but cryptographically invalid or inconsistent private JWKs", async () => {
    const other = await generateDpopPrivateJwk();
    for (const privateJwk of [
      { ...TEST_DPOP_PRIVATE_JWK, d: other.d },
      { ...TEST_DPOP_PRIVATE_JWK, d: "A".repeat(43) },
      { ...TEST_DPOP_PRIVATE_JWK, x: "A".repeat(43), y: "A".repeat(43) },
    ]) {
      await expect(
        validateDpopCredential({
          accessToken: TEST_DPOP_CREDENTIAL.accessToken,
          privateJwk,
        }),
      ).rejects.toThrow("Access token is not a valid DPoP-bound at+jwt");
    }
  });

  it.each([
    ["HTTPS://EXAMPLE.COM:443", "https://example.com/"],
    ["https://example.com/%7e/%41/%2f/%ab", "https://example.com/~/A/%2F/%AB"],
    ["https://example.com/a/./b/../c", "https://example.com/a/c"],
    ["http://EXAMPLE.COM:80", "http://example.com/"],
  ])("normalizes htu %s", (value, expected) => {
    expect(canonicalizeDpopHtu(value)).toBe(expected);
  });

  it("accepts the full bounded NQCHAR nonce syntax and rejects unsafe values", () => {
    expect(parseDpopNonce("!")).toBe("!");
    expect(parseDpopNonce("#[]~")).toBe("#[]~");
    expect(parseDpopNonce('bad"nonce')).toBeUndefined();
    expect(parseDpopNonce("bad\\nonce")).toBeUndefined();
    expect(parseDpopNonce("bad nonce")).toBeUndefined();
  });
});
