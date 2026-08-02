import { decodeJwt } from "jose";
import { describe, expect, it, vi } from "vitest";

import type { CliError } from "../src/errors.js";
import { OidcClient } from "../src/oidc.js";
import { jsonResponse, oidcDiscovery, takeResponse } from "./helpers.js";
import { TEST_DPOP_PRIVATE_JWK, tokenResponse } from "./dpop-fixture.js";

function deviceResponse(expiresIn = 60): unknown {
  return {
    device_code: "device-secret-value",
    expires_in: expiresIn,
    interval: 1,
    user_code: "ABCD-EFGH",
    verification_uri: "https://identity.example/verify",
  };
}

describe("RFC 8628 device authorization", () => {
  it("handles authorization_pending, slow_down, and success without real sleeps", async () => {
    const responses = [
      jsonResponse(oidcDiscovery()),
      jsonResponse(deviceResponse()),
      jsonResponse({ error: "authorization_pending" }, 400),
      jsonResponse({ error: "slow_down" }, 400),
      jsonResponse(tokenResponse("device-success")),
    ];
    let currentTime = 1_000;
    const waits: number[] = [];
    const requests: Request[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (request) => {
      if (!(request instanceof Request)) throw new TypeError("expected Request");
      requests.push(request);
      return takeResponse(responses);
    });
    const client = new OidcClient({
      fetch: fetchMock,
      now: () => currentTime,
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
        currentTime += milliseconds;
      },
      timeoutMs: 1000,
    });
    const issuer = new URL("https://identity.example/realms/gopher/");
    const authorization = await client.beginDeviceAuthorization(issuer);
    const token = await client.pollDeviceToken(issuer, authorization, TEST_DPOP_PRIVATE_JWK);

    expect(waits).toEqual([1000, 6000]);
    expect(token.expiresAt).toBe(currentTime + 300_000);
    expect(token.scope).toEqual(["openid", "offline_access", "campus:read"]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const proofPayloads = requests.slice(2).map((request) => decodeJwt(request.headers.get("dpop") ?? ""));
    expect(new Set(proofPayloads.map((payload) => payload.jti)).size).toBe(3);
    expect(
      proofPayloads.every(
        (payload) => payload["htm"] === "POST" && payload["htu"] === "https://identity.example/token",
      ),
    ).toBe(true);
  });

  it("maps access denial to the authentication exit class", async () => {
    const responses = [
      jsonResponse(oidcDiscovery()),
      jsonResponse(deviceResponse()),
      jsonResponse({ error: "access_denied" }, 400),
    ];
    const client = new OidcClient({
      fetch: vi.fn<typeof fetch>(async () => takeResponse(responses)),
      now: () => 0,
      sleep: async () => undefined,
      timeoutMs: 1000,
    });
    const issuer = new URL("https://identity.example/realms/gopher/");
    const authorization = await client.beginDeviceAuthorization(issuer);
    await expect(client.pollDeviceToken(issuer, authorization, TEST_DPOP_PRIVATE_JWK)).rejects.toMatchObject({
      code: "device-access-denied",
      exitCode: 4,
    });
  });

  it("expires deterministically after pending without another request", async () => {
    const responses = [
      jsonResponse(oidcDiscovery()),
      jsonResponse(deviceResponse(1)),
      jsonResponse({ error: "authorization_pending" }, 400),
    ];
    let currentTime = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => takeResponse(responses));
    const client = new OidcClient({
      fetch: fetchMock,
      now: () => currentTime,
      sleep: async (milliseconds) => {
        currentTime += milliseconds;
      },
      timeoutMs: 1000,
    });
    const issuer = new URL("https://identity.example/realms/gopher/");
    const authorization = await client.beginDeviceAuthorization(issuer);
    await expect(client.pollDeviceToken(issuer, authorization, TEST_DPOP_PRIVATE_JWK)).rejects.toMatchObject({
      code: "device-code-expired",
      exitCode: 4,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("honors cancellation before polling", async () => {
    const responses = [jsonResponse(oidcDiscovery()), jsonResponse(deviceResponse())];
    const client = new OidcClient({
      fetch: vi.fn<typeof fetch>(async () => takeResponse(responses)),
      now: () => 0,
      sleep: async () => undefined,
      timeoutMs: 1000,
    });
    const issuer = new URL("https://identity.example/realms/gopher/");
    const authorization = await client.beginDeviceAuthorization(issuer);
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.pollDeviceToken(issuer, authorization, TEST_DPOP_PRIVATE_JWK, controller.signal),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CliError>>({ code: "device-flow-cancelled", exitCode: 4 }),
    );
  });

  it("retries one authorization-server nonce challenge with a fresh proof", async () => {
    const responses = [
      jsonResponse(oidcDiscovery()),
      jsonResponse(deviceResponse()),
      jsonResponse({ error: "use_dpop_nonce" }, 400, { "dpop-nonce": "identity-nonce-001" }),
      jsonResponse(tokenResponse("nonce-success"), 200, {
        "dpop-nonce": "identity-nonce-002",
      }),
    ];
    const proofs: string[] = [];
    const client = new OidcClient({
      fetch: vi.fn<typeof fetch>(async (request) => {
        if (request instanceof Request && request.headers.has("dpop")) {
          proofs.push(request.headers.get("dpop") ?? "");
        }
        return takeResponse(responses);
      }),
      now: () => 1_000,
      sleep: async () => undefined,
      timeoutMs: 1_000,
    });
    const issuer = new URL("https://identity.example/realms/gopher/");
    const authorization = await client.beginDeviceAuthorization(issuer);
    const token = await client.pollDeviceToken(issuer, authorization, TEST_DPOP_PRIVATE_JWK);

    expect(proofs).toHaveLength(2);
    expect(decodeJwt(proofs[0] ?? "")["nonce"]).toBeUndefined();
    expect(decodeJwt(proofs[1] ?? "")["nonce"]).toBe("identity-nonce-001");
    expect(decodeJwt(proofs[1] ?? "").jti).not.toBe(decodeJwt(proofs[0] ?? "").jti);
    expect(token.authorizationServerDpopNonce).toBe("identity-nonce-002");
  });

  it("reports a stable DPoP error when the fresh nonce proof is challenged again", async () => {
    const responses = [
      jsonResponse(oidcDiscovery()),
      jsonResponse(deviceResponse()),
      jsonResponse({ error: "use_dpop_nonce" }, 400, { "dpop-nonce": "identity-nonce-first" }),
      jsonResponse({ error: "use_dpop_nonce" }, 400, { "dpop-nonce": "identity-nonce-second" }),
    ];
    const client = new OidcClient({
      fetch: vi.fn<typeof fetch>(async () => takeResponse(responses)),
      now: () => 1_000,
      sleep: async () => undefined,
      timeoutMs: 1_000,
    });
    const issuer = new URL("https://identity.example/realms/gopher/");
    const authorization = await client.beginDeviceAuthorization(issuer);

    await expect(client.pollDeviceToken(issuer, authorization, TEST_DPOP_PRIVATE_JWK)).rejects.toMatchObject({
      code: "dpop-nonce-rejected",
      exitCode: 7,
    });
  });
});
