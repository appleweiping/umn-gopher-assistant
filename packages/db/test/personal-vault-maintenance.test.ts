import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const migration = readFileSync(
  resolve(packageRoot, "migrations/0003_personal_vault_ephemera_retention.sql"),
  "utf8",
);
const snapshot = readFileSync(resolve(packageRoot, "migrations/meta/0003_snapshot.json"), "utf8");
const maintenanceScriptPath = resolve(packageRoot, "scripts/maintain-personal-vault.mjs");
const maintenanceScript = readFileSync(maintenanceScriptPath, "utf8");
const rootPackage = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8")) as {
  readonly scripts?: Record<string, string>;
};

describe("personal-vault ephemeral retention", () => {
  it("uses indexed, bounded, skip-locked batches behind a closed security-definer entry point", () => {
    expect(migration).toContain("p_dry_run boolean DEFAULT true");
    expect(migration).toContain("p_batch_size integer DEFAULT 500");
    expect(migration).toContain("p_batch_size NOT BETWEEN 1 AND 5000");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = pg_catalog, pg_temp");
    expect(migration).toContain("SET row_security = off");
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION "public"."maintain_personal_vault_ephemera"(boolean, integer) FROM PUBLIC',
    );
    expect(migration.match(/FOR UPDATE OF (?:pairing|command) SKIP LOCKED/gu)).toHaveLength(3);
    expect(migration.match(/LIMIT p_batch_size/gu)?.length).toBeGreaterThanOrEqual(7);

    for (const indexName of [
      "personal_vault_commands_completed_retention_idx",
      "personal_vault_commands_pending_attention_idx",
      "personal_vault_pairings_pending_expiry_idx",
      "personal_vault_pairings_terminal_retention_idx",
    ]) {
      expect(migration).toContain(`CREATE INDEX "${indexName}"`);
      expect(snapshot).toContain(`"${indexName}"`);
    }
  });

  it("keeps the documented 24-hour and 30-day floors and never silently deletes pending work", () => {
    expect(migration).toContain("observed_at - interval '24 hours'");
    expect(migration).toContain("observed_at - interval '30 days'");
    expect(migration).toContain("SET state = 'expired'");
    expect(migration).toContain("pairing.state = 'pending'");
    expect(migration).toContain("command.status = 'pending'");
    expect(migration).toContain("stale_pending_commands_observed");
    expect(migration).toContain("DELETE FROM public.personal_vault_commands AS command");
    expect(migration).toContain("command.status IN ('succeeded', 'failed')");
    expect(migration).toContain("DELETE FROM public.personal_vault_pairings AS pairing");
    expect(migration).toContain("pairing.state IN ('consumed', 'expired', 'cancelled')");

    for (const immutableTable of [
      "personal_vault_commits",
      "personal_vault_payloads",
      "personal_vault_keyrings",
      "personal_vault_manifests",
    ]) {
      expect(migration).not.toMatch(new RegExp(`DELETE FROM public\\.${immutableTable}`, "u"));
      expect(migration).not.toMatch(new RegExp(`UPDATE public\\.${immutableTable}`, "u"));
    }
  });

  it("makes apply batches auditable without writing during dry-run", () => {
    const dryRunBranch = migration.slice(
      migration.indexOf("IF p_dry_run THEN"),
      migration.indexOf("WITH candidates AS MATERIALIZED"),
    );
    expect(dryRunBranch).not.toContain("INSERT INTO");
    expect(dryRunBranch).not.toContain("UPDATE ");
    expect(dryRunBranch).not.toContain("DELETE FROM");
    expect(migration).toContain("INSERT INTO public.audit_events");
    expect(migration).toContain("'personal_vault.ephemera.maintain'");
    expect(migration).toContain("'stalePendingCommandsObserved'");
  });

  it("ships an explicit, no-fallback operator CLI with machine-readable output", () => {
    expect(maintenanceScript).toContain("PERSONAL_VAULT_MAINTENANCE_DATABASE_URL");
    expect(maintenanceScript).toContain("no development or API-role fallback is used");
    expect(maintenanceScript).toContain("APPLY_PERSONAL_VAULT_EPHEMERA_RETENTION");
    expect(maintenanceScript).toContain("schemaVersion: 1");
    expect(maintenanceScript).toContain("checkServerIdentity(databaseConfiguration.hostname");
    expect(maintenanceScript).toContain("rejectUnauthorized: true");
    expect(rootPackage.scripts?.["maintain:personal-vault"]).toBe(
      "pnpm --filter @umn-gopher-assistant/db maintain:personal-vault",
    );

    const environment = { ...process.env };
    delete environment["PERSONAL_VAULT_MAINTENANCE_DATABASE_URL"];
    const missingUrl = spawnSync(process.execPath, [maintenanceScriptPath], {
      encoding: "utf8",
      env: environment,
    });
    expect(missingUrl.status).toBe(2);
    expect(`${missingUrl.stdout}${missingUrl.stderr}`).toContain(
      "PERSONAL_VAULT_MAINTENANCE_DATABASE_URL is required",
    );

    const unconfirmedApply = spawnSync(process.execPath, [maintenanceScriptPath, "--apply"], {
      encoding: "utf8",
      env: environment,
    });
    expect(unconfirmedApply.status).toBe(2);
    expect(`${unconfirmedApply.stdout}${unconfirmedApply.stderr}`).toContain(
      "--apply requires --confirm APPLY_PERSONAL_VAULT_EPHEMERA_RETENTION",
    );

    const conflictingMode = spawnSync(process.execPath, [maintenanceScriptPath, "--dry-run", "--apply"], {
      encoding: "utf8",
      env: environment,
    });
    expect(conflictingMode.status).toBe(2);
    expect(`${conflictingMode.stdout}${conflictingMode.stderr}`).toContain(
      "--apply and --dry-run are mutually exclusive",
    );

    const encodedPassword = "vault%40secret%2Fretention";
    const decodedPassword = "vault@secret/retention";
    const unreachableUrl = `postgresql://maintenance:${encodedPassword}@127.0.0.1:1/gopher`;
    const connectionFailure = spawnSync(process.execPath, [maintenanceScriptPath, "--dry-run"], {
      encoding: "utf8",
      env: {
        ...environment,
        PERSONAL_VAULT_MAINTENANCE_DATABASE_URL: unreachableUrl,
      },
      timeout: 15_000,
    });
    const failureOutput = `${connectionFailure.stdout}${connectionFailure.stderr}`;
    expect(connectionFailure.status).toBe(1);
    expect(connectionFailure.stdout).toBe("");
    expect(failureOutput).toContain("Personal-vault maintenance failed (code=");
    expect(failureOutput).not.toContain(unreachableUrl);
    expect(failureOutput).not.toContain(encodedPassword);
    expect(failureOutput).not.toContain(decodedPassword);
  }, 30_000);

  it("requires verify-full off loopback while keeping local development usable", () => {
    const encodedPassword = "remote%40vault%2Fmaintenance";
    const decodedPassword = "remote@vault/maintenance";
    const environment = { ...process.env };
    const rejectedUrls = [
      `postgresql://runner:${encodedPassword}@db.example/gopher`,
      `postgresql://runner:${encodedPassword}@db.example/gopher?sslmode=require`,
      `postgresql://runner:${encodedPassword}@db.example/gopher?sslmode=verify-full&sslmode=disable`,
    ];
    for (const databaseUrl of rejectedUrls) {
      const result = spawnSync(process.execPath, [maintenanceScriptPath, "--dry-run"], {
        encoding: "utf8",
        env: {
          ...environment,
          PERSONAL_VAULT_MAINTENANCE_DATABASE_URL: databaseUrl,
        },
      });
      const output = `${result.stdout}${result.stderr}`;
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(output).toMatch(/sslmode(?:=verify-full| parameter)/u);
      expect(output).not.toContain(databaseUrl);
      expect(output).not.toContain(encodedPassword);
      expect(output).not.toContain(decodedPassword);
    }

    for (const [databaseUrl, transport] of [
      ["postgresql://runner:local-only@127.0.0.1:1/gopher?sslmode=disable", "loopback-development"],
      [`postgresql://runner:${encodedPassword}@db.example/gopher?sslmode=verify-full`, "verify-full"],
    ]) {
      const acceptedConfiguration = spawnSync(
        process.execPath,
        [maintenanceScriptPath, "--check-configuration"],
        {
          encoding: "utf8",
          env: {
            ...environment,
            PERSONAL_VAULT_MAINTENANCE_DATABASE_URL: databaseUrl,
          },
        },
      );
      expect(acceptedConfiguration.status).toBe(0);
      expect(acceptedConfiguration.stderr).toBe("");
      expect(JSON.parse(acceptedConfiguration.stdout)).toMatchObject({ status: "valid", transport });
      expect(acceptedConfiguration.stdout).not.toContain(databaseUrl);
      expect(acceptedConfiguration.stdout).not.toContain(encodedPassword);
      expect(acceptedConfiguration.stdout).not.toContain(decodedPassword);
    }
  }, 20_000);
});
