#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = resolve(repositoryRoot, "infra/compose/docker-compose.yml");
const maintenanceScript = resolve(repositoryRoot, "packages/db/scripts/maintain-personal-vault.mjs");
const projectName = `gopher-vault-maintenance-smoke-${String(process.pid)}`;
const reusePrebuiltImage = process.env["SMOKE_DB_REUSE_IMAGE"] === "true";
const smokeEnvironment = {
  ...process.env,
  AI_KNOWLEDGE_READER_DB_PASSWORD: "local-ai-reader-password-only",
  AI_KNOWLEDGE_READER_DB_USER: "gopher_ai_reader",
  AI_KNOWLEDGE_SYNC_DB_PASSWORD: "local-ai-sync-password-only",
  AI_KNOWLEDGE_SYNC_DB_USER: "gopher_ai_sync",
  API_PERSONAL_DB_PASSWORD: "local-api-personal-password-only",
  API_PERSONAL_DB_USER: "gopher_api_personal",
  COMPOSE_BIND_ADDRESS: "127.0.0.1",
  COMPOSE_PROJECT_NAME: projectName,
  KEYCLOAK_DB: "keycloak",
  KEYCLOAK_DB_PASSWORD: "local-keycloak-password-only",
  KEYCLOAK_DB_USER: "gopher_keycloak",
  POSTGRES_DB: "gopher",
  POSTGRES_PASSWORD: "local-postgres-password-only",
  POSTGRES_PORT: "0",
  POSTGRES_USER: "gopher",
};

function compose(arguments_, { allowFailure = false, capture = false } = {}) {
  const result = spawnSync("docker", ["compose", "--file", composeFile, ...arguments_], {
    cwd: repositoryRoot,
    encoding: capture ? "utf8" : undefined,
    env: smokeEnvironment,
    stdio: capture ? "pipe" : "inherit",
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`docker compose command failed with status ${String(result.status)}`);
  }
  return result;
}

function runMaintenanceAsync(arguments_, databaseUrl) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [maintenanceScript, ...arguments_], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PERSONAL_VAULT_MAINTENANCE_DATABASE_URL: databaseUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectPromise);
    child.once("exit", (status) => {
      if (status === 0) {
        try {
          resolvePromise(JSON.parse(stdout));
        } catch {
          rejectPromise(new Error("maintenance CLI returned invalid JSON"));
        }
      } else {
        rejectPromise(
          new Error(
            `concurrent personal-vault maintenance CLI failed with status ${String(status)}: ${stderr}`,
          ),
        );
      }
    });
  });
}

function psqlArguments({ command, password, user }) {
  return [
    "exec",
    "--no-TTY",
    "--env",
    `PGPASSWORD=${password}`,
    "postgres",
    "psql",
    "--host",
    "127.0.0.1",
    "--username",
    user,
    "--dbname",
    smokeEnvironment.POSTGRES_DB,
    "--set",
    "ON_ERROR_STOP=1",
    "--command",
    command,
  ];
}

function ownerPsql(command) {
  return psqlArguments({
    command,
    password: smokeEnvironment.POSTGRES_PASSWORD,
    user: smokeEnvironment.POSTGRES_USER,
  });
}

const seedSql = `
INSERT INTO accounts (id)
VALUES ('10000000-0000-4000-8000-000000000001');

INSERT INTO personal_vaults (id, account_id)
VALUES (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);

INSERT INTO personal_vault_payloads (
  id, account_id, vault_id, revision, wire_payload, content_hash, byte_length, created_at
) VALUES (
  '21000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  1, '{}'::jsonb, repeat('a', 64), 4112, clock_timestamp() - interval '60 days'
);
INSERT INTO personal_vault_keyrings (
  id, account_id, vault_id, revision, wire_payload, content_hash, byte_length, created_at
) VALUES (
  '22000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  1, '{}'::jsonb, repeat('b', 64), 1, clock_timestamp() - interval '60 days'
);
INSERT INTO personal_vault_manifests (
  id, account_id, vault_id, revision, wire_payload, content_hash, byte_length, created_at
) VALUES (
  '23000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  1, '{}'::jsonb, repeat('c', 64), 1, clock_timestamp() - interval '60 days'
);
INSERT INTO personal_vault_commits (
  id, account_id, vault_id, revision, parent_commit_id, payload_id, keyring_id,
  manifest_id, wire_payload, content_hash, byte_length, created_at
) VALUES (
  '24000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  1, NULL,
  '21000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001',
  '{}'::jsonb, repeat('d', 64), 1, clock_timestamp() - interval '60 days'
);
UPDATE personal_vaults
   SET current_revision = 1,
       current_payload_id = '21000000-0000-4000-8000-000000000001',
       current_keyring_id = '22000000-0000-4000-8000-000000000001',
       current_manifest_id = '23000000-0000-4000-8000-000000000001',
       head_commit_id = '24000000-0000-4000-8000-000000000001'
 WHERE id = '20000000-0000-4000-8000-000000000001';

INSERT INTO personal_vault_commands (
  id, account_id, vault_id, idempotency_key, actor_kind, request_hash, status,
  response_body, response_etag, response_revision, created_at, completed_at
) VALUES
(
  '31000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'old-success-command-0001', 'account', repeat('1', 64), 'succeeded',
  '{}'::jsonb, '"revision-1"', 1,
  clock_timestamp() - interval '26 hours', clock_timestamp() - interval '25 hours'
),
(
  '31000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'old-failed-command-00002', 'account', repeat('2', 64), 'failed',
  '{}'::jsonb, NULL, NULL,
  clock_timestamp() - interval '26 hours', clock_timestamp() - interval '25 hours'
),
(
  '31000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'recent-success-command-01', 'account', repeat('3', 64), 'succeeded',
  '{}'::jsonb, '"revision-1"', 1,
  clock_timestamp() - interval '24 hours', clock_timestamp() - interval '23 hours'
),
(
  '31000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'stale-pending-command-001', 'account', repeat('4', 64), 'pending',
  NULL, NULL, NULL,
  clock_timestamp() - interval '25 hours', NULL
);

INSERT INTO personal_vault_pairings (
  id, account_id, vault_id, requesting_device_id, state, code_digest,
  request_payload, response_payload, expires_at, consumed_at, created_at, updated_at
) VALUES
(
  '41000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',
  'pending', decode(repeat('11', 32), 'hex'), '{}'::jsonb, NULL,
  clock_timestamp() - interval '1 day', NULL,
  clock_timestamp() - interval '2 days', clock_timestamp() - interval '2 days'
),
(
  '41000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000002',
  'pending', decode(repeat('22', 32), 'hex'), '{}'::jsonb, NULL,
  clock_timestamp() - interval '1 day', NULL,
  clock_timestamp() - interval '2 days', clock_timestamp() - interval '2 days'
),
(
  '41000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000003',
  'expired', decode(repeat('33', 32), 'hex'), '{}'::jsonb, NULL,
  clock_timestamp() - interval '49 days', NULL,
  clock_timestamp() - interval '50 days', clock_timestamp() - interval '31 days'
),
(
  '41000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000004',
  'cancelled', decode(repeat('44', 32), 'hex'), '{}'::jsonb, NULL,
  clock_timestamp() - interval '49 days', NULL,
  clock_timestamp() - interval '50 days', clock_timestamp() - interval '31 days'
),
(
  '41000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000005',
  'pending', decode(repeat('55', 32), 'hex'), '{}'::jsonb, NULL,
  clock_timestamp() + interval '1 hour', NULL,
  clock_timestamp(), clock_timestamp()
),
(
  '41000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000006',
  'consumed', decode(repeat('66', 32), 'hex'), '{}'::jsonb, '{}'::jsonb,
  clock_timestamp() - interval '19 days', clock_timestamp() - interval '10 days',
  clock_timestamp() - interval '20 days', clock_timestamp() - interval '10 days'
);
`;

const dryRunVerificationSql = `
DO $$
DECLARE
  result record;
BEGIN
  SELECT * INTO STRICT result
    FROM public.maintain_personal_vault_ephemera(true, 1);
  IF result.mode <> 'dry-run'
    OR result.maintenance_run_id IS NOT NULL
    OR result.pending_pairings_eligible <> 1
    OR result.pending_pairings_expired <> 0
    OR result.completed_commands_eligible <> 1
    OR result.completed_commands_deleted <> 0
    OR result.terminal_pairings_eligible <> 1
    OR result.terminal_pairings_deleted <> 0
    OR result.stale_pending_commands_observed <> 1
    OR NOT result.pending_pairings_remaining
    OR NOT result.completed_commands_remaining
    OR NOT result.terminal_pairings_remaining THEN
    RAISE EXCEPTION 'dry-run returned an unexpected bounded preview: %', row_to_json(result);
  END IF;
  IF (SELECT count(*) FROM personal_vault_commands) <> 4
    OR (SELECT count(*) FROM personal_vault_pairings) <> 6
    OR (SELECT count(*) FROM audit_events WHERE action = 'personal_vault.ephemera.maintain') <> 0 THEN
    RAISE EXCEPTION 'dry-run mutated personal-vault or audit data';
  END IF;
END
$$;
`;

const finalVerificationSql = `
DO $$
BEGIN
  IF current_setting('server_version_num')::integer < 170000
    OR current_setting('server_version_num')::integer >= 180000 THEN
    RAISE EXCEPTION 'maintenance smoke did not run on PostgreSQL 17';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM platform_schema_migrations
    WHERE version = '0003_personal_vault_ephemera_retention'
      AND checksum ~ '^[a-f0-9]{64}$'
  ) THEN
    RAISE EXCEPTION 'maintenance migration was not applied through the ordered migration runner';
  END IF;
  IF (SELECT count(*) FROM personal_vault_commands WHERE status IN ('succeeded', 'failed')) <> 1
    OR (SELECT count(*) FROM personal_vault_commands WHERE status = 'pending') <> 1 THEN
    RAISE EXCEPTION 'completed retention or pending-command preservation failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM personal_vault_commands
    WHERE id IN (
      '31000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000002'
    )
  ) THEN
    RAISE EXCEPTION 'old completed command rows remain';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM personal_vault_commands
    WHERE id = '31000000-0000-4000-8000-000000000003'
      AND status = 'succeeded'
  ) OR NOT EXISTS (
    SELECT 1 FROM personal_vault_commands
    WHERE id = '31000000-0000-4000-8000-000000000004'
      AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'recent or pending commands were deleted';
  END IF;
  IF (SELECT count(*) FROM personal_vault_pairings WHERE state = 'expired') <> 2
    OR (SELECT count(*) FROM personal_vault_pairings WHERE state = 'pending') <> 1
    OR (SELECT count(*) FROM personal_vault_pairings WHERE state = 'consumed') <> 1
    OR (SELECT count(*) FROM personal_vault_pairings) <> 4 THEN
    RAISE EXCEPTION 'pairing expiry, terminal retention, or live pairing preservation failed';
  END IF;
  IF (SELECT count(*) FROM personal_vault_payloads) <> 1
    OR (SELECT count(*) FROM personal_vault_keyrings) <> 1
    OR (SELECT count(*) FROM personal_vault_manifests) <> 1
    OR (SELECT count(*) FROM personal_vault_commits) <> 1
    OR (SELECT current_revision FROM personal_vaults WHERE id = '20000000-0000-4000-8000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'immutable encrypted history or vault head changed';
  END IF;
  IF (
    SELECT count(*) = 2
      AND sum((metadata->>'pendingPairingsExpired')::integer) = 2
      AND sum((metadata->>'completedCommandsDeleted')::integer) = 2
      AND sum((metadata->>'terminalPairingsDeleted')::integer) = 2
      AND bool_and(metadata->>'sessionRole' = 'gopher_personal_maintenance_runner')
    FROM audit_events
    WHERE action = 'personal_vault.ephemera.maintain'
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'apply audit summaries are incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid = 'public.maintain_personal_vault_ephemera(boolean,integer)'::regprocedure
      AND prosecdef
      AND proconfig @> ARRAY[
        'search_path=pg_catalog, pg_temp',
        'row_security=off'
      ]
  ) THEN
    RAISE EXCEPTION 'maintenance function security configuration is invalid';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    CROSS JOIN LATERAL aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) AS privilege
    WHERE procedure.oid =
      'public.maintain_personal_vault_ephemera(boolean,integer)'::regprocedure
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC can execute personal-vault maintenance';
  END IF;
END
$$;
`;

let completed = false;
try {
  compose(["up", reusePrebuiltImage ? "--no-build" : "--build", "--wait", "postgres"]);
  compose(["run", "--rm", "--no-deps", "postgres-migrate"]);
  compose(
    ownerPsql(`
      CREATE ROLE gopher_personal_maintenance_runner
        LOGIN PASSWORD 'local-personal-maintenance-password-only'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
      GRANT CONNECT ON DATABASE gopher TO gopher_personal_maintenance_runner;
      GRANT USAGE ON SCHEMA public TO gopher_personal_maintenance_runner;
      GRANT EXECUTE ON FUNCTION
        public.maintain_personal_vault_ephemera(boolean, integer)
        TO gopher_personal_maintenance_runner;
    `),
  );
  const publishedPort = compose(["port", "postgres", "5432"], { capture: true }).stdout?.trim();
  const portMatch = /127\.0\.0\.1:(\d+)$/u.exec(publishedPort ?? "");
  if (portMatch?.[1] === undefined) {
    throw new Error("could not resolve the isolated PostgreSQL loopback port");
  }
  const maintenanceDatabaseUrl =
    `postgresql://gopher_personal_maintenance_runner:` +
    `local-personal-maintenance-password-only@127.0.0.1:${portMatch[1]}/gopher`;

  compose(ownerPsql(seedSql));
  compose(ownerPsql(dryRunVerificationSql));
  const cliDryRun = spawnSync(process.execPath, [maintenanceScript, "--dry-run", "--batch-size", "1"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PERSONAL_VAULT_MAINTENANCE_DATABASE_URL: maintenanceDatabaseUrl,
    },
  });
  const cliDryRunResult = JSON.parse(cliDryRun.stdout);
  const cliDryRunJson = JSON.stringify(cliDryRunResult);
  if (
    cliDryRun.status !== 0 ||
    cliDryRunResult.mode !== "dry-run" ||
    cliDryRunResult.maintenanceRunId !== null ||
    cliDryRunResult.pendingPairingsEligible !== 1 ||
    cliDryRunResult.completedCommandsEligible !== 1 ||
    cliDryRunResult.terminalPairingsEligible !== 1 ||
    cliDryRunResult.stalePendingCommandsObserved !== 1 ||
    cliDryRunJson.includes("postgresql://") ||
    cliDryRunJson.includes("local-personal-maintenance-password-only")
  ) {
    throw new Error("maintenance CLI dry-run did not return the expected bounded preview");
  }

  const personalRoleAttempt = compose(
    psqlArguments({
      command: "SELECT * FROM public.maintain_personal_vault_ephemera(true, 1);",
      password: smokeEnvironment.API_PERSONAL_DB_PASSWORD,
      user: smokeEnvironment.API_PERSONAL_DB_USER,
    }),
    { allowFailure: true, capture: true },
  );
  if (
    personalRoleAttempt.status === 0 ||
    !/permission denied for function maintain_personal_vault_ephemera/iu.test(
      `${personalRoleAttempt.stdout ?? ""}${personalRoleAttempt.stderr ?? ""}`,
    )
  ) {
    throw new Error("personal API role was not denied maintenance execution");
  }

  const invalidBatchAttempt = compose(
    ownerPsql("SELECT * FROM public.maintain_personal_vault_ephemera(false, 5001);"),
    { allowFailure: true, capture: true },
  );
  if (
    invalidBatchAttempt.status === 0 ||
    !/p_batch_size must be between 1 and 5000/iu.test(
      `${invalidBatchAttempt.stdout ?? ""}${invalidBatchAttempt.stderr ?? ""}`,
    )
  ) {
    throw new Error("maintenance accepted an unsafe batch size");
  }

  const applyArguments = [
    "--apply",
    "--confirm",
    "APPLY_PERSONAL_VAULT_EPHEMERA_RETENTION",
    "--batch-size",
    "1",
  ];
  const applyResults = await Promise.all([
    runMaintenanceAsync(applyArguments, maintenanceDatabaseUrl),
    runMaintenanceAsync(applyArguments, maintenanceDatabaseUrl),
  ]);
  if (
    applyResults.some(
      (result) =>
        result.mode !== "apply" ||
        typeof result.maintenanceRunId !== "string" ||
        result.pendingPairingsExpired !== 1 ||
        result.completedCommandsDeleted !== 1 ||
        result.terminalPairingsDeleted !== 1,
    )
  ) {
    throw new Error("concurrent maintenance CLI batches returned unexpected mutation counts");
  }
  compose(ownerPsql(finalVerificationSql));

  console.log(
    "PostgreSQL 17 personal-vault maintenance smoke passed: dry-run isolation, bounded concurrent apply, 24-hour and 30-day retention, pending-command preservation, API-role denial, anonymous audit summaries, and immutable encrypted history.",
  );
  completed = true;
} finally {
  if (!completed) {
    compose(["ps", "--all"], { allowFailure: true });
    compose(["logs", "--no-color", "postgres", "postgres-migrate"], { allowFailure: true });
  }
  compose(["down", "--volumes", "--remove-orphans"], { allowFailure: true });
}
