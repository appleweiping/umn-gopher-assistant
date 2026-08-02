// @vitest-environment node

import { createLocalJWKSet, decodeJwt, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import type { AuthSessionStore } from "../lib/auth/redis-store";
import { tokenFreeSessionResponse } from "../lib/auth/route-support";
import { loadWebAuthRuntime } from "../lib/auth/runtime";
import { sealAuthRecord } from "../lib/auth/session-records";
import {
  completeLogin,
  endAuthSession,
  resolveAuthSession,
  sessionCookieForTesting,
  startLogin,
} from "../lib/auth/session";
import { TEST_DPOP_JKT, TEST_DPOP_PRIVATE_JWK } from "./dpop-fixture";

const runtime = loadWebAuthRuntime({ NODE_ENV: "test" });
const now = Math.floor(Date.now() / 1_000);
const SUBJECT = "private-issuer-subject-123";

class MemoryAuthStore implements AuthSessionStore {
  readonly sessions = new Map<string, string>();
  readonly transactions = new Map<string, string>();
  readonly refreshLocks = new Map<string, string>();
  readonly refreshLockTtls: number[] = [];
  readonly resourceDpopNonces = new Map<string, string>();

  async acquireRefreshLock(id: string, token: string, ttlMilliseconds: number): Promise<boolean> {
    this.refreshLockTtls.push(ttlMilliseconds);
    if (this.refreshLocks.has(id)) return false;
    this.refreshLocks.set(id, token);
    return true;
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

  async consumeTransaction(id: string, sealed: string): Promise<boolean> {
    if (this.transactions.get(id) !== sealed) return false;
    this.transactions.delete(id);
    return true;
  }

  async getSession(id: string): Promise<string | undefined> {
    return this.sessions.get(id);
  }

  async getResourceDpopNonce(id: string): Promise<string | undefined> {
    return this.resourceDpopNonces.get(id);
  }

  async getTransaction(id: string): Promise<string | undefined> {
    return this.transactions.get(id);
  }

  async putSession(id: string, sealed: string): Promise<void> {
    this.sessions.set(id, sealed);
  }

  async putResourceDpopNonce(id: string, nonce: string): Promise<void> {
    this.resourceDpopNonces.set(id, nonce);
  }

  async putTransaction(id: string, sealed: string): Promise<void> {
    if (this.transactions.has(id)) throw new Error("collision");
    this.transactions.set(id, sealed);
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

  async releaseRefreshLock(id: string, token: string): Promise<void> {
    if (this.refreshLocks.get(id) === token) this.refreshLocks.delete(id);
  }
}

type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

let signingKey: SigningKey;
let keyResolver: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  signingKey = pair.privateKey;
  keyResolver = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), alg: "RS256", kid: "web-auth-test", use: "sig" }],
  });
});

async function idToken(nonce: string | undefined, subject = SUBJECT): Promise<string> {
  return new SignJWT({ azp: runtime.clientId, ...(nonce === undefined ? {} : { nonce }) })
    .setProtectedHeader({ alg: "RS256", kid: "web-auth-test", typ: "JWT" })
    .setIssuer(runtime.issuer)
    .setAudience(runtime.clientId)
    .setSubject(subject)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(signingKey);
}

async function accessToken(
  expiration: number,
  jti: string,
  dpopJkt: string | null = TEST_DPOP_JKT,
  cnfExtensions: Readonly<Record<string, unknown>> = {},
  subject = SUBJECT,
): Promise<string> {
  return new SignJWT({
    azp: runtime.clientId,
    ...(dpopJkt === null ? {} : { cnf: { jkt: dpopJkt, ...cnfExtensions } }),
    scope: "campus:read personal:read personal:write",
  })
    .setProtectedHeader({ alg: "RS256", kid: "web-auth-test", typ: "at+jwt" })
    .setIssuer(runtime.issuer)
    .setAudience(runtime.apiAudience)
    .setSubject(subject)
    .setJti(jti)
    .setIssuedAt(now)
    .setExpirationTime(expiration)
    .sign(signingKey);
}

function deterministicRandomness() {
  let counter = 0;
  return (size: number): Uint8Array => new Uint8Array(size).fill((counter += 1));
}

function cookiePair(setCookie: string): string {
  const pair = setCookie.split(";", 1)[0];
  if (pair === undefined) throw new Error("missing cookie");
  return pair;
}

describe("server-side web OIDC flow", () => {
  it("rejects ambiguous or surplus login parameters before allocating state", async () => {
    const store = new MemoryAuthStore();
    for (const url of [
      "http://localhost:3000/auth/login?returnTo=%2Fplan&returnTo=%2Fexplore",
      "http://localhost:3000/auth/login?redirect_uri=https%3A%2F%2Fattacker.invalid",
    ]) {
      await expect(startLogin(new Request(url), runtime, store)).rejects.toThrow();
    }
    expect(store.transactions.size).toBe(0);
  });

  it("uses one-time state, refreshes without exposing tokens, and logs out only same-origin", async () => {
    const store = new MemoryAuthStore();
    const randomBytes = deterministicRandomness();
    let initialNonce = "";
    let tokenRequests = 0;
    const tokenFetch: typeof fetch = async (_input, init) => {
      tokenRequests += 1;
      expect(new Headers(init?.headers).get("dpop")).toMatch(/^[^.]+\.[^.]+\.[^.]+$/u);
      const parameters = init?.body as URLSearchParams;
      const refresh = parameters.get("grant_type") === "refresh_token";
      return Response.json({
        access_token: await accessToken(
          refresh ? now + 300 : now + 20,
          refresh ? "access-jti-refresh-0002" : "access-jti-initial-0001",
        ),
        id_token: await idToken(refresh ? undefined : initialNonce),
        refresh_expires_in: 3_600,
        refresh_token: refresh ? "s".repeat(64) : "r".repeat(64),
        token_type: "DPoP",
      });
    };
    const dependencies = {
      dpopPrivateJwk: () => Promise.resolve(TEST_DPOP_PRIVATE_JWK),
      fetch: tokenFetch,
      keyResolver,
      now: () => now * 1_000,
      randomBytes,
    };

    const started = await startLogin(
      new Request("http://localhost:3000/auth/login?returnTo=%2Fplan%3Fcampus%3Dtc"),
      runtime,
      store,
      dependencies,
    );
    expect(started.location.origin).toBe("http://127.0.0.1:8080");
    expect(started.location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(started.location.searchParams.get("dpop_jkt")).toBe(TEST_DPOP_JKT);
    expect(started.location.searchParams.get("scope")).toBe(
      "openid campus:read personal:read personal:write",
    );
    initialNonce = started.location.searchParams.get("nonce") ?? "";
    const state = started.location.searchParams.get("state");
    expect(state).toHaveLength(43);

    const callback = new Request(
      `http://localhost:3000/auth/callback?code=${"c".repeat(32)}&state=${state}`,
      { headers: { cookie: cookiePair(started.setCookie) } },
    );
    const completed = await completeLogin(callback, runtime, store, dependencies);
    expect(completed.location.toString()).toBe("http://localhost:3000/plan?campus=tc");
    expect(completed.setSessionCookie).not.toContain(SUBJECT);
    expect(completed.setSessionCookie).not.toContain("access_token");
    await expect(completeLogin(callback, runtime, store, dependencies)).rejects.toThrow();
    expect(tokenRequests).toBe(1);

    const sessionPair = cookiePair(completed.setSessionCookie);
    const resolved = await resolveAuthSession(
      new Request("http://localhost:3000/auth/session", { headers: { cookie: sessionPair } }),
      runtime,
      store,
      dependencies,
    );
    expect(resolved.authenticated).toBe(true);
    expect(tokenRequests).toBe(2);
    if (!resolved.authenticated) throw new Error("expected authenticated session");
    expect(resolved.record.accessTokenExpiresAt).toBe(now + 300);
    expect(resolved.record.refreshToken).toBe("s".repeat(64));
    const publicSession = tokenFreeSessionResponse({
      authenticated: true,
      expiresAt: resolved.record.accessTokenExpiresAt,
    });
    const publicBody = await publicSession.text();
    expect(publicBody).toBe(JSON.stringify({ authenticated: true, expiresAt: now + 300 }));
    expect(publicBody).not.toContain(resolved.record.accessToken);
    expect(publicBody).not.toContain(SUBJECT);

    await expect(
      endAuthSession(
        new Request("http://localhost:3000/auth/logout", {
          headers: {
            cookie: sessionPair,
            origin: "https://attacker.invalid",
            "sec-fetch-site": "cross-site",
          },
          method: "POST",
        }),
        runtime,
        store,
      ),
    ).rejects.toThrow();
    expect(store.sessions.size).toBe(1);

    const ended = await endAuthSession(
      new Request("http://localhost:3000/auth/logout", {
        headers: {
          cookie: sessionPair,
          origin: runtime.publicOrigin.origin,
          "sec-fetch-site": "same-origin",
        },
        method: "POST",
      }),
      runtime,
      store,
    );
    expect(ended.location.origin).toBe("http://127.0.0.1:8080");
    expect(ended.location.searchParams.get("client_id")).toBe(runtime.clientId);
    expect(store.sessions.size).toBe(0);
  });

  it("retries an authorization-server nonce challenge once with a fresh proof", async () => {
    const store = new MemoryAuthStore();
    let initialNonce = "";
    const proofs: string[] = [];
    let requestNumber = 0;
    const dependencies = {
      dpopPrivateJwk: () => Promise.resolve(TEST_DPOP_PRIVATE_JWK),
      fetch: async (_input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
        requestNumber += 1;
        proofs.push(new Headers(init?.headers).get("dpop") ?? "");
        if (requestNumber === 1) {
          return Response.json(
            { error: "use_dpop_nonce" },
            { headers: { "DPoP-Nonce": "identity-nonce-123" }, status: 400 },
          );
        }
        return Response.json({
          access_token: await accessToken(now + 300, "access-jti-nonce-0001"),
          id_token: await idToken(initialNonce),
          refresh_expires_in: 3_600,
          refresh_token: "r".repeat(64),
          token_type: "DPoP",
        });
      },
      keyResolver,
      now: () => now * 1_000,
      randomBytes: deterministicRandomness(),
    };
    const started = await startLogin(
      new Request("http://localhost:3000/auth/login"),
      runtime,
      store,
      dependencies,
    );
    initialNonce = started.location.searchParams.get("nonce") ?? "";
    const state = started.location.searchParams.get("state");
    const completed = await completeLogin(
      new Request(`http://localhost:3000/auth/callback?code=${"c".repeat(32)}&state=${state}`, {
        headers: { cookie: cookiePair(started.setCookie) },
      }),
      runtime,
      store,
      dependencies,
    );
    const resolved = await resolveAuthSession(
      new Request("http://localhost:3000/auth/session", {
        headers: { cookie: cookiePair(completed.setSessionCookie) },
      }),
      runtime,
      store,
      dependencies,
    );

    expect(requestNumber).toBe(2);
    const payloads = proofs.map((proof) => decodeJwt(proof));
    expect(payloads[0]?.["nonce"]).toBeUndefined();
    expect(payloads[1]?.["nonce"]).toBe("identity-nonce-123");
    expect(payloads[1]?.jti).not.toBe(payloads[0]?.jti);
    expect(resolved.authenticated).toBe(true);
    if (resolved.authenticated) {
      expect(resolved.record.authorizationServerDpopNonce).toBe("identity-nonce-123");
    }
  });

  it.each([
    { accessJkt: TEST_DPOP_JKT, label: "Bearer token_type", tokenType: "Bearer" },
    { accessJkt: null, label: "missing cnf.jkt", tokenType: "DPoP" },
    { accessJkt: "w".repeat(43), label: "wrong cnf.jkt", tokenType: "DPoP" },
  ])("rejects a token response with $label", async ({ accessJkt, tokenType }) => {
    const store = new MemoryAuthStore();
    let initialNonce = "";
    const dependencies = {
      dpopPrivateJwk: () => Promise.resolve(TEST_DPOP_PRIVATE_JWK),
      fetch: async (): Promise<Response> =>
        Response.json({
          access_token: await accessToken(now + 300, "access-jti-binding-0001", accessJkt),
          id_token: await idToken(initialNonce),
          token_type: tokenType,
        }),
      keyResolver,
      now: () => now * 1_000,
      randomBytes: deterministicRandomness(),
    };
    const started = await startLogin(
      new Request("http://localhost:3000/auth/login"),
      runtime,
      store,
      dependencies,
    );
    initialNonce = started.location.searchParams.get("nonce") ?? "";
    const state = started.location.searchParams.get("state");
    await expect(
      completeLogin(
        new Request(`http://localhost:3000/auth/callback?code=${"c".repeat(32)}&state=${state}`, {
          headers: { cookie: cookiePair(started.setCookie) },
        }),
        runtime,
        store,
        dependencies,
      ),
    ).rejects.toThrow();
    expect(store.sessions.size).toBe(0);
  });

  it.each([
    ["control characters", "bad\u0000subject"],
    ["more than 512 UTF-8 bytes", "😀".repeat(129)],
  ])("rejects a token subject containing %s", async (_label, subject) => {
    const store = new MemoryAuthStore();
    let initialNonce = "";
    const dependencies = {
      dpopPrivateJwk: () => Promise.resolve(TEST_DPOP_PRIVATE_JWK),
      fetch: async (): Promise<Response> =>
        Response.json({
          access_token: await accessToken(
            now + 300,
            "access-jti-subject-boundary",
            TEST_DPOP_JKT,
            {},
            subject,
          ),
          id_token: await idToken(initialNonce, subject),
          token_type: "DPoP",
        }),
      keyResolver,
      now: () => now * 1_000,
      randomBytes: deterministicRandomness(),
    };
    const started = await startLogin(
      new Request("http://localhost:3000/auth/login"),
      runtime,
      store,
      dependencies,
    );
    initialNonce = started.location.searchParams.get("nonce") ?? "";
    await expect(
      completeLogin(
        new Request(
          `http://localhost:3000/auth/callback?code=${"c".repeat(32)}&state=${started.location.searchParams.get("state")}`,
          { headers: { cookie: cookiePair(started.setCookie) } },
        ),
        runtime,
        store,
        dependencies,
      ),
    ).rejects.toThrow();
    expect(store.sessions.size).toBe(0);
  });

  it("accepts access-token cnf extension members alongside the bound jkt", async () => {
    const store = new MemoryAuthStore();
    let initialNonce = "";
    const dependencies = {
      dpopPrivateJwk: () => Promise.resolve(TEST_DPOP_PRIVATE_JWK),
      fetch: async (): Promise<Response> =>
        Response.json({
          access_token: await accessToken(now + 300, "access-jti-cnf-extension", TEST_DPOP_JKT, {
            "urn:example:key-policy": "device-bound",
          }),
          id_token: await idToken(initialNonce),
          token_type: "DPoP",
        }),
      keyResolver,
      now: () => now * 1_000,
      randomBytes: deterministicRandomness(),
    };
    const started = await startLogin(
      new Request("http://localhost:3000/auth/login"),
      runtime,
      store,
      dependencies,
    );
    initialNonce = started.location.searchParams.get("nonce") ?? "";
    const state = started.location.searchParams.get("state");
    const completed = await completeLogin(
      new Request(`http://localhost:3000/auth/callback?code=${"c".repeat(32)}&state=${state}`, {
        headers: { cookie: cookiePair(started.setCookie) },
      }),
      runtime,
      store,
      dependencies,
    );

    expect(store.sessions.size).toBe(1);
    expect(completed.location.pathname).toBe("/plan");
  });

  it("rejects ambiguous callbacks without letting a guessed state consume the transaction", async () => {
    const store = new MemoryAuthStore();
    const randomBytes = deterministicRandomness();
    const started = await startLogin(new Request("http://localhost:3000/auth/login"), runtime, store, {
      now: () => now * 1_000,
      randomBytes,
    });
    const state = started.location.searchParams.get("state");
    const request = new Request(
      `http://localhost:3000/auth/callback?code=${"c".repeat(32)}&state=${state}&state=${state}`,
      { headers: { cookie: cookiePair(started.setCookie) } },
    );
    await expect(
      completeLogin(request, runtime, store, { now: () => now * 1_000, randomBytes }),
    ).rejects.toThrow();
    expect(store.transactions.size).toBe(1);
    const wrongState = new Request(
      `http://localhost:3000/auth/callback?code=${"c".repeat(32)}&state=${Buffer.alloc(32, 31).toString("base64url")}`,
      { headers: { cookie: cookiePair(started.setCookie) } },
    );
    await expect(
      completeLogin(wrongState, runtime, store, { now: () => now * 1_000, randomBytes }),
    ).rejects.toThrow();
    expect(store.transactions.size).toBe(1);
  });

  it("rejects a duplicate signed session cookie without loading the encrypted record", async () => {
    const store = new MemoryAuthStore();
    const id = Buffer.alloc(32, 23).toString("base64url");
    store.sessions.set(id, "should-not-be-opened");
    const cookie = sessionCookieForTesting(id, runtime);
    const resolved = await resolveAuthSession(
      new Request("http://localhost:3000/auth/session", {
        headers: { cookie: `${cookie}; ${cookie}` },
      }),
      runtime,
      store,
    );
    expect(resolved).toEqual({ authenticated: false, clearCookie: undefined });
    expect(store.sessions.get(id)).toBe("should-not-be-opened");
  });

  it("fails closed when refresh fails and the bearer has five seconds or less remaining", async () => {
    const store = new MemoryAuthStore();
    const id = Buffer.alloc(32, 29).toString("base64url");
    store.sessions.set(
      id,
      sealAuthRecord(
        "session",
        id,
        {
          accessToken: "a".repeat(64),
          accessTokenExpiresAt: now + 5,
          authorizationServerDpopNonce: null,
          createdAt: now,
          dpopPrivateJwk: TEST_DPOP_PRIVATE_JWK,
          idToken: "i".repeat(64),
          issuer: runtime.issuer,
          nonce: Buffer.alloc(32, 31).toString("base64url"),
          refreshToken: "r".repeat(64),
          refreshTokenExpiresAt: now + 300,
          scopes: ["campus:read", "personal:read", "personal:write"],
          subject: SUBJECT,
        },
        runtime,
        { randomBytes: (size) => new Uint8Array(size).fill(19) },
      ),
    );

    const resolved = await resolveAuthSession(
      new Request("http://localhost:3000/auth/session", {
        headers: { cookie: sessionCookieForTesting(id, runtime) },
      }),
      runtime,
      store,
      {
        fetch: () => Promise.reject(new Error("identity provider unavailable")),
        now: () => now * 1_000,
      },
    );

    expect(resolved.authenticated).toBe(false);
    expect(store.sessions.has(id)).toBe(false);
  });

  it("recovers an expired access token when its bound refresh token is still valid", async () => {
    const store = new MemoryAuthStore();
    const id = Buffer.alloc(32, 35).toString("base64url");
    store.sessions.set(
      id,
      sealAuthRecord(
        "session",
        id,
        {
          accessToken: "a".repeat(64),
          accessTokenExpiresAt: now - 1,
          authorizationServerDpopNonce: null,
          createdAt: now - 60,
          dpopPrivateJwk: TEST_DPOP_PRIVATE_JWK,
          idToken: "i".repeat(64),
          issuer: runtime.issuer,
          nonce: Buffer.alloc(32, 36).toString("base64url"),
          refreshToken: "r".repeat(64),
          refreshTokenExpiresAt: now + 300,
          scopes: ["campus:read", "personal:read", "personal:write"],
          subject: SUBJECT,
        },
        runtime,
        { randomBytes: (size) => new Uint8Array(size).fill(37) },
      ),
    );

    const resolved = await resolveAuthSession(
      new Request("http://localhost:3000/auth/session", {
        headers: { cookie: sessionCookieForTesting(id, runtime) },
      }),
      runtime,
      store,
      {
        fetch: async () =>
          Response.json({
            access_token: await accessToken(now + 300, "access-jti-expired-refresh"),
            refresh_expires_in: 600,
            refresh_token: "s".repeat(64),
            token_type: "DPoP",
          }),
        keyResolver,
        now: () => now * 1_000,
      },
    );

    expect(resolved.authenticated).toBe(true);
    if (!resolved.authenticated) throw new Error("expected refreshed session");
    expect(resolved.record.accessTokenExpiresAt).toBe(now + 300);
    expect(resolved.record.refreshToken).toBe("s".repeat(64));
    expect(store.sessions.has(id)).toBe(true);
  });

  it("does not let a stale refresh failure delete a newer rotated session", async () => {
    const store = new MemoryAuthStore();
    const id = Buffer.alloc(32, 38).toString("base64url");
    const baseRecord = {
      accessToken: "a".repeat(64),
      accessTokenExpiresAt: now + 5,
      authorizationServerDpopNonce: null,
      createdAt: now - 60,
      dpopPrivateJwk: TEST_DPOP_PRIVATE_JWK,
      idToken: "i".repeat(64),
      issuer: runtime.issuer,
      nonce: Buffer.alloc(32, 39).toString("base64url"),
      refreshToken: "r".repeat(64),
      refreshTokenExpiresAt: now + 300,
      scopes: ["campus:read", "personal:read", "personal:write"],
      subject: SUBJECT,
    } as const;
    store.sessions.set(
      id,
      sealAuthRecord("session", id, baseRecord, runtime, {
        randomBytes: (size) => new Uint8Array(size).fill(40),
      }),
    );
    const newerRecord = {
      ...baseRecord,
      accessToken: "n".repeat(64),
      accessTokenExpiresAt: now + 300,
      refreshToken: "s".repeat(64),
    };

    const resolved = await resolveAuthSession(
      new Request("http://localhost:3000/auth/session", {
        headers: { cookie: sessionCookieForTesting(id, runtime) },
      }),
      runtime,
      store,
      {
        fetch: () => {
          store.sessions.set(
            id,
            sealAuthRecord("session", id, newerRecord, runtime, {
              randomBytes: (size) => new Uint8Array(size).fill(41),
            }),
          );
          return Promise.reject(new Error("stale identity-provider request failed"));
        },
        now: () => now * 1_000,
      },
    );

    expect(resolved.authenticated).toBe(true);
    if (!resolved.authenticated) throw new Error("expected fenced newer session");
    expect(resolved.record.accessToken).toBe("n".repeat(64));
    expect(resolved.record.refreshToken).toBe("s".repeat(64));
    expect(store.sessions.has(id)).toBe(true);
  });

  it("coordinates a slow two-attempt nonce refresh across concurrent callers", async () => {
    const store = new MemoryAuthStore();
    const id = Buffer.alloc(32, 43).toString("base64url");
    store.sessions.set(
      id,
      sealAuthRecord(
        "session",
        id,
        {
          accessToken: "a".repeat(64),
          accessTokenExpiresAt: now + 5,
          authorizationServerDpopNonce: null,
          createdAt: now - 60,
          dpopPrivateJwk: TEST_DPOP_PRIVATE_JWK,
          idToken: "i".repeat(64),
          issuer: runtime.issuer,
          nonce: Buffer.alloc(32, 44).toString("base64url"),
          refreshToken: "r".repeat(64),
          refreshTokenExpiresAt: now + 300,
          scopes: ["campus:read", "personal:read", "personal:write"],
          subject: SUBJECT,
        },
        runtime,
        { randomBytes: (size) => new Uint8Array(size).fill(45) },
      ),
    );
    let releaseSecondAttempt!: () => void;
    let markSecondAttemptStarted!: () => void;
    const secondAttemptCanFinish = new Promise<void>((resolve) => {
      releaseSecondAttempt = resolve;
    });
    const secondAttemptStarted = new Promise<void>((resolve) => {
      markSecondAttemptStarted = resolve;
    });
    let tokenRequests = 0;
    const fetch: typeof globalThis.fetch = async () => {
      tokenRequests += 1;
      if (tokenRequests === 1) {
        return Response.json(
          { error: "use_dpop_nonce" },
          { headers: { "DPoP-Nonce": "slow-authorization-server-nonce" }, status: 400 },
        );
      }
      markSecondAttemptStarted();
      await secondAttemptCanFinish;
      return Response.json({
        access_token: await accessToken(now + 300, "access-jti-slow-concurrent"),
        refresh_expires_in: 600,
        refresh_token: "s".repeat(64),
        token_type: "DPoP",
      });
    };
    const request = new Request("http://localhost:3000/auth/session", {
      headers: { cookie: sessionCookieForTesting(id, runtime) },
    });
    const first = resolveAuthSession(request, runtime, store, {
      fetch,
      keyResolver,
      now: () => now * 1_000,
    });
    await secondAttemptStarted;
    const second = resolveAuthSession(request, runtime, store, {
      delay: async () => {
        releaseSecondAttempt();
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      },
      fetch,
      keyResolver,
      now: () => now * 1_000,
    });
    const [firstResolved, secondResolved] = await Promise.all([first, second]);

    expect(firstResolved.authenticated).toBe(true);
    expect(secondResolved.authenticated).toBe(true);
    expect(tokenRequests).toBe(2);
    expect(store.refreshLockTtls).toEqual([30_000, 30_000]);
    if (firstResolved.authenticated && secondResolved.authenticated) {
      expect(secondResolved.record.accessToken).toBe(firstResolved.record.accessToken);
      expect(secondResolved.record.refreshToken).toBe("s".repeat(64));
    }
  });

  it("does not resurrect a session logged out while its refresh response is in flight", async () => {
    const store = new MemoryAuthStore();
    const id = Buffer.alloc(32, 46).toString("base64url");
    store.sessions.set(
      id,
      sealAuthRecord(
        "session",
        id,
        {
          accessToken: "a".repeat(64),
          accessTokenExpiresAt: now + 5,
          authorizationServerDpopNonce: null,
          createdAt: now - 60,
          dpopPrivateJwk: TEST_DPOP_PRIVATE_JWK,
          idToken: "i".repeat(64),
          issuer: runtime.issuer,
          nonce: Buffer.alloc(32, 47).toString("base64url"),
          refreshToken: "r".repeat(64),
          refreshTokenExpiresAt: now + 300,
          scopes: ["campus:read", "personal:read", "personal:write"],
          subject: SUBJECT,
        },
        runtime,
        { randomBytes: (size) => new Uint8Array(size).fill(48) },
      ),
    );

    const resolved = await resolveAuthSession(
      new Request("http://localhost:3000/auth/session", {
        headers: { cookie: sessionCookieForTesting(id, runtime) },
      }),
      runtime,
      store,
      {
        fetch: async () => {
          await store.deleteSession(id);
          return Response.json({
            access_token: await accessToken(now + 300, "access-jti-logout-race"),
            token_type: "DPoP",
          });
        },
        keyResolver,
        now: () => now * 1_000,
      },
    );

    expect(resolved.authenticated).toBe(false);
    if (resolved.authenticated) throw new Error("logout-race session was unexpectedly restored");
    expect(resolved.clearCookie).toBeDefined();
    expect(store.sessions.has(id)).toBe(false);
  });
});
