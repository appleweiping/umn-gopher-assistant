#!/usr/bin/env node

import { spawnSync } from "node:child_process";
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
  IF (SELECT count(*) FROM platform_schema_migrations) <> 2 THEN
    RAISE EXCEPTION 'migration ledger does not contain exactly two migrations';
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
    WHERE rolname IN ('gopher_ai_reader', 'gopher_ai_sync', 'gopher_keycloak')
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'a runtime database role has elevated role attributes';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_auth_members AS membership
    JOIN pg_roles AS member ON member.oid = membership.member
    WHERE member.rolname IN ('gopher_ai_reader', 'gopher_ai_sync', 'gopher_keycloak')
  ) THEN
    RAISE EXCEPTION 'a runtime database role retained an unsafe role membership';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_roles
    WHERE rolname IN ('gopher_ai_reader', 'gopher_ai_sync', 'gopher_keycloak')
      AND rolcanlogin
  ) <> 3 THEN
    RAISE EXCEPTION 'dedicated runtime database roles are missing';
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
    "ALTER ROLE gopher_ai_reader BYPASSRLS; ALTER ROLE gopher_ai_sync BYPASSRLS; ALTER ROLE gopher_keycloak BYPASSRLS; GRANT gopher TO gopher_ai_reader; GRANT pg_read_all_data TO gopher_ai_sync; GRANT pg_write_all_data TO gopher_keycloak;",
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
    "Database upgrade smoke passed with legacy UID normalization, preserved platform and Keycloak data, exact UMN URL governance, projection integrity, isolated runtime roles, dedicated Keycloak ownership, PostGIS, pgvector, and migration ledger.",
  );
  completed = true;
} finally {
  if (!completed) {
    compose(["ps", "--all"], true);
    compose(["logs", "--no-color", "postgres-permissions", "postgres", "postgres-migrate"], true);
  }
  compose(["down", "--volumes", "--remove-orphans"], true);
}
