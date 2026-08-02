import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { AuthManager } from "../src/auth.js";
import { OidcClient } from "../src/oidc.js";
import { MemorySecretStore, type SecretStore } from "../src/secret-store.js";
import { SocketCredentialRefreshLock } from "../src/refresh-lock.js";
import {
  TEST_DPOP_CREDENTIAL,
  TEST_DPOP_PRIVATE_JWK,
  testAccessToken,
  tokenResponse,
} from "./dpop-fixture.js";
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
      jsonResponse(tokenResponse("unavailable-store")),
    ];
    const store = new MemorySecretStore(false);
    const oidc = new OidcClient({
      fetch: vi.fn<typeof fetch>(async () => takeResponse(responses)),
      now: () => 100,
      sleep: async () => undefined,
      timeoutMs: 1000,
    });
    const manager = new AuthManager({
      environment: {},
      generateDpopPrivateJwk: () => Promise.resolve(TEST_DPOP_PRIVATE_JWK),
      now: () => 100,
      oidc,
      secretStore: store,
    });
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
      jsonResponse(tokenResponse("refused-store")),
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
      generateDpopPrivateJwk: () => Promise.resolve(TEST_DPOP_PRIVATE_JWK),
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
      jsonResponse(tokenResponse("throwing-store")),
    ];
    const store: SecretStore = {
      availability: () => Promise.resolve({ available: true }),
      delete: () => Promise.reject(new Error("native delete detail must stay hidden")),
      get: () => Promise.resolve(undefined),
      set: () => Promise.reject(new Error("native write detail must stay hidden")),
    };
    const manager = new AuthManager({
      environment: {},
      generateDpopPrivateJwk: () => Promise.resolve(TEST_DPOP_PRIVATE_JWK),
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
        dpopPrivateJwk: TEST_DPOP_PRIVATE_JWK,
        token: {
          accessToken: testAccessToken(undefined, "expired"),
          expiresAt: 1,
          refreshToken: "old-refresh-secret",
          scope: ["openid", "campus:read"],
        },
        version: 2,
      }),
    );
    const requests: Request[] = [];
    const responses = [jsonResponse(oidcDiscovery()), jsonResponse(tokenResponse("rotated"))];
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
      manager.getDpopCredential("local", new URL("https://identity.example/realms/gopher/")),
    ).resolves.toMatchObject({ accessToken: testAccessToken(undefined, "rotated") });
    expect(requests).toHaveLength(2);
    const safeStatus = JSON.stringify(await manager.status("local"));
    expect(safeStatus).not.toContain("access-secret");
    expect(safeStatus).not.toContain("refresh-secret");
    expect(await store.get("profile:local")).toContain("refresh-secret-rotated");
  });

  it("serializes simulated CLI processes and re-reads the rotated token after the OS lease", async () => {
    const lockNamespace = `test:${randomUUID()}`;
    const store = new MemorySecretStore();
    await store.set(
      "profile:local",
      JSON.stringify({
        issuer: "https://identity.example/realms/gopher",
        dpopPrivateJwk: TEST_DPOP_PRIVATE_JWK,
        token: {
          accessToken: testAccessToken(undefined, "expired-concurrent"),
          expiresAt: 1,
          refreshToken: "single-use-refresh-token",
          scope: ["openid", "campus:read"],
        },
        version: 2,
      }),
    );
    let releaseTokenRequest!: () => void;
    let markTokenRequestStarted!: () => void;
    const tokenRequestCanFinish = new Promise<void>((resolve) => {
      releaseTokenRequest = resolve;
    });
    const tokenRequestStarted = new Promise<void>((resolve) => {
      markTokenRequestStarted = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>(async () => {
      if (fetchMock.mock.calls.length === 1) return jsonResponse(oidcDiscovery());
      markTokenRequestStarted();
      await tokenRequestCanFinish;
      return jsonResponse(tokenResponse("rotated-concurrent"));
    });
    const firstManager = new AuthManager({
      environment: {},
      now: () => 100_000,
      oidc: new OidcClient({
        fetch: fetchMock,
        now: () => 100_000,
        sleep: async () => undefined,
        timeoutMs: 1_000,
      }),
      refreshLock: new SocketCredentialRefreshLock(lockNamespace),
      secretStore: store,
    });
    const secondManager = new AuthManager({
      environment: {},
      now: () => 100_000,
      oidc: new OidcClient({
        fetch: fetchMock,
        now: () => 100_000,
        sleep: async () => undefined,
        timeoutMs: 1_000,
      }),
      refreshLock: new SocketCredentialRefreshLock(lockNamespace),
      secretStore: store,
    });

    try {
      const first = firstManager.getDpopCredential(
        "local",
        new URL("https://identity.example/realms/gopher/"),
      );
      await tokenRequestStarted;
      const second = secondManager.getDpopCredential(
        "local",
        new URL("https://identity.example/realms/gopher/"),
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 75));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      releaseTokenRequest();

      const [firstCredential, secondCredential] = await Promise.all([first, second]);
      expect(firstCredential.accessToken).toBe(testAccessToken(undefined, "rotated-concurrent"));
      expect(secondCredential.accessToken).toBe(firstCredential.accessToken);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(await store.get("profile:local")).toContain("refresh-secret-rotated-concurrent");
    } finally {
      releaseTokenRequest();
    }
  });

  it("does not resurrect credentials when logout races an in-flight refresh", async () => {
    const lockNamespace = `test:${randomUUID()}`;
    const store = new MemorySecretStore();
    await store.set(
      "profile:local",
      JSON.stringify({
        issuer: "https://identity.example/realms/gopher",
        dpopPrivateJwk: TEST_DPOP_PRIVATE_JWK,
        token: {
          accessToken: testAccessToken(undefined, "expired-logout-race"),
          expiresAt: 1,
          refreshToken: "single-use-refresh-token",
          scope: ["openid", "campus:read"],
        },
        version: 2,
      }),
    );
    let releaseRefresh!: () => void;
    let markRefreshStarted!: () => void;
    const refreshCanFinish = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>(async () => {
      if (fetchMock.mock.calls.length === 1) return jsonResponse(oidcDiscovery());
      markRefreshStarted();
      await refreshCanFinish;
      return jsonResponse(tokenResponse("logout-race"));
    });
    const options = () => ({
      environment: {},
      now: () => 100_000,
      oidc: new OidcClient({
        fetch: fetchMock,
        now: () => 100_000,
        sleep: async () => undefined,
        timeoutMs: 1_000,
      }),
      refreshLock: new SocketCredentialRefreshLock(lockNamespace),
      secretStore: store,
    });
    const refreshingManager = new AuthManager(options());
    const logoutManager = new AuthManager(options());

    try {
      const refresh = refreshingManager.getDpopCredential(
        "local",
        new URL("https://identity.example/realms/gopher/"),
      );
      await refreshStarted;
      const logout = logoutManager.logout("local");
      await new Promise<void>((resolve) => setTimeout(resolve, 75));
      expect(await store.get("profile:local")).toContain("single-use-refresh-token");
      releaseRefresh();
      await expect(refresh).resolves.toMatchObject({
        accessToken: testAccessToken(undefined, "logout-race"),
      });
      await expect(logout).resolves.toMatchObject({ deletion: "deleted", removed: true });
      expect(await store.get("profile:local")).toBeUndefined();
    } finally {
      releaseRefresh();
    }
  });

  it("uses a complete environment DPoP credential without copying it into the keychain", async () => {
    const store = new MemorySecretStore();
    const oidc = new OidcClient({
      fetch: vi.fn<typeof fetch>(),
      now: () => 0,
      sleep: async () => undefined,
      timeoutMs: 1000,
    });
    const manager = new AuthManager({
      environment: {
        UGA_ACCESS_TOKEN: TEST_DPOP_CREDENTIAL.accessToken,
        UGA_DPOP_PRIVATE_JWK: JSON.stringify(TEST_DPOP_PRIVATE_JWK),
      },
      now: () => 0,
      oidc,
      secretStore: store,
    });
    await expect(
      manager.getDpopCredential("local", new URL("https://identity.example/realms/gopher/")),
    ).resolves.toEqual(TEST_DPOP_CREDENTIAL);
    expect(await store.get("profile:local")).toBeUndefined();
    expect(await manager.status("local")).toMatchObject({ source: "environment" });
  });

  it("rejects a lone environment access token instead of falling back to Bearer", async () => {
    const manager = new AuthManager({
      environment: { UGA_ACCESS_TOKEN: TEST_DPOP_CREDENTIAL.accessToken },
      now: () => 0,
      oidc: new OidcClient({
        fetch: vi.fn<typeof fetch>(),
        now: () => 0,
        sleep: async () => undefined,
        timeoutMs: 1000,
      }),
      secretStore: new MemorySecretStore(),
    });
    await expect(
      manager.getDpopCredential("local", new URL("https://identity.example/realms/gopher/")),
    ).rejects.toMatchObject({ code: "environment-dpop-credential-incomplete", exitCode: 4 });
  });

  it("fails closed on a legacy keychain entry that has no DPoP private key", async () => {
    const store = new MemorySecretStore();
    await store.set(
      "profile:local",
      JSON.stringify({
        issuer: "https://identity.example/realms/gopher",
        token: { accessToken: "legacy", expiresAt: 1, scope: [] },
        version: 1,
      }),
    );
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
    await expect(
      manager.getDpopCredential("local", new URL("https://identity.example/realms/gopher/")),
    ).rejects.toMatchObject({ code: "dpop-key-missing", exitCode: 4 });
    await expect(manager.status("local")).resolves.toMatchObject({
      available: false,
      source: "legacy-keychain",
    });
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
