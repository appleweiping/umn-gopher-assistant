import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getTableName } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  auditEvents,
  campuses,
  outboxEvents,
  sourceSnapshots,
  sources,
  worldManifests,
} from "../src/schema.js";

const migration = readFileSync(resolve(import.meta.dirname, "../migrations/0000_foundation.sql"), "utf8");

function checkNames(table: PgTable): readonly string[] {
  return getTableConfig(table)
    .checks.map((constraint) => constraint.name)
    .sort();
}

function indexByName(table: PgTable, name: string) {
  return getTableConfig(table).indexes.find((candidate) => candidate.config.name === name);
}

function indexColumnNames(table: PgTable, name: string): readonly (string | null)[] {
  return (
    indexByName(table, name)?.config.columns.map((column) =>
      "name" in column ? (column.name ?? null) : null,
    ) ?? []
  );
}

describe("foundation database schema", () => {
  it("exposes the service-owned foundation tables", () => {
    expect(
      [campuses, sources, sourceSnapshots, outboxEvents, worldManifests, auditEvents].map(getTableName),
    ).toEqual([
      "campuses",
      "sources",
      "source_snapshots",
      "outbox_events",
      "world_manifests",
      "audit_events",
    ]);
  });

  it.each([
    [
      campuses,
      ["campuses_academic_mapping_check", "campuses_nonempty_check", "campuses_source_url_https_check"],
    ],
    [
      sources,
      [
        "prohibited_source_access_check",
        "sources_campus_ids_nonempty_check",
        "sources_nonempty_check",
        "sources_source_url_https_check",
      ],
    ],
    [
      sourceSnapshots,
      ["source_snapshots_content_hash_check", "source_snapshots_parse_version_nonempty_check"],
    ],
    [outboxEvents, ["outbox_events_attempts_check", "outbox_events_nonempty_check"]],
    [
      worldManifests,
      [
        "world_manifests_nonempty_check",
        "world_manifests_revision_check",
        "world_manifests_source_ids_nonempty_check",
      ],
    ],
    [auditEvents, ["audit_events_nonempty_check", "audit_events_outcome_check"]],
  ] as const)("keeps %s checks aligned with the migration", (table, expectedChecks) => {
    expect(checkNames(table)).toEqual([...expectedChecks].sort());
    for (const checkName of expectedChecks) {
      expect(migration).toContain(`CONSTRAINT ${checkName} CHECK`);
    }
  });

  it("matches snapshot ordering and the partial HNSW index", () => {
    const captured = indexByName(sourceSnapshots, "source_snapshots_source_captured_idx");
    expect(indexColumnNames(sourceSnapshots, "source_snapshots_source_captured_idx")).toEqual([
      "source_id",
      "captured_at",
    ]);
    expect(
      (captured?.config.columns[1] as { readonly indexConfig?: { readonly order?: string } } | undefined)
        ?.indexConfig?.order,
    ).toBe("desc");

    const embedding = indexByName(sourceSnapshots, "source_snapshots_embedding_hnsw_idx");
    expect(embedding?.config.method).toBe("hnsw");
    expect(
      (embedding?.config.columns[0] as { readonly indexConfig?: { readonly opClass?: string } } | undefined)
        ?.indexConfig?.opClass,
    ).toBe("vector_cosine_ops");
    expect(embedding?.config.where).toBeDefined();
    expect(migration).toContain(
      "CREATE INDEX source_snapshots_embedding_hnsw_idx ON source_snapshots USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL;",
    );
  });

  it("matches partial outbox and descending audit indexes", () => {
    const unpublished = indexByName(outboxEvents, "outbox_events_unpublished_idx");
    expect(indexColumnNames(outboxEvents, "outbox_events_unpublished_idx")).toEqual(["available_at"]);
    expect(unpublished?.config.where).toBeDefined();
    expect(migration).toContain(
      "CREATE INDEX outbox_events_unpublished_idx ON outbox_events (available_at) WHERE published_at IS NULL;",
    );

    const audit = indexByName(auditEvents, "audit_events_target_occurred_idx");
    expect(indexColumnNames(auditEvents, "audit_events_target_occurred_idx")).toEqual([
      "action",
      "occurred_at",
    ]);
    expect(
      (audit?.config.columns[1] as { readonly indexConfig?: { readonly order?: string } } | undefined)
        ?.indexConfig?.order,
    ).toBe("desc");
  });

  it("keeps geometry, unique indexes, and foreign keys identical to Drizzle DDL", () => {
    expect(campuses.centroid.getSQLType()).toBe("geometry(Point,4326)");
    expect(campuses.centroid.mapToDriverValue({ x: -93.2277, y: 44.974 })).toBe(
      "SRID=4326;POINT(-93.2277 44.974)",
    );
    for (const indexName of [
      "sources_external_id_uidx",
      "source_snapshots_source_hash_uidx",
      "world_manifests_campus_version_revision_uidx",
    ]) {
      expect(migration).toContain(`CREATE UNIQUE INDEX ${indexName}`);
      expect(migration).not.toContain(`CONSTRAINT ${indexName} UNIQUE`);
    }
    expect(migration).toContain(
      "CONSTRAINT source_snapshots_source_id_sources_id_fk FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE ON UPDATE NO ACTION",
    );
    expect(migration).toContain(
      "CONSTRAINT world_manifests_campus_id_campuses_id_fk FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE RESTRICT ON UPDATE NO ACTION",
    );
  });
});
