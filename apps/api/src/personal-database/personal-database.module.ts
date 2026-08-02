import { Global, Module } from "@nestjs/common";

import { PersonalDatabase } from "./personal-database.js";

@Global()
@Module({
  providers: [PersonalDatabase],
  exports: [PersonalDatabase],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest modules are decorator metadata containers.
export class PersonalDatabaseModule {}
