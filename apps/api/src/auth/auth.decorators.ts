import { SetMetadata } from "@nestjs/common";

import { IS_AUTHENTICATED_ROUTE, IS_PUBLIC_ROUTE, REQUIRED_SCOPES } from "./auth.tokens.js";

const MAX_DECLARED_SCOPE_COUNT = 64;
const MAX_SCOPE_LENGTH = 256;
const SCOPE_PATTERN = /^[\x21\x23-\x5b\x5d-\x7e]+$/u;

export function Authenticated(): ClassDecorator & MethodDecorator {
  return SetMetadata(IS_AUTHENTICATED_ROUTE, true);
}

export function Public(): ClassDecorator & MethodDecorator {
  return SetMetadata(IS_PUBLIC_ROUTE, true);
}

export function RequireScopes(...scopes: readonly string[]): ClassDecorator & MethodDecorator {
  if (
    scopes.length === 0 ||
    scopes.length > MAX_DECLARED_SCOPE_COUNT ||
    scopes.some((scope) => scope.length > MAX_SCOPE_LENGTH || !SCOPE_PATTERN.test(scope))
  ) {
    throw new TypeError("RequireScopes needs at least one valid OAuth scope");
  }
  return SetMetadata(REQUIRED_SCOPES, Object.freeze([...new Set(scopes)]));
}
