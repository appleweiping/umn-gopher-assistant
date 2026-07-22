import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { createRemoteJWKSet } from "jose";
import type { JWTVerifyGetKey } from "jose";

import { loadApiRuntimeConfig, type ApiRuntimeConfig } from "../runtime-config.js";
import { ACCESS_TOKEN_VERIFIER, API_RUNTIME_CONFIG, OIDC_KEY_RESOLVER } from "./auth.tokens.js";
import { BearerAuthGuard } from "./bearer-auth.guard.js";
import { JoseOidcTokenVerifier } from "./oidc-token-verifier.js";

@Module({
  providers: [
    { provide: API_RUNTIME_CONFIG, useFactory: (): ApiRuntimeConfig => loadApiRuntimeConfig() },
    {
      provide: OIDC_KEY_RESOLVER,
      inject: [API_RUNTIME_CONFIG],
      useFactory: (config: ApiRuntimeConfig): JWTVerifyGetKey =>
        createRemoteJWKSet(config.oidc.jwksUrl, {
          cacheMaxAge: 10 * 60_000,
          cooldownDuration: 30_000,
          timeoutDuration: 5_000,
        }),
    },
    { provide: ACCESS_TOKEN_VERIFIER, useClass: JoseOidcTokenVerifier },
    { provide: APP_GUARD, useClass: BearerAuthGuard },
  ],
  exports: [ACCESS_TOKEN_VERIFIER, API_RUNTIME_CONFIG],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest modules are decorator metadata containers.
export class AuthModule {}
