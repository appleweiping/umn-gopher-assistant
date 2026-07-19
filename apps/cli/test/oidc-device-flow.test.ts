import { describe, expect, it, vi } from "vitest";

import type { CliError } from "../src/errors.js";
import { OidcClient } from "../src/oidc.js";
import { jsonResponse, oidcDiscovery, takeResponse } from "./helpers.js";

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
      jsonResponse({
        access_token: "access-secret-value",
        expires_in: 300,
        refresh_token: "refresh-secret-value",
        scope: "openid offline_access campus:read",
        token_type: "Bearer",
      }),
    ];
    let currentTime = 1_000;
    const waits: number[] = [];
    const fetchMock = vi.fn<typeof fetch>(async () => takeResponse(responses));
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
    const token = await client.pollDeviceToken(issuer, authorization);

    expect(waits).toEqual([1000, 6000]);
    expect(token.expiresAt).toBe(currentTime + 300_000);
    expect(token.scope).toEqual(["openid", "offline_access", "campus:read"]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
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
    await expect(client.pollDeviceToken(issuer, authorization)).rejects.toMatchObject({
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
    await expect(client.pollDeviceToken(issuer, authorization)).rejects.toMatchObject({
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
    await expect(client.pollDeviceToken(issuer, authorization, controller.signal)).rejects.toEqual(
      expect.objectContaining<Partial<CliError>>({ code: "device-flow-cancelled", exitCode: 4 }),
    );
  });
});
