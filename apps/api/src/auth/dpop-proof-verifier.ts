import { createHash, timingSafeEqual } from "node:crypto";

import {
  calculateJwkThumbprint,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type JWK,
  type JWTPayload,
} from "jose";

import type { ApiRuntimeConfig } from "../runtime-config.js";
import type { DpopProofInput, DpopProofVerifier } from "./auth.types.js";
import type { DpopReplayStore } from "./dpop-replay-store.js";
import { DpopRateLimitExceededException } from "./bearer-auth.errors.js";
import { isBoundedJwtString } from "./jwt-string.js";

const MAX_DPOP_PROOF_LENGTH = 8_192;
const BASE64URL_256 = /^[A-Za-z0-9_-]{43}$/u;
const NONCE = /^[\x21\x23-\x5B\x5D-\x7E]{1,512}$/u;
const CLOCK_SKEW_SECONDS = 5;

export class DpopProofValidationError extends Error {
  constructor() {
    super("DPoP proof validation failed");
    this.name = "DpopProofValidationError";
  }
}

export class DpopNonceRequiredError extends Error {
  constructor(readonly nonce: string) {
    super("A fresh DPoP nonce is required");
    this.name = "DpopNonceRequiredError";
  }
}

function canonicalBase64url256(value: unknown): value is string {
  return (
    typeof value === "string" &&
    BASE64URL_256.test(value) &&
    Buffer.from(value, "base64url").toString("base64url") === value
  );
}

function publicP256Jwk(value: unknown): JWK & {
  readonly crv: "P-256";
  readonly kty: "EC";
  readonly x: string;
  readonly y: string;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DpopProofValidationError();
  }
  const jwk = value as Record<string, unknown>;
  if (
    jwk["kty"] !== "EC" ||
    jwk["crv"] !== "P-256" ||
    Object.hasOwn(jwk, "d") ||
    !canonicalBase64url256(jwk["x"]) ||
    !canonicalBase64url256(jwk["y"])
  ) {
    throw new DpopProofValidationError();
  }
  return {
    ...jwk,
    crv: "P-256",
    kty: "EC",
    x: jwk["x"],
    y: jwk["y"],
  } as JWK & {
    readonly crv: "P-256";
    readonly kty: "EC";
    readonly x: string;
    readonly y: string;
  };
}

function normalizePercentEncoding(pathname: string): string {
  if (/%(?![0-9A-Fa-f]{2})/u.test(pathname)) throw new DpopProofValidationError();
  return pathname.replace(/%([0-9A-Fa-f]{2})/gu, (_encoded, hexadecimal: string) => {
    const octet = Number.parseInt(hexadecimal, 16);
    const character = String.fromCharCode(octet);
    return /^[A-Za-z0-9\-._~]$/u.test(character) ? character : `%${hexadecimal.toUpperCase()}`;
  });
}

export function canonicalizeDpopHtu(value: string | URL): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DpopProofValidationError();
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username !== "" || url.password !== "") {
    throw new DpopProofValidationError();
  }
  url.search = "";
  url.hash = "";
  url.pathname = normalizePercentEncoding(url.pathname || "/");
  return url.toString();
}

function expectedTargetUri(rawUrl: string, origin: URL): string {
  if (
    rawUrl.length < 1 ||
    rawUrl.length > 8_192 ||
    !rawUrl.startsWith("/") ||
    rawUrl.startsWith("//") ||
    rawUrl.includes("\\") ||
    rawUrl.includes("#")
  ) {
    throw new DpopProofValidationError();
  }
  return canonicalizeDpopHtu(new URL(rawUrl, origin));
}

function assertSafeProtectedHeader(header: Record<string, unknown>): void {
  // Embedded public JWK is the sole key source. Remote/key-id selectors and
  // unprocessed critical/b64 parameters are rejected, while ordinary private
  // extension parameters remain interoperable as RFC 9449 requires.
  for (const forbidden of ["b64", "crit", "jku", "x5c", "x5u"]) {
    if (Object.hasOwn(header, forbidden)) throw new DpopProofValidationError();
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function accessTokenHash(accessToken: string): string {
  return createHash("sha256").update(accessToken, "ascii").digest("base64url");
}

export class JoseDpopProofVerifier implements DpopProofVerifier {
  constructor(
    private readonly config: ApiRuntimeConfig,
    private readonly replayStore: DpopReplayStore,
    private readonly now: () => number = Date.now,
  ) {
    if (config.oidc.dpop.replayTtlSeconds < config.oidc.dpop.proofMaxAgeSeconds + CLOCK_SKEW_SECONDS + 1) {
      throw new RangeError("DPoP replay TTL must cover the complete accepted proof window");
    }
  }

  async verify(input: DpopProofInput): Promise<void> {
    if (
      input.proof.length < 64 ||
      input.proof.length > MAX_DPOP_PROOF_LENGTH ||
      input.accessToken.length < 32 ||
      input.method.length < 1 ||
      input.method !== input.method.toUpperCase()
    ) {
      throw new DpopProofValidationError();
    }

    let payload: JWTPayload;
    let publicJwk: ReturnType<typeof publicP256Jwk>;
    try {
      const protectedHeader = decodeProtectedHeader(input.proof);
      assertSafeProtectedHeader(protectedHeader);
      if (protectedHeader.typ !== "dpop+jwt" || protectedHeader.alg !== "ES256") {
        throw new DpopProofValidationError();
      }
      publicJwk = publicP256Jwk(protectedHeader.jwk);
      const key = await importJWK(publicJwk, "ES256");
      ({ payload } = await jwtVerify(input.proof, key, {
        algorithms: ["ES256"],
        requiredClaims: ["ath", "htm", "htu", "iat", "jti"],
        typ: "dpop+jwt",
      }));
    } catch {
      throw new DpopProofValidationError();
    }

    const nowSeconds = Math.floor(this.now() / 1_000);
    const expectedHtu = expectedTargetUri(input.rawUrl, this.config.oidc.dpop.publicOrigin);
    const claimedHtu = payload["htu"];
    let canonicalClaimedHtu: string | undefined;
    if (typeof claimedHtu === "string") {
      try {
        canonicalClaimedHtu = canonicalizeDpopHtu(claimedHtu);
      } catch {
        canonicalClaimedHtu = undefined;
      }
    }
    if (
      typeof payload.iat !== "number" ||
      !Number.isSafeInteger(payload.iat) ||
      payload.iat > nowSeconds + CLOCK_SKEW_SECONDS ||
      nowSeconds - payload.iat > this.config.oidc.dpop.proofMaxAgeSeconds ||
      !isBoundedJwtString(payload.jti, 256) ||
      typeof payload["htm"] !== "string" ||
      payload["htm"] !== input.method ||
      canonicalClaimedHtu === undefined ||
      canonicalClaimedHtu !== expectedHtu ||
      typeof payload["ath"] !== "string" ||
      !canonicalBase64url256(payload["ath"]) ||
      !constantTimeEqual(payload["ath"], accessTokenHash(input.accessToken)) ||
      (payload["nonce"] !== undefined &&
        (typeof payload["nonce"] !== "string" || !NONCE.test(payload["nonce"])))
    ) {
      throw new DpopProofValidationError();
    }

    const thumbprint = await calculateJwkThumbprint(publicJwk, "sha256");
    if (!constantTimeEqual(thumbprint, input.authorization.dpopJkt)) {
      throw new DpopProofValidationError();
    }

    const decision = await this.replayStore.consume(
      input.authorization.subject,
      input.authorization.dpopJkt,
      payload.jti,
      typeof payload["nonce"] === "string" ? payload["nonce"] : undefined,
    );
    if (decision.status === "rate_limited") {
      throw new DpopRateLimitExceededException(this.config.oidc.dpop.proofLimit, decision.retryAfterSeconds);
    }
    if (decision.status === "challenge") throw new DpopNonceRequiredError(decision.nonce);
    if (decision.status === "replay") throw new DpopProofValidationError();
  }
}
