import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import postgres, { type Sql } from "postgres";

import { loadPersonalDatabaseConfig, type PersonalDatabaseConfig } from "./personal-database.config.js";

@Injectable()
export class PersonalDatabase implements OnApplicationShutdown {
  readonly config: PersonalDatabaseConfig | null;
  readonly sql: Sql<Record<string, never>> | null;

  constructor() {
    this.config = loadPersonalDatabaseConfig();
    this.sql =
      this.config === null
        ? null
        : postgres(this.config.url, {
            connection: {
              application_name: "gopher-core-api-personal",
              idle_in_transaction_session_timeout: 15_000,
              lock_timeout: 5_000,
              statement_timeout: 15_000,
              TimeZone: "UTC",
            },
            connect_timeout: 10,
            idle_timeout: 20,
            max: 12,
            max_lifetime: 60 * 30,
            prepare: true,
            target_session_attrs: "read-write",
          });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.sql?.end({ timeout: 5 });
  }
}
