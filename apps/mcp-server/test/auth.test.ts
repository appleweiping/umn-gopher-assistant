import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { AccessTokenValidationError, JoseAccessTokenVerifier, parseBearerToken } from "../src/auth.js";
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
let verifier: JoseAccessTokenVerifier;
let localJwkSet: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const primary = await generateKeyPair("RS256");
  const other = await generateKeyPair("RS256");
  privateKey = primary.privateKey;
  otherPrivateKey = other.privateKey;
  const publicJwk = { ...(await exportJWK(primary.publicKey)), alg: "RS256", kid: "primary", use: "sig" };
  localJwkSet = createLocalJWKSet({ keys: [publicJwk] });
  verifier = new JoseAccessTokenVerifier(config, localJwkSet);
});

interface TokenOverrides {
  readonly audience?: string | readonly string[];
  readonly expiration?: number | "missing";
  readonly issuer?: string;
  readonly key?: SigningKey;
  readonly notBefore?: number | "missing";
  readonly scope?: string;
  readonly subject?: string;
}

async function issueToken(overrides: TokenOverrides = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const audience =
    overrides.audience === undefined
      ? "http://127.0.0.1:4100/mcp"
      : typeof overrides.audience === "string"
        ? overrides.audience
        : [...overrides.audience];
  let token = new SignJWT({ scope: overrides.scope ?? "campus:read profile" })
    .setProtectedHeader({ alg: "RS256", kid: "primary", typ: "JWT" })
    .setIssuer(overrides.issuer ?? "http://127.0.0.1:8080/realms/gopher-assistant-dev")
    .setAudience(audience)
    .setSubject(overrides.subject ?? "test-user")
    .setIssuedAt(now);
  if (overrides.expiration !== "missing") {
    token = token.setExpirationTime(overrides.expiration ?? now + 300);
  }
  if (overrides.notBefore !== "missing") {
    token = token.setNotBefore(overrides.notBefore ?? now - 1);
  }
  return token.sign(overrides.key ?? privateKey);
}

describe("OAuth access-token verification", () => {
  it("accepts a correctly signed, exact-resource, scoped token", async () => {
    const identity = await verifier.verify(await issueToken());

    expect(identity.subject).toBe("test-user");
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
    ["forged signature", () => issueToken({ key: otherPrivateKey })],
  ])("rejects %s without exposing verifier detail", async (_label, createToken) => {
    await expect(verifier.verify(await createToken())).rejects.toBeInstanceOf(AccessTokenValidationError);
  });

  it("parses only a single strict Bearer credential", () => {
    const token = "a".repeat(32);
    expect(parseBearerToken(`Bearer ${token}`)).toBe(token);
    expect(() => parseBearerToken(`bearer ${token}`)).toThrow(AccessTokenValidationError);
    expect(() => parseBearerToken(`Bearer ${token},Bearer second`)).toThrow(AccessTokenValidationError);
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
