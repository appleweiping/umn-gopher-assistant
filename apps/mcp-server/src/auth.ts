import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTPayload, JWTVerifyGetKey } from "jose";

import type { McpServerConfig, OAuthConfig } from "./config.js";

const ACCESS_TOKEN_ALGORITHMS = ["RS256", "PS256", "ES256"] as const;

export interface VerifiedAccessIdentity {
  readonly clientId?: string;
  readonly expiresAt: number;
  readonly scopes: ReadonlySet<string>;
  readonly subject: string;
}

export interface AccessTokenVerifier {
  verify(token: string): Promise<VerifiedAccessIdentity>;
}

export class AccessTokenValidationError extends Error {
  constructor() {
    super("Access token validation failed");
    this.name = "AccessTokenValidationError";
  }
}

function exactAudienceMatches(payload: JWTPayload, resource: string): boolean {
  if (typeof payload.aud === "string") return payload.aud === resource;
  return Array.isArray(payload.aud) && payload.aud.length === 1 && payload.aud[0] === resource;
}

function readScopes(payload: JWTPayload): ReadonlySet<string> {
  if (typeof payload["scope"] !== "string") throw new AccessTokenValidationError();
  const scopes = payload["scope"].split(/\s+/u).filter(Boolean);
  if (scopes.length === 0) throw new AccessTokenValidationError();
  return new Set(scopes);
}

export class JoseAccessTokenVerifier implements AccessTokenVerifier {
  readonly #config: McpServerConfig;
  readonly #keyResolver: JWTVerifyGetKey;

  constructor(config: McpServerConfig, keyResolver?: JWTVerifyGetKey) {
    if (config.auth.mode !== "oauth") {
      throw new TypeError("JoseAccessTokenVerifier requires OAuth configuration");
    }
    this.#config = config;
    this.#keyResolver = keyResolver ?? createRemoteKeyResolver(config.auth);
  }

  async verify(token: string): Promise<VerifiedAccessIdentity> {
    if (token.length < 32 || token.length > 16_384) throw new AccessTokenValidationError();
    const auth = this.#config.auth;
    if (auth.mode !== "oauth") throw new AccessTokenValidationError();

    try {
      const { payload } = await jwtVerify(token, this.#keyResolver, {
        algorithms: [...ACCESS_TOKEN_ALGORITHMS],
        audience: this.#config.resourceUrl.toString(),
        clockTolerance: 5,
        issuer: auth.issuer,
      });
      if (!exactAudienceMatches(payload, this.#config.resourceUrl.toString())) {
        throw new AccessTokenValidationError();
      }
      if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
        throw new AccessTokenValidationError();
      }
      if (payload.nbf !== undefined && (typeof payload.nbf !== "number" || !Number.isFinite(payload.nbf))) {
        throw new AccessTokenValidationError();
      }
      if (typeof payload.sub !== "string" || payload.sub.length === 0 || payload.sub.length > 512) {
        throw new AccessTokenValidationError();
      }
      const scopes = readScopes(payload);
      if (!this.#config.requiredScopes.every((scope) => scopes.has(scope))) {
        throw new AccessTokenValidationError();
      }
      const clientIdClaim = payload["azp"] ?? payload["client_id"];
      const clientId =
        typeof clientIdClaim === "string" && clientIdClaim.length <= 256 ? clientIdClaim : undefined;
      return {
        ...(clientId === undefined ? {} : { clientId }),
        expiresAt: payload.exp,
        scopes,
        subject: payload.sub,
      };
    } catch {
      throw new AccessTokenValidationError();
    }
  }
}

function createRemoteKeyResolver(config: OAuthConfig): JWTVerifyGetKey {
  return createRemoteJWKSet(config.jwksUrl, {
    cooldownDuration: 30_000,
    timeoutDuration: 5_000,
  });
}

export function parseBearerToken(value: string | undefined): string {
  if (value === undefined || value.length > 16_391) throw new AccessTokenValidationError();
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/u.exec(value);
  if (match?.[1] === undefined) throw new AccessTokenValidationError();
  return match[1];
}
