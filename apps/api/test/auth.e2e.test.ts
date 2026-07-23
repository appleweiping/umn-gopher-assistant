import { randomUUID } from "node:crypto";

import { Controller, Get, Req } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyRequest } from "fastify";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { Authenticated, Public, RequireScopes } from "../src/auth/auth.decorators.js";
import { API_RUNTIME_CONFIG, OIDC_KEY_RESOLVER } from "../src/auth/auth.tokens.js";
import type { AuthPrincipal, RequestWithAuthPrincipal } from "../src/auth/auth.types.js";
import { createFastifyAdapter } from "../src/http/fastify-adapter.js";
import type { ProblemDetails } from "../src/http/problem-details.filter.js";
import type { ApiRuntimeConfig } from "../src/runtime-config.js";

const ISSUER = "https://identity.example.edu/realms/gopher";
const AUDIENCE = "gopher-api";
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

beforeAll(async () => {
  const keyPair = await generateKeyPair("RS256");
  privateKey = keyPair.privateKey;
  const publicJwk = {
    ...(await exportJWK(keyPair.publicKey)),
    alg: "RS256",
    kid: "primary",
    use: "sig",
  };
  const localResolver = createLocalJWKSet({ keys: [publicJwk] });
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
    .compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter({}), {
    logger: false,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

function expectProblem(
  response: Awaited<ReturnType<typeof app.inject>>,
  status: 401 | 403 | 500,
  instance = "/test/auth/identity",
): void {
  expect(response.statusCode).toBe(status);
  expect(response.headers["content-type"]).toContain("application/problem+json");
  const problem = response.json<ProblemDetails>();
  expect(problem).toMatchObject({
    instance,
    status,
    title: status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Internal Server Error",
  });
  expect(problem.traceId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(response.headers["x-request-id"]).toBe(problem.traceId);
}

describe("API Bearer authentication and scope authorization", () => {
  it("keeps explicitly public controllers anonymous", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/health" });
    expect(response.statusCode).toBe(200);
  });

  it("accepts a valid token and derives identity only from signed claims", async () => {
    const token = await issueToken();
    const response = await app.inject({
      headers: {
        authorization: `Bearer ${token}`,
        "x-sub": "forged-subject",
        "x-user": "forged-user",
      },
      method: "GET",
      url: "/test/auth/identity",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      clientId: "gopher-web",
      scopes: ["campus:read"],
      subject: "token-student",
    });
  });

  it("supports an explicit authenticated-only route", async () => {
    const withoutToken = await app.inject({ method: "GET", url: "/test/auth/authenticated" });
    expect(withoutToken.statusCode).toBe(401);

    const token = await issueToken({ omitScope: true });
    const authenticated = await app.inject({
      headers: { authorization: `Bearer ${token}` },
      method: "GET",
      url: "/test/auth/authenticated",
    });
    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.json()).toEqual({ clientId: "gopher-web", scopes: [], subject: "token-student" });
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
    expect(response.headers["www-authenticate"]).toBe("Bearer");
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it.each([
    ["expired", () => issueToken({ expiration: Math.floor(Date.now() / 1_000) - 30 })],
    ["wrong issuer", () => issueToken({ issuer: "https://identity.example.edu/realms/other" })],
    ["wrong audience", () => issueToken({ audience: "another-api" })],
  ])("returns an RFC problem for a %s token", async (_label, makeToken) => {
    const response = await app.inject({
      headers: { authorization: `Bearer ${await makeToken()}` },
      method: "GET",
      url: "/test/auth/identity",
    });
    expectProblem(response, 401);
    expect(response.headers["www-authenticate"]).toBe('Bearer error="invalid_token"');
  });

  it("returns the RFC 6750 invalid_request challenge for malformed authorization", async () => {
    const response = await app.inject({
      headers: { authorization: "Basic definitely-not-a-bearer-token" },
      method: "GET",
      url: "/test/auth/identity",
    });
    expectProblem(response, 401);
    expect(response.headers["www-authenticate"]).toBe('Bearer error="invalid_request"');
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("returns 403 when authentication succeeds without the required scope", async () => {
    const token = await issueToken({ scope: "personal:read" });
    const response = await app.inject({
      headers: { authorization: `Bearer ${token}` },
      method: "GET",
      url: "/test/auth/identity",
    });
    expectProblem(response, 403);
    expect(response.headers["www-authenticate"]).toBe(
      'Bearer error="insufficient_scope", scope="campus:read"',
    );
  });

  it("enforces multiple scopes with AND semantics", async () => {
    const incomplete = await app.inject({
      headers: { authorization: `Bearer ${await issueToken({ scope: "campus:read" })}` },
      method: "GET",
      url: "/test/auth/multiple-scopes",
    });
    expectProblem(incomplete, 403, "/test/auth/multiple-scopes");

    const complete = await app.inject({
      headers: { authorization: `Bearer ${await issueToken({ scope: "campus:read personal:read" })}` },
      method: "GET",
      url: "/test/auth/multiple-scopes",
    });
    expect(complete.statusCode).toBe(200);
  });

  it("merges class-level and method-level scopes with AND semantics", async () => {
    const classOnly = await issueToken({ scope: "campus:read" });
    expect(
      (
        await app.inject({
          headers: { authorization: `Bearer ${classOnly}` },
          method: "GET",
          url: "/test/class-scoped/class-only",
        })
      ).statusCode,
    ).toBe(200);

    const incomplete = await app.inject({
      headers: { authorization: `Bearer ${classOnly}` },
      method: "GET",
      url: "/test/class-scoped/merged",
    });
    expectProblem(incomplete, 403, "/test/class-scoped/merged");

    const complete = await app.inject({
      headers: { authorization: `Bearer ${await issueToken({ scope: "personal:read campus:read" })}` },
      method: "GET",
      url: "/test/class-scoped/merged",
    });
    expect(complete.statusCode).toBe(200);
  });

  it("allows ordinary read access tokens to be reused within their short lifetime", async () => {
    const token = await issueToken();
    for (let requestNumber = 0; requestNumber < 2; requestNumber += 1) {
      const response = await app.inject({
        headers: { authorization: `Bearer ${token}` },
        method: "GET",
        url: "/test/auth/identity",
      });
      expect(response.statusCode).toBe(200);
    }
  });
});
