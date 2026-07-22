import { Inject, Injectable } from "@nestjs/common";
import { jwtVerify } from "jose";
import type { JWTPayload, JWTVerifyGetKey } from "jose";

import type { ApiRuntimeConfig } from "../runtime-config.js";
import { API_RUNTIME_CONFIG, OIDC_KEY_RESOLVER } from "./auth.tokens.js";
import type { AccessTokenVerifier, AuthPrincipal } from "./auth.types.js";

const ACCESS_TOKEN_ALGORITHMS = ["RS256"] as const;
const ACCESS_TOKEN_TYPE = "at+jwt";
const CLOCK_TOLERANCE_SECONDS = 5;
const MAX_ACCESS_TOKEN_LENGTH = 16_384;
const MAX_SCOPE_CLAIM_LENGTH = 2_048;
const MAX_SCOPE_COUNT = 64;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9._~:-]{1,128}$/u;
// JWT ID is a case-sensitive string under RFC 7519. Keep it bounded and
// URI-safe while accepting issuer formats such as `urn:uuid:<uuid>`.
const JTI_PATTERN = /^[A-Za-z0-9._~:-]{8,128}$/u;
const SCOPE_CLAIM_PATTERN = /^[\x21\x23-\x5b\x5d-\x7e]+(?: [\x21\x23-\x5b\x5d-\x7e]+)*$/u;

export class AccessTokenValidationError extends Error {
  constructor() {
    super("Access token validation failed");
    this.name = "AccessTokenValidationError";
  }
}

function exactAudienceMatches(payload: JWTPayload, audience: string): boolean {
  if (typeof payload.aud === "string") return payload.aud === audience;
  return Array.isArray(payload.aud) && payload.aud.length === 1 && payload.aud[0] === audience;
}

function parseScopes(payload: JWTPayload): readonly string[] {
  const claim = payload["scope"];
  if (claim === undefined || claim === "") return Object.freeze([]);
  if (
    typeof claim !== "string" ||
    claim.length > MAX_SCOPE_CLAIM_LENGTH ||
    !SCOPE_CLAIM_PATTERN.test(claim)
  ) {
    throw new AccessTokenValidationError();
  }

  const scopes = [...new Set(claim.split(" "))];
  if (scopes.length > MAX_SCOPE_COUNT) throw new AccessTokenValidationError();
  return Object.freeze(scopes);
}

function parseClientId(payload: JWTPayload, allowedClientIds: readonly string[]): string {
  const authorizedParty = payload["azp"];
  const profileClientId = payload["client_id"];
  if (
    (authorizedParty !== undefined &&
      (typeof authorizedParty !== "string" || !CLIENT_ID_PATTERN.test(authorizedParty))) ||
    (profileClientId !== undefined &&
      (typeof profileClientId !== "string" || !CLIENT_ID_PATTERN.test(profileClientId))) ||
    (authorizedParty !== undefined && profileClientId !== undefined && authorizedParty !== profileClientId)
  ) {
    throw new AccessTokenValidationError();
  }
  const clientId = authorizedParty ?? profileClientId;
  if (typeof clientId !== "string" || !allowedClientIds.includes(clientId)) {
    throw new AccessTokenValidationError();
  }
  return clientId;
}

@Injectable()
export class JoseOidcTokenVerifier implements AccessTokenVerifier {
  constructor(
    @Inject(API_RUNTIME_CONFIG) private readonly config: ApiRuntimeConfig,
    @Inject(OIDC_KEY_RESOLVER) private readonly keyResolver: JWTVerifyGetKey,
  ) {}

  async verify(token: string): Promise<AuthPrincipal> {
    if (token.length < 32 || token.length > MAX_ACCESS_TOKEN_LENGTH) {
      throw new AccessTokenValidationError();
    }

    try {
      const { payload, protectedHeader } = await jwtVerify(token, this.keyResolver, {
        algorithms: [...ACCESS_TOKEN_ALGORITHMS],
        audience: this.config.oidc.audience,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        issuer: this.config.oidc.issuer,
        requiredClaims: ["sub", "exp", "iat", "jti"],
      });
      if (protectedHeader.typ !== ACCESS_TOKEN_TYPE) {
        throw new AccessTokenValidationError();
      }
      if (!exactAudienceMatches(payload, this.config.oidc.audience)) {
        throw new AccessTokenValidationError();
      }
      if (
        typeof payload.exp !== "number" ||
        !Number.isSafeInteger(payload.exp) ||
        typeof payload.iat !== "number" ||
        !Number.isSafeInteger(payload.iat) ||
        payload.exp <= payload.iat ||
        payload.exp - payload.iat > this.config.oidc.maxTokenLifetimeSeconds ||
        payload.iat > Math.floor(Date.now() / 1_000) + CLOCK_TOLERANCE_SECONDS
      ) {
        throw new AccessTokenValidationError();
      }
      if (
        payload.nbf !== undefined &&
        (typeof payload.nbf !== "number" || !Number.isSafeInteger(payload.nbf))
      ) {
        throw new AccessTokenValidationError();
      }
      if (typeof payload.sub !== "string" || payload.sub.length === 0 || payload.sub.length > 512) {
        throw new AccessTokenValidationError();
      }
      if (typeof payload.jti !== "string" || !JTI_PATTERN.test(payload.jti)) {
        throw new AccessTokenValidationError();
      }

      return Object.freeze({
        clientId: parseClientId(payload, this.config.oidc.allowedClientIds),
        scopes: parseScopes(payload),
        subject: payload.sub,
      });
    } catch {
      throw new AccessTokenValidationError();
    }
  }
}

export function parseBearerToken(value: string | undefined): string {
  if (value === undefined || value.length > MAX_ACCESS_TOKEN_LENGTH + 7) {
    throw new AccessTokenValidationError();
  }
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/u.exec(value);
  if (match?.[1] === undefined) throw new AccessTokenValidationError();
  return match[1];
}
