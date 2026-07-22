import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";

import {
  cleanupIdentityWithReauthentication,
  DEFAULT_API_AUDIENCE,
  DEFAULT_MCP_AUDIENCE,
  parseIdentityBaseUrl,
  runBoundedCleanup,
  sanitizeBrowserEnvironment,
  verifyAccessToken,
} from "./smoke-identity-device.mjs";

const issuer = "https://identity.example/realms/test";
const nowSeconds = 1_800_000_000;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const { privateKey: otherPrivateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const keyId = "unit-test-signing-key";
const publicJwk = {
  ...publicKey.export({ format: "jwk" }),
  alg: "RS256",
  kid: keyId,
  key_ops: ["verify"],
  use: "sig",
};
const jwks = { keys: [publicJwk] };

const allowedPayload = {
  aud: DEFAULT_API_AUDIENCE,
  azp: "gopher-cli",
  exp: nowSeconds + 300,
  iat: nowSeconds,
  iss: issuer,
  jti: "00000000-0000-4000-8000-000000000001",
  nbf: nowSeconds - 5,
  scope: "openid offline_access campus:read",
  sub: "synthetic-student",
};

function tokenFor(payload, signingKey = privateKey, type = "at+jwt") {
  const headerSegment = Buffer.from(JSON.stringify({ alg: "RS256", kid: keyId, typ: type })).toString(
    "base64url",
  );
  const payloadSegment = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signatureSegment = sign("RSA-SHA256", Buffer.from(signingInput, "ascii"), signingKey).toString(
    "base64url",
  );
  return `${signingInput}.${signatureSegment}`;
}

function verify(token) {
  return verifyAccessToken(token, { issuer, jwks, nowSeconds });
}

test("cryptographically verifies the narrow CLI token", () => {
  assert.deepEqual(verify(tokenFor(allowedPayload)), {
    adminWriteAbsent: true,
    apiAudiencePresent: true,
    campusReadPresent: true,
    clientExact: true,
    issuerExact: true,
    mcpAudienceAbsent: true,
    signatureVerified: true,
  });
});

test("accepts the issuer's bounded URI-form JWT ID", () => {
  assert.equal(
    verify(tokenFor({ ...allowedPayload, jti: "urn:uuid:00000000-0000-4000-8000-000000000001" }))
      .signatureVerified,
    true,
  );
});

test("rejects token-level scope escalation and audience confusion", () => {
  const rejectedPayloads = [
    { ...allowedPayload, scope: `${allowedPayload.scope} admin:write` },
    { ...allowedPayload, scope: "openid offline_access" },
    { ...allowedPayload, aud: ["account"] },
    { ...allowedPayload, aud: [DEFAULT_API_AUDIENCE, DEFAULT_MCP_AUDIENCE] },
    { ...allowedPayload, exp: nowSeconds + 301 },
    { ...allowedPayload, jti: "short" },
  ];

  for (const payload of rejectedPayloads) {
    assert.throws(() => verify(tokenFor(payload)));
  }
});

test("rejects wrong signatures, issuers, and authorized clients", () => {
  const wrongSignature = tokenFor(allowedPayload, otherPrivateKey);
  const wrongIssuer = tokenFor({ ...allowedPayload, iss: "https://identity.example/realms/other" });
  const wrongAuthorizedParty = tokenFor({ ...allowedPayload, azp: "other-client" });
  const payloadWithoutAzp = { ...allowedPayload };
  Reflect.deleteProperty(payloadWithoutAzp, "azp");
  const wrongClientId = tokenFor({ ...payloadWithoutAzp, client_id: "other-client" });

  for (const token of [wrongSignature, wrongIssuer, wrongAuthorizedParty, wrongClientId]) {
    assert.throws(() => verify(token));
  }
});

test("rejects a generic JWT instead of an RFC 9068 access token", () => {
  assert.throws(() => verify(tokenFor(allowedPayload, privateKey, "JWT")));
});

test("rejects a malformed token without reflecting its value", () => {
  const sensitiveValue = "sensitive-token-value";
  assert.throws(
    () => verify(sensitiveValue),
    (error) => error instanceof Error && !error.message.includes(sensitiveValue),
  );
});

test("sanitizes the browser environment case-insensitively", () => {
  const sanitized = sanitizeBrowserEnvironment({
    authorization: "remove",
    Cookie: "remove",
    DEBUG: "pw:api",
    keycloak_admin: "remove",
    Keycloak_Admin_Password: "remove",
    "mixed-api-key": "remove",
    PATH: "keep-path",
    pwdebug: "1",
    refresh_token: "remove",
    service_secret: "remove",
    TEMP: "keep-temp",
    UNRELATED: "not-allowlisted",
  });

  assert.deepEqual(sanitized, { PATH: "keep-path", TEMP: "keep-temp" });
});

test("allows HTTPS or explicit loopback HTTP identity base URLs", () => {
  assert.equal(parseIdentityBaseUrl("http://localhost:8080").href, "http://localhost:8080/");
  assert.equal(parseIdentityBaseUrl("http://127.9.8.7:8080/base").href, "http://127.9.8.7:8080/base/");
  assert.equal(parseIdentityBaseUrl("http://[::1]:8080").href, "http://[::1]:8080/");
  assert.equal(parseIdentityBaseUrl("https://identity.example/base").href, "https://identity.example/base/");
});

test("rejects unsafe identity base URLs", () => {
  const rejected = [
    "http://identity.example/",
    "ftp://127.0.0.1/",
    "https://user:password@identity.example/",
    "https://identity.example/?target=other",
    "https://identity.example/#fragment",
  ];
  for (const value of rejected) assert.throws(() => parseIdentityBaseUrl(value));
});

test("bounds browser cleanup without blocking temporary-user deletion", async () => {
  let deletionCompleted = false;
  const cleanup = await runBoundedCleanup({
    browserCleanupRequired: true,
    browserTimeoutMilliseconds: 10,
    closeBrowser: () =>
      new Promise((resolve) => {
        assert.equal(typeof resolve, "function");
      }),
    deleteIdentity: async () => {
      deletionCompleted = true;
    },
    identityCleanupRequired: true,
    identityTimeoutMilliseconds: 100,
  });

  assert.equal(deletionCompleted, true);
  assert.deepEqual(cleanup, { browserClosed: false, temporaryUserDeleted: true });
});

test("retries temporary-user cleanup with fresh administrator authentication", async () => {
  const attemptedTokens = [];
  let reauthenticationCount = 0;
  let postDeleteAuditCompleted = false;

  await cleanupIdentityWithReauthentication(
    "initial-admin-session",
    async (accessToken) => {
      attemptedTokens.push(accessToken);
      if (accessToken === "initial-admin-session") throw new Error("expired");
      postDeleteAuditCompleted = true;
    },
    async () => {
      reauthenticationCount += 1;
      return "refreshed-admin-session";
    },
  );

  assert.deepEqual(attemptedTokens, ["initial-admin-session", "refreshed-admin-session"]);
  assert.equal(reauthenticationCount, 1);
  assert.equal(postDeleteAuditCompleted, true);
});
