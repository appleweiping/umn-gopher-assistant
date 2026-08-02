import { Module } from "@nestjs/common";

import { PersonalDatabaseModule } from "../personal-database/personal-database.module.js";
import { PersonalDatabase } from "../personal-database/personal-database.js";
import { loadAccountSubjectHmacKeySet } from "../runtime-config.js";
import { AccountHmacContinuityService } from "./account-hmac-continuity.service.js";
import { ACCOUNT_IDENTITY_STORE, ACCOUNT_RESOLVER } from "./account.tokens.js";
import type { AccountIdentityStore } from "./account.types.js";
import { HmacAccountResolver } from "./hmac-account-resolver.js";
import { InMemoryAccountIdentityStore } from "./in-memory-account-identity.store.js";
import { PostgresAccountIdentityStore } from "./postgres-account-identity.store.js";

@Module({
  imports: [PersonalDatabaseModule],
  providers: [
    AccountHmacContinuityService,
    {
      provide: ACCOUNT_IDENTITY_STORE,
      inject: [PersonalDatabase],
      useFactory: (database: PersonalDatabase): AccountIdentityStore => {
        if (database.sql === null || database.config === null) {
          return new InMemoryAccountIdentityStore();
        }
        return new PostgresAccountIdentityStore(
          database.sql,
          database.config.identityHmacKeyVersion,
          database.config.previousIdentityHmacKeyVersion,
        );
      },
    },
    {
      provide: ACCOUNT_RESOLVER,
      inject: [ACCOUNT_IDENTITY_STORE],
      useFactory: (store: AccountIdentityStore): HmacAccountResolver => {
        const keys = loadAccountSubjectHmacKeySet();
        return new HmacAccountResolver(store, keys.currentKey, keys.previousKey);
      },
    },
  ],
  exports: [ACCOUNT_IDENTITY_STORE, ACCOUNT_RESOLVER],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest modules are decorator metadata containers.
export class AccountsModule {}
