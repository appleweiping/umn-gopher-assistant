import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import type { JWTPayload } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { AccessTokenValidationError, JoseAccessTokenVerifier, parseDpopAccessToken } from "../src/auth.js";
import { loadMcpServerConfig } from "../src/config.js";

const config = loadMcpServerConfig({
  MCP_AUTH_MODE: "oauth",
  MCP_OAUTH_ISSUER: "http://127.0.0.1:8080/realms/gopher-assistant-dev",
  MCP_RESOURCE_URL: "http://127.0.0.1:4100/mcp",
  NODE_ENV: "test",
});

type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

let privateKey: SigningKey;
let otherPrivateKey: SigningKey;
let psPrivateKey: SigningKey;
let verifier: JoseAccessTokenVerifier;
let localJwkSet: ReturnType<typeof createLocalJWKSet>;
const DPOP_JKT = Buffer.alloc(32, 91).toString("base64url");

beforeAll(async () => {
  const primary = await generateKeyPair("RS256");
  const other = await generateKeyPair("RS256");
  const ps = await generateKeyPair("PS256");
  privateKey = primary.privateKey;
  otherPrivateKey = other.privateKey;
  psPrivateKey = ps.privateKey;
  const publicJwk = { ...(await exportJWK(primary.publicKey)), alg: "RS256", kid: "primary", use: "sig" };
  const psPublicJwk = { ...(await exportJWK(ps.publicKey)), alg: "PS256", kid: "ps", use: "sig" };
  localJwkSet = createLocalJWKSet({ keys: [publicJwk, psPublicJwk] });
  verifier = new JoseAccessTokenVerifier(config, localJwkSet);
});

interface TokenOverrides {
  readonly algorithm?: "PS256" | "RS256";
  readonly audience?: string | readonly string[];
  readonly authorizedParty?: unknown;
  readonly clientId?: unknown;
  readonly confirmation?: unknown;
  readonly expiration?: number | "missing";
  readonly issuer?: string;
  readonly issuedAt?: number;
  readonly jti?: unknown;
  readonly key?: SigningKey;
  readonly notBefore?: number | "missing";
  readonly omitAuthorizedParty?: boolean;
  readonly omitConfirmation?: boolean;
  readonly scope?: string;
  readonly subject?: string;
  readonly tokenType?: string;
}

async function issueToken(overrides: TokenOverrides = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const audience =
    overrides.audience === undefined
      ? "http://127.0.0.1:4100/mcp"
      : typeof overrides.audience === "string"
        ? overrides.audience
        : [...overrides.audience];
  const algorithm = overrides.algorithm ?? "RS256";
  const payload: Record<string, unknown> = {
    ...(!overrides.omitAuthorizedParty
      ? {
          azp: overrides.authorizedParty === undefined ? "gopher-mcp" : overrides.authorizedParty,
        }
      : {}),
    ...(overrides.clientId === undefined ? {} : { client_id: overrides.clientId }),
    ...(overrides.omitConfirmation
      ? {}
      : {
          cnf: overrides.confirmation === undefined ? { jkt: DPOP_JKT } : overrides.confirmation,
        }),
    ...(overrides.jti === "missing" ? {} : { jti: overrides.jti ?? "mcp-access-token-jti" }),
    scope: overrides.scope ?? "campus:read profile",
  };
  let token = new SignJWT(payload as JWTPayload)
    .setProtectedHeader({
      alg: algorithm,
      kid: algorithm === "PS256" ? "ps" : "primary",
      typ: overrides.tokenType ?? "at+jwt",
    })
    .setIssuer(overrides.issuer ?? "http://127.0.0.1:8080/realms/gopher-assistant-dev")
    .setAudience(audience)
    .setSubject(overrides.subject ?? "test-user")
    .setIssuedAt(overrides.issuedAt ?? now);
  if (overrides.expiration !== "missing") {
    token = token.setExpirationTime(overrides.expiration ?? now + 300);
  }
  if (overrides.notBefore !== "missing") {
    token = token.setNotBefore(overrides.notBefore ?? now - 1);
  }
  return token.sign(overrides.key ?? (algorithm === "PS256" ? psPrivateKey : privateKey));
}

describe("OAuth access-token verification", () => {
  it("accepts a correctly signed, exact-resource, scoped token", async () => {
    const identity = await verifier.verify(await issueToken());

    expect(identity.subject).toBe("test-user");
    expect(identity.clientId).toBe("gopher-mcp");
    expect(identity.dpopJkt).toBe(DPOP_JKT);
    expect(identity.scopes.has("campus:read")).toBe(true);
  });

  it.each([
    ["wrong issuer", () => issueToken({ issuer: "http://127.0.0.1:8080/realms/other" })],
    ["wrong audience", () => issueToken({ audience: "http://127.0.0.1:4000" })],
    [
      "audience confusion",
      () => issueToken({ audience: ["http://127.0.0.1:4100/mcp", "http://127.0.0.1:4000"] }),
    ],
    ["missing scope", () => issueToken({ scope: "profile" })],
    ["missing expiration", () => issueToken({ expiration: "missing" })],
    ["expired token", () => issueToken({ expiration: Math.floor(Date.now() / 1000) - 30 })],
    ["future not-before", () => issueToken({ notBefore: Math.floor(Date.now() / 1000) + 60 })],
    ["non-integer not-before", () => issueToken({ notBefore: Math.floor(Date.now() / 1000) - 0.5 })],
    ["future issued-at", () => issueToken({ issuedAt: Math.floor(Date.now() / 1000) + 60 })],
    ["non-integer expiration", () => issueToken({ expiration: Math.floor(Date.now() / 1000) + 300.5 })],
    ["tab-separated scope", () => issueToken({ scope: "campus:read\tprofile" })],
    ["duplicate scope", () => issueToken({ scope: "campus:read campus:read" })],
    [
      "too many scopes",
      () =>
        issueToken({
          scope: `campus:read ${Array.from({ length: 64 }, (_, index) => `s${String(index)}`).join(" ")}`,
        }),
    ],
    ["oversized scope", () => issueToken({ scope: `campus:read ${"s".repeat(2_100)}` })],
    ["forged signature", () => issueToken({ key: otherPrivateKey })],
    ["non-realm signing algorithm", () => issueToken({ algorithm: "PS256" })],
    ["wrong token type", () => issueToken({ tokenType: "JWT" })],
    ["missing jti", () => issueToken({ jti: "missing" })],
    ["control-character jti", () => issueToken({ jti: "bad\u0000jti" })],
    ["oversized jti", () => issueToken({ jti: "😀".repeat(65) })],
    ["control-character subject", () => issueToken({ subject: "bad\u0000subject" })],
    ["oversized subject", () => issueToken({ subject: "😀".repeat(129) })],
    ["missing confirmation", () => issueToken({ omitConfirmation: true })],
    ["malformed confirmation", () => issueToken({ confirmation: { jkt: "short" } })],
    ["missing client", () => issueToken({ omitAuthorizedParty: true })],
    ["unapproved client", () => issueToken({ authorizedParty: "other-client" })],
    [
      "conflicting client claims",
      () => issueToken({ authorizedParty: "gopher-mcp", clientId: "other-client" }),
    ],
  ])("rejects %s without exposing verifier detail", async (_label, createToken) => {
    await expect(verifier.verify(await createToken())).rejects.toBeInstanceOf(AccessTokenValidationError);
  });

  it("accepts a short Unicode subject and jti with one consistent approved client claim", async () => {
    const token = await issueToken({
      authorizedParty: "gopher-mcp",
      clientId: "gopher-mcp",
      jti: "短😀",
      subject: "学生😀",
    });

    await expect(verifier.verify(token)).resolves.toMatchObject({
      clientId: "gopher-mcp",
      subject: "学生😀",
    });
  });

  it("accepts extension members alongside the required cnf.jkt", async () => {
    await expect(
      verifier.verify(
        await issueToken({
          confirmation: {
            jkt: DPOP_JKT,
            "urn:example:key-policy": "device-bound",
          },
        }),
      ),
    ).resolves.toMatchObject({ dpopJkt: DPOP_JKT });
  });

  it("parses one case-insensitive DPoP credential and rejects Bearer fallback", () => {
    const token = "a".repeat(32);
    expect(parseDpopAccessToken(`DPoP ${token}`)).toBe(token);
    expect(parseDpopAccessToken(`dpop    ${token}`)).toBe(token);
    expect(() => parseDpopAccessToken(`Bearer ${token}`)).toThrow(AccessTokenValidationError);
    expect(() => parseDpopAccessToken(`DPoP ${token},DPoP second`)).toThrow(AccessTokenValidationError);
  });

  it.each(["https://issuer.example", "https://issuer.example/"])(
    "matches the exact root issuer lexical form %s",
    async (issuer) => {
      const rootConfig = loadMcpServerConfig({
        MCP_AUTH_MODE: "oauth",
        MCP_OAUTH_ISSUER: issuer,
        MCP_RESOURCE_URL: "http://127.0.0.1:4100/mcp",
        NODE_ENV: "test",
      });
      const rootVerifier = new JoseAccessTokenVerifier(rootConfig, localJwkSet);

      await expect(rootVerifier.verify(await issueToken({ issuer }))).resolves.toMatchObject({
        subject: "test-user",
      });
    },
  );
});
