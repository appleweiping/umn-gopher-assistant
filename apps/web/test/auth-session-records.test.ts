// @vitest-environment node

import { describe, expect, it } from "vitest";

import { loadWebAuthRuntime } from "../lib/auth/runtime";
import {
  AUTH_SESSION_COOKIE,
  clearSessionCookie,
  isSafeReturnTo,
  openAuthRecord,
  randomOpaqueId,
  sealAuthRecord,
  sessionCookie,
  signedAuthCookie,
  uniqueCookieValue,
  verifySignedAuthCookie,
  type AuthSessionRecord,
} from "../lib/auth/session-records";
import { TEST_DPOP_PRIVATE_JWK } from "./dpop-fixture";

const runtime = loadWebAuthRuntime({ NODE_ENV: "test" });
const id = Buffer.alloc(32, 11).toString("base64url");
const nonce = Buffer.alloc(32, 13).toString("base64url");
const record: AuthSessionRecord = {
  accessToken: "a".repeat(64),
  accessTokenExpiresAt: 2_000_000_300,
  authorizationServerDpopNonce: "authorization-server-nonce",
  createdAt: 2_000_000_000,
  dpopPrivateJwk: TEST_DPOP_PRIVATE_JWK,
  idToken: "i".repeat(64),
  issuer: runtime.issuer,
  nonce,
  refreshToken: "r".repeat(64),
  refreshTokenExpiresAt: 2_000_003_600,
  scopes: ["campus:read", "personal:read", "personal:write"],
  subject: "opaque-subject",
};

describe("sealed server-side web sessions", () => {
  it("authenticates an opaque cookie without placing identity or tokens in it", () => {
    const value = signedAuthCookie("session", id, runtime);
    expect(verifySignedAuthCookie("session", value, runtime)).toBe(id);
    expect(value).not.toContain(record.subject);
    expect(value).not.toContain(record.accessToken);
    expect(verifySignedAuthCookie("session", `${value.slice(0, -1)}A`, runtime)).toBeUndefined();
    expect(verifySignedAuthCookie("transaction", value, runtime)).toBeUndefined();
  });

  it("encrypts records with record-specific AAD and rejects tampering", () => {
    const sealed = sealAuthRecord("session", id, record, runtime, {
      randomBytes: (size) => new Uint8Array(size).fill(17),
    });
    expect(sealed).not.toContain(record.subject);
    expect(sealed).not.toContain(record.accessToken);
    expect(sealed).not.toContain(TEST_DPOP_PRIVATE_JWK.d);
    expect(openAuthRecord("session", id, sealed, runtime)).toEqual(record);
    expect(
      openAuthRecord("session", Buffer.alloc(32, 12).toString("base64url"), sealed, runtime),
    ).toBeUndefined();
    expect(openAuthRecord("session", id, `${sealed.slice(0, -1)}A`, runtime)).toBeUndefined();
  });

  it("rejects duplicate session cookies and emits hardened lifecycle attributes", () => {
    const value = signedAuthCookie("session", id, runtime);
    expect(
      uniqueCookieValue(
        new Request("http://localhost:3000", { headers: { cookie: `${AUTH_SESSION_COOKIE}=${value}` } }),
        AUTH_SESSION_COOKIE,
      ),
    ).toBe(value);
    expect(
      uniqueCookieValue(
        new Request("http://localhost:3000", {
          headers: { cookie: `${AUTH_SESSION_COOKIE}=${value}; ${AUTH_SESSION_COOKIE}=${value}` },
        }),
        AUTH_SESSION_COOKIE,
      ),
    ).toBeUndefined();
    expect(sessionCookie(id, 300, runtime)).toContain("HttpOnly; SameSite=Strict");
    expect(clearSessionCookie(runtime)).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  });

  it("accepts only same-origin relative return locations", () => {
    expect(isSafeReturnTo("/plan?campus=tc#today")).toBe(true);
    for (const value of [
      "https://attacker.invalid",
      "//attacker.invalid",
      "/\\attacker",
      "/ok\nSet-Cookie:x",
    ]) {
      expect(isSafeReturnTo(value)).toBe(false);
    }
  });

  it("requires exact randomness lengths", () => {
    expect(randomOpaqueId({ randomBytes: (size) => new Uint8Array(size) })).toHaveLength(43);
    expect(() => randomOpaqueId({ randomBytes: () => new Uint8Array(31) })).toThrow();
  });
});
