import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTPayload, JWTVerifyGetKey } from "jose";

import type { McpServerConfig, OAuthConfig } from "./config.js";

const ACCESS_TOKEN_ALGORITHMS = ["RS256"] as const;
const JWK_THUMBPRINT = /^[A-Za-z0-9_-]{43}$/u;
const SCOPE = /^[\x21\x23-\x5B\x5D-\x7E]+(?: [\x21\x23-\x5B\x5D-\x7E]+)*$/u;

export interface VerifiedAccessIdentity {
  readonly clientId: string;
  readonly dpopJkt: string;
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
  const value = payload["scope"];
  if (typeof value !== "string" || value.length > 2_048 || !SCOPE.test(value)) {
    throw new AccessTokenValidationError();
  }
  const scopes = value.split(" ");
  const unique = new Set(scopes);
  if (scopes.length > 64 || unique.size !== scopes.length) {
    throw new AccessTokenValidationError();
  }
  return unique;
}

function hasAsciiControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}

function isBoundedJwtString(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.isWellFormed() &&
    !hasAsciiControl(value) &&
    new TextEncoder().encode(value).byteLength <= maximumBytes
  );
}

function readApprovedClient(payload: JWTPayload, auth: OAuthConfig): string {
  const hasAuthorizedParty = Object.prototype.hasOwnProperty.call(payload, "azp");
  const hasClientId = Object.prototype.hasOwnProperty.call(payload, "client_id");
  const authorizedParty = payload["azp"];
  const clientIdClaim = payload["client_id"];
  if (
    (!hasAuthorizedParty && !hasClientId) ||
    (hasAuthorizedParty && !isBoundedJwtString(authorizedParty, 128)) ||
    (hasClientId && !isBoundedJwtString(clientIdClaim, 128))
  ) {
    throw new AccessTokenValidationError();
  }
  const clientId = hasAuthorizedParty ? authorizedParty : clientIdClaim;
  if (
    typeof clientId !== "string" ||
    (hasAuthorizedParty && hasClientId && authorizedParty !== clientIdClaim) ||
    !auth.allowedClientIds.has(clientId)
  ) {
    throw new AccessTokenValidationError();
  }
  return clientId;
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
      const { payload, protectedHeader } = await jwtVerify(token, this.#keyResolver, {
        algorithms: [...ACCESS_TOKEN_ALGORITHMS],
        audience: this.#config.resourceUrl.toString(),
        clockTolerance: 5,
        issuer: auth.issuer,
        requiredClaims: ["sub", "exp", "iat", "jti"],
      });
      if (
        protectedHeader.typ !== "at+jwt" ||
        protectedHeader.b64 !== undefined ||
        protectedHeader.jku !== undefined ||
        protectedHeader.x5u !== undefined ||
        protectedHeader.x5c !== undefined ||
        protectedHeader.crit !== undefined
      ) {
        throw new AccessTokenValidationError();
      }
      if (!exactAudienceMatches(payload, this.#config.resourceUrl.toString())) {
        throw new AccessTokenValidationError();
      }
      if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
        throw new AccessTokenValidationError();
      }
      if (
        typeof payload.iat !== "number" ||
        !Number.isSafeInteger(payload.iat) ||
        !Number.isSafeInteger(payload.exp) ||
        payload.iat > Math.floor(Date.now() / 1_000) + 5 ||
        payload.exp <= payload.iat ||
        payload.exp - payload.iat > 600
      ) {
        throw new AccessTokenValidationError();
      }
      if (
        payload.nbf !== undefined &&
        (typeof payload.nbf !== "number" || !Number.isSafeInteger(payload.nbf))
      ) {
        throw new AccessTokenValidationError();
      }
      if (!isBoundedJwtString(payload.sub, 512) || !isBoundedJwtString(payload.jti, 256)) {
        throw new AccessTokenValidationError();
      }
      const scopes = readScopes(payload);
      if (!this.#config.requiredScopes.every((scope) => scopes.has(scope))) {
        throw new AccessTokenValidationError();
      }
      const clientId = readApprovedClient(payload, auth);
      const confirmation = payload["cnf"];
      const dpopJkt =
        typeof confirmation === "object" &&
        confirmation !== null &&
        !Array.isArray(confirmation) &&
        typeof (confirmation as { readonly jkt?: unknown }).jkt === "string"
          ? (confirmation as { readonly jkt: string }).jkt
          : undefined;
      if (
        dpopJkt === undefined ||
        !JWK_THUMBPRINT.test(dpopJkt) ||
        Buffer.from(dpopJkt, "base64url").toString("base64url") !== dpopJkt
      ) {
        throw new AccessTokenValidationError();
      }
      return {
        clientId,
        dpopJkt,
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

export function parseDpopAccessToken(value: string | undefined): string {
  if (value === undefined || value.length > 16_391) throw new AccessTokenValidationError();
  const match = /^DPoP +([A-Za-z0-9._~-]+)$/iu.exec(value);
  if (match?.[1] === undefined) throw new AccessTokenValidationError();
  return match[1];
}
