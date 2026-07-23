import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getTableName } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  knowledgeChunks,
  knowledgeCitations,
  knowledgeDocuments,
  knowledgeIngestionRuns,
  knowledgeSources,
} from "../src/schema.js";

const migration = readFileSync(resolve(import.meta.dirname, "../migrations/0001_ai_knowledge.sql"), "utf8");
const snapshot = readFileSync(resolve(import.meta.dirname, "../migrations/meta/0001_snapshot.json"), "utf8");
const schemaSource = readFileSync(resolve(import.meta.dirname, "../src/schema.ts"), "utf8");

function checkNames(table: PgTable): readonly string[] {
  return getTableConfig(table)
    .checks.map((constraint) => constraint.name)
    .sort();
}

function indexByName(table: PgTable, name: string) {
  return getTableConfig(table).indexes.find((candidate) => candidate.config.name === name);
}

function foreignKeyNames(table: PgTable): readonly string[] {
  return getTableConfig(table)
    .foreignKeys.map((constraint) => constraint.getName())
    .sort();
}

describe("AI knowledge database schema", () => {
  it("owns separate source-governance and evidence lifecycle tables", () => {
    expect(
      [knowledgeSources, knowledgeDocuments, knowledgeChunks, knowledgeCitations, knowledgeIngestionRuns].map(
        getTableName,
      ),
    ).toEqual([
      "knowledge_sources",
      "knowledge_documents",
      "knowledge_chunks",
      "knowledge_citations",
      "knowledge_ingestion_runs",
    ]);
    expect(migration).not.toContain("REFERENCES source_snapshots");
    expect(migration).toContain("separate governed summary and official verification identities");
  });

  it.each([
    [
      knowledgeSources,
      [
        "knowledge_sources_governance_check",
        "knowledge_sources_identity_check",
        "knowledge_sources_url_check",
      ],
    ],
    [
      knowledgeDocuments,
      [
        "knowledge_documents_hash_check",
        "knowledge_documents_conflict_metadata_check",
        "knowledge_documents_nonempty_check",
        "knowledge_documents_retrieval_metadata_check",
        "knowledge_documents_retirement_check",
      ],
    ],
    [
      knowledgeChunks,
      ["knowledge_chunks_content_check", "knowledge_chunks_hash_check", "knowledge_chunks_ordinal_check"],
    ],
    [knowledgeCitations, ["knowledge_citations_hash_check", "knowledge_citations_nonempty_check"]],
    [
      knowledgeIngestionRuns,
      [
        "knowledge_ingestion_runs_counts_check",
        "knowledge_ingestion_runs_lifecycle_check",
        "knowledge_ingestion_runs_projection_check",
        "knowledge_ingestion_runs_version_check",
      ],
    ],
  ] as const)("aligns %s checks with the migration", (table, expected) => {
    expect(checkNames(table)).toEqual([...expected].sort());
    for (const name of expected) expect(migration).toContain(`CONSTRAINT "${name}" CHECK`);
  });

  it("provides lexical and vector retrieval indexes plus cascade deletion propagation", () => {
    expect(indexByName(knowledgeChunks, "knowledge_chunks_search_gin_idx")?.config.method).toBe("gin");
    expect(indexByName(knowledgeChunks, "knowledge_chunks_embedding_hnsw_idx")?.config.method).toBe("hnsw");
    expect(migration).toContain('"search_vector" "tsvector" GENERATED ALWAYS AS');
    expect(migration).toContain('"embedding" vector(384),');
    expect(migration).toContain('WHERE "knowledge_chunks"."embedding" IS NOT NULL');
    expect(migration).toContain('REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade');
    expect(migration).toContain(
      'FOREIGN KEY ("chunk_id","document_id") REFERENCES "public"."knowledge_chunks"("id","document_id") ON DELETE cascade',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("summary_source_id") REFERENCES "public"."knowledge_sources"("external_id") ON DELETE restrict',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("verification_source_id") REFERENCES "public"."knowledge_sources"("external_id") ON DELETE restrict',
    );
    expect(migration.indexOf('CREATE UNIQUE INDEX "knowledge_chunks_id_document_uidx"')).toBeLessThan(
      migration.indexOf('ADD CONSTRAINT "knowledge_citations_chunk_document_fk"'),
    );
  });

  it("uses explicit PostgreSQL-safe names for document source foreign keys", () => {
    expect(foreignKeyNames(knowledgeDocuments)).toEqual([
      "knowledge_documents_campus_id_campuses_id_fk",
      "knowledge_documents_summary_source_fk",
      "knowledge_documents_verification_source_fk",
    ]);
    expect(migration).toContain('ADD CONSTRAINT "knowledge_documents_summary_source_fk"');
    expect(migration).toContain('ADD CONSTRAINT "knowledge_documents_verification_source_fk"');
  });

  it("seeds all five canonical campuses and makes citation projections immutable", () => {
    for (const campusId of ["tc", "duluth", "crookston", "morris", "rochester"]) {
      expect(migration).toContain(`('${campusId}',`);
    }
    expect(migration).toContain('ON CONFLICT ("id") DO NOTHING');
    expect(migration).toContain('CREATE TRIGGER "knowledge_citations_immutable"');
    expect(migration).toContain('BEFORE UPDATE ON "knowledge_citations"');
  });

  it("uses an exact UMN authority boundary instead of an escape-sensitive hostname regex", () => {
    for (const representation of [schemaSource, migration, snapshot]) {
      expect(representation).toContain("substring(");
      expect(representation).toContain("from 9)");
      expect(representation).toContain("right(");
      expect(representation).toContain("'.umn.edu'");
      expect(representation).toContain("|| ':443'");
      expect(representation).toContain("'[[:space:]@?#]'");
      expect(representation).not.toContain("([a-z0-9-]+.)*umn.edu");
    }
  });

  it("persists a complete projection digest only for successful ingestion runs", () => {
    for (const column of [
      "projection_sha256",
      "projection_sources",
      "projection_documents",
      "projection_chunks",
      "projection_citations",
    ]) {
      expect(migration).toContain(`"${column}"`);
      expect(snapshot).toContain(`"${column}"`);
    }
    expect(migration).toContain("\"status\" = 'succeeded'");
    expect(migration).toContain("\"projection_sha256\" ~ '^[a-f0-9]{64}$'");
    expect(migration).toContain("\"status\" IN ('running', 'failed')");
  });
});
