import { Module } from "@nestjs/common";

import { AccountsModule } from "../accounts/accounts.module.js";
import { PersonalDatabaseModule } from "../personal-database/personal-database.module.js";
import { PersonalDatabase } from "../personal-database/personal-database.js";
import { InMemoryPersonalVaultRepository } from "./in-memory-personal-vault.repository.js";
import { PersonalVaultController } from "./personal-vault.controller.js";
import type { PersonalVaultRepository } from "./personal-vault.repository.js";
import { PersonalVaultService } from "./personal-vault.service.js";
import { PERSONAL_VAULT_REPOSITORY } from "./personal-vault.tokens.js";
import { PostgresPersonalVaultRepository } from "./postgres-personal-vault.repository.js";
import { ReadProofReplayGuard } from "./read-proof-replay.guard.js";

@Module({
  imports: [AccountsModule, PersonalDatabaseModule],
  controllers: [PersonalVaultController],
  providers: [
    PersonalVaultService,
    ReadProofReplayGuard,
    {
      provide: PERSONAL_VAULT_REPOSITORY,
      inject: [PersonalDatabase],
      useFactory: (database: PersonalDatabase): PersonalVaultRepository =>
        database.sql === null
          ? new InMemoryPersonalVaultRepository()
          : new PostgresPersonalVaultRepository(database.sql),
    },
  ],
  exports: [PERSONAL_VAULT_REPOSITORY],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest modules are decorator metadata containers.
export class PersonalVaultModule {}
