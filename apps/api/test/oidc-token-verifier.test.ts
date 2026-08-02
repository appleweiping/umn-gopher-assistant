import { randomUUID } from "node:crypto";

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { JoseOidcTokenVerifier, parseDpopAuthorization } from "../src/auth/oidc-token-verifier.js";
import type { ApiRuntimeConfig } from "../src/runtime-config.js";

const ISSUER = "https://identity.example.edu/realms/gopher";
const AUDIENCE = "gopher-api";
const DPOP_JKT = Buffer.alloc(32, 7).toString("base64url");
const config: ApiRuntimeConfig = {
  ai: {
    knowledgeBaseUrl: new URL("http://127.0.0.1:8100"),
    maxResponseBytes: 262_144,
    serviceHmacKey: new TextEncoder().encode("development-only-ai-service-hmac-key-v1"),
    rateLimit: {
      clientLimit: 12,
      globalLimit: 600,
      networkLimit: 120,
      redisUrl: new URL("redis://:local-only@127.0.0.1:6379"),
      windowSeconds: 60,
    },
    requestTimeoutMs: 3_000,
  },
  cors: { allowedOrigins: ["http://localhost:3000"] },
  nodeEnv: "test",
  oidc: {
    allowedClientIds: ["gopher-web", "gopher-cli"],
    audience: AUDIENCE,
    dpop: {
      nonceTtlSeconds: 300,
      operationTimeoutMs: 1_000,
      proofLimit: 600,
      proofMaxAgeSeconds: 60,
      proofWindowSeconds: 60,
      publicOrigin: new URL("https://api.example.edu"),
      redisUrl: new URL("rediss://:test-only@redis.example.edu"),
      replayTtlSeconds: 120,
    },
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
    cnf: { jkt: DPOP_JKT },
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
      dpopJkt: DPOP_JKT,
      issuer: ISSUER,
      scopes: ["campus:read", "personal:read"],
      subject: "student-123",
    });
    expect(Object.keys(principal).sort()).toEqual(["clientId", "dpopJkt", "issuer", "scopes", "subject"]);
    expect(Object.isFrozen(principal)).toBe(true);
    expect(Object.isFrozen(principal.scopes)).toBe(true);
  });

  it("accepts the access-token-profile client_id claim and a token without scope", async () => {
    const principal = await verifier.verify(
      await issueToken({ claims: { azp: undefined, client_id: "gopher-cli" }, omitScope: true }),
    );
    expect(principal).toEqual({
      clientId: "gopher-cli",
      dpopJkt: DPOP_JKT,
      issuer: ISSUER,
      scopes: [],
      subject: "student-123",
    });
  });

  it("accepts extension members alongside the required cnf.jkt confirmation", async () => {
    const principal = await verifier.verify(
      await issueToken({
        claims: {
          cnf: {
            jkt: DPOP_JKT,
            "urn:example:key-policy": "device-bound",
          },
        },
      }),
    );

    expect(principal.dpopJkt).toBe(DPOP_JKT);
  });

  it("accepts an issuer's bounded URI-form JWT ID", async () => {
    const principal = await verifier.verify(
      await issueToken({ jti: "urn:uuid:00000000-0000-4000-8000-000000000001" }),
    );
    expect(principal.subject).toBe("student-123");
    await expect(verifier.verify(await issueToken({ jti: "短" }))).resolves.toMatchObject({
      subject: "student-123",
    });
    await expect(verifier.verify(await issueToken({ jti: "😀" }))).resolves.toMatchObject({
      subject: "student-123",
    });
  });

  it("accepts a bounded Unicode subject without normalizing its identity", async () => {
    await expect(verifier.verify(await issueToken({ subject: "学生😀" }))).resolves.toMatchObject({
      subject: "学生😀",
    });
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
    ["control character in token ID", () => issueToken({ jti: "bad\nid" })],
    ["oversized UTF-8 token ID", () => issueToken({ jti: "短".repeat(86) })],
    ["future issued-at", () => issueToken({ issuedAt: Math.floor(Date.now() / 1_000) + 30 })],
    ["future not-before", () => issueToken({ notBefore: Math.floor(Date.now() / 1_000) + 60 })],
    ["wrong issuer", () => issueToken({ issuer: "https://identity.example.edu/realms/other" })],
    ["wrong audience", () => issueToken({ audience: "another-api" })],
    ["ambiguous audience", () => issueToken({ audience: [AUDIENCE, "another-api"] })],
    ["forged signature", () => issueToken({ key: otherPrivateKey })],
    ["missing subject", () => issueToken({ omitSubject: true })],
    ["control character in subject", () => issueToken({ subject: "student\u0000subject" })],
    ["ill-formed subject", () => issueToken({ subject: "\uD800" })],
    ["oversized UTF-8 subject", () => issueToken({ subject: "😀".repeat(129) })],
    ["generic JWT type", () => issueToken({ tokenType: "JWT" })],
    ["ID-token type", () => issueToken({ tokenType: "id+jwt" })],
    ["missing token type", () => issueToken({ tokenType: null })],
    ["missing DPoP confirmation", () => issueToken({ claims: { cnf: undefined } })],
    ["malformed DPoP confirmation", () => issueToken({ claims: { cnf: { jkt: "short" } } })],
    ["unapproved authorized party", () => issueToken({ claims: { azp: "untrusted-client" } })],
    ["MCP client at the Core API boundary", () => issueToken({ claims: { azp: "gopher-mcp" } })],
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

  it("parses one DPoP credential with a case-insensitive scheme and rejects Bearer fallback", () => {
    const token = "a".repeat(32);
    expect(parseDpopAuthorization(`DPoP ${token}`)).toBe(token);
    expect(parseDpopAuthorization(`dpop ${token}`)).toBe(token);
    expect(parseDpopAuthorization(`dPoP ${token}`)).toBe(token);
    expect(parseDpopAuthorization(`DPoP    ${token}`)).toBe(token);
    for (const invalid of [
      `DPoP ${token} `,
      `DPoP ${token}, DPoP second`,
      `Bearer ${token}`,
      `Basic ${token}`,
      undefined,
    ]) {
      expect(() => parseDpopAuthorization(invalid)).toThrow("Access token validation failed");
    }
  });
});
