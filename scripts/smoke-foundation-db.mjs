#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = resolve(repositoryRoot, "infra/compose/docker-compose.yml");
const projectName = `gopher-db-smoke-${String(process.pid)}`;
const reusePrebuiltImage = process.env.SMOKE_DB_REUSE_IMAGE === "true";
const smokeEnvironment = {
  ...process.env,
  COMPOSE_BIND_ADDRESS: "127.0.0.1",
  COMPOSE_PROJECT_NAME: projectName,
  AI_KNOWLEDGE_READER_DB_PASSWORD: "local-ai-reader-password-only",
  AI_KNOWLEDGE_READER_DB_USER: "gopher_ai_reader",
  AI_KNOWLEDGE_SYNC_DB_PASSWORD: "local-ai-sync-password-only",
  AI_KNOWLEDGE_SYNC_DB_USER: "gopher_ai_sync",
  API_PERSONAL_DB_PASSWORD: "local-api-personal-password-only",
  API_PERSONAL_DB_USER: "gopher_api_personal",
  KEYCLOAK_DB: "keycloak",
  KEYCLOAK_DB_PASSWORD: "local-keycloak-password-only",
  KEYCLOAK_DB_USER: "gopher_keycloak",
  POSTGRES_DB: "gopher",
  POSTGRES_PASSWORD: "local-postgres-password-only",
  POSTGRES_PORT: "0",
  POSTGRES_USER: "gopher",
};
const commandLabel = "docker compose";

function compose(arguments_, allowFailure = false) {
  const result = spawnSync("docker", ["compose", "--file", composeFile, ...arguments_], {
    cwd: repositoryRoot,
    env: smokeEnvironment,
    stdio: "inherit",
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${commandLabel} ${arguments_.join(" ")} failed with status ${String(result.status)}`);
  }
  return result;
}

function composeAsync(arguments_) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("docker", ["compose", "--file", composeFile, ...arguments_], {
      cwd: repositoryRoot,
      env: smokeEnvironment,
      stdio: "inherit",
    });
    child.once("error", rejectPromise);
    child.once("exit", (status) => {
      if (status === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`concurrent ${commandLabel} database command failed`));
      }
    });
  });
}

function composeMustFail(
  arguments_,
  failureLabel,
  expectedError = /permission denied|not permitted to set role/iu,
) {
  const result = spawnSync("docker", ["compose", "--file", composeFile, ...arguments_], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: smokeEnvironment,
    stdio: "pipe",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.status === 0) {
    throw new Error(`${failureLabel} unexpectedly succeeded`);
  }
  if (!expectedError.test(output)) {
    throw new Error(`${failureLabel} failed for an unexpected reason`);
  }
}

function postgresPsqlArguments({ command, database = "gopher", password, user }) {
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
    database,
    "--set",
    "ON_ERROR_STOP=1",
    "--command",
    command,
  ];
}

function composeWithInput(arguments_, input) {
  const result = spawnSync("docker", ["compose", "--file", composeFile, ...arguments_], {
    cwd: repositoryRoot,
    env: smokeEnvironment,
    input,
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (result.status !== 0) {
    throw new Error(`${commandLabel} ${arguments_.join(" ")} failed with status ${String(result.status)}`);
  }
}

const foundationMigration = readFileSync(
  resolve(repositoryRoot, "packages/db/migrations/0000_foundation.sql"),
  "utf8",
);
const legacyCampusMarker = `
INSERT INTO campuses (
  id, name_en, name_zh_cn, city_en, city_zh_cn, time_zone,
  academic_institution_code, academic_calendar_campus_id, source_url, official_status
) VALUES (
  'tc', 'Legacy Twin Cities', '旧双城校区', 'Legacy City', '旧城市', 'America/Chicago',
  'UMNTC', 'tc', 'https://twin-cities.umn.edu/', 'UNVERIFIED'
);
`;
const legacyKeycloakMarker = `
CREATE TABLE public.legacy_keycloak_marker (
  id integer PRIMARY KEY,
  marker text NOT NULL
);
INSERT INTO public.legacy_keycloak_marker (id, marker)
VALUES (1, 'preserve-and-transfer-owner');
`;

const verificationSql = `
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_extension WHERE extname IN ('postgis', 'vector')) <> 2 THEN
    RAISE EXCEPTION 'postgis and vector extensions must both be installed';
  END IF;
  IF to_regclass('public.campuses') IS NULL OR to_regclass('public.source_snapshots') IS NULL THEN
    RAISE EXCEPTION 'foundation migration tables are missing';
  END IF;
  IF to_regclass('public.source_snapshots_embedding_hnsw_idx') IS NULL THEN
    RAISE EXCEPTION 'foundation HNSW index is missing';
  END IF;
  IF to_regclass('public.knowledge_sources') IS NULL OR to_regclass('public.knowledge_documents') IS NULL OR to_regclass('public.knowledge_chunks_embedding_hnsw_idx') IS NULL THEN
    RAISE EXCEPTION 'AI knowledge tables or HNSW index are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'knowledge_sources_governance_check'
      AND conrelid = 'knowledge_sources'::regclass
  ) THEN
    RAISE EXCEPTION 'AI source-governance constraint is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'knowledge_ingestion_runs_projection_check'
      AND conrelid = 'knowledge_ingestion_runs'::regclass
  ) THEN
    RAISE EXCEPTION 'AI projection-integrity constraint is missing';
  END IF;
  IF to_regclass('public.personal_vaults') IS NULL
    OR to_regclass('public.personal_vault_payloads') IS NULL
    OR to_regclass('public.personal_vault_commands') IS NULL THEN
    RAISE EXCEPTION 'personal vault synchronization tables are missing';
  END IF;
  IF (SELECT count(*) FROM platform_schema_migrations) <> 5 THEN
    RAISE EXCEPTION 'migration ledger does not contain exactly five migrations';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM platform_schema_migrations
    WHERE version = '0003_personal_vault_ephemera_retention'
      AND checksum ~ '^[a-f0-9]{64}$'
  ) THEN
    RAISE EXCEPTION 'personal-vault ephemeral retention migration is not registered';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM platform_schema_migrations
    WHERE version = '0004_account_hmac_continuity'
      AND checksum ~ '^[a-f0-9]{64}$'
  ) THEN
    RAISE EXCEPTION 'account-HMAC continuity migration is not registered';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'platform_schema_migrations_immutable'
      AND tgrelid = 'platform_schema_migrations'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'migration ledger immutability trigger is missing';
  END IF;
  IF (SELECT name_en FROM campuses WHERE id = 'tc') <> 'Legacy Twin Cities' THEN
    RAISE EXCEPTION 'the 0000 to 0001 upgrade did not preserve existing campus data';
  END IF;
  IF (SELECT datdba FROM pg_database WHERE datname = 'keycloak') <> (
    SELECT oid FROM pg_roles WHERE rolname = 'gopher_keycloak'
  ) THEN
    RAISE EXCEPTION 'Keycloak database is not owned by its dedicated role';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname IN ('gopher_ai_reader', 'gopher_ai_sync', 'gopher_api_personal', 'gopher_keycloak')
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'a runtime database role has elevated role attributes';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_auth_members AS membership
    JOIN pg_roles AS member ON member.oid = membership.member
    WHERE member.rolname IN ('gopher_ai_reader', 'gopher_ai_sync', 'gopher_api_personal', 'gopher_keycloak')
  ) THEN
    RAISE EXCEPTION 'a runtime database role retained an unsafe role membership';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_roles
    WHERE rolname IN ('gopher_ai_reader', 'gopher_ai_sync', 'gopher_api_personal', 'gopher_keycloak')
      AND rolcanlogin
  ) <> 4 THEN
    RAISE EXCEPTION 'dedicated runtime database roles are missing';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_class
    WHERE oid IN (
      'personal_vaults'::regclass,
      'personal_vault_payloads'::regclass,
      'personal_vault_keyrings'::regclass,
      'personal_vault_manifests'::regclass,
      'personal_vault_commits'::regclass,
      'personal_vault_devices'::regclass,
      'personal_vault_pairings'::regclass,
      'personal_vault_commands'::regclass
    )
      AND relrowsecurity
      AND relforcerowsecurity
  ) <> 8 THEN
    RAISE EXCEPTION 'personal tables must enable and force row-level security';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_policy
    WHERE polrelid IN (
      'personal_vaults'::regclass,
      'personal_vault_payloads'::regclass,
      'personal_vault_keyrings'::regclass,
      'personal_vault_manifests'::regclass,
      'personal_vault_commits'::regclass,
      'personal_vault_devices'::regclass,
      'personal_vault_pairings'::regclass,
      'personal_vault_commands'::regclass
    )
  ) <> 8 THEN
    RAISE EXCEPTION 'personal tables must each have one account isolation policy';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid = 'resolve_personal_account(bytea,smallint,bytea,smallint)'::regprocedure
      AND prosecdef
      AND proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
  ) THEN
    RAISE EXCEPTION 'personal account resolver is not a fixed-search-path security definer';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid = 'maintain_personal_vault_ephemera(boolean,integer)'::regprocedure
      AND prosecdef
      AND proconfig @> ARRAY[
        'search_path=pg_catalog, pg_temp',
        'row_security=off'
      ]
  ) THEN
    RAISE EXCEPTION 'personal-vault maintenance is not a fixed-search-path security definer';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    CROSS JOIN LATERAL aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) AS privilege
    WHERE procedure.oid =
      'maintain_personal_vault_ephemera(boolean,integer)'::regprocedure
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC can execute personal-vault maintenance';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND has_function_privilege('gopher_api_personal', procedure.oid, 'EXECUTE')
  ) <> 2
    OR NOT has_function_privilege(
      'gopher_api_personal',
      'resolve_personal_account(bytea,smallint,bytea,smallint)'::regprocedure,
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'gopher_api_personal',
      'assert_account_hmac_key_continuity(smallint,bytea,smallint,bytea,boolean,boolean)'::regprocedure,
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'personal API function allowlist did not converge exactly';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND has_function_privilege('gopher_ai_reader', procedure.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'AI reader retained public-schema function execution';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND has_function_privilege('gopher_ai_sync', procedure.oid, 'EXECUTE')
  ) <> 1
    OR NOT has_function_privilege(
      'gopher_ai_sync',
      'public.vector(public.vector,integer,boolean)'::regprocedure,
      'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'AI sync function allowlist did not converge exactly';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'accounts'
      AND column_name = 'owner_binding'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'stable account owner binding is missing';
  END IF;
END
$$;

DO $$
DECLARE
  candidate text;
BEGIN
  FOREACH candidate IN ARRAY ARRAY[
    'https://evil-umn.edu/path',
    'https://umnXedu/path',
    'https://attacker@safe.umn.edu/path',
    'https://safe.umn.edu/path?redirect=https://evil.example',
    'https://safe.umn.edu/path#fragment',
    'https://safe.umn.edu:8443/path'
  ]
  LOOP
    BEGIN
      INSERT INTO knowledge_sources (
        external_id, campus_ids, role, source_url, license_status, license_evidence_url
      ) VALUES (
        'smoke-rejected-source', ARRAY['tc'::campus_id], 'OFFICIAL_VERIFICATION',
        candidate, 'DEEPLINK_ONLY', NULL
      );
      RAISE EXCEPTION 'unsafe official URL unexpectedly passed governance: %', candidate;
    EXCEPTION
      WHEN check_violation THEN NULL;
    END;
  END LOOP;

  INSERT INTO knowledge_sources (
    external_id, campus_ids, role, source_url, license_status, license_evidence_url
  ) VALUES (
    'smoke-valid-source', ARRAY['tc'::campus_id], 'OFFICIAL_VERIFICATION',
    'https://safe.umn.edu:443/path', 'DEEPLINK_ONLY', NULL
  );
  DELETE FROM knowledge_sources WHERE external_id = 'smoke-valid-source';
END
$$;
`;

let completed = false;
try {
  compose(["up", reusePrebuiltImage ? "--no-build" : "--build", "--wait", "postgres"]);
  // Reproduce an existing volume created by the foundation-only release. The
  // migration runner must baseline 0000, apply 0001, and preserve this row.
  composeWithInput(
    [
      "exec",
      "--no-TTY",
      "postgres",
      "psql",
      "--username",
      "gopher",
      "--dbname",
      "gopher",
      "--set",
      "ON_ERROR_STOP=1",
      "--file=-",
    ],
    `${foundationMigration}\n${legacyCampusMarker}`,
  );
  composeWithInput(
    [
      "exec",
      "--no-TTY",
      "postgres",
      "psql",
      "--username",
      smokeEnvironment.POSTGRES_USER,
      "--dbname",
      smokeEnvironment.KEYCLOAK_DB,
      "--set",
      "ON_ERROR_STOP=1",
      "--file=-",
    ],
    legacyKeycloakMarker,
  );
  compose([
    "exec",
    "--no-TTY",
    "postgres",
    "psql",
    "--username",
    smokeEnvironment.POSTGRES_USER,
    "--dbname",
    smokeEnvironment.POSTGRES_DB,
    "--set",
    "ON_ERROR_STOP=1",
    "--command",
    "ALTER ROLE gopher_ai_reader BYPASSRLS; ALTER ROLE gopher_ai_sync BYPASSRLS; ALTER ROLE gopher_api_personal BYPASSRLS; ALTER ROLE gopher_keycloak BYPASSRLS; GRANT gopher TO gopher_ai_reader; GRANT pg_read_all_data TO gopher_ai_sync; GRANT pg_write_all_data TO gopher_api_personal; GRANT pg_write_all_data TO gopher_keycloak;",
  ]);

  // Simulate an existing Debian-based volume whose postgres account used a
  // different numeric UID, then force a full container recreation. The
  // one-shot permissions service must normalize the retained data before the
  // long-running database starts as non-root UID 70.
  compose(["stop", "postgres"]);
  compose(["rm", "--force", "postgres", "postgres-permissions"]);
  compose([
    "run",
    "--rm",
    "--no-deps",
    "--user",
    "0:0",
    "--entrypoint",
    "sh",
    "postgres",
    "-ec",
    "chown -R 999:999 /var/lib/postgresql/data && chmod 0700 /var/lib/postgresql/data",
  ]);
  compose(["up", "--no-build", "--wait", "postgres"]);
  compose([
    "exec",
    "--no-TTY",
    "postgres",
    "sh",
    "-ec",
    'test "$(id -u)" = 70 && test "$(stat -c %u:%g /var/lib/postgresql/data)" = 70:70',
  ]);

  compose(["run", "--rm", "--no-deps", "postgres-migrate"]);
  for (const unsafeKeycloakDatabase of ["gopher", "postgres", "template0", "template1"]) {
    composeMustFail(
      ["run", "--rm", "--no-deps", "--env", `KEYCLOAK_DB=${unsafeKeycloakDatabase}`, "postgres-migrate"],
      `unsafe Keycloak database target ${unsafeKeycloakDatabase}`,
      /KEYCLOAK_DB must be a dedicated non-system database distinct from POSTGRES_DB/u,
    );
  }
  compose([
    "exec",
    "--no-TTY",
    "postgres",
    "psql",
    "--username",
    "gopher",
    "--dbname",
    "gopher",
    "--set",
    "ON_ERROR_STOP=1",
    "--command",
    verificationSql,
  ]);

  const readerConnection = {
    password: smokeEnvironment.AI_KNOWLEDGE_READER_DB_PASSWORD,
    user: smokeEnvironment.AI_KNOWLEDGE_READER_DB_USER,
  };
  const syncConnection = {
    password: smokeEnvironment.AI_KNOWLEDGE_SYNC_DB_PASSWORD,
    user: smokeEnvironment.AI_KNOWLEDGE_SYNC_DB_USER,
  };
  const personalConnection = {
    password: smokeEnvironment.API_PERSONAL_DB_PASSWORD,
    user: smokeEnvironment.API_PERSONAL_DB_USER,
  };
  const keycloakConnection = {
    password: smokeEnvironment.KEYCLOAK_DB_PASSWORD,
    user: smokeEnvironment.KEYCLOAK_DB_USER,
  };

  compose(
    postgresPsqlArguments({
      ...readerConnection,
      command: "SELECT count(*) FROM knowledge_documents;",
    }),
  );
  composeMustFail(
    postgresPsqlArguments({
      ...readerConnection,
      command:
        "INSERT INTO knowledge_ingestion_runs (corpus_version, status, started_at) VALUES ('forbidden', 'running', now());",
    }),
    "AI reader write escalation",
  );
  composeMustFail(
    postgresPsqlArguments({
      ...readerConnection,
      command: "SELECT count(*) FROM campuses;",
    }),
    "AI reader access outside knowledge projections",
  );
  composeMustFail(
    postgresPsqlArguments({
      ...readerConnection,
      command: "CREATE TEMP TABLE forbidden_reader_temp (id integer);",
    }),
    "AI reader temporary-table creation",
  );
  composeMustFail(
    postgresPsqlArguments({
      ...readerConnection,
      command: "SET ROLE gopher;",
    }),
    "AI reader migration-owner role escalation",
  );

  compose(
    postgresPsqlArguments({
      ...syncConnection,
      command:
        "INSERT INTO knowledge_ingestion_runs (corpus_version, status, started_at) VALUES ('smoke-sync', 'running', now()); SELECT count(*) FROM campuses;",
    }),
  );
  composeMustFail(
    postgresPsqlArguments({
      ...syncConnection,
      command: "UPDATE knowledge_citations SET excerpt = excerpt;",
    }),
    "AI sync mutation of immutable citations",
  );
  composeMustFail(
    postgresPsqlArguments({
      ...syncConnection,
      command: "SELECT count(*) FROM audit_events;",
    }),
    "AI sync access outside its ingestion boundary",
  );
  composeMustFail(
    postgresPsqlArguments({
      ...syncConnection,
      command: "CREATE TABLE public.forbidden_sync_table (id integer);",
    }),
    "AI sync schema-owner escalation",
  );

  compose(
    postgresPsqlArguments({
      ...personalConnection,
      command: `
        SELECT assert_account_hmac_key_continuity(
          1::smallint, decode(repeat('c1', 32), 'hex'),
          NULL::smallint, NULL::bytea, false, false
        );
      `,
    }),
  );
  composeMustFail(
    postgresPsqlArguments({
      ...personalConnection,
      command: `
        SELECT assert_account_hmac_key_continuity(
          1::smallint, decode(repeat('c2', 32), 'hex'),
          NULL::smallint, NULL::bytea, false, false
        );
      `,
    }),
    "same-version account HMAC replacement",
    /fingerprint does not match the registered key version/iu,
  );
  compose(
    postgresPsqlArguments({
      ...personalConnection,
      command: `
        SELECT assert_account_hmac_key_continuity(
          2::smallint, decode(repeat('c3', 32), 'hex'),
          1::smallint, decode(repeat('c1', 32), 'hex'), false, false
        );
      `,
    }),
  );

  compose(
    postgresPsqlArguments({
      ...personalConnection,
      command: `
        WITH first_resolution AS MATERIALIZED (
          SELECT * FROM resolve_personal_account(decode(repeat('11', 32), 'hex'), 1::smallint)
        ), second_resolution AS MATERIALIZED (
          SELECT * FROM resolve_personal_account(decode(repeat('11', 32), 'hex'), 1::smallint)
        ), other_resolution AS MATERIALIZED (
          SELECT * FROM resolve_personal_account(decode(repeat('22', 32), 'hex'), 1::smallint)
        )
        SELECT 1 / (
          first_resolution.account_id = second_resolution.account_id
          AND first_resolution.owner_binding = second_resolution.owner_binding
          AND first_resolution.account_id <> other_resolution.account_id
          AND first_resolution.owner_binding <> other_resolution.owner_binding
          AND first_resolution.owner_binding <> decode(repeat('11', 32), 'hex')
        )::integer
        FROM first_resolution, second_resolution, other_resolution;

        BEGIN;
        SELECT set_config('app.account_id', account_id::text, true)
        FROM resolve_personal_account(decode(repeat('11', 32), 'hex'), 1::smallint);
        INSERT INTO personal_vaults (account_id)
        SELECT account_id
        FROM resolve_personal_account(decode(repeat('11', 32), 'hex'), 1::smallint);
        SELECT 1 / (count(*) = 1)::integer FROM personal_vaults;
        COMMIT;
      `,
    }),
  );
  composeMustFail(
    postgresPsqlArguments({
      ...personalConnection,
      command: `
        SELECT assert_account_hmac_key_continuity(
          3::smallint, decode(repeat('c4', 32), 'hex'),
          2::smallint, decode(repeat('c3', 32), 'hex'), false, false
        );
      `,
    }),
    "account HMAC rotation before previous finalization",
    /requires the previous rotation to be finalized/iu,
  );
  composeMustFail(
    postgresPsqlArguments({
      password: smokeEnvironment.POSTGRES_PASSWORD,
      user: smokeEnvironment.POSTGRES_USER,
      command: `
        BEGIN;
        UPDATE account_hmac_key_registry
        SET retired_at = clock_timestamp()
        WHERE hmac_key_version = 1;
        UPDATE account_identity_keys
        SET retired_at = clock_timestamp()
        WHERE hmac_key_version = 1;
        SELECT assert_account_hmac_key_continuity(
          3::smallint, decode(repeat('c4', 32), 'hex'),
          2::smallint, decode(repeat('c3', 32), 'hex'), false, false
        );
      `,
    }),
    "account HMAC rotation with dormant accounts missing the previous mapping",
    /cannot advance while accounts lack the previous key version/iu,
  );
  compose(
    postgresPsqlArguments({
      password: smokeEnvironment.POSTGRES_PASSWORD,
      user: smokeEnvironment.POSTGRES_USER,
      command: `
        BEGIN;
        INSERT INTO account_identity_keys (
          account_id, identity_hmac, hmac_key_version
        )
        SELECT
          account.id,
          digest('smoke-v2:' || account.id::text, 'sha256'),
          2::smallint
        FROM accounts AS account
        WHERE NOT EXISTS (
          SELECT 1
          FROM account_identity_keys AS identity_key
          WHERE identity_key.account_id = account.id
            AND identity_key.hmac_key_version = 2
            AND identity_key.retired_at IS NULL
        );
        SELECT assert_account_hmac_key_continuity(
          2::smallint, decode(repeat('c3', 32), 'hex'),
          NULL::smallint, NULL::bytea, true, false
        );
        SELECT assert_account_hmac_key_continuity(
          3::smallint, decode(repeat('c4', 32), 'hex'),
          2::smallint, decode(repeat('c3', 32), 'hex'), false, false
        );
        SELECT 1 / (count(*) = 1)::integer
        FROM account_hmac_key_registry
        WHERE hmac_key_version = 3
          AND retired_at IS NULL;
        ROLLBACK;
      `,
    }),
  );

  compose(
    postgresPsqlArguments({
      ...personalConnection,
      command: `
        WITH rotation_aware_first_login AS MATERIALIZED (
          SELECT * FROM resolve_personal_account(
            decode(repeat('a0', 32), 'hex'), 2::smallint,
            decode(repeat('a1', 32), 'hex'), 1::smallint
          )
        ), old_instance_lookup AS MATERIALIZED (
          SELECT * FROM resolve_personal_account(decode(repeat('a1', 32), 'hex'), 1::smallint)
        )
        SELECT 1 / (
          rotation_aware_first_login.account_id = old_instance_lookup.account_id
          AND rotation_aware_first_login.owner_binding = old_instance_lookup.owner_binding
        )::integer
        FROM rotation_aware_first_login, old_instance_lookup;
      `,
    }),
  );

  const concurrentNewUserCommand = `
    SELECT * FROM resolve_personal_account(
      decode(repeat('a2', 32), 'hex'), 2::smallint,
      decode(repeat('a3', 32), 'hex'), 1::smallint
    );`;
  await Promise.all(
    Array.from({ length: 8 }, () =>
      composeAsync(
        postgresPsqlArguments({
          ...personalConnection,
          command: concurrentNewUserCommand,
        }),
      ),
    ),
  );
  compose(
    postgresPsqlArguments({
      password: smokeEnvironment.POSTGRES_PASSWORD,
      user: smokeEnvironment.POSTGRES_USER,
      command: `
        SELECT 1 / (
          count(*) = 2
          AND count(DISTINCT account_id) = 1
        )::integer
        FROM account_identity_keys
        WHERE (hmac_key_version = 2 AND identity_hmac = decode(repeat('a2', 32), 'hex'))
           OR (hmac_key_version = 1 AND identity_hmac = decode(repeat('a3', 32), 'hex'));
      `,
    }),
  );

  const rollingDeploymentCommands = [
    ...Array.from(
      { length: 4 },
      () => `
      SELECT * FROM resolve_personal_account(
        decode(repeat('a5', 32), 'hex'), 1::smallint
      );`,
    ),
    ...Array.from(
      { length: 4 },
      () => `
      SELECT * FROM resolve_personal_account(
        decode(repeat('a4', 32), 'hex'), 2::smallint,
        decode(repeat('a5', 32), 'hex'), 1::smallint
      );`,
    ),
  ];
  await Promise.all(
    rollingDeploymentCommands.map((command) =>
      composeAsync(
        postgresPsqlArguments({
          ...personalConnection,
          command,
        }),
      ),
    ),
  );
  compose(
    postgresPsqlArguments({
      password: smokeEnvironment.POSTGRES_PASSWORD,
      user: smokeEnvironment.POSTGRES_USER,
      command: `
        SELECT 1 / (
          count(*) = 2
          AND count(DISTINCT account_id) = 1
        )::integer
        FROM account_identity_keys
        WHERE (hmac_key_version = 2 AND identity_hmac = decode(repeat('a4', 32), 'hex'))
           OR (hmac_key_version = 1 AND identity_hmac = decode(repeat('a5', 32), 'hex'));
      `,
    }),
  );

  const concurrentRotationCommand = `
    SELECT account_id, encode(owner_binding, 'hex')
    FROM resolve_personal_account(
      decode(repeat('44', 32), 'hex'),
      2::smallint,
      decode(repeat('11', 32), 'hex'),
      1::smallint
    );`;
  await Promise.all(
    Array.from({ length: 8 }, () =>
      composeAsync(
        postgresPsqlArguments({
          ...personalConnection,
          command: concurrentRotationCommand,
        }),
      ),
    ),
  );
  compose(
    postgresPsqlArguments({
      ...personalConnection,
      command: `
        WITH previous_resolution AS MATERIALIZED (
          SELECT * FROM resolve_personal_account(decode(repeat('11', 32), 'hex'), 1::smallint)
        ), current_resolution AS MATERIALIZED (
          SELECT * FROM resolve_personal_account(decode(repeat('44', 32), 'hex'), 2::smallint)
        ), repeated_rotation AS MATERIALIZED (
          SELECT * FROM resolve_personal_account(
            decode(repeat('44', 32), 'hex'), 2::smallint,
            decode(repeat('11', 32), 'hex'), 1::smallint
          )
        )
        SELECT 1 / (
          previous_resolution.account_id = current_resolution.account_id
          AND previous_resolution.account_id = repeated_rotation.account_id
          AND previous_resolution.owner_binding = current_resolution.owner_binding
          AND previous_resolution.owner_binding = repeated_rotation.owner_binding
        )::integer
        FROM previous_resolution, current_resolution, repeated_rotation;
      `,
    }),
  );
  composeMustFail(
    postgresPsqlArguments({
      ...personalConnection,
      command: `
        SELECT assert_account_hmac_key_continuity(
          2::smallint, decode(repeat('c3', 32), 'hex'),
          NULL::smallint, NULL::bytea, true, false
        );
      `,
    }),
    "account HMAC finalization with unmigrated accounts",
    /cannot be finalized while accounts remain unmigrated/iu,
  );
  compose(
    postgresPsqlArguments({
      password: smokeEnvironment.POSTGRES_PASSWORD,
      user: smokeEnvironment.POSTGRES_USER,
      command: `
        SELECT 1 / (
          count(*) = 2
          AND count(DISTINCT account_id) = 1
        )::integer
        FROM account_identity_keys
        WHERE (hmac_key_version = 1 AND identity_hmac = decode(repeat('11', 32), 'hex'))
           OR (hmac_key_version = 2 AND identity_hmac = decode(repeat('44', 32), 'hex'));
      `,
    }),
  );
  compose(
    postgresPsqlArguments({
      ...personalConnection,
      command: "SELECT * FROM resolve_personal_account(decode(repeat('77', 32), 'hex'), 1::smallint);",
    }),
  );
  const divergentRotationCommands = ["88", "99"].map((digestByte) =>
    composeAsync(
      postgresPsqlArguments({
        ...personalConnection,
        command: `
          SELECT * FROM resolve_personal_account(
            decode(repeat('${digestByte}', 32), 'hex'), 2::smallint,
            decode(repeat('77', 32), 'hex'), 1::smallint
          );`,
      }),
    ),
  );
  const divergentRotationOutcomes = await Promise.allSettled(divergentRotationCommands);
  if (
    divergentRotationOutcomes.filter((outcome) => outcome.status === "fulfilled").length !== 1 ||
    divergentRotationOutcomes.filter((outcome) => outcome.status === "rejected").length !== 1
  ) {
    throw new Error("conflicting concurrent identity rotations did not produce exactly one winner");
  }
  compose(
    postgresPsqlArguments({
      password: smokeEnvironment.POSTGRES_PASSWORD,
      user: smokeEnvironment.POSTGRES_USER,
      command: `
        SELECT 1 / (
          count(*) = 2
          AND count(DISTINCT account_id) = 1
          AND count(*) FILTER (WHERE hmac_key_version = 2) = 1
        )::integer
        FROM account_identity_keys
        WHERE account_id = (
          SELECT account_id
          FROM account_identity_keys
          WHERE hmac_key_version = 1
            AND identity_hmac = decode(repeat('77', 32), 'hex')
        );
      `,
    }),
  );
  compose(
    postgresPsqlArguments({
      ...personalConnection,
      command: `
        SELECT * FROM resolve_personal_account(
          decode(repeat('55', 32), 'hex'), 2::smallint,
          decode(repeat('22', 32), 'hex'), 1::smallint
        );
      `,
    }),
  );
  composeMustFail(
    postgresPsqlArguments({
      ...personalConnection,
      command: `
        SELECT * FROM resolve_personal_account(
          decode(repeat('55', 32), 'hex'), 2::smallint,
          decode(repeat('11', 32), 'hex'), 1::smallint
        );
      `,
    }),
    "identity rotation collision across accounts",
    /current and previous identity HMACs map to different accounts/iu,
  );
  compose(
    postgresPsqlArguments({
      ...personalConnection,
      command: `
        SELECT * FROM resolve_personal_account(
          decode(repeat('a6', 32), 'hex'), 2::smallint,
          decode(repeat('a7', 32), 'hex'), 1::smallint
        );
      `,
    }),
  );
  compose(
    postgresPsqlArguments({
      password: smokeEnvironment.POSTGRES_PASSWORD,
      user: smokeEnvironment.POSTGRES_USER,
      command: `
        DELETE FROM account_identity_keys
        WHERE hmac_key_version = 1
          AND identity_hmac = decode(repeat('a7', 32), 'hex');
      `,
    }),
  );
  compose(
    postgresPsqlArguments({
      ...personalConnection,
      command: `
        WITH current_only AS MATERIALIZED (
          SELECT * FROM resolve_personal_account(decode(repeat('a6', 32), 'hex'), 2::smallint)
        ), missing_previous AS MATERIALIZED (
          SELECT * FROM resolve_personal_account(
            decode(repeat('a6', 32), 'hex'), 2::smallint,
            decode(repeat('a7', 32), 'hex'), 1::smallint
          )
        )
        SELECT 1 / (
          current_only.account_id = missing_previous.account_id
          AND current_only.owner_binding = missing_previous.owner_binding
        )::integer
        FROM current_only, missing_previous;
      `,
    }),
  );
  compose(
    postgresPsqlArguments({
      ...personalConnection,
      command: `
        SELECT * FROM resolve_personal_account(
          decode(repeat('a8', 32), 'hex'), 2::smallint,
          decode(repeat('a9', 32), 'hex'), 1::smallint
        );
      `,
    }),
  );
  compose(
    postgresPsqlArguments({
      password: smokeEnvironment.POSTGRES_PASSWORD,
      user: smokeEnvironment.POSTGRES_USER,
      command: `
        UPDATE account_identity_keys
        SET retired_at = clock_timestamp()
        WHERE hmac_key_version = 1
          AND identity_hmac = decode(repeat('a9', 32), 'hex');
      `,
    }),
  );
  compose(
    postgresPsqlArguments({
      ...personalConnection,
      command: `
        WITH current_only AS MATERIALIZED (
          SELECT * FROM resolve_personal_account(decode(repeat('a8', 32), 'hex'), 2::smallint)
        ), retired_previous AS MATERIALIZED (
          SELECT * FROM resolve_personal_account(
            decode(repeat('a8', 32), 'hex'), 2::smallint,
            decode(repeat('a9', 32), 'hex'), 1::smallint
          )
        )
        SELECT 1 / (
          current_only.account_id = retired_previous.account_id
          AND current_only.owner_binding = retired_previous.owner_binding
        )::integer
        FROM current_only, retired_previous;
      `,
    }),
  );
  compose(
    postgresPsqlArguments({
      ...personalConnection,
      command: "SELECT * FROM resolve_personal_account(decode(repeat('aa', 32), 'hex'), 1::smallint);",
    }),
  );
  compose(
    postgresPsqlArguments({
      password: smokeEnvironment.POSTGRES_PASSWORD,
      user: smokeEnvironment.POSTGRES_USER,
      command: `
        UPDATE account_identity_keys
        SET retired_at = clock_timestamp()
        WHERE hmac_key_version = 1
          AND identity_hmac = decode(repeat('aa', 32), 'hex');
      `,
    }),
  );
  composeMustFail(
    postgresPsqlArguments({
      ...personalConnection,
      command: `
        SELECT * FROM resolve_personal_account(
          decode(repeat('ab', 32), 'hex'), 2::smallint,
          decode(repeat('aa', 32), 'hex'), 1::smallint
        );
      `,
    }),
    "identity rotation from a retired previous mapping",
    /previous personal account identity is not active/iu,
  );
  compose(
    postgresPsqlArguments({
      password: smokeEnvironment.POSTGRES_PASSWORD,
      user: smokeEnvironment.POSTGRES_USER,
      command: `
        SELECT 1 / (count(*) = 0)::integer
        FROM account_identity_keys
        WHERE hmac_key_version = 2
          AND identity_hmac = decode(repeat('ab', 32), 'hex');
      `,
    }),
  );
  compose(
    postgresPsqlArguments({
      ...personalConnection,
      command: "SELECT 1 / (count(*) = 0)::integer FROM personal_vaults;",
    }),
  );
  compose(
    postgresPsqlArguments({
      ...personalConnection,
      command: `
        BEGIN;
        SELECT set_config('app.account_id', account_id::text, true)
        FROM resolve_personal_account(decode(repeat('22', 32), 'hex'), 1::smallint);
        SELECT 1 / (count(*) = 0)::integer FROM personal_vaults;
        ROLLBACK;
      `,
    }),
  );
  composeMustFail(
    postgresPsqlArguments({
      ...personalConnection,
      command: `
        BEGIN;
        SELECT set_config('app.account_id', account_id::text, true)
        FROM resolve_personal_account(decode(repeat('22', 32), 'hex'), 1::smallint);
        INSERT INTO personal_vaults (account_id)
        SELECT account_id
        FROM resolve_personal_account(decode(repeat('11', 32), 'hex'), 1::smallint);
      `,
    }),
    "personal API cross-account write through RLS",
    /row-level security|violates row-level security policy/iu,
  );
  for (const forbiddenTable of ["accounts", "account_identity_keys", "audit_events"]) {
    composeMustFail(
      postgresPsqlArguments({
        ...personalConnection,
        command: `SELECT count(*) FROM ${forbiddenTable};`,
      }),
      `personal API direct access to ${forbiddenTable}`,
    );
  }
  composeMustFail(
    postgresPsqlArguments({
      ...personalConnection,
      command: "UPDATE personal_vault_payloads SET content_hash = content_hash;",
    }),
    "personal API mutation of immutable encrypted payloads",
  );
  composeMustFail(
    postgresPsqlArguments({
      ...personalConnection,
      command: "DELETE FROM personal_vaults;",
    }),
    "personal API vault deletion outside a dedicated lifecycle command",
  );
  composeMustFail(
    postgresPsqlArguments({
      ...personalConnection,
      command: "SELECT * FROM resolve_personal_account(decode(repeat('33', 31), 'hex'), 1::smallint);",
    }),
    "personal API malformed identity HMAC",
    /identity HMAC must contain exactly 32 bytes/iu,
  );
  composeMustFail(
    postgresPsqlArguments({
      ...personalConnection,
      command: "CREATE TEMP TABLE forbidden_personal_temp (id integer);",
    }),
    "personal API temporary-table creation",
  );
  composeMustFail(
    postgresPsqlArguments({
      ...personalConnection,
      command: "SET ROLE gopher;",
    }),
    "personal API migration-owner role escalation",
  );

  composeMustFail(
    postgresPsqlArguments({
      ...keycloakConnection,
      command: "SELECT count(*) FROM knowledge_sources;",
    }),
    "Keycloak cross-database access",
  );
  compose(
    postgresPsqlArguments({
      ...keycloakConnection,
      database: smokeEnvironment.KEYCLOAK_DB,
      command:
        "DO $$ BEGIN IF (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'legacy_keycloak_marker') <> current_user THEN RAISE EXCEPTION 'legacy Keycloak object owner was not transferred'; END IF; IF (SELECT marker FROM public.legacy_keycloak_marker WHERE id = 1) <> 'preserve-and-transfer-owner' THEN RAISE EXCEPTION 'legacy Keycloak data was not preserved'; END IF; END $$; DROP TABLE public.legacy_keycloak_marker; CREATE TABLE public.keycloak_owner_smoke (id integer PRIMARY KEY); DROP TABLE public.keycloak_owner_smoke;",
    }),
  );
  compose([
    "exec",
    "--no-TTY",
    "postgres",
    "psql",
    "--username",
    smokeEnvironment.POSTGRES_USER,
    "--dbname",
    smokeEnvironment.POSTGRES_DB,
    "--set",
    "ON_ERROR_STOP=1",
    "--command",
    "DELETE FROM knowledge_ingestion_runs WHERE corpus_version = 'smoke-sync';",
  ]);
  console.log(
    "Database upgrade smoke passed with retained-volume migration, stable owner binding, atomic first-login and rolling-deployment identity-HMAC rotation concurrency, migrated and retired-key handling, conflict rejection, forced tenant RLS, negative cross-account and privilege checks, isolated runtime roles, dedicated Keycloak ownership, PostGIS, pgvector, and migration ledger.",
  );
  completed = true;
} finally {
  if (!completed) {
    compose(["ps", "--all"], true);
    compose(["logs", "--no-color", "postgres-permissions", "postgres", "postgres-migrate"], true);
  }
  compose(["down", "--volumes", "--remove-orphans"], true);
}
