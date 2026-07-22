import { Inject, Injectable, InternalServerErrorException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";

import {
  ACCESS_TOKEN_VERIFIER,
  IS_AUTHENTICATED_ROUTE,
  IS_PUBLIC_ROUTE,
  REQUIRED_SCOPES,
} from "./auth.tokens.js";
import type { AccessTokenVerifier, RequestWithAuthPrincipal } from "./auth.types.js";
import { BearerAuthenticationException, BearerInsufficientScopeException } from "./bearer-auth.errors.js";
import { parseBearerToken } from "./oidc-token-verifier.js";

const ROUTE_POLICY_ERROR = "The route has no valid explicit authorization policy.";

interface RouteAuthPolicy {
  readonly isAuthenticated: boolean;
  readonly isPublic: boolean;
  readonly requiredScopes: readonly string[];
}

@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
  ) {}

  private resolvePolicy(context: ExecutionContext): RouteAuthPolicy {
    const handler = context.getHandler();
    const controller = context.getClass();
    const isPublic =
      (this.reflector.get<boolean | undefined>(IS_PUBLIC_ROUTE, handler) ?? false) ||
      (this.reflector.get<boolean | undefined>(IS_PUBLIC_ROUTE, controller) ?? false);
    const isAuthenticated =
      (this.reflector.get<boolean | undefined>(IS_AUTHENTICATED_ROUTE, handler) ?? false) ||
      (this.reflector.get<boolean | undefined>(IS_AUTHENTICATED_ROUTE, controller) ?? false);
    const classScopes = this.reflector.get<readonly string[] | undefined>(REQUIRED_SCOPES, controller) ?? [];
    const handlerScopes = this.reflector.get<readonly string[] | undefined>(REQUIRED_SCOPES, handler) ?? [];
    const requiredScopes = Object.freeze([...new Set([...classScopes, ...handlerScopes])]);

    if (
      (isPublic && (isAuthenticated || requiredScopes.length > 0)) ||
      (!isPublic && !isAuthenticated && requiredScopes.length === 0)
    ) {
      throw new InternalServerErrorException(ROUTE_POLICY_ERROR);
    }
    return { isAuthenticated, isPublic, requiredScopes };
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.resolvePolicy(context);
    if (policy.isPublic) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest & RequestWithAuthPrincipal>();
    const authorization = request.headers.authorization;
    if (authorization === undefined) {
      throw new BearerAuthenticationException("missing");
    }

    let token: string;
    try {
      token = parseBearerToken(authorization);
    } catch {
      throw new BearerAuthenticationException("invalid_request");
    }

    let principal;
    try {
      principal = await this.verifier.verify(token);
    } catch {
      throw new BearerAuthenticationException("invalid_token");
    }

    request.authPrincipal = principal;
    const grantedScopes = new Set(principal.scopes);
    if (!policy.requiredScopes.every((scope) => grantedScopes.has(scope))) {
      throw new BearerInsufficientScopeException(policy.requiredScopes);
    }
    return true;
  }
}
