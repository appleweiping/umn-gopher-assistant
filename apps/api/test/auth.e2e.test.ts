import { createHash, randomUUID } from "node:crypto";

import { Controller, Get, Req } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyRequest } from "fastify";
import { calculateJwkThumbprint, createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { Authenticated, Public, RequireScopes } from "../src/auth/auth.decorators.js";
import { DpopReplayStoreUnavailableException } from "../src/auth/bearer-auth.errors.js";
import { API_RUNTIME_CONFIG, DPOP_REPLAY_STORE, OIDC_KEY_RESOLVER } from "../src/auth/auth.tokens.js";
import type { AuthPrincipal, RequestWithAuthPrincipal } from "../src/auth/auth.types.js";
import { InMemoryDpopReplayStore, type DpopReplayStore } from "../src/auth/dpop-replay-store.js";
import { createFastifyAdapter } from "../src/http/fastify-adapter.js";
import { API_CORS_EXPOSED_HEADERS, apiCorsOptions } from "../src/http/cors.js";
import type { ProblemDetails } from "../src/http/problem-details.filter.js";
import type { ApiRuntimeConfig } from "../src/runtime-config.js";

const ISSUER = "https://identity.example.edu/realms/gopher";
const AUDIENCE = "gopher-api";
const API_ORIGIN = "https://api.example.edu";
const config: ApiRuntimeConfig = {
  ai: {
    knowledgeBaseUrl: new URL("http://127.0.0.1:8100"),
    maxResponseBytes: 262_144,
    serviceHmacKey: new TextEncoder().encode("development-only-ai-service-hmac-key-v1"),
    rateLimit: {
      clientLimit: 12,
      globalLimit: 600,
      networkLimit: 120,
      redisUrl: new URL("redis://:local-only@127.0.0.1:6379"),
      windowSeconds: 60,
    },
    requestTimeoutMs: 3_000,
  },
  cors: { allowedOrigins: ["http://localhost:3000"] },
  nodeEnv: "test",
  oidc: {
    allowedClientIds: ["gopher-web"],
    audience: AUDIENCE,
    dpop: {
      nonceTtlSeconds: 300,
      operationTimeoutMs: 1_000,
      proofLimit: 600,
      proofMaxAgeSeconds: 60,
      proofWindowSeconds: 60,
      publicOrigin: new URL(API_ORIGIN),
      redisUrl: new URL("rediss://:test-only@redis.example.edu"),
      replayTtlSeconds: 120,
    },
    issuer: ISSUER,
    jwksUrl: new URL(`${ISSUER}/protocol/openid-connect/certs`),
    maxTokenLifetimeSeconds: 300,
  },
  port: 4000,
};

@Controller("test/auth")
class AuthProbeController {
  @Get("identity")
  @RequireScopes("campus:read")
  identity(@Req() request: FastifyRequest & RequestWithAuthPrincipal): AuthPrincipal | undefined {
    return request.authPrincipal;
  }

  @Get("authenticated")
  @Authenticated()
  authenticated(@Req() request: FastifyRequest & RequestWithAuthPrincipal): AuthPrincipal | undefined {
    return request.authPrincipal;
  }

  @Get("multiple-scopes")
  @RequireScopes("campus:read", "personal:read")
  multipleScopes(): { readonly ok: true } {
    return { ok: true };
  }

  @Get("unconfigured")
  unconfigured(): { readonly ok: true } {
    return { ok: true };
  }

  @Get("conflicting")
  @Public()
  @Authenticated()
  conflicting(): { readonly ok: true } {
    return { ok: true };
  }
}

@Controller("test/class-scoped")
@RequireScopes("campus:read")
class ClassScopedProbeController {
  @Get("class-only")
  classOnly(): { readonly ok: true } {
    return { ok: true };
  }

  @Get("merged")
  @RequireScopes("personal:read")
  merged(): { readonly ok: true } {
    return { ok: true };
  }
}

@Controller("test/public-conflict")
@Public()
class PublicConflictProbeController {
  @Get()
  @RequireScopes("campus:read")
  conflicting(): { readonly ok: true } {
    return { ok: true };
  }
}

@Controller("test/authenticated-conflict")
@Authenticated()
class AuthenticatedConflictProbeController {
  @Get()
  @Public()
  conflicting(): { readonly ok: true } {
    return { ok: true };
  }
}

type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

let app: NestFastifyApplication;
let privateKey: SigningKey;
let dpopPrivateKey: SigningKey;
let dpopPublicJwk: Awaited<ReturnType<typeof exportJWK>>;
let dpopJkt: string;
let dpopNonce: string | undefined;
let replayUnavailable = false;
let replayRateLimited = false;

interface TokenOverrides {
  readonly audience?: string;
  readonly clientId?: string;
  readonly expiration?: number;
  readonly issuer?: string;
  readonly omitScope?: boolean;
  readonly scope?: string;
  readonly subject?: string;
}

async function issueToken(overrides: TokenOverrides = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT({
    azp: overrides.clientId ?? "gopher-web",
    cnf: { jkt: dpopJkt },
    ...(overrides.omitScope === true ? {} : { scope: overrides.scope ?? "campus:read" }),
  })
    .setProtectedHeader({ alg: "RS256", kid: "primary", typ: "at+jwt" })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setSubject(overrides.subject ?? "token-student")
    .setIssuedAt(now)
    .setJti(randomUUID())
    .setNotBefore(now - 1)
    .setExpirationTime(overrides.expiration ?? now + 300)
    .sign(privateKey);
}

async function issueProof(
  token: string,
  method: string,
  url: string,
  options: {
    readonly accessToken?: string;
    readonly htm?: string;
    readonly htu?: string;
    readonly jti?: string;
    readonly jwk?: Awaited<ReturnType<typeof exportJWK>>;
    readonly key?: SigningKey;
    readonly nonce?: string | undefined;
  } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  const target = new URL(url, API_ORIGIN);
  target.search = "";
  target.hash = "";
  return new SignJWT({
    ath: createHash("sha256")
      .update(options.accessToken ?? token, "ascii")
      .digest("base64url"),
    htm: options.htm ?? method,
    htu: options.htu ?? target.toString(),
    iat: now,
    jti: options.jti ?? randomUUID(),
    ...(options.nonce === undefined ? {} : { nonce: options.nonce }),
  })
    .setProtectedHeader({ alg: "ES256", jwk: options.jwk ?? dpopPublicJwk, typ: "dpop+jwt" })
    .sign(options.key ?? dpopPrivateKey);
}

async function authorizedInject(options: {
  readonly headers?: Readonly<Record<string, string>>;
  readonly method: "GET";
  readonly token: string;
  readonly url: string;
}): Promise<Awaited<ReturnType<typeof app.inject>>> {
  const request = async (nonce: string | undefined) =>
    app.inject({
      headers: {
        ...options.headers,
        authorization: `DPoP ${options.token}`,
        dpop: await issueProof(options.token, options.method, options.url, { nonce }),
      },
      method: options.method,
      url: options.url,
    });
  let response = await request(dpopNonce);
  if (response.statusCode === 401 && response.headers["www-authenticate"] === 'DPoP error="use_dpop_nonce"') {
    const rawNonce = response.headers["dpop-nonce"];
    const nonce = typeof rawNonce === "string" ? rawNonce : undefined;
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    dpopNonce = nonce;
    response = await request(dpopNonce);
  }
  return response;
}

beforeAll(async () => {
  const keyPair = await generateKeyPair("RS256");
  const dpopKeyPair = await generateKeyPair("ES256", { extractable: true });
  privateKey = keyPair.privateKey;
  dpopPrivateKey = dpopKeyPair.privateKey;
  dpopPublicJwk = await exportJWK(dpopKeyPair.publicKey);
  dpopJkt = await calculateJwkThumbprint(dpopPublicJwk, "sha256");
  const publicJwk = {
    ...(await exportJWK(keyPair.publicKey)),
    alg: "RS256",
    kid: "primary",
    use: "sig",
  };
  const localResolver = createLocalJWKSet({ keys: [publicJwk] });
  const memoryReplayStore = new InMemoryDpopReplayStore();
  const replayStore: DpopReplayStore = {
    consume: (...arguments_) =>
      replayUnavailable
        ? Promise.reject(new DpopReplayStoreUnavailableException())
        : replayRateLimited
          ? Promise.resolve({ retryAfterSeconds: 17, status: "rate_limited" })
          : memoryReplayStore.consume(...arguments_),
  };
  const moduleRef = await Test.createTestingModule({
    controllers: [
      AuthProbeController,
      AuthenticatedConflictProbeController,
      ClassScopedProbeController,
      PublicConflictProbeController,
    ],
    imports: [AppModule],
  })
    .overrideProvider(API_RUNTIME_CONFIG)
    .useValue(config)
    .overrideProvider(OIDC_KEY_RESOLVER)
    .useValue(localResolver)
    .overrideProvider(DPOP_REPLAY_STORE)
    .useValue(replayStore)
    .compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter({}), {
    logger: false,
  });
  app.enableCors(apiCorsOptions(config.cors.allowedOrigins));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

function expectProblem(
  response: Awaited<ReturnType<typeof app.inject>>,
  status: 401 | 403 | 429 | 500,
  instance = "/test/auth/identity",
): void {
  expect(response.statusCode).toBe(status);
  expect(response.headers["content-type"]).toContain("application/problem+json");
  const problem = response.json<ProblemDetails>();
  expect(problem).toMatchObject({
    instance,
    status,
    title:
      status === 401
        ? "Unauthorized"
        : status === 403
          ? "Forbidden"
          : status === 429
            ? "Too Many Requests"
            : "Internal Server Error",
  });
  expect(problem.traceId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(response.headers["x-request-id"]).toBe(problem.traceId);
}

describe("API DPoP authentication and scope authorization", () => {
  it("serves a real cross-origin preflight and exposes DPoP challenge metadata", async () => {
    const origin = config.cors.allowedOrigins[0] ?? "";
    const preflight = await app.inject({
      headers: {
        "access-control-request-headers": "authorization,dpop,x-request-id",
        "access-control-request-method": "GET",
        origin,
      },
      method: "OPTIONS",
      url: "/test/auth/identity",
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe(origin);
    expect(preflight.headers["access-control-allow-credentials"]).toBe("true");
    expect(preflight.headers["access-control-allow-headers"]?.toLowerCase()).toContain("authorization");
    expect(preflight.headers["access-control-allow-headers"]?.toLowerCase()).toContain("dpop");

    const token = await issueToken();
    const challenged = await app.inject({
      headers: {
        authorization: `DPoP ${token}`,
        dpop: await issueProof(token, "GET", "/test/auth/identity"),
        origin,
      },
      method: "GET",
      url: "/test/auth/identity",
    });
    expect(challenged.statusCode).toBe(401);
    expect(challenged.headers["dpop-nonce"]).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(challenged.headers["access-control-allow-origin"]).toBe(origin);
    const exposed = (challenged.headers["access-control-expose-headers"] ?? "")
      .toLowerCase()
      .split(",")
      .map((value) => value.trim());
    for (const header of API_CORS_EXPOSED_HEADERS) {
      expect(exposed).toContain(header.toLowerCase());
    }
  });

  it("keeps explicitly public controllers anonymous", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/health" });
    expect(response.statusCode).toBe(200);
  });

  it("accepts a valid token and derives identity only from signed claims", async () => {
    const token = await issueToken();
    const response = await authorizedInject({
      headers: {
        "x-sub": "forged-subject",
        "x-user": "forged-user",
      },
      method: "GET",
      token,
      url: "/test/auth/identity",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      clientId: "gopher-web",
      issuer: ISSUER,
      scopes: ["campus:read"],
      subject: "token-student",
    });
  });

  it("uses the configured public origin instead of Host or forwarded-host assertions", async () => {
    const token = await issueToken();
    const response = await authorizedInject({
      headers: {
        host: "attacker.invalid",
        "x-forwarded-host": "attacker.invalid",
        "x-forwarded-proto": "http",
      },
      method: "GET",
      token,
      url: "/test/auth/identity?client-query=ignored-by-htu",
    });
    expect(response.statusCode).toBe(200);
  });

  it("supports an explicit authenticated-only route", async () => {
    const withoutToken = await app.inject({ method: "GET", url: "/test/auth/authenticated" });
    expect(withoutToken.statusCode).toBe(401);

    const token = await issueToken({ omitScope: true });
    const authenticated = await authorizedInject({
      method: "GET",
      token,
      url: "/test/auth/authenticated",
    });
    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.json()).toEqual({
      clientId: "gopher-web",
      issuer: ISSUER,
      scopes: [],
      subject: "token-student",
    });
  });

  it("fails closed when a route has no explicit policy", async () => {
    const response = await app.inject({ method: "GET", url: "/test/auth/unconfigured" });
    expectProblem(response, 500, "/test/auth/unconfigured");
  });

  it.each([
    ["method-level Public plus Authenticated", "/test/auth/conflicting"],
    ["class-level Public plus method scope", "/test/public-conflict"],
    ["class-level Authenticated plus method Public", "/test/authenticated-conflict"],
  ])("fails closed for %s policy conflict", async (_label, url) => {
    const response = await app.inject({ method: "GET", url });
    expectProblem(response, 500, url);
  });

  it("rejects missing tokens and never accepts identity-shaped headers", async () => {
    const response = await app.inject({
      headers: { "x-sub": "forged-subject", "x-user": "forged-user" },
      method: "GET",
      url: "/test/auth/identity",
    });
    expectProblem(response, 401);
    expect(response.headers["www-authenticate"]).toBe("DPoP");
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("rejects a DPoP-bound token presented without its proof or through Bearer", async () => {
    const token = await issueToken();
    const missingProof = await app.inject({
      headers: { authorization: `DPoP ${token}` },
      method: "GET",
      url: "/test/auth/identity",
    });
    expectProblem(missingProof, 401);
    expect(missingProof.headers["www-authenticate"]).toBe('DPoP error="invalid_dpop_proof"');

    const bearer = await app.inject({
      headers: { authorization: `Bearer ${token}` },
      method: "GET",
      url: "/test/auth/identity",
    });
    expectProblem(bearer, 401);
    expect(bearer.headers["www-authenticate"]).toBe('DPoP error="invalid_request"');
  });

  it("requires a server nonce before accepting an otherwise valid first proof", async () => {
    const token = await issueToken();
    const response = await app.inject({
      headers: {
        authorization: `DPoP ${token}`,
        dpop: await issueProof(token, "GET", "/test/auth/identity"),
      },
      method: "GET",
      url: "/test/auth/identity",
    });
    expectProblem(response, 401);
    expect(response.headers["www-authenticate"]).toBe('DPoP error="use_dpop_nonce"');
    expect(response.headers["dpop-nonce"]).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    dpopNonce =
      typeof response.headers["dpop-nonce"] === "string" ? response.headers["dpop-nonce"] : undefined;
  });

  it("rejects a captured proof on its second use", async () => {
    const token = await issueToken();
    const proof = await issueProof(token, "GET", "/test/auth/identity", { nonce: dpopNonce });
    const request = () =>
      app.inject({
        headers: { authorization: `DPoP ${token}`, dpop: proof },
        method: "GET",
        url: "/test/auth/identity",
      });
    expect((await request()).statusCode).toBe(200);
    const replay = await request();
    expectProblem(replay, 401);
    expect(replay.headers["www-authenticate"]).toBe('DPoP error="invalid_dpop_proof"');
  });

  it.each([
    [
      "wrong method",
      async (token: string) =>
        issueProof(token, "GET", "/test/auth/identity", { htm: "POST", nonce: dpopNonce }),
    ],
    [
      "wrong URL",
      async (token: string) =>
        issueProof(token, "GET", "/test/auth/identity", {
          htu: `${API_ORIGIN}/test/auth/authenticated`,
          nonce: dpopNonce,
        }),
    ],
    [
      "wrong access-token hash",
      async (token: string) =>
        issueProof(token, "GET", "/test/auth/identity", {
          accessToken: `${token}altered`,
          nonce: dpopNonce,
        }),
    ],
  ])("rejects a proof bound to the %s", async (_label, makeProof) => {
    const token = await issueToken();
    const response = await app.inject({
      headers: {
        authorization: `DPoP ${token}`,
        dpop: await makeProof(token),
      },
      method: "GET",
      url: "/test/auth/identity",
    });
    expectProblem(response, 401);
    expect(response.headers["www-authenticate"]).toBe('DPoP error="invalid_dpop_proof"');
  });

  it("rejects a stolen token when the caller has a different private key", async () => {
    const attacker = await generateKeyPair("ES256", { extractable: true });
    const attackerJwk = await exportJWK(attacker.publicKey);
    const token = await issueToken();
    const response = await app.inject({
      headers: {
        authorization: `DPoP ${token}`,
        dpop: await issueProof(token, "GET", "/test/auth/identity", {
          jwk: attackerJwk,
          key: attacker.privateKey,
          nonce: dpopNonce,
        }),
      },
      method: "GET",
      url: "/test/auth/identity",
    });
    expectProblem(response, 401);
    expect(response.headers["www-authenticate"]).toBe('DPoP error="invalid_dpop_proof"');
  });

  it("returns the current challenge after a wrong nonce without rotating it", async () => {
    const token = await issueToken();
    const response = await app.inject({
      headers: {
        authorization: `DPoP ${token}`,
        dpop: await issueProof(token, "GET", "/test/auth/identity", {
          nonce: "wrong-nonce-value",
        }),
      },
      method: "GET",
      url: "/test/auth/identity",
    });
    expectProblem(response, 401);
    expect(response.headers["www-authenticate"]).toBe('DPoP error="use_dpop_nonce"');
    expect(response.headers["dpop-nonce"]).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(response.headers["dpop-nonce"]).toBe(dpopNonce);
    expect(
      (
        await authorizedInject({
          method: "GET",
          token,
          url: "/test/auth/identity",
        })
      ).statusCode,
    ).toBe(200);
  });

  it("accepts the case-insensitive DPoP authorization scheme without changing the token", async () => {
    const token = await issueToken();
    const response = await app.inject({
      headers: {
        authorization: `dPoP ${token}`,
        dpop: await issueProof(token, "GET", "/test/auth/identity", { nonce: dpopNonce }),
      },
      method: "GET",
      url: "/test/auth/identity",
    });
    expect(response.statusCode).toBe(200);
  });

  it("fails closed with 503 when shared replay state is unavailable", async () => {
    const token = await issueToken();
    replayUnavailable = true;
    try {
      const response = await app.inject({
        headers: {
          authorization: `DPoP ${token}`,
          dpop: await issueProof(token, "GET", "/test/auth/identity", { nonce: dpopNonce }),
        },
        method: "GET",
        url: "/test/auth/identity",
      });
      expect(response.statusCode).toBe(503);
      expect(response.headers["www-authenticate"]).toBeUndefined();
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json<ProblemDetails>()).toMatchObject({
        status: 503,
        title: "Service Unavailable",
      });
    } finally {
      replayUnavailable = false;
    }
  });

  it("returns 429 and bounded retry metadata when a subject/key proof budget is exhausted", async () => {
    const token = await issueToken();
    replayRateLimited = true;
    try {
      const response = await app.inject({
        headers: {
          authorization: `DPoP ${token}`,
          dpop: await issueProof(token, "GET", "/test/auth/identity", { nonce: dpopNonce }),
        },
        method: "GET",
        url: "/test/auth/identity",
      });

      expectProblem(response, 429);
      expect(response.headers["www-authenticate"]).toBeUndefined();
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["retry-after"]).toBe("17");
      expect(response.headers["ratelimit-limit"]).toBe("600");
      expect(response.headers["ratelimit-remaining"]).toBe("0");
      expect(response.headers["ratelimit-reset"]).toBe("17");
    } finally {
      replayRateLimited = false;
    }
  });

  it.each([
    ["expired", () => issueToken({ expiration: Math.floor(Date.now() / 1_000) - 30 })],
    ["wrong issuer", () => issueToken({ issuer: "https://identity.example.edu/realms/other" })],
    ["wrong audience", () => issueToken({ audience: "another-api" })],
  ])("returns an RFC problem for a %s token", async (_label, makeToken) => {
    const response = await app.inject({
      headers: { authorization: `DPoP ${await makeToken()}` },
      method: "GET",
      url: "/test/auth/identity",
    });
    expectProblem(response, 401);
    expect(response.headers["www-authenticate"]).toBe('DPoP error="invalid_token"');
  });

  it("returns the RFC 6750 invalid_request challenge for malformed authorization", async () => {
    const response = await app.inject({
      headers: { authorization: "Basic definitely-not-a-bearer-token" },
      method: "GET",
      url: "/test/auth/identity",
    });
    expectProblem(response, 401);
    expect(response.headers["www-authenticate"]).toBe('DPoP error="invalid_request"');
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("returns 403 when authentication succeeds without the required scope", async () => {
    const token = await issueToken({ scope: "personal:read" });
    const response = await authorizedInject({
      method: "GET",
      token,
      url: "/test/auth/identity",
    });
    expectProblem(response, 403);
    expect(response.headers["www-authenticate"]).toBe('DPoP error="insufficient_scope", scope="campus:read"');
  });

  it("enforces multiple scopes with AND semantics", async () => {
    const incomplete = await authorizedInject({
      method: "GET",
      token: await issueToken({ scope: "campus:read" }),
      url: "/test/auth/multiple-scopes",
    });
    expectProblem(incomplete, 403, "/test/auth/multiple-scopes");

    const complete = await authorizedInject({
      method: "GET",
      token: await issueToken({ scope: "campus:read personal:read" }),
      url: "/test/auth/multiple-scopes",
    });
    expect(complete.statusCode).toBe(200);
  });

  it("merges class-level and method-level scopes with AND semantics", async () => {
    const classOnly = await issueToken({ scope: "campus:read" });
    expect(
      (
        await authorizedInject({
          method: "GET",
          token: classOnly,
          url: "/test/class-scoped/class-only",
        })
      ).statusCode,
    ).toBe(200);

    const incomplete = await authorizedInject({
      method: "GET",
      token: classOnly,
      url: "/test/class-scoped/merged",
    });
    expectProblem(incomplete, 403, "/test/class-scoped/merged");

    const complete = await authorizedInject({
      method: "GET",
      token: await issueToken({ scope: "personal:read campus:read" }),
      url: "/test/class-scoped/merged",
    });
    expect(complete.statusCode).toBe(200);
  });

  it("allows a DPoP-bound access token to be reused only with a fresh proof", async () => {
    const token = await issueToken();
    for (let requestNumber = 0; requestNumber < 2; requestNumber += 1) {
      const response = await authorizedInject({
        method: "GET",
        token,
        url: "/test/auth/identity",
      });
      expect(response.statusCode).toBe(200);
    }
  });
});
