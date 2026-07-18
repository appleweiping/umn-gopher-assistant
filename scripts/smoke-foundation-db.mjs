#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = resolve(repositoryRoot, "infra/compose/docker-compose.yml");
const projectName = `gopher-db-smoke-${String(process.pid)}`;
const smokeEnvironment = {
  ...process.env,
  COMPOSE_BIND_ADDRESS: "127.0.0.1",
  COMPOSE_PROJECT_NAME: projectName,
  POSTGRES_DB: "gopher",
  POSTGRES_PASSWORD: "local-postgres-password-only",
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
}

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
END
$$;
`;

try {
  compose(["up", "--build", "--wait", "postgres"]);
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
  console.log("Foundation database smoke test passed with PostGIS and pgvector.");
} finally {
  compose(["down", "--volumes", "--remove-orphans"], true);
}
