import { Injectable } from "@nestjs/common";
import type { Sql } from "postgres";

import {
  AccountIdentityInactiveError,
  AccountIdentityUnavailableError,
  type AccountIdentityStore,
} from "./account.types.js";

@Injectable()
export class PostgresAccountIdentityStore implements AccountIdentityStore {
  constructor(
    private readonly sql: Sql<Record<string, never>>,
    private readonly keyVersion: number,
    private readonly previousKeyVersion?: number,
  ) {}

  async resolveAccount(
    subjectHmac: Uint8Array,
    previousSubjectHmac?: Uint8Array,
  ): Promise<{
    readonly accountId: string;
    readonly ownerBinding: Uint8Array;
  }> {
    try {
      const rows = await this.sql<
        readonly {
          readonly accountId: string | null;
          readonly ownerBinding: Buffer | null;
        }[]
      >`select
           account_id as "accountId",
           owner_binding as "ownerBinding"
         from public.resolve_personal_account(
           ${Buffer.from(subjectHmac)},
           ${this.keyVersion}::smallint,
           ${previousSubjectHmac === undefined ? null : Buffer.from(previousSubjectHmac)},
           ${this.previousKeyVersion ?? null}::smallint
         )`;
      const row = rows[0];
      if (row?.accountId === undefined || row.accountId === null || row.ownerBinding?.byteLength !== 32) {
        throw new AccountIdentityUnavailableError();
      }
      return {
        accountId: row.accountId,
        ownerBinding: new Uint8Array(row.ownerBinding),
      };
    } catch (error) {
      if (error instanceof AccountIdentityInactiveError || error instanceof AccountIdentityUnavailableError) {
        throw error;
      }
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { readonly code?: unknown }).code
          : undefined;
      if (code === "28000") throw new AccountIdentityInactiveError();
      throw new AccountIdentityUnavailableError();
    }
  }
}
