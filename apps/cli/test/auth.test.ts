import { describe, expect, it, vi } from "vitest";

import { AuthManager } from "../src/auth.js";
import { OidcClient } from "../src/oidc.js";
import { MemorySecretStore, type SecretStore } from "../src/secret-store.js";
import { jsonResponse, oidcDiscovery, takeResponse } from "./helpers.js";

describe("credential lifecycle", () => {
  it("fails closed and retains no session when the OS keychain is unavailable", async () => {
    const responses = [
      jsonResponse(oidcDiscovery()),
      jsonResponse({
        device_code: "device-secret",
        expires_in: 60,
        interval: 1,
        user_code: "USER-CODE",
        verification_uri: "https://identity.example/verify",
      }),
      jsonResponse({
        access_token: "access-secret",
        expires_in: 300,
        refresh_token: "refresh-secret",
        scope: "openid campus:read",
        token_type: "Bearer",
      }),
    ];
    const store = new MemorySecretStore(false);
    const oidc = new OidcClient({
      fetch: vi.fn<typeof fetch>(async () => takeResponse(responses)),
      now: () => 100,
      sleep: async () => undefined,
      timeoutMs: 1000,
    });
    const manager = new AuthManager({ environment: {}, now: () => 100, oidc, secretStore: store });
    await expect(
      manager.login("local", new URL("https://identity.example/realms/gopher/"), {
        verification: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "secure-storage-unavailable", exitCode: 4 });
    expect(await store.get("profile:local")).toBeUndefined();
    expect(await manager.status("local")).toMatchObject({ available: false, source: "missing" });
  });

  it("fails closed when an apparently available keychain refuses the credential write", async () => {
    const responses = [
      jsonResponse(oidcDiscovery()),
      jsonResponse({
        device_code: "device-secret",
        expires_in: 60,
        interval: 1,
        user_code: "USER-CODE",
        verification_uri: "https://identity.example/verify",
      }),
      jsonResponse({
        access_token: "access-secret",
        expires_in: 300,
        refresh_token: "refresh-secret",
        scope: "openid campus:read",
        token_type: "Bearer",
      }),
    ];
    let deleteCalled = false;
    const store: SecretStore = {
      availability: () => Promise.resolve({ available: true }),
      delete: () => {
        deleteCalled = true;
        return Promise.resolve({ status: "deleted" });
      },
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve(false),
    };
    const manager = new AuthManager({
      environment: {},
      now: () => 100,
      oidc: new OidcClient({
        fetch: vi.fn<typeof fetch>(async () => takeResponse(responses)),
        now: () => 100,
        sleep: async () => undefined,
        timeoutMs: 1000,
      }),
      secretStore: store,
    });
    await expect(
      manager.login("local", new URL("https://identity.example/realms/gopher/"), {
        verification: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "secure-storage-unavailable", exitCode: 4 });
    expect(deleteCalled).toBe(true);
    expect(await manager.status("local")).toMatchObject({ available: false, source: "missing" });
  });

  it("normalizes a throwing keychain write to the same fail-closed authentication error", async () => {
    const responses = [
      jsonResponse(oidcDiscovery()),
      jsonResponse({
        device_code: "device-secret",
        expires_in: 60,
        interval: 1,
        user_code: "USER-CODE",
        verification_uri: "https://identity.example/verify",
      }),
      jsonResponse({
        access_token: "access-secret",
        expires_in: 300,
        refresh_token: "refresh-secret",
        scope: "openid campus:read",
        token_type: "Bearer",
      }),
    ];
    const store: SecretStore = {
      availability: () => Promise.resolve({ available: true }),
      delete: () => Promise.reject(new Error("native delete detail must stay hidden")),
      get: () => Promise.resolve(undefined),
      set: () => Promise.reject(new Error("native write detail must stay hidden")),
    };
    const manager = new AuthManager({
      environment: {},
      now: () => 100,
      oidc: new OidcClient({
        fetch: vi.fn<typeof fetch>(async () => takeResponse(responses)),
        now: () => 100,
        sleep: async () => undefined,
        timeoutMs: 1000,
      }),
      secretStore: store,
    });
    await expect(
      manager.login("local", new URL("https://identity.example/realms/gopher/"), {
        verification: () => undefined,
      }),
    ).rejects.toMatchObject({
      code: "secure-storage-unavailable",
      exitCode: 4,
      message: expect.not.stringContaining("native"),
    });
  });

  it("refreshes an expired keychain token and never exposes it through status", async () => {
    const store = new MemorySecretStore();
    await store.set(
      "profile:local",
      JSON.stringify({
        issuer: "https://identity.example/realms/gopher",
        token: {
          accessToken: "expired-access-secret",
          expiresAt: 1,
          refreshToken: "old-refresh-secret",
          scope: ["openid", "campus:read"],
        },
        version: 1,
      }),
    );
    const requests: Request[] = [];
    const responses = [
      jsonResponse(oidcDiscovery()),
      jsonResponse({
        access_token: "rotated-access-secret",
        expires_in: 300,
        refresh_token: "rotated-refresh-secret",
        scope: "openid campus:read",
        token_type: "Bearer",
      }),
    ];
    const oidc = new OidcClient({
      fetch: vi.fn<typeof fetch>(async (request) => {
        if (!(request instanceof Request)) throw new TypeError("expected a Request");
        requests.push(request);
        return takeResponse(responses);
      }),
      now: () => 100_000,
      sleep: async () => undefined,
      timeoutMs: 1000,
    });
    const manager = new AuthManager({ environment: {}, now: () => 100_000, oidc, secretStore: store });
    await expect(
      manager.getAccessToken("local", new URL("https://identity.example/realms/gopher/")),
    ).resolves.toBe("rotated-access-secret");
    expect(requests).toHaveLength(2);
    const safeStatus = JSON.stringify(await manager.status("local"));
    expect(safeStatus).not.toContain("access-secret");
    expect(safeStatus).not.toContain("refresh-secret");
    expect(await store.get("profile:local")).toContain("rotated-refresh-secret");
  });

  it("uses an environment access token without copying it into the keychain", async () => {
    const store = new MemorySecretStore();
    const oidc = new OidcClient({
      fetch: vi.fn<typeof fetch>(),
      now: () => 0,
      sleep: async () => undefined,
      timeoutMs: 1000,
    });
    const manager = new AuthManager({
      environment: { UGA_ACCESS_TOKEN: "environment-secret" },
      now: () => 0,
      oidc,
      secretStore: store,
    });
    await expect(
      manager.getAccessToken("local", new URL("https://identity.example/realms/gopher/")),
    ).resolves.toBe("environment-secret");
    expect(await store.get("profile:local")).toBeUndefined();
    expect(await manager.status("local")).toMatchObject({ source: "environment" });
  });

  it("maps cancellation during an identity-provider request to authentication exit 4", async () => {
    const controller = new AbortController();
    controller.abort();
    const oidc = new OidcClient({
      fetch: vi.fn<typeof fetch>(async () => {
        throw new DOMException("aborted", "AbortError");
      }),
      now: () => 0,
      sleep: async () => undefined,
      timeoutMs: 1000,
    });
    const manager = new AuthManager({
      environment: {},
      now: () => 0,
      oidc,
      secretStore: new MemorySecretStore(),
    });
    await expect(
      manager.login("local", new URL("https://identity.example/realms/gopher/"), {
        signal: controller.signal,
        verification: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "device-flow-cancelled", exitCode: 4 });
  });

  it("distinguishes an absent credential from a successful deletion", async () => {
    const manager = new AuthManager({
      environment: {},
      now: () => 0,
      oidc: new OidcClient({
        fetch: vi.fn<typeof fetch>(),
        now: () => 0,
        sleep: async () => undefined,
        timeoutMs: 1000,
      }),
      secretStore: new MemorySecretStore(),
    });

    await expect(manager.logout("local")).resolves.toEqual({
      deletion: "absent",
      environmentTokenStillSet: false,
      removed: false,
    });
  });

  it.each([
    {
      deleteCredential: () => Promise.resolve({ status: "backend-error" as const }),
      label: "reported native backend failure",
    },
    {
      deleteCredential: () => Promise.reject(new Error("native account detail must stay hidden")),
      label: "throwing secret-store implementation",
    },
  ])("fails closed on $label during logout", async ({ deleteCredential }) => {
    const store: SecretStore = {
      availability: () => Promise.resolve({ available: true }),
      delete: deleteCredential,
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve(true),
    };
    const manager = new AuthManager({
      environment: {},
      now: () => 0,
      oidc: new OidcClient({
        fetch: vi.fn<typeof fetch>(),
        now: () => 0,
        sleep: async () => undefined,
        timeoutMs: 1000,
      }),
      secretStore: store,
    });

    await expect(manager.logout("local")).rejects.toMatchObject({
      code: "secure-storage-unavailable",
      exitCode: 4,
      message: expect.not.stringContaining("native"),
    });
  });
});
