import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { createRemoteJWKSet } from "jose";
import type { JWTVerifyGetKey } from "jose";

import { loadApiRuntimeConfig, type ApiRuntimeConfig } from "../runtime-config.js";
import {
  ACCESS_TOKEN_VERIFIER,
  API_RUNTIME_CONFIG,
  DPOP_PROOF_VERIFIER,
  DPOP_REPLAY_STORE,
  OIDC_KEY_RESOLVER,
} from "./auth.tokens.js";
import { DpopAuthGuard } from "./bearer-auth.guard.js";
import { JoseDpopProofVerifier } from "./dpop-proof-verifier.js";
import { RedisDpopReplayStore, type DpopReplayStore } from "./dpop-replay-store.js";
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
    {
      provide: DPOP_REPLAY_STORE,
      inject: [API_RUNTIME_CONFIG],
      useFactory: (config: ApiRuntimeConfig): DpopReplayStore => new RedisDpopReplayStore(config.oidc.dpop),
    },
    {
      provide: DPOP_PROOF_VERIFIER,
      inject: [API_RUNTIME_CONFIG, DPOP_REPLAY_STORE],
      useFactory: (config: ApiRuntimeConfig, replayStore: DpopReplayStore) =>
        new JoseDpopProofVerifier(config, replayStore),
    },
    { provide: APP_GUARD, useClass: DpopAuthGuard },
  ],
  exports: [ACCESS_TOKEN_VERIFIER, API_RUNTIME_CONFIG, DPOP_PROOF_VERIFIER],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest modules are decorator metadata containers.
export class AuthModule {}
