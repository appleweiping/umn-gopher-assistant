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
      "FROM postgis/postgis:17-3.5@sha256:4e8c30197f7ce4190cf11a1b8c44bea35a58507558cffa48570814beba77b099",
    );
    expect(dockerfile).toContain("ARG PGVECTOR_VERSION=0.8.2");
    expect(dockerfile).toContain("69f4019389af05dc1c9548deb8628e62878e6e207c03907f2b8af2016472cdaa");
    expect(compose).toMatch(/postgres:\n\s+build:\n\s+context: \.\/postgres/u);
  });

  it("initializes the foundation migration and provides a real container smoke command", () => {
    expect(compose).toContain(
      "../../packages/db/migrations/0000_foundation.sql:/docker-entrypoint-initdb.d/10-foundation.sql:ro",
    );
    expect(compose).toContain("FROM pg_extension");
    const smokePath = resolve(repositoryRoot, "scripts/smoke-foundation-db.mjs");
    expect(existsSync(smokePath)).toBe(true);
    const smoke = existsSync(smokePath) ? readFileSync(smokePath, "utf8") : "";
    expect(smoke).toContain("docker compose");
    expect(smoke).toContain("postgis");
    expect(smoke).toContain("vector");
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

  it("documents a DATABASE_URL that matches the Compose default", () => {
    expect(environmentExample).toContain(
      "DATABASE_URL=postgres://gopher:local-postgres-password-only@127.0.0.1:5432/gopher",
    );
  });
});
