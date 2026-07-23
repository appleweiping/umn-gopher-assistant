import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const compose = readFileSync(resolve(repositoryRoot, "infra/compose/docker-compose.yml"), "utf8");
const environmentExample = readFileSync(resolve(repositoryRoot, "infra/compose/.env.example"), "utf8");

describe("local infrastructure contract", () => {
  it("builds an auditable Postgres 17 image with fixed PostGIS and pgvector sources", () => {
    const dockerfilePath = resolve(repositoryRoot, "infra/compose/postgres/Dockerfile");
    expect(existsSync(dockerfilePath)).toBe(true);
    const dockerfile = existsSync(dockerfilePath) ? readFileSync(dockerfilePath, "utf8") : "";

    expect(dockerfile).toContain(
      "# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e",
    );
    expect(dockerfile).toContain(
      "FROM postgis/postgis:17-3.5-alpine@sha256:bcab61c139a9644dcf0bb00b0cff8ab84e36b3b6f74983cf229ddb4ea0c22897",
    );
    expect(dockerfile).toContain("ARG PGVECTOR_VERSION=0.8.2");
    expect(dockerfile).toContain("69f4019389af05dc1c9548deb8628e62878e6e207c03907f2b8af2016472cdaa");
    expect(dockerfile).toContain("ARG SU_EXEC_VERSION=0.3-r0");
    expect(dockerfile).toContain("cp /sbin/su-exec /usr/local/bin/gosu");
    expect(dockerfile).toContain("gosu postgres id -u | grep -Fx '70'");
    expect(dockerfile).toContain("FROM scratch AS final");
    expect(dockerfile).toContain("COPY --from=runtime / /");
    expect(dockerfile).toContain('ENTRYPOINT ["docker-entrypoint.sh"]');
    expect(dockerfile).toContain('VOLUME ["/var/lib/postgresql/data"]');
    expect(dockerfile).toContain("USER 70:70");
    expect(compose).toMatch(/postgres:\n\s+build:\n\s+context: \.\/postgres/u);
  });

  it("runs ordered migrations on empty and existing volumes and provides a real upgrade smoke", () => {
    expect(compose).toContain(
      "../../packages/db/migrations/0000_foundation.sql:/migrations/0000_foundation.sql:ro",
    );
    expect(compose).toContain("./postgres/migrate.sh:/migrations/migrate.sh:ro");
    expect(compose).toContain(
      "./postgres/bootstrap-runtime-roles.sh:/docker-entrypoint-initdb.d/00-bootstrap-runtime-roles.sh:ro",
    );
    expect(compose).toContain("./postgres/runtime-grants.sql:/migrations/runtime-grants.sql:ro");
    expect(compose).toContain('test "$$(cat /proc/1/comm)" = postgres');
    expect(compose).toContain("condition: service_completed_successfully");
    expect(compose).toContain("postgres-permissions:");
    expect(compose).toContain('user: "0:0"');
    expect(compose).toContain("network_mode: none");
    expect(compose).toContain("chown -R 70:70 /var/lib/postgresql/data");
    const migrationRunnerPath = resolve(repositoryRoot, "infra/compose/postgres/migrate.sh");
    expect(existsSync(migrationRunnerPath)).toBe(true);
    const migrationRunner = existsSync(migrationRunnerPath) ? readFileSync(migrationRunnerPath, "utf8") : "";
    expect(migrationRunner).toContain("platform_schema_migrations");
    expect(migrationRunner).toContain("--single-transaction");
    expect(migrationRunner).toContain("platform_schema_migrations_immutable");
    expect(migrationRunner).toContain("to_regclass('public.audit_events') IS NOT NULL");
    expect(migrationRunner).toContain("to_regclass('public.knowledge_sources') IS NOT NULL");
    expect(migrationRunner).toContain("to_regtype('public.knowledge_source_role') IS NOT NULL");
    expect(migrationRunner).toContain("tgrelid = to_regclass('public.knowledge_citations')");
    expect(migrationRunner).toContain("tgname = 'knowledge_citations_immutable'");
    expect(migrationRunner).toContain("bootstrap-runtime-roles.sh");
    expect(migrationRunner).toContain("runtime-grants.sql");
    const smokePath = resolve(repositoryRoot, "scripts/smoke-foundation-db.mjs");
    expect(existsSync(smokePath)).toBe(true);
    const smoke = existsSync(smokePath) ? readFileSync(smokePath, "utf8") : "";
    expect(smoke).toContain("docker compose");
    expect(smoke).toContain("postgis");
    expect(smoke).toContain("vector");
    expect(smoke).toContain("Legacy Twin Cities");
    expect(smoke).toContain("chown -R 999:999 /var/lib/postgresql/data");
    expect(smoke).toContain('test "$(id -u)" = 70');
    expect(compose).toContain('"${COMPOSE_BIND_ADDRESS:-127.0.0.1}:${POSTGRES_PORT:-5432}:5432"');
    expect(smoke).toContain('POSTGRES_PORT: "0"');
    expect(smoke).toContain("https://evil-umn.edu/path");
    expect(smoke).toContain("https://umnXedu/path");
    expect(smoke).toContain("https://attacker@safe.umn.edu/path");
    expect(smoke).toContain("https://safe.umn.edu/path?redirect=");
    expect(smoke).toContain("https://safe.umn.edu/path#fragment");
    expect(smoke).toContain("https://safe.umn.edu:8443/path");
  });

  it("separates migration, AI reader, AI sync, and Keycloak database authority", () => {
    const bootstrapPath = resolve(repositoryRoot, "infra/compose/postgres/bootstrap-runtime-roles.sh");
    const grantsPath = resolve(repositoryRoot, "infra/compose/postgres/runtime-grants.sql");
    expect(existsSync(bootstrapPath)).toBe(true);
    expect(existsSync(grantsPath)).toBe(true);
    const bootstrap = existsSync(bootstrapPath) ? readFileSync(bootstrapPath, "utf8") : "";
    const grants = existsSync(grantsPath) ? readFileSync(grantsPath, "utf8") : "";

    expect(compose).toContain(
      "AI_KNOWLEDGE_READER_DATABASE_URL:-postgresql://gopher_ai_reader:local-ai-reader-password-only@postgres:5432/gopher",
    );
    expect(compose).toContain(
      "AI_KNOWLEDGE_SYNC_DATABASE_URL:-postgresql://gopher_ai_sync:local-ai-sync-password-only@postgres:5432/gopher",
    );
    expect(compose).toContain("KC_DB_USERNAME: ${KEYCLOAK_DB_USER:-gopher_keycloak}");
    expect(bootstrap).toContain("NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS");
    expect(bootstrap).toContain("FROM pg_auth_members AS membership");
    expect(bootstrap).toContain("REVOKE %I FROM %I");
    expect(bootstrap).toContain("CREATE DATABASE %I OWNER %I");
    expect(bootstrap).toContain('"$POSTGRES_DB"|postgres|template0|template1');
    expect(bootstrap).toContain(
      "KEYCLOAK_DB must be a dedicated non-system database distinct from POSTGRES_DB",
    );
    expect(bootstrap).not.toMatch(/^\s*REASSIGN OWNED/gmu);
    expect(grants).toContain(
      "GRANT SELECT ON TABLE knowledge_sources, knowledge_documents, knowledge_chunks, knowledge_citations, knowledge_ingestion_runs",
    );
    expect(grants).toContain("GRANT INSERT, UPDATE, DELETE ON TABLE knowledge_sources");
    expect(grants).toContain("REVOKE UPDATE ON TABLE knowledge_citations");
    expect(grants).toContain("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    expect(environmentExample).toContain("AI_KNOWLEDGE_READER_DB_USER=gopher_ai_reader");
    expect(environmentExample).toContain("AI_KNOWLEDGE_SYNC_DB_USER=gopher_ai_sync");
    expect(environmentExample).toContain("KEYCLOAK_DB_USER=gopher_keycloak");
  });

  it("binds every published development port to loopback unless explicitly overridden", () => {
    const portMappings = [...compose.matchAll(/^\s+- "([^"\n]*:\d[^"\n]*)"$/gmu)].map(
      (match) => match[1] ?? "",
    );
    expect(portMappings.length).toBeGreaterThan(0);
    expect(portMappings.every((mapping) => mapping.startsWith("${COMPOSE_BIND_ADDRESS:-127.0.0.1}:"))).toBe(
      true,
    );
    expect(environmentExample).toContain("COMPOSE_BIND_ADDRESS=127.0.0.1");
  });

  it("documents the migration-owner DATABASE_URL used only by local database tooling", () => {
    expect(environmentExample).toContain(
      "DATABASE_URL=postgres://gopher:local-postgres-password-only@127.0.0.1:5432/gopher",
    );
  });
});
