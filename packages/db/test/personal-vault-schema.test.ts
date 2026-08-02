import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getTableName } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  accountHmacKeyRegistry,
  accountIdentityKeys,
  accounts,
  personalVaultCommands,
  personalVaultCommits,
  personalVaultDevices,
  personalVaultKeyrings,
  personalVaultManifests,
  personalVaultPairings,
  personalVaultPayloads,
  personalVaults,
} from "../src/schema.js";

const migration = readFileSync(
  resolve(import.meta.dirname, "../migrations/0002_personal_vault_sync.sql"),
  "utf8",
);
const snapshot = readFileSync(resolve(import.meta.dirname, "../migrations/meta/0002_snapshot.json"), "utf8");
const continuityMigration = readFileSync(
  resolve(import.meta.dirname, "../migrations/0004_account_hmac_continuity.sql"),
  "utf8",
);
const continuitySnapshot = readFileSync(
  resolve(import.meta.dirname, "../migrations/meta/0004_snapshot.json"),
  "utf8",
);
const personalTables = [
  personalVaults,
  personalVaultPayloads,
  personalVaultKeyrings,
  personalVaultManifests,
  personalVaultCommits,
  personalVaultDevices,
  personalVaultPairings,
  personalVaultCommands,
] as const;

function foreignKeyNames(table: PgTable): readonly string[] {
  return getTableConfig(table)
    .foreignKeys.map((constraint) => constraint.getName())
    .sort();
}

describe("account-bound encrypted personal vault schema", () => {
  it("persists only opaque identity HMACs and a distinct random owner binding", () => {
    expect([accounts, accountIdentityKeys].map(getTableName)).toEqual(["accounts", "account_identity_keys"]);
    expect(accounts.ownerBinding.getSQLType()).toBe("bytea");
    expect(accountIdentityKeys.identityHmac.getSQLType()).toBe("bytea");
    expect(migration).toContain('"owner_binding" "bytea" DEFAULT gen_random_bytes(32) NOT NULL');
    expect(migration).toContain("RETURNS TABLE(account_id uuid, owner_binding bytea)");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = pg_catalog, pg_temp");
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION "resolve_personal_account"(bytea, smallint, bytea, smallint) FROM PUBLIC',
    );
    expect(migration).toContain("p_previous_identity_hmac bytea DEFAULT NULL");
    expect(migration).toContain("FOR UPDATE OF identity_key, account");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("hashtextextended");
    expect(migration).toContain("No mapping exists. This is a safe first login");
    expect(migration).toContain("previous_account_id");
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "account_identity_keys_account_version_uidx" ON "account_identity_keys" USING btree ("account_id","hmac_key_version")',
    );
    expect(migration).not.toContain("account_identity_keys_account_hmac_uidx");
    for (const forbidden of ["subject", "email", "task_metadata", "course_title"]) {
      expect(migration.toLowerCase()).not.toContain(`"${forbidden}"`);
    }
  });

  it("anchors account-HMAC deployment continuity and makes rotation finalization fail closed", () => {
    expect(getTableName(accountHmacKeyRegistry)).toBe("account_hmac_key_registry");
    expect(accountHmacKeyRegistry.keyFingerprint.getSQLType()).toBe("bytea");
    expect(continuityMigration).toContain("gopher:account-hmac-continuity:v1");
    expect(continuityMigration).toContain("pg_advisory_xact_lock");
    expect(continuityMigration).toContain(
      "account HMAC fingerprint does not match the registered key version",
    );
    expect(continuityMigration).toContain(
      "account HMAC continuity registry is uninitialized for existing identities",
    );
    expect(continuityMigration).toContain(
      "account HMAC rotation cannot be finalized while accounts remain unmigrated",
    );
    expect(continuityMigration).toContain(
      "account HMAC rotation requires the previous rotation to be finalized",
    );
    expect(continuityMigration).toContain(
      "account HMAC rotation cannot advance while accounts lack the previous key version",
    );
    expect(continuityMigration).toContain("registry.hmac_key_version < p_previous_hmac_key_version");
    expect(continuityMigration).toContain("identity_key.hmac_key_version = p_previous_hmac_key_version");
    expect(continuityMigration).toContain("UPDATE public.account_identity_keys");
    expect(continuityMigration).toContain('REVOKE ALL ON FUNCTION "assert_account_hmac_key_continuity"');
    expect(continuitySnapshot).toContain('"public.account_hmac_key_registry"');
  });

  it("gives every personal row an account id and tenant-safe composite lineage", () => {
    expect(personalTables.map(getTableName)).toEqual([
      "personal_vaults",
      "personal_vault_payloads",
      "personal_vault_keyrings",
      "personal_vault_manifests",
      "personal_vault_commits",
      "personal_vault_devices",
      "personal_vault_pairings",
      "personal_vault_commands",
    ]);
    for (const table of personalTables) {
      expect("accountId" in table).toBe(true);
      expect(migration).toContain(`ALTER TABLE "${getTableName(table)}" ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE "${getTableName(table)}" FORCE ROW LEVEL SECURITY`);
      expect(migration).toContain(
        `CREATE POLICY "${getTableName(table)}_account_isolation" ON "${getTableName(table)}"`,
      );
    }
    expect(foreignKeyNames(personalVaultCommits)).toEqual([
      "personal_vault_commits_keyring_fk",
      "personal_vault_commits_manifest_fk",
      "personal_vault_commits_parent_fk",
      "personal_vault_commits_payload_fk",
      "personal_vault_commits_vault_account_fk",
    ]);
    expect(foreignKeyNames(personalVaultPairings)).toEqual([
      "personal_vault_pairings_approving_device_fk",
      "personal_vault_pairings_vault_account_fk",
    ]);
    expect(migration).toContain(
      "pending requester identity authenticated inside request_payload; no device row exists until approval",
    );
  });

  it("enforces JavaScript-safe revisions, bounded opaque payloads, and strict lifecycles", () => {
    expect(migration).toContain("BETWEEN 1 AND 9007199254740991");
    expect(migration).toContain("BETWEEN 4112 AND 8388624");
    expect(migration).toContain('("personal_vault_payloads"."byte_length" - 16) % 4096 = 0');
    expect(migration).toContain("\"content_hash\" ~ '^[a-f0-9]{64}$'");
    expect(migration).toContain(
      '"actor_kind" = \'account\' AND "personal_vault_commands"."actor_key_id" IS NULL',
    );
    expect(migration).toContain(
      '"actor_kind" IN (\'device\', \'recovery\') AND "personal_vault_commands"."actor_key_id" IS NOT NULL',
    );
    expect(migration).toContain('"key_digest" "bytea" NOT NULL');
    expect(migration).not.toContain('"key_hmac"');
    expect(migration).toContain('"code_digest" "bytea" NOT NULL');
    expect(migration).not.toContain('"code_hmac"');
    expect(snapshot).toContain('"accounts_owner_binding_uidx"');
    expect(snapshot).toContain('"personal_vault_devices_digest_uidx"');
    expect(snapshot).toContain('"personal_vault_pairings_code_digest_uidx"');
  });
});
