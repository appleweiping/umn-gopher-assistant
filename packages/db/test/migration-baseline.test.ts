import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");
const migrationsRoot = resolve(packageRoot, "migrations");
const snapshotPath = resolve(migrationsRoot, "meta/0000_snapshot.json");
const aiSnapshotPath = resolve(migrationsRoot, "meta/0001_snapshot.json");
const personalVaultSnapshotPath = resolve(migrationsRoot, "meta/0002_snapshot.json");
const personalVaultRetentionSnapshotPath = resolve(migrationsRoot, "meta/0003_snapshot.json");
const accountHmacContinuitySnapshotPath = resolve(migrationsRoot, "meta/0004_snapshot.json");
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Drizzle migration baseline", () => {
  it("records the current schema in a versioned baseline snapshot", () => {
    expect(existsSync(snapshotPath)).toBe(true);
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
      readonly tables?: Record<string, { readonly columns?: Record<string, { readonly type?: string }> }>;
    };

    expect(snapshot.tables?.["public.campuses"]?.columns?.["centroid"]?.type).toBe("geometry(Point,4326)");
    expect(existsSync(aiSnapshotPath)).toBe(true);
    const aiSnapshot = JSON.parse(readFileSync(aiSnapshotPath, "utf8")) as {
      readonly tables?: Record<string, { readonly columns?: Record<string, { readonly type?: string }> }>;
    };
    expect(aiSnapshot.tables?.["public.knowledge_chunks"]?.columns?.["embedding"]?.type).toBe("vector(384)");
    expect(existsSync(personalVaultSnapshotPath)).toBe(true);
    const personalVaultSnapshot = JSON.parse(readFileSync(personalVaultSnapshotPath, "utf8")) as {
      readonly tables?: Record<string, { readonly columns?: Record<string, { readonly type?: string }> }>;
    };
    expect(personalVaultSnapshot.tables?.["public.accounts"]?.columns?.["owner_binding"]?.type).toBe("bytea");
    expect(
      personalVaultSnapshot.tables?.["public.personal_vault_payloads"]?.columns?.["revision"]?.type,
    ).toBe("bigint");
    expect(existsSync(personalVaultRetentionSnapshotPath)).toBe(true);
    const personalVaultRetentionSnapshot = JSON.parse(
      readFileSync(personalVaultRetentionSnapshotPath, "utf8"),
    ) as {
      readonly tables?: Record<string, { readonly indexes?: Record<string, { readonly where?: string }> }>;
    };
    expect(
      personalVaultRetentionSnapshot.tables?.["public.personal_vault_commands"]?.indexes?.[
        "personal_vault_commands_completed_retention_idx"
      ]?.where,
    ).toContain("succeeded");
    expect(existsSync(accountHmacContinuitySnapshotPath)).toBe(true);
    const accountHmacContinuitySnapshot = JSON.parse(
      readFileSync(accountHmacContinuitySnapshotPath, "utf8"),
    ) as { readonly tables?: Record<string, unknown> };
    expect(accountHmacContinuitySnapshot.tables).toHaveProperty("public.account_hmac_key_registry");
  });

  it("generates no follow-up migration from the committed baseline", () => {
    expect(existsSync(snapshotPath)).toBe(true);
    const temporaryRoot = mkdtempSync(resolve(tmpdir(), "gopher-drizzle-baseline-"));
    temporaryRoots.push(temporaryRoot);
    const generatedMigrations = resolve(temporaryRoot, "migrations");
    cpSync(migrationsRoot, generatedMigrations, { recursive: true });

    const result = spawnSync(
      process.execPath,
      [
        resolve(packageRoot, "node_modules/drizzle-kit/bin.cjs"),
        "generate",
        "--dialect",
        "postgresql",
        "--schema",
        "./src/schema.ts",
        "--out",
        generatedMigrations,
        "--name",
        "regression",
      ],
      { cwd: packageRoot, encoding: "utf8" },
    );

    expect(`${result.stdout}${result.stderr}`).not.toContain("CREATE TYPE");
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    expect(readdirSync(generatedMigrations).filter((file) => file.endsWith(".sql"))).toEqual([
      "0000_foundation.sql",
      "0001_ai_knowledge.sql",
      "0002_personal_vault_sync.sql",
      "0003_personal_vault_ephemera_retention.sql",
      "0004_account_hmac_continuity.sql",
    ]);
  }, 30_000);
});
