import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";

const AUTHENTICATION_ERROR = "A valid DPoP-bound access token and proof are required.";
const AUTHORIZATION_ERROR = "The access token does not grant every required scope.";

export interface DpopChallengeException {
  readonly wwwAuthenticate: string;
}

export class DpopAuthenticationException extends UnauthorizedException implements DpopChallengeException {
  readonly dpopNonce: string | undefined;
  readonly wwwAuthenticate: string;

  constructor(
    reason: "invalid_dpop_proof" | "invalid_request" | "invalid_token" | "missing" | "use_dpop_nonce",
    dpopNonce?: string,
  ) {
    super(AUTHENTICATION_ERROR);
    if (reason === "use_dpop_nonce" && dpopNonce === undefined) {
      throw new TypeError("A DPoP nonce challenge requires a nonce");
    }
    this.dpopNonce = dpopNonce;
    this.wwwAuthenticate = reason === "missing" ? "DPoP" : `DPoP error="${reason}"`;
  }
}

export class DpopInsufficientScopeException extends ForbiddenException implements DpopChallengeException {
  readonly wwwAuthenticate: string;

  constructor(requiredScopes: readonly string[]) {
    super(AUTHORIZATION_ERROR);
    this.wwwAuthenticate = `DPoP error="insufficient_scope", scope="${requiredScopes.join(" ")}"`;
  }
}

export class DpopReplayStoreUnavailableException extends ServiceUnavailableException {
  constructor() {
    super("DPoP replay protection is temporarily unavailable.");
  }
}

export class DpopRateLimitExceededException extends HttpException {
  constructor(
    readonly limit: number,
    readonly retryAfterSeconds: number,
  ) {
    super("DPoP proof rate limit exceeded.", HttpStatus.TOO_MANY_REQUESTS);
  }
}

export function getDpopChallenge(
  exception: unknown,
): { readonly nonce?: string; readonly value: string } | undefined {
  if (
    exception instanceof DpopAuthenticationException ||
    exception instanceof DpopInsufficientScopeException
  ) {
    return {
      ...(exception instanceof DpopAuthenticationException && exception.dpopNonce !== undefined
        ? { nonce: exception.dpopNonce }
        : {}),
      value: exception.wwwAuthenticate,
    };
  }
  return undefined;
}
