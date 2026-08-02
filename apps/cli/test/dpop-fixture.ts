import type { DpopCredential, DpopPrivateJwk } from "@umn-gopher-assistant/sdk";

export const TEST_DPOP_PRIVATE_JWK: DpopPrivateJwk = Object.freeze({
  crv: "P-256",
  d: "Ahf0JPgLlybUv6euhNp6pFsixe9v0zTocANo0YOn_eA",
  kty: "EC",
  x: "sGBI_2uhE467VFgXkK3k1I1DSEXe4KiMUxCAkoMoPSQ",
  y: "DVun0ulLO6lO_jHqH5QcKFUZWQE5QfoBCk2oYWZsz_A",
});

export const TEST_DPOP_JKT = "DXPI8U8WWsno1fBpIng_ok7x-fcqV6NwOWBXPy4c-OM";

function segment(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function testAccessToken(jkt = TEST_DPOP_JKT, marker = "current"): string {
  return `${segment({ alg: "RS256", kid: "test", typ: "at+jwt" })}.${segment({
    aud: "gopher-api",
    cnf: { jkt },
    exp: 4_000_000_000,
    iat: 2_000_000_000,
    marker,
    sub: "test-student",
  })}.${Buffer.from(`test-signature-${marker}`).toString("base64url")}`;
}

export const TEST_DPOP_CREDENTIAL: DpopCredential = Object.freeze({
  accessToken: testAccessToken(),
  privateJwk: TEST_DPOP_PRIVATE_JWK,
});

export function tokenResponse(marker = "current"): Record<string, unknown> {
  return {
    access_token: testAccessToken(TEST_DPOP_JKT, marker),
    expires_in: 300,
    refresh_token: `refresh-secret-${marker}`,
    scope: "openid offline_access campus:read",
    token_type: "DPoP",
  };
}
