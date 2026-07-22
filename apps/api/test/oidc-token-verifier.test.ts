import { randomUUID } from "node:crypto";

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { JoseOidcTokenVerifier, parseBearerToken } from "../src/auth/oidc-token-verifier.js";
import type { ApiRuntimeConfig } from "../src/runtime-config.js";

const ISSUER = "https://identity.example.edu/realms/gopher";
const AUDIENCE = "gopher-api";
const config: ApiRuntimeConfig = {
  cors: { allowedOrigins: ["http://localhost:3000"] },
  nodeEnv: "test",
  oidc: {
    allowedClientIds: ["gopher-web", "gopher-cli"],
    audience: AUDIENCE,
    issuer: ISSUER,
    jwksUrl: new URL(`${ISSUER}/protocol/openid-connect/certs`),
    maxTokenLifetimeSeconds: 300,
  },
  port: 4000,
};

type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

let privateKey: SigningKey;
let otherPrivateKey: SigningKey;
let verifier: JoseOidcTokenVerifier;

interface TokenOverrides {
  readonly audience?: string | readonly string[];
  readonly claims?: Readonly<Record<string, unknown>>;
  readonly expiration?: number | null;
  readonly issuer?: string;
  readonly issuedAt?: number | null;
  readonly jti?: string | null;
  readonly key?: SigningKey;
  readonly notBefore?: number | null;
  readonly omitScope?: boolean;
  readonly omitSubject?: boolean;
  readonly scope?: string;
  readonly subject?: string;
  readonly tokenType?: string | null;
}

async function issueToken(overrides: TokenOverrides = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  const audience = overrides.audience ?? AUDIENCE;
  let token = new SignJWT({
    azp: "gopher-web",
    ...(overrides.omitScope === true ? {} : { scope: overrides.scope ?? "campus:read personal:read" }),
    ...overrides.claims,
  })
    .setProtectedHeader({
      alg: "RS256",
      kid: "primary",
      ...(overrides.tokenType === null ? {} : { typ: overrides.tokenType ?? "at+jwt" }),
    })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(typeof audience === "string" ? audience : [...audience]);
  if (overrides.issuedAt !== null) {
    token = token.setIssuedAt(overrides.issuedAt ?? now);
  }
  if (overrides.jti !== null) {
    token = token.setJti(overrides.jti ?? randomUUID());
  }
  if (overrides.omitSubject !== true) {
    token = token.setSubject(overrides.subject ?? "student-123");
  }
  if (overrides.expiration !== null) {
    token = token.setExpirationTime(overrides.expiration ?? now + 300);
  }
  if (overrides.notBefore !== null) {
    token = token.setNotBefore(overrides.notBefore ?? now - 1);
  }
  return token.sign(overrides.key ?? privateKey);
}

beforeAll(async () => {
  const keyPair = await generateKeyPair("RS256");
  const otherKeyPair = await generateKeyPair("RS256");
  privateKey = keyPair.privateKey;
  otherPrivateKey = otherKeyPair.privateKey;
  const publicJwk = {
    ...(await exportJWK(keyPair.publicKey)),
    alg: "RS256",
    kid: "primary",
    use: "sig",
  };
  verifier = new JoseOidcTokenVerifier(config, createLocalJWKSet({ keys: [publicJwk] }));
});

function expectValidationFailure(tokenPromise: Promise<string>): Promise<unknown> {
  return expect(tokenPromise.then((token) => verifier.verify(token))).rejects.toMatchObject({
    message: "Access token validation failed",
    name: "AccessTokenValidationError",
  });
}

describe("OIDC access-token verifier", () => {
  it("returns only a frozen client, subject, and parsed scope list for a valid access token", async () => {
    const principal = await verifier.verify(await issueToken());

    expect(principal).toEqual({
      clientId: "gopher-web",
      scopes: ["campus:read", "personal:read"],
      subject: "student-123",
    });
    expect(Object.keys(principal).sort()).toEqual(["clientId", "scopes", "subject"]);
    expect(Object.isFrozen(principal)).toBe(true);
    expect(Object.isFrozen(principal.scopes)).toBe(true);
  });

  it("accepts the access-token-profile client_id claim and a token without scope", async () => {
    const principal = await verifier.verify(
      await issueToken({ claims: { azp: undefined, client_id: "gopher-cli" }, omitScope: true }),
    );
    expect(principal).toEqual({ clientId: "gopher-cli", scopes: [], subject: "student-123" });
  });

  it("accepts an issuer's bounded URI-form JWT ID", async () => {
    const principal = await verifier.verify(
      await issueToken({ jti: "urn:uuid:00000000-0000-4000-8000-000000000001" }),
    );
    expect(principal.subject).toBe("student-123");
  });

  it("deduplicates canonical scopes", async () => {
    const principal = await verifier.verify(
      await issueToken({ scope: "campus:read campus:read personal:read" }),
    );
    expect(principal.scopes).toEqual(["campus:read", "personal:read"]);
  });

  it.each([
    ["expired", () => issueToken({ expiration: Math.floor(Date.now() / 1_000) - 30 })],
    ["missing expiration", () => issueToken({ expiration: null })],
    ["missing issued-at", () => issueToken({ issuedAt: null })],
    ["missing token ID", () => issueToken({ jti: null })],
    ["malformed token ID", () => issueToken({ jti: "short" })],
    ["future issued-at", () => issueToken({ issuedAt: Math.floor(Date.now() / 1_000) + 30 })],
    ["future not-before", () => issueToken({ notBefore: Math.floor(Date.now() / 1_000) + 60 })],
    ["wrong issuer", () => issueToken({ issuer: "https://identity.example.edu/realms/other" })],
    ["wrong audience", () => issueToken({ audience: "another-api" })],
    ["ambiguous audience", () => issueToken({ audience: [AUDIENCE, "another-api"] })],
    ["forged signature", () => issueToken({ key: otherPrivateKey })],
    ["missing subject", () => issueToken({ omitSubject: true })],
    ["generic JWT type", () => issueToken({ tokenType: "JWT" })],
    ["ID-token type", () => issueToken({ tokenType: "id+jwt" })],
    ["missing token type", () => issueToken({ tokenType: null })],
    ["unapproved authorized party", () => issueToken({ claims: { azp: "untrusted-client" } })],
    [
      "conflicting client identifiers",
      () => issueToken({ claims: { azp: "gopher-web", client_id: "gopher-cli" } }),
    ],
  ])("rejects a %s token", async (_label, makeToken) => {
    await expectValidationFailure(makeToken());
  });

  it("rejects a token whose declared lifetime exceeds the configured maximum", async () => {
    const now = Math.floor(Date.now() / 1_000);
    await expectValidationFailure(issueToken({ expiration: now + 301, issuedAt: now }));
  });

  it.each([
    ["embedded quote", 'campus:read bad"scope'],
    ["double separator", "campus:read  personal:read"],
    ["line break", "campus:read\npersonal:read"],
    ["overlong claim", "a".repeat(2_049)],
    ["too many scopes", Array.from({ length: 65 }, (_, index) => `scope:${String(index)}`).join(" ")],
  ])("rejects a malformed or excessive scope claim: %s", async (_label, scope) => {
    await expectValidationFailure(issueToken({ scope }));
  });

  it("parses only one canonical Bearer credential", () => {
    const token = "a".repeat(32);
    expect(parseBearerToken(`Bearer ${token}`)).toBe(token);
    for (const invalid of [
      `bearer ${token}`,
      `Bearer  ${token}`,
      `Bearer ${token} `,
      `Bearer ${token}, Bearer second`,
      `Basic ${token}`,
      undefined,
    ]) {
      expect(() => parseBearerToken(invalid)).toThrow("Access token validation failed");
    }
  });
});
