import { createHash } from "node:crypto";

import { Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import type { Sql } from "postgres";

import { PersonalDatabase } from "../personal-database/personal-database.js";
import { loadAccountSubjectHmacKeySet, type AccountSubjectHmacKeySet } from "../runtime-config.js";

const ACCOUNT_HMAC_FINGERPRINT_DOMAIN = Buffer.from(
  "UGA2/ACCOUNT-SUBJECT-HMAC/DEPLOYMENT-FINGERPRINT\0",
  "utf8",
);

/**
 * Produces a non-secret, purpose-separated continuity fingerprint. Account
 * subject HMAC keys are required by the production runbook to contain at least
 * 256 bits of random entropy, so persisting this digest does not create a
 * practical offline guessing oracle.
 */
export function accountHmacKeyFingerprint(key: Uint8Array): Uint8Array {
  if (key.byteLength < 32 || key.byteLength > 64) {
    throw new TypeError("Account subject HMAC key must contain 32 through 64 bytes");
  }
  return new Uint8Array(createHash("sha256").update(ACCOUNT_HMAC_FINGERPRINT_DOMAIN).update(key).digest());
}

export async function assertPostgresAccountHmacContinuity(
  sql: Sql<Record<string, never>>,
  keys: AccountSubjectHmacKeySet,
): Promise<void> {
  const currentFingerprint = accountHmacKeyFingerprint(keys.currentKey);
  const previousFingerprint =
    keys.previousKey === undefined ? undefined : accountHmacKeyFingerprint(keys.previousKey);
  const currentParameter = Buffer.from(currentFingerprint);
  const previousParameter = previousFingerprint === undefined ? undefined : Buffer.from(previousFingerprint);
  try {
    await sql`
      select public.assert_account_hmac_key_continuity(
        ${keys.currentVersion}::smallint,
        ${currentParameter}::bytea,
        ${keys.previousVersion ?? null}::smallint,
        ${previousParameter ?? null}::bytea,
        ${keys.rotationFinalized}::boolean,
        ${keys.allowExistingContinuityBootstrap}::boolean
      )
    `;
  } finally {
    currentFingerprint.fill(0);
    previousFingerprint?.fill(0);
    currentParameter.fill(0);
    previousParameter?.fill(0);
  }
}

/**
 * Nest runs this hook during application initialization, before the HTTP
 * listener is opened. Any continuity mismatch therefore fails the deployment
 * closed before an account lookup can create a split identity.
 */
@Injectable()
export class AccountHmacContinuityService implements OnApplicationBootstrap {
  constructor(private readonly database: PersonalDatabase) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.database.sql === null) return;
    const keys = loadAccountSubjectHmacKeySet();
    try {
      await assertPostgresAccountHmacContinuity(this.database.sql, keys);
    } catch (cause) {
      throw new Error("Account HMAC deployment continuity verification failed", { cause });
    } finally {
      keys.currentKey.fill(0);
      keys.previousKey?.fill(0);
    }
  }
}
