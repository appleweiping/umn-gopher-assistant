// @vitest-environment node

import { decodeJwt, importJWK, jwtVerify } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthSessionStore } from "../lib/auth/redis-store";
import { loadWebAuthRuntime } from "../lib/auth/runtime";
import { sealAuthRecord, type AuthSessionRecord } from "../lib/auth/session-records";
import { sessionCookieForTesting } from "../lib/auth/session";
import { handlePersonalVaultProxy, type PersonalVaultProxyOptions } from "../lib/personal-vault/sync-bff";
import { TEST_DPOP_PRIVATE_JWK } from "./dpop-fixture";

const runtime = loadWebAuthRuntime({ NODE_ENV: "test" });
const sessionId = Buffer.alloc(32, 41).toString("base64url");
const now = Math.floor(Date.now() / 1_000);
const accessToken = `${"a".repeat(40)}.${"b".repeat(40)}.${"c".repeat(40)}`;
const record: AuthSessionRecord = {
  accessToken,
  accessTokenExpiresAt: now + 300,
  authorizationServerDpopNonce: null,
  createdAt: now,
  dpopPrivateJwk: TEST_DPOP_PRIVATE_JWK,
  idToken: `${"d".repeat(40)}.${"e".repeat(40)}.${"f".repeat(40)}`,
  issuer: runtime.issuer,
  nonce: Buffer.alloc(32, 42).toString("base64url"),
  refreshToken: null,
  refreshTokenExpiresAt: null,
  scopes: ["campus:read", "personal:read", "personal:write"],
  subject: "private-subject",
};

class MemoryStore implements AuthSessionStore {
  readonly sessions = new Map<string, string>();
  readonly resourceDpopNonces = new Map<string, string>();
  async acquireRefreshLock(): Promise<boolean> {
    return true;
  }
  async consumeTransaction(): Promise<boolean> {
    return false;
  }
  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
    this.resourceDpopNonces.delete(id);
  }
  async deleteSessionIfCurrent(id: string, expectedSealed: string): Promise<boolean> {
    if (this.sessions.get(id) !== expectedSealed) return false;
    await this.deleteSession(id);
    return true;
  }
  async getSession(id: string): Promise<string | undefined> {
    return this.sessions.get(id);
  }
  async getResourceDpopNonce(id: string): Promise<string | undefined> {
    return this.resourceDpopNonces.get(id);
  }
  async getTransaction(): Promise<string | undefined> {
    return undefined;
  }
  async putSession(id: string, sealed: string): Promise<void> {
    this.sessions.set(id, sealed);
  }
  async putResourceDpopNonce(id: string, nonce: string): Promise<void> {
    this.resourceDpopNonces.set(id, nonce);
  }
  async putTransaction(): Promise<void> {
    return undefined;
  }
  async replaceSessionIfCurrent(
    id: string,
    expectedSealed: string,
    replacementSealed: string,
  ): Promise<boolean> {
    if (this.sessions.get(id) !== expectedSealed) return false;
    this.sessions.set(id, replacementSealed);
    return true;
  }
  async releaseRefreshLock(): Promise<void> {
    return undefined;
  }
}

function authenticatedStore(): MemoryStore {
  const store = new MemoryStore();
  store.sessions.set(
    sessionId,
    sealAuthRecord("session", sessionId, record, runtime, {
      randomBytes: (size) => new Uint8Array(size).fill(43),
    }),
  );
  return store;
}

function options(store: MemoryStore, upstream: typeof fetch): PersonalVaultProxyOptions {
  return {
    authRuntime: runtime,
    authStore: store,
    environment: {
      NODE_ENV: "test",
      GOPHER_API_BASE_URL: "https://api.internal.example",
    } as NodeJS.ProcessEnv,
    fetch: upstream,
  };
}

function browserHeaders(extra: HeadersInit = {}): Headers {
  return new Headers({
    cookie: sessionCookieForTesting(sessionId, runtime),
    origin: runtime.publicOrigin.origin,
    "sec-fetch-site": "same-origin",
    ...Object.fromEntries(new Headers(extra)),
  });
}

afterEach(() => vi.restoreAllMocks());

describe("authenticated personal-vault BFF", () => {
  it("injects a fresh proof for the server-held DPoP token into a fixed bootstrap request only", async () => {
    const store = authenticatedStore();
    let capturedHeaders = new Headers();
    let capturedMethod: string | undefined;
    let capturedUrl = "";
    const upstream = vi.fn<typeof fetch>(async (input, init) => {
      capturedUrl = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      capturedHeaders = new Headers(init?.headers);
      capturedMethod = init?.method;
      return Response.json({ formatVersion: 2, ownerBinding: "o".repeat(43), vault: { exists: false } });
    });

    const response = await handlePersonalVaultProxy(
      new Request("http://localhost:3000/api/personal/vault/bootstrap", {
        headers: browserHeaders(),
      }),
      "bootstrap",
      undefined,
      options(store, upstream),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(capturedUrl).toBe("https://api.internal.example/v1/personal/vault/bootstrap");
    expect(capturedMethod).toBe("GET");
    expect(capturedHeaders.get("authorization")).toBe(`DPoP ${accessToken}`);
    const proof = capturedHeaders.get("dpop");
    expect(proof).not.toBeNull();
    const publicKey = await importJWK(
      {
        crv: TEST_DPOP_PRIVATE_JWK.crv,
        kty: TEST_DPOP_PRIVATE_JWK.kty,
        x: TEST_DPOP_PRIVATE_JWK.x,
        y: TEST_DPOP_PRIVATE_JWK.y,
      },
      "ES256",
    );
    const verified = await jwtVerify(proof as string, publicKey, {
      algorithms: ["ES256"],
      typ: "dpop+jwt",
    });
    expect(verified.payload).toMatchObject({
      htm: "GET",
      htu: "http://127.0.0.1:4000/v1/personal/vault/bootstrap",
    });
    expect(verified.payload["ath"]).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(capturedHeaders.has("cookie")).toBe(false);
    expect(capturedHeaders.has("origin")).toBe(false);
    expect(capturedHeaders.has("x-vault-read-proof")).toBe(false);
  });

  it("returns 401 without contacting Core when the opaque session is absent", async () => {
    const upstream = vi.fn<typeof fetch>();
    const response = await handlePersonalVaultProxy(
      new Request("http://localhost:3000/api/personal/vault/bootstrap", {
        headers: { "sec-fetch-site": "same-origin" },
      }),
      "bootstrap",
      undefined,
      options(new MemoryStore(), upstream),
    );
    expect(response.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("private-subject");
  });

  it("rejects cross-site mutation before reading or forwarding encrypted content", async () => {
    const upstream = vi.fn<typeof fetch>();
    const response = await handlePersonalVaultProxy(
      new Request("http://localhost:3000/api/personal/vault", {
        body: JSON.stringify({ ciphertext: "secret" }),
        headers: {
          ...Object.fromEntries(
            browserHeaders({
              "content-type": "application/json",
              "idempotency-key": "00000000-0000-4000-8000-000000000001",
              "if-none-match": "*",
            }),
          ),
          origin: "https://attacker.invalid",
          "sec-fetch-site": "cross-site",
        },
        method: "POST",
      }),
      "create",
      undefined,
      options(authenticatedStore(), upstream),
    );
    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards a bounded conditional update and only safe response headers", async () => {
    const body = JSON.stringify({ commandType: "UPDATE_PAYLOAD", ciphertext: "opaque" });
    const upstream = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.method).toBe("PUT");
      expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe(body);
      const headers = new Headers(init?.headers);
      expect(headers.get("if-match")).toBe('"pv2:parent"');
      expect(headers.get("idempotency-key")).toBe("00000000-0000-4000-8000-000000000002");
      return Response.json(
        { formatVersion: 2, commitHash: "opaque" },
        {
          headers: {
            ETag: '"pv2:next"',
            "Idempotency-Replayed": "false",
            Location: "/v1/personal/vault",
            "Set-Cookie": "upstream=must-not-pass",
            "X-Request-Id": "request-id-12345678",
          },
        },
      );
    });
    const response = await handlePersonalVaultProxy(
      new Request("http://localhost:3000/api/personal/vault/payload", {
        body,
        headers: browserHeaders({
          "content-type": "application/json",
          "idempotency-key": "00000000-0000-4000-8000-000000000002",
          "if-match": '"pv2:parent"',
        }),
        method: "PUT",
      }),
      "update-payload",
      undefined,
      options(authenticatedStore(), upstream),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"pv2:next"');
    expect(response.headers.get("idempotency-replayed")).toBe("false");
    expect(response.headers.get("location")).toBe("/api/personal/vault");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("requires a bounded device read proof and validates a conditional 304", async () => {
    const proof = Buffer.alloc(256, 44).toString("base64url");
    const upstream = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("x-vault-read-proof")).toBe(proof);
      return new Response(null, { headers: { ETag: '"pv2:same"' }, status: 304 });
    });
    const response = await handlePersonalVaultProxy(
      new Request("http://localhost:3000/api/personal/vault", {
        headers: browserHeaders({ "if-none-match": '"pv2:same"', "x-vault-read-proof": proof }),
      }),
      "read",
      undefined,
      options(authenticatedStore(), upstream),
    );
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe('"pv2:same"');
    expect(await response.text()).toBe("");
  });

  it("rejects missing preconditions, oversized declarations, and malformed upstream responses", async () => {
    const upstream = vi.fn<typeof fetch>();
    const missing = await handlePersonalVaultProxy(
      new Request("http://localhost:3000/api/personal/vault/payload", {
        body: "{}",
        headers: browserHeaders({
          "content-type": "application/json",
          "idempotency-key": "operation-key-0001",
        }),
        method: "PUT",
      }),
      "update-payload",
      undefined,
      options(authenticatedStore(), upstream),
    );
    expect(missing.status).toBe(428);

    const oversized = await handlePersonalVaultProxy(
      new Request("http://localhost:3000/api/personal/vault/payload", {
        body: "{}",
        headers: browserHeaders({
          "content-length": String(16 * 1_024 * 1_024 + 1),
          "content-type": "application/json",
          "idempotency-key": "operation-key-0002",
          "if-match": '"pv2:parent"',
        }),
        method: "PUT",
      }),
      "update-payload",
      undefined,
      options(authenticatedStore(), upstream),
    );
    expect(oversized.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();

    const malformedUpstream = vi.fn<typeof fetch>(
      async () => new Response("<html>bad</html>", { headers: { "Content-Type": "text/html" }, status: 200 }),
    );
    const bad = await handlePersonalVaultProxy(
      new Request("http://localhost:3000/api/personal/vault/bootstrap", {
        headers: browserHeaders(),
      }),
      "bootstrap",
      undefined,
      options(authenticatedStore(), malformedUpstream),
    );
    expect(bad.status).toBe(502);
  });

  it("retries one resource nonce challenge with a new proof and reuses the cached nonce", async () => {
    const store = authenticatedStore();
    const proofs: string[] = [];
    let calls = 0;
    const upstream = vi.fn<typeof fetch>(async (_input, init) => {
      calls += 1;
      proofs.push(new Headers(init?.headers).get("dpop") ?? "");
      if (calls === 1) {
        return Response.json(
          { error: "use_dpop_nonce" },
          {
            headers: {
              "DPoP-Nonce": "resource-nonce-123",
              "WWW-Authenticate": 'DPoP error="use_dpop_nonce"',
            },
            status: 401,
          },
        );
      }
      return Response.json({ formatVersion: 2, ownerBinding: "o".repeat(43), vault: { exists: false } });
    });

    for (let requestNumber = 0; requestNumber < 2; requestNumber += 1) {
      const response = await handlePersonalVaultProxy(
        new Request("http://localhost:3000/api/personal/vault/bootstrap", {
          headers: browserHeaders(),
        }),
        "bootstrap",
        undefined,
        options(store, upstream),
      );
      expect(response.status).toBe(200);
    }

    expect(upstream).toHaveBeenCalledTimes(3);
    expect(store.resourceDpopNonces.get(sessionId)).toBe("resource-nonce-123");
    const payloads = proofs.map((proof) => decodeJwt(proof));
    expect(payloads[0]?.["nonce"]).toBeUndefined();
    expect(payloads[1]?.["nonce"]).toBe("resource-nonce-123");
    expect(payloads[2]?.["nonce"]).toBe("resource-nonce-123");
    expect(new Set(payloads.map((payload) => payload.jti)).size).toBe(3);
  });

  it("fails a repeated nonce challenge without deleting the authenticated session", async () => {
    const store = authenticatedStore();
    let nonce = 0;
    const response = await handlePersonalVaultProxy(
      new Request("http://localhost:3000/api/personal/vault/bootstrap", {
        headers: browserHeaders(),
      }),
      "bootstrap",
      undefined,
      options(store, async () =>
        Response.json(
          { error: "use_dpop_nonce" },
          {
            headers: {
              "DPoP-Nonce": `resource-nonce-${(nonce += 1).toString().padStart(3, "0")}`,
              "WWW-Authenticate": 'DPoP error="use_dpop_nonce"',
            },
            status: 401,
          },
        ),
      ),
    );

    expect(response.status).toBe(502);
    expect(store.sessions.has(sessionId)).toBe(true);
    expect(store.resourceDpopNonces.get(sessionId)).toBe("resource-nonce-002");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("absorbs a valid nonce delivered on a successful response for the next proof", async () => {
    const store = authenticatedStore();
    const proofs: string[] = [];
    const upstream = vi.fn<typeof fetch>(async (_input, init) => {
      proofs.push(new Headers(init?.headers).get("dpop") ?? "");
      return Response.json(
        { formatVersion: 2, ownerBinding: "o".repeat(43), vault: { exists: false } },
        { headers: { "DPoP-Nonce": "success-nonce-123" } },
      );
    });
    for (let requestNumber = 0; requestNumber < 2; requestNumber += 1) {
      const response = await handlePersonalVaultProxy(
        new Request("http://localhost:3000/api/personal/vault/bootstrap", {
          headers: browserHeaders(),
        }),
        "bootstrap",
        undefined,
        options(store, upstream),
      );
      expect(response.status).toBe(200);
    }
    expect(decodeJwt(proofs[0] ?? "")["nonce"]).toBeUndefined();
    expect(decodeJwt(proofs[1] ?? "")["nonce"]).toBe("success-nonce-123");
    expect(store.resourceDpopNonces.get(sessionId)).toBe("success-nonce-123");
  });

  it("deletes the server session and clears the browser handle after an upstream 401", async () => {
    const store = authenticatedStore();
    const response = await handlePersonalVaultProxy(
      new Request("http://localhost:3000/api/personal/vault/bootstrap", { headers: browserHeaders() }),
      "bootstrap",
      undefined,
      options(store, async () => Response.json({ status: 401 }, { status: 401 })),
    );
    expect(response.status).toBe(401);
    expect(store.sessions.size).toBe(0);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(response.headers.get("set-cookie")).not.toContain(accessToken);
  });
});
