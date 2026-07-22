import { ForbiddenException, UnauthorizedException } from "@nestjs/common";

const AUTHENTICATION_ERROR = "A valid Bearer access token is required.";
const AUTHORIZATION_ERROR = "The access token does not grant every required scope.";

export interface BearerChallengeException {
  readonly wwwAuthenticate: string;
}

export class BearerAuthenticationException extends UnauthorizedException implements BearerChallengeException {
  readonly wwwAuthenticate: string;

  constructor(reason: "invalid_request" | "invalid_token" | "missing") {
    super(AUTHENTICATION_ERROR);
    this.wwwAuthenticate = reason === "missing" ? "Bearer" : `Bearer error="${reason}"`;
  }
}

export class BearerInsufficientScopeException extends ForbiddenException implements BearerChallengeException {
  readonly wwwAuthenticate: string;

  constructor(requiredScopes: readonly string[]) {
    super(AUTHORIZATION_ERROR);
    this.wwwAuthenticate = `Bearer error="insufficient_scope", scope="${requiredScopes.join(" ")}"`;
  }
}

export function getBearerChallenge(exception: unknown): string | undefined {
  if (
    exception instanceof BearerAuthenticationException ||
    exception instanceof BearerInsufficientScopeException
  ) {
    return exception.wwwAuthenticate;
  }
  return undefined;
}
