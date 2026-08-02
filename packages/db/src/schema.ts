import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  type PgTableExtraConfigValue,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { parseEWKB } from "drizzle-orm/pg-core/columns/postgis_extension/utils";

const geometryPoint4326 = customType<{
  data: { x: number; y: number };
  driverData: string;
}>({
  dataType: () => "geometry(Point,4326)",
  fromDriver: (value) => {
    const [x, y] = parseEWKB(value);
    return { x, y };
  },
  toDriver: ({ x, y }) => `SRID=4326;POINT(${String(x)} ${String(y)})`,
});

const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});

export const campusIdEnum = pgEnum("campus_id", ["tc", "duluth", "crookston", "morris", "rochester"]);
export const academicInstitutionCodeEnum = pgEnum("academic_institution_code", [
  "UMNTC",
  "UMNDL",
  "UMNCR",
  "UMNMO",
]);
export const licenseStatusEnum = pgEnum("license_status", [
  "OPEN_REUSE",
  "LIVE_ONLY",
  "DEEPLINK_ONLY",
  "APPROVAL_REQUIRED",
  "PROHIBITED",
]);
export const freshnessStateEnum = pgEnum("freshness_state", ["FRESH", "STALE", "EXPIRED", "UNKNOWN"]);
export const verificationStateEnum = pgEnum("verification_state", [
  "schematic",
  "surveyed",
  "campus-reviewed",
  "verified",
  "retired",
]);
export const officialStatusEnum = pgEnum("official_status", [
  "UNVERIFIED",
  "PUBLISHER_ASSERTED",
  "PARTNERSHIP_VERIFIED",
]);
export const cachePolicyEnum = pgEnum("cache_policy", [
  "CACHE_ALLOWED",
  "METADATA_ONLY",
  "NO_CONTENT_CACHE",
  "NO_ACCESS",
]);
export const aiLocaleEnum = pgEnum("ai_locale", ["en", "zh-CN"]);
export const knowledgeCategoryEnum = pgEnum("knowledge_category", [
  "library",
  "student-services",
  "safety",
  "transportation",
  "dining",
]);
export const knowledgeIngestionStatusEnum = pgEnum("knowledge_ingestion_status", [
  "running",
  "succeeded",
  "failed",
]);
export const knowledgeSourceRoleEnum = pgEnum("knowledge_source_role", [
  "PROJECT_SUMMARY",
  "OFFICIAL_VERIFICATION",
]);
export const accountStatusEnum = pgEnum("account_status", ["active", "suspended", "deleted"]);
export const personalVaultDeviceStatusEnum = pgEnum("personal_vault_device_status", ["active", "revoked"]);
export const personalVaultPairingStateEnum = pgEnum("personal_vault_pairing_state", [
  "pending",
  "approved",
  "consumed",
  "expired",
  "cancelled",
]);
export const personalVaultCommandStatusEnum = pgEnum("personal_vault_command_status", [
  "pending",
  "succeeded",
  "failed",
]);
export const personalVaultCommandActorKindEnum = pgEnum("personal_vault_command_actor_kind", [
  "account",
  "device",
  "recovery",
]);

export const campuses = pgTable(
  "campuses",
  {
    id: campusIdEnum("id").primaryKey(),
    nameEn: text("name_en").notNull(),
    nameZhCn: text("name_zh_cn").notNull(),
    cityEn: text("city_en").notNull(),
    cityZhCn: text("city_zh_cn").notNull(),
    timeZone: text("time_zone").notNull(),
    academicInstitutionCode: academicInstitutionCodeEnum("academic_institution_code").notNull(),
    academicCalendarCampusId: campusIdEnum("academic_calendar_campus_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    officialStatus: officialStatusEnum("official_status").notNull().default("UNVERIFIED"),
    centroid: geometryPoint4326("centroid"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "campuses_nonempty_check",
      sql`char_length(btrim(${table.nameEn})) > 0 AND char_length(btrim(${table.nameZhCn})) > 0 AND char_length(btrim(${table.cityEn})) > 0 AND char_length(btrim(${table.cityZhCn})) > 0 AND char_length(btrim(${table.timeZone})) > 0`,
    ),
    check("campuses_source_url_https_check", sql`${table.sourceUrl} LIKE 'https://%'`),
    check(
      "campuses_academic_mapping_check",
      sql`(${table.id} = 'tc' AND ${table.academicInstitutionCode} = 'UMNTC' AND ${table.academicCalendarCampusId} = 'tc') OR (${table.id} = 'duluth' AND ${table.academicInstitutionCode} = 'UMNDL' AND ${table.academicCalendarCampusId} = 'duluth') OR (${table.id} = 'crookston' AND ${table.academicInstitutionCode} = 'UMNCR' AND ${table.academicCalendarCampusId} = 'crookston') OR (${table.id} = 'morris' AND ${table.academicInstitutionCode} = 'UMNMO' AND ${table.academicCalendarCampusId} = 'morris') OR (${table.id} = 'rochester' AND ${table.academicInstitutionCode} = 'UMNTC' AND ${table.academicCalendarCampusId} = 'tc')`,
    ),
  ],
);

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalId: text("external_id").notNull(),
    campusIds: campusIdEnum("campus_ids").array().notNull(),
    nameEn: text("name_en").notNull(),
    nameZhCn: text("name_zh_cn").notNull(),
    publisher: text("publisher").notNull(),
    sourceUrl: text("source_url").notNull(),
    licenseStatus: licenseStatusEnum("license_status").notNull(),
    freshnessState: freshnessStateEnum("freshness_state").notNull().default("UNKNOWN"),
    verificationState: verificationStateEnum("verification_state").notNull().default("surveyed"),
    officialStatus: officialStatusEnum("official_status").notNull().default("UNVERIFIED"),
    attribution: text("attribution").notNull(),
    cachePolicy: cachePolicyEnum("cache_policy").notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sources_external_id_uidx").on(table.externalId),
    check(
      "sources_nonempty_check",
      sql`char_length(btrim(${table.externalId})) > 0 AND char_length(btrim(${table.nameEn})) > 0 AND char_length(btrim(${table.nameZhCn})) > 0 AND char_length(btrim(${table.publisher})) > 0 AND char_length(btrim(${table.attribution})) > 0`,
    ),
    check("sources_campus_ids_nonempty_check", sql`cardinality(${table.campusIds}) > 0`),
    check("sources_source_url_https_check", sql`${table.sourceUrl} LIKE 'https://%'`),
    check(
      "prohibited_source_access_check",
      sql`${table.licenseStatus} <> 'PROHIBITED' OR ${table.cachePolicy} = 'NO_ACCESS'`,
    ),
  ],
);

export const sourceSnapshots = pgTable(
  "source_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    contentHash: text("content_hash").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    normalizedPayload: jsonb("normalized_payload").$type<Record<string, unknown>>().notNull(),
    rawObjectKey: text("raw_object_key"),
    parseVersion: text("parse_version").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("source_snapshots_source_hash_uidx").on(table.sourceId, table.contentHash),
    index("source_snapshots_source_captured_idx").on(table.sourceId, table.capturedAt.desc()),
    index("source_snapshots_embedding_hnsw_idx")
      .using("hnsw", table.embedding.op("vector_cosine_ops"))
      .where(sql`${table.embedding} IS NOT NULL`),
    check("source_snapshots_content_hash_check", sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
    check(
      "source_snapshots_parse_version_nonempty_check",
      sql`char_length(btrim(${table.parseVersion})) > 0`,
    ),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (table) => [
    index("outbox_events_unpublished_idx")
      .on(table.availableAt)
      .where(sql`${table.publishedAt} IS NULL`),
    check("outbox_events_attempts_check", sql`${table.attempts} >= 0`),
    check(
      "outbox_events_nonempty_check",
      sql`char_length(btrim(${table.aggregateType})) > 0 AND char_length(btrim(${table.aggregateId})) > 0 AND char_length(btrim(${table.eventType})) > 0`,
    ),
  ],
);

export const worldManifests = pgTable(
  "world_manifests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campusId: campusIdEnum("campus_id")
      .notNull()
      .references(() => campuses.id, { onDelete: "restrict" }),
    worldVersion: text("world_version").notNull(),
    revision: integer("revision").notNull(),
    verificationState: verificationStateEnum("verification_state").notNull(),
    etag: text("etag").notNull(),
    sourceIds: jsonb("source_ids").$type<string[]>().notNull(),
    manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("world_manifests_campus_version_revision_uidx").on(
      table.campusId,
      table.worldVersion,
      table.revision,
    ),
    check("world_manifests_revision_check", sql`${table.revision} > 0`),
    check(
      "world_manifests_nonempty_check",
      sql`char_length(btrim(${table.worldVersion})) > 0 AND char_length(btrim(${table.etag})) > 0`,
    ),
    check(
      "world_manifests_source_ids_nonempty_check",
      sql`jsonb_typeof(${table.sourceIds}) = 'array' AND jsonb_array_length(${table.sourceIds}) > 0`,
    ),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    actor: jsonb("actor").$type<{ type: string; id: string }>().notNull(),
    action: text("action").notNull(),
    target: jsonb("target").$type<{ type: string; id: string }>().notNull(),
    outcome: text("outcome").notNull(),
    traceId: text("trace_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_events_target_occurred_idx").on(table.action, table.occurredAt.desc()),
    check(
      "audit_events_nonempty_check",
      sql`char_length(btrim(${table.action})) > 0 AND char_length(btrim(${table.traceId})) > 0`,
    ),
    check("audit_events_outcome_check", sql`${table.outcome} IN ('SUCCESS', 'DENIED', 'FAILURE')`),
  ],
);

export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    externalId: text("external_id").primaryKey(),
    campusIds: campusIdEnum("campus_ids").array().notNull(),
    role: knowledgeSourceRoleEnum("role").notNull(),
    sourceUrl: text("source_url").notNull(),
    licenseStatus: licenseStatusEnum("license_status").notNull(),
    licenseEvidenceUrl: text("license_evidence_url"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "knowledge_sources_identity_check",
      sql`${table.externalId} ~ '^[a-z0-9][a-z0-9-]{2,127}$' AND cardinality(${table.campusIds}) BETWEEN 1 AND 5`,
    ),
    check("knowledge_sources_url_check", sql`${table.sourceUrl} LIKE 'https://%'`),
    check(
      "knowledge_sources_governance_check",
      sql`(${table.role} = 'PROJECT_SUMMARY' AND cardinality(${table.campusIds}) = 5 AND ${table.sourceUrl} = 'https://github.com/appleweiping/umn-gopher-assistant/blob/main/apps/ai-knowledge/ai_knowledge/data/corpus.json' AND ${table.licenseStatus} = 'OPEN_REUSE' AND ${table.licenseEvidenceUrl} = 'https://www.apache.org/licenses/LICENSE-2.0') OR (${table.role} = 'OFFICIAL_VERIFICATION' AND cardinality(${table.campusIds}) = 1 AND ${table.sourceUrl} = lower(btrim(${table.sourceUrl})) AND ${table.sourceUrl} !~ '[[:space:]@?#]' AND ${table.sourceUrl} LIKE 'https://%/%' AND char_length(split_part(split_part(substring(${table.sourceUrl} from 9), '/', 1), ':', 1)) BETWEEN 1 AND 253 AND translate(split_part(split_part(substring(${table.sourceUrl} from 9), '/', 1), ':', 1), 'abcdefghijklmnopqrstuvwxyz0123456789-.', '') = '' AND split_part(split_part(substring(${table.sourceUrl} from 9), '/', 1), ':', 1) NOT LIKE '.%' AND split_part(split_part(substring(${table.sourceUrl} from 9), '/', 1), ':', 1) NOT LIKE '-%' AND split_part(split_part(substring(${table.sourceUrl} from 9), '/', 1), ':', 1) NOT LIKE '%..%' AND split_part(split_part(substring(${table.sourceUrl} from 9), '/', 1), ':', 1) NOT LIKE '%.-%' AND split_part(split_part(substring(${table.sourceUrl} from 9), '/', 1), ':', 1) NOT LIKE '%-.%' AND (split_part(split_part(substring(${table.sourceUrl} from 9), '/', 1), ':', 1) = 'umn.edu' OR right(split_part(split_part(substring(${table.sourceUrl} from 9), '/', 1), ':', 1), 8) = '.umn.edu') AND (split_part(substring(${table.sourceUrl} from 9), '/', 1) = split_part(split_part(substring(${table.sourceUrl} from 9), '/', 1), ':', 1) OR split_part(substring(${table.sourceUrl} from 9), '/', 1) = split_part(split_part(substring(${table.sourceUrl} from 9), '/', 1), ':', 1) || ':443') AND ${table.licenseStatus} = 'DEEPLINK_ONLY' AND ${table.licenseEvidenceUrl} IS NULL)`,
    ),
  ],
);

export const knowledgeDocuments = pgTable(
  "knowledge_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalId: text("external_id").notNull(),
    summarySourceId: text("summary_source_id").notNull(),
    verificationSourceId: text("verification_source_id").notNull(),
    campusId: campusIdEnum("campus_id")
      .notNull()
      .references(() => campuses.id, { onDelete: "restrict" }),
    category: knowledgeCategoryEnum("category").notNull(),
    titleEn: text("title_en").notNull(),
    titleZhCn: text("title_zh_cn").notNull(),
    bodyEn: text("body_en").notNull(),
    bodyZhCn: text("body_zh_cn").notNull(),
    keywordsEn: text("keywords_en").array().notNull(),
    keywordsZhCn: text("keywords_zh_cn").array().notNull(),
    contentHash: text("content_hash").notNull(),
    freshForDays: integer("fresh_for_days").notNull(),
    freshnessState: freshnessStateEnum("freshness_state").notNull(),
    verificationState: verificationStateEnum("verification_state").notNull().default("schematic"),
    conflictGroup: text("conflict_group"),
    conflictVariant: text("conflict_variant"),
    enabled: boolean("enabled").notNull().default(true),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("knowledge_documents_external_id_uidx").on(table.externalId),
    index("knowledge_documents_campus_category_idx").on(table.campusId, table.category),
    index("knowledge_documents_summary_source_idx").on(table.summarySourceId),
    index("knowledge_documents_verification_source_idx").on(table.verificationSourceId),
    foreignKey({
      name: "knowledge_documents_summary_source_fk",
      columns: [table.summarySourceId],
      foreignColumns: [knowledgeSources.externalId],
    }).onDelete("restrict"),
    foreignKey({
      name: "knowledge_documents_verification_source_fk",
      columns: [table.verificationSourceId],
      foreignColumns: [knowledgeSources.externalId],
    }).onDelete("restrict"),
    check(
      "knowledge_documents_nonempty_check",
      sql`char_length(btrim(${table.externalId})) > 0 AND ${table.summarySourceId} ~ '^[a-z0-9][a-z0-9-]{2,127}$' AND ${table.verificationSourceId} ~ '^[a-z0-9][a-z0-9-]{2,127}$' AND ${table.summarySourceId} <> ${table.verificationSourceId} AND char_length(btrim(${table.titleEn})) > 0 AND char_length(btrim(${table.titleZhCn})) > 0 AND char_length(btrim(${table.bodyEn})) > 0 AND char_length(btrim(${table.bodyZhCn})) > 0`,
    ),
    check("knowledge_documents_hash_check", sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
    check(
      "knowledge_documents_retrieval_metadata_check",
      sql`cardinality(${table.keywordsEn}) BETWEEN 1 AND 24 AND cardinality(${table.keywordsZhCn}) BETWEEN 1 AND 24 AND ${table.freshForDays} BETWEEN 1 AND 3650`,
    ),
    check(
      "knowledge_documents_conflict_metadata_check",
      sql`(${table.conflictGroup} IS NULL AND ${table.conflictVariant} IS NULL) OR (${table.conflictGroup} ~ '^[a-z0-9][a-z0-9-]{2,127}$' AND ${table.conflictVariant} ~ '^[a-z0-9][a-z0-9-]{2,127}$')`,
    ),
    check(
      "knowledge_documents_retirement_check",
      sql`(${table.enabled} AND ${table.retiredAt} IS NULL AND ${table.verificationState} <> 'retired') OR (NOT ${table.enabled} AND ${table.retiredAt} IS NOT NULL AND ${table.verificationState} = 'retired')`,
    ),
  ],
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    locale: aiLocaleEnum("locale").notNull(),
    ordinal: smallint("ordinal").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    tokenCount: integer("token_count").notNull(),
    searchVector: tsvector("search_vector")
      .notNull()
      .generatedAlwaysAs(sql`to_tsvector('simple', "content")`),
    embedding: vector("embedding", { dimensions: 384 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("knowledge_chunks_document_locale_ordinal_uidx").on(
      table.documentId,
      table.locale,
      table.ordinal,
    ),
    uniqueIndex("knowledge_chunks_id_document_uidx").on(table.id, table.documentId),
    index("knowledge_chunks_search_gin_idx").using("gin", table.searchVector),
    index("knowledge_chunks_embedding_hnsw_idx")
      .using("hnsw", table.embedding.op("vector_cosine_ops"))
      .where(sql`${table.embedding} IS NOT NULL`),
    check("knowledge_chunks_ordinal_check", sql`${table.ordinal} >= 0`),
    check(
      "knowledge_chunks_content_check",
      sql`char_length(btrim(${table.content})) > 0 AND ${table.tokenCount} > 0 AND ${table.tokenCount} <= 4096`,
    ),
    check("knowledge_chunks_hash_check", sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const knowledgeCitations = pgTable(
  "knowledge_citations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    citationKey: text("citation_key").notNull(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id").notNull(),
    excerpt: text("excerpt").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("knowledge_citations_key_uidx").on(table.citationKey),
    uniqueIndex("knowledge_citations_document_chunk_uidx").on(table.documentId, table.chunkId),
    foreignKey({
      name: "knowledge_citations_chunk_document_fk",
      columns: [table.chunkId, table.documentId],
      foreignColumns: [knowledgeChunks.id, knowledgeChunks.documentId],
    }).onDelete("cascade"),
    check(
      "knowledge_citations_nonempty_check",
      sql`char_length(btrim(${table.citationKey})) > 0 AND char_length(btrim(${table.excerpt})) > 0`,
    ),
    check("knowledge_citations_hash_check", sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const knowledgeIngestionRuns = pgTable(
  "knowledge_ingestion_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    corpusVersion: text("corpus_version").notNull(),
    status: knowledgeIngestionStatusEnum("status").notNull(),
    documentsSeen: integer("documents_seen").notNull().default(0),
    documentsIndexed: integer("documents_indexed").notNull().default(0),
    documentsRetired: integer("documents_retired").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorSummary: text("error_summary"),
    projectionSha256: text("projection_sha256"),
    projectionSources: integer("projection_sources"),
    projectionDocuments: integer("projection_documents"),
    projectionChunks: integer("projection_chunks"),
    projectionCitations: integer("projection_citations"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("knowledge_ingestion_runs_started_idx").on(table.startedAt.desc()),
    check(
      "knowledge_ingestion_runs_counts_check",
      sql`${table.documentsSeen} >= 0 AND ${table.documentsIndexed} >= 0 AND ${table.documentsRetired} >= 0 AND ${table.documentsIndexed} + ${table.documentsRetired} <= ${table.documentsSeen}`,
    ),
    check(
      "knowledge_ingestion_runs_lifecycle_check",
      sql`(${table.status} = 'running' AND ${table.completedAt} IS NULL AND ${table.errorSummary} IS NULL) OR (${table.status} = 'succeeded' AND ${table.completedAt} IS NOT NULL AND ${table.errorSummary} IS NULL) OR (${table.status} = 'failed' AND ${table.completedAt} IS NOT NULL AND char_length(btrim(${table.errorSummary})) > 0)`,
    ),
    check(
      "knowledge_ingestion_runs_projection_check",
      sql`(${table.status} = 'succeeded' AND ${table.projectionSha256} IS NOT NULL AND ${table.projectionSha256} ~ '^[a-f0-9]{64}$' AND ${table.projectionSources} IS NOT NULL AND ${table.projectionSources} >= 0 AND ${table.projectionDocuments} IS NOT NULL AND ${table.projectionDocuments} >= 0 AND ${table.projectionChunks} IS NOT NULL AND ${table.projectionChunks} >= 0 AND ${table.projectionCitations} IS NOT NULL AND ${table.projectionCitations} >= 0) OR (${table.status} IN ('running', 'failed') AND ${table.projectionSha256} IS NULL AND ${table.projectionSources} IS NULL AND ${table.projectionDocuments} IS NULL AND ${table.projectionChunks} IS NULL AND ${table.projectionCitations} IS NULL)`,
    ),
    check("knowledge_ingestion_runs_version_check", sql`char_length(btrim(${table.corpusVersion})) > 0`),
  ],
);

/**
 * Authentication identifiers are never stored in their original form. The
 * identity resolver receives a server-side HMAC and returns only this opaque
 * account id; personal-data services have no direct table privilege.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerBinding: bytea("owner_binding")
      .notNull()
      .default(sql`gen_random_bytes(32)`),
    status: accountStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "accounts_lifecycle_check",
      sql`(${table.status} IN ('active', 'suspended') AND ${table.deletedAt} IS NULL) OR (${table.status} = 'deleted' AND ${table.deletedAt} IS NOT NULL AND ${table.deletedAt} >= ${table.createdAt})`,
    ),
    check("accounts_owner_binding_check", sql`octet_length(${table.ownerBinding}) = 32`),
    uniqueIndex("accounts_id_uidx").on(table.id),
    uniqueIndex("accounts_owner_binding_uidx").on(table.ownerBinding),
  ],
);

export const accountIdentityKeys = pgTable(
  "account_identity_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    identityHmac: bytea("identity_hmac").notNull(),
    hmacKeyVersion: smallint("hmac_key_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("account_identity_keys_hmac_uidx").on(table.hmacKeyVersion, table.identityHmac),
    uniqueIndex("account_identity_keys_account_version_uidx").on(table.accountId, table.hmacKeyVersion),
    check(
      "account_identity_keys_hmac_check",
      sql`octet_length(${table.identityHmac}) = 32 AND ${table.hmacKeyVersion} BETWEEN 1 AND 32767`,
    ),
    check(
      "account_identity_keys_lifecycle_check",
      sql`${table.retiredAt} IS NULL OR ${table.retiredAt} >= ${table.createdAt}`,
    ),
  ],
);

/**
 * Deployment continuity sentinel for the purpose-specific account identity
 * HMAC. Only a domain-separated fingerprint is persisted; runtime roles may
 * verify it through a narrowly granted SECURITY DEFINER function but never
 * read or mutate this registry directly.
 */
export const accountHmacKeyRegistry = pgTable(
  "account_hmac_key_registry",
  {
    hmacKeyVersion: smallint("hmac_key_version").primaryKey(),
    keyFingerprint: bytea("key_fingerprint").notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "account_hmac_key_registry_fingerprint_check",
      sql`${table.hmacKeyVersion} BETWEEN 1 AND 32767 AND octet_length(${table.keyFingerprint}) = 32`,
    ),
    check(
      "account_hmac_key_registry_lifecycle_check",
      sql`${table.retiredAt} IS NULL OR ${table.retiredAt} >= ${table.activatedAt}`,
    ),
  ],
);

export const personalVaults = pgTable(
  "personal_vaults",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    currentRevision: bigint("current_revision", { mode: "number" }).notNull().default(0),
    currentPayloadId: uuid("current_payload_id"),
    currentKeyringId: uuid("current_keyring_id"),
    currentManifestId: uuid("current_manifest_id"),
    headCommitId: uuid("head_commit_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table): PgTableExtraConfigValue[] => [
    uniqueIndex("personal_vaults_id_account_uidx").on(table.id, table.accountId),
    uniqueIndex("personal_vaults_account_uidx").on(table.accountId),
    foreignKey({
      name: "personal_vaults_current_payload_fk",
      columns: [table.currentPayloadId, table.accountId, table.id],
      foreignColumns: [
        personalVaultPayloads.id,
        personalVaultPayloads.accountId,
        personalVaultPayloads.vaultId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "personal_vaults_current_keyring_fk",
      columns: [table.currentKeyringId, table.accountId, table.id],
      foreignColumns: [
        personalVaultKeyrings.id,
        personalVaultKeyrings.accountId,
        personalVaultKeyrings.vaultId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "personal_vaults_current_manifest_fk",
      columns: [table.currentManifestId, table.accountId, table.id],
      foreignColumns: [
        personalVaultManifests.id,
        personalVaultManifests.accountId,
        personalVaultManifests.vaultId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "personal_vaults_head_commit_fk",
      columns: [table.headCommitId, table.accountId, table.id],
      foreignColumns: [personalVaultCommits.id, personalVaultCommits.accountId, personalVaultCommits.vaultId],
    }).onDelete("restrict"),
    check("personal_vaults_revision_check", sql`${table.currentRevision} BETWEEN 0 AND 9007199254740991`),
    check(
      "personal_vaults_head_lifecycle_check",
      sql`(${table.currentRevision} = 0 AND ${table.currentPayloadId} IS NULL AND ${table.currentKeyringId} IS NULL AND ${table.currentManifestId} IS NULL AND ${table.headCommitId} IS NULL) OR (${table.currentRevision} BETWEEN 1 AND 9007199254740991 AND ${table.currentPayloadId} IS NOT NULL AND ${table.currentKeyringId} IS NOT NULL AND ${table.currentManifestId} IS NOT NULL AND ${table.headCommitId} IS NOT NULL)`,
    ),
  ],
);

export const personalVaultPayloads = pgTable(
  "personal_vault_payloads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull(),
    vaultId: uuid("vault_id").notNull(),
    revision: bigint("revision", { mode: "number" }).notNull(),
    wirePayload: jsonb("wire_payload").$type<Record<string, unknown>>().notNull(),
    contentHash: text("content_hash").notNull(),
    byteLength: integer("byte_length").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    uniqueIndex("personal_vault_payloads_id_account_vault_uidx").on(table.id, table.accountId, table.vaultId),
    uniqueIndex("personal_vault_payloads_vault_revision_uidx").on(
      table.accountId,
      table.vaultId,
      table.revision,
    ),
    foreignKey({
      name: "personal_vault_payloads_vault_account_fk",
      columns: [table.vaultId, table.accountId],
      foreignColumns: [personalVaults.id, personalVaults.accountId],
    }).onDelete("cascade"),
    check("personal_vault_payloads_revision_check", sql`${table.revision} BETWEEN 1 AND 9007199254740991`),
    check(
      "personal_vault_payloads_hash_size_check",
      sql`${table.contentHash} ~ '^[a-f0-9]{64}$' AND ${table.byteLength} BETWEEN 4112 AND 8388624 AND (${table.byteLength} - 16) % 4096 = 0 AND jsonb_typeof(${table.wirePayload}) = 'object'`,
    ),
  ],
);

export const personalVaultKeyrings = pgTable(
  "personal_vault_keyrings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull(),
    vaultId: uuid("vault_id").notNull(),
    revision: bigint("revision", { mode: "number" }).notNull(),
    wirePayload: jsonb("wire_payload").$type<Record<string, unknown>>().notNull(),
    contentHash: text("content_hash").notNull(),
    byteLength: integer("byte_length").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("personal_vault_keyrings_id_account_vault_uidx").on(table.id, table.accountId, table.vaultId),
    uniqueIndex("personal_vault_keyrings_vault_revision_uidx").on(
      table.accountId,
      table.vaultId,
      table.revision,
    ),
    foreignKey({
      name: "personal_vault_keyrings_vault_account_fk",
      columns: [table.vaultId, table.accountId],
      foreignColumns: [personalVaults.id, personalVaults.accountId],
    }).onDelete("cascade"),
    check("personal_vault_keyrings_revision_check", sql`${table.revision} BETWEEN 1 AND 9007199254740991`),
    check(
      "personal_vault_keyrings_hash_size_check",
      sql`${table.contentHash} ~ '^[a-f0-9]{64}$' AND ${table.byteLength} BETWEEN 1 AND 262144 AND jsonb_typeof(${table.wirePayload}) = 'object'`,
    ),
  ],
);

export const personalVaultManifests = pgTable(
  "personal_vault_manifests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull(),
    vaultId: uuid("vault_id").notNull(),
    revision: bigint("revision", { mode: "number" }).notNull(),
    wirePayload: jsonb("wire_payload").$type<Record<string, unknown>>().notNull(),
    contentHash: text("content_hash").notNull(),
    byteLength: integer("byte_length").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("personal_vault_manifests_id_account_vault_uidx").on(
      table.id,
      table.accountId,
      table.vaultId,
    ),
    uniqueIndex("personal_vault_manifests_vault_revision_uidx").on(
      table.accountId,
      table.vaultId,
      table.revision,
    ),
    foreignKey({
      name: "personal_vault_manifests_vault_account_fk",
      columns: [table.vaultId, table.accountId],
      foreignColumns: [personalVaults.id, personalVaults.accountId],
    }).onDelete("cascade"),
    check("personal_vault_manifests_revision_check", sql`${table.revision} BETWEEN 1 AND 9007199254740991`),
    check(
      "personal_vault_manifests_hash_size_check",
      sql`${table.contentHash} ~ '^[a-f0-9]{64}$' AND ${table.byteLength} BETWEEN 1 AND 1048576 AND jsonb_typeof(${table.wirePayload}) = 'object'`,
    ),
  ],
);

export const personalVaultCommits = pgTable(
  "personal_vault_commits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull(),
    vaultId: uuid("vault_id").notNull(),
    revision: bigint("revision", { mode: "number" }).notNull(),
    parentCommitId: uuid("parent_commit_id"),
    payloadId: uuid("payload_id").notNull(),
    keyringId: uuid("keyring_id").notNull(),
    manifestId: uuid("manifest_id").notNull(),
    wirePayload: jsonb("wire_payload").$type<Record<string, unknown>>().notNull(),
    contentHash: text("content_hash").notNull(),
    byteLength: integer("byte_length").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("personal_vault_commits_id_account_vault_uidx").on(table.id, table.accountId, table.vaultId),
    uniqueIndex("personal_vault_commits_vault_revision_uidx").on(
      table.accountId,
      table.vaultId,
      table.revision,
    ),
    foreignKey({
      name: "personal_vault_commits_vault_account_fk",
      columns: [table.vaultId, table.accountId],
      foreignColumns: [personalVaults.id, personalVaults.accountId],
    }).onDelete("cascade"),
    foreignKey({
      name: "personal_vault_commits_parent_fk",
      columns: [table.parentCommitId, table.accountId, table.vaultId],
      foreignColumns: [table.id, table.accountId, table.vaultId],
    }).onDelete("restrict"),
    foreignKey({
      name: "personal_vault_commits_payload_fk",
      columns: [table.payloadId, table.accountId, table.vaultId],
      foreignColumns: [
        personalVaultPayloads.id,
        personalVaultPayloads.accountId,
        personalVaultPayloads.vaultId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "personal_vault_commits_keyring_fk",
      columns: [table.keyringId, table.accountId, table.vaultId],
      foreignColumns: [
        personalVaultKeyrings.id,
        personalVaultKeyrings.accountId,
        personalVaultKeyrings.vaultId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "personal_vault_commits_manifest_fk",
      columns: [table.manifestId, table.accountId, table.vaultId],
      foreignColumns: [
        personalVaultManifests.id,
        personalVaultManifests.accountId,
        personalVaultManifests.vaultId,
      ],
    }).onDelete("restrict"),
    check("personal_vault_commits_revision_check", sql`${table.revision} BETWEEN 1 AND 9007199254740991`),
    check(
      "personal_vault_commits_hash_size_check",
      sql`${table.contentHash} ~ '^[a-f0-9]{64}$' AND ${table.byteLength} BETWEEN 1 AND 1048576 AND jsonb_typeof(${table.wirePayload}) = 'object'`,
    ),
    check(
      "personal_vault_commits_parent_check",
      sql`(${table.revision} = 1 AND ${table.parentCommitId} IS NULL) OR (${table.revision} > 1 AND ${table.parentCommitId} IS NOT NULL)`,
    ),
  ],
);

export const personalVaultDevices = pgTable(
  "personal_vault_devices",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id").notNull(),
    vaultId: uuid("vault_id").notNull(),
    keyId: uuid("key_id").notNull(),
    wrappingPublicKey: jsonb("wrapping_public_key").$type<Record<string, unknown>>().notNull(),
    signingPublicKey: jsonb("signing_public_key").$type<Record<string, unknown>>().notNull(),
    keyDigest: bytea("key_digest").notNull(),
    status: personalVaultDeviceStatusEnum("status").notNull().default("active"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("personal_vault_devices_id_account_vault_uidx").on(table.id, table.accountId, table.vaultId),
    uniqueIndex("personal_vault_devices_key_uidx").on(table.accountId, table.vaultId, table.keyId),
    uniqueIndex("personal_vault_devices_digest_uidx").on(table.accountId, table.vaultId, table.keyDigest),
    foreignKey({
      name: "personal_vault_devices_vault_account_fk",
      columns: [table.vaultId, table.accountId],
      foreignColumns: [personalVaults.id, personalVaults.accountId],
    }).onDelete("cascade"),
    check(
      "personal_vault_devices_keys_check",
      sql`octet_length(${table.keyDigest}) = 32 AND jsonb_typeof(${table.wrappingPublicKey}) = 'object' AND jsonb_typeof(${table.signingPublicKey}) = 'object'`,
    ),
    check(
      "personal_vault_devices_lifecycle_check",
      sql`(${table.status} = 'active' AND ${table.revokedAt} IS NULL) OR (${table.status} = 'revoked' AND ${table.revokedAt} IS NOT NULL AND ${table.revokedAt} >= ${table.createdAt})`,
    ),
    check(
      "personal_vault_devices_last_seen_check",
      sql`${table.lastSeenAt} IS NULL OR ${table.lastSeenAt} >= ${table.createdAt}`,
    ),
  ],
);

export const personalVaultPairings = pgTable(
  "personal_vault_pairings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull(),
    vaultId: uuid("vault_id").notNull(),
    requestingDeviceId: uuid("requesting_device_id").notNull(),
    approvingDeviceId: uuid("approving_device_id"),
    state: personalVaultPairingStateEnum("state").notNull().default("pending"),
    codeDigest: bytea("code_digest").notNull(),
    requestPayload: jsonb("request_payload").$type<Record<string, unknown>>().notNull(),
    responsePayload: jsonb("response_payload").$type<Record<string, unknown>>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("personal_vault_pairings_id_account_vault_uidx").on(table.id, table.accountId, table.vaultId),
    uniqueIndex("personal_vault_pairings_code_digest_uidx").on(
      table.accountId,
      table.vaultId,
      table.codeDigest,
    ),
    index("personal_vault_pairings_pending_expiry_idx")
      .on(table.expiresAt, table.id)
      .where(sql`${table.state} = 'pending'`),
    index("personal_vault_pairings_terminal_retention_idx")
      .on(table.updatedAt, table.id)
      .where(sql`${table.state} IN ('consumed', 'expired', 'cancelled')`),
    foreignKey({
      name: "personal_vault_pairings_vault_account_fk",
      columns: [table.vaultId, table.accountId],
      foreignColumns: [personalVaults.id, personalVaults.accountId],
    }).onDelete("cascade"),
    foreignKey({
      name: "personal_vault_pairings_approving_device_fk",
      columns: [table.approvingDeviceId, table.accountId, table.vaultId],
      foreignColumns: [personalVaultDevices.id, personalVaultDevices.accountId, personalVaultDevices.vaultId],
    }).onDelete("restrict"),
    check(
      "personal_vault_pairings_payload_check",
      sql`octet_length(${table.codeDigest}) = 32 AND jsonb_typeof(${table.requestPayload}) = 'object' AND (${table.responsePayload} IS NULL OR jsonb_typeof(${table.responsePayload}) = 'object')`,
    ),
    check(
      "personal_vault_pairings_lifecycle_check",
      sql`${table.expiresAt} > ${table.createdAt} AND ((${table.state} = 'pending' AND ${table.approvingDeviceId} IS NULL AND ${table.responsePayload} IS NULL AND ${table.consumedAt} IS NULL) OR (${table.state} = 'approved' AND ${table.responsePayload} IS NOT NULL AND ${table.consumedAt} IS NULL) OR (${table.state} = 'consumed' AND ${table.responsePayload} IS NOT NULL AND ${table.consumedAt} IS NOT NULL AND ${table.consumedAt} >= ${table.createdAt}) OR (${table.state} IN ('expired', 'cancelled') AND ${table.consumedAt} IS NULL))`,
    ),
    check(
      "personal_vault_pairings_distinct_devices_check",
      sql`${table.approvingDeviceId} IS NULL OR ${table.approvingDeviceId} <> ${table.requestingDeviceId}`,
    ),
  ],
);

export const personalVaultCommands = pgTable(
  "personal_vault_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull(),
    vaultId: uuid("vault_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    actorKind: personalVaultCommandActorKindEnum("actor_kind").notNull(),
    actorKeyId: uuid("actor_key_id"),
    requestHash: text("request_hash").notNull(),
    status: personalVaultCommandStatusEnum("status").notNull().default("pending"),
    responseBody: jsonb("response_body").$type<Record<string, unknown>>(),
    responseEtag: text("response_etag"),
    responseRevision: bigint("response_revision", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("personal_vault_commands_id_account_vault_uidx").on(table.id, table.accountId, table.vaultId),
    uniqueIndex("personal_vault_commands_idempotency_uidx").on(
      table.accountId,
      table.vaultId,
      table.idempotencyKey,
    ),
    index("personal_vault_commands_completed_retention_idx")
      .on(table.completedAt, table.id)
      .where(sql`${table.status} IN ('succeeded', 'failed')`),
    index("personal_vault_commands_pending_attention_idx")
      .on(table.createdAt, table.id)
      .where(sql`${table.status} = 'pending'`),
    foreignKey({
      name: "personal_vault_commands_vault_account_fk",
      columns: [table.vaultId, table.accountId],
      foreignColumns: [personalVaults.id, personalVaults.accountId],
    }).onDelete("cascade"),
    check(
      "personal_vault_commands_request_check",
      sql`char_length(${table.idempotencyKey}) BETWEEN 16 AND 128 AND ${table.idempotencyKey} !~ '[[:space:]]' AND ${table.requestHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "personal_vault_commands_actor_check",
      sql`(${table.actorKind} = 'account' AND ${table.actorKeyId} IS NULL) OR (${table.actorKind} IN ('device', 'recovery') AND ${table.actorKeyId} IS NOT NULL)`,
    ),
    check(
      "personal_vault_commands_lifecycle_check",
      sql`(${table.status} = 'pending' AND ${table.completedAt} IS NULL AND ${table.responseBody} IS NULL AND ${table.responseEtag} IS NULL AND ${table.responseRevision} IS NULL) OR (${table.status} = 'succeeded' AND ${table.completedAt} IS NOT NULL AND ${table.responseBody} IS NOT NULL AND char_length(btrim(${table.responseEtag})) > 0 AND ${table.responseRevision} BETWEEN 1 AND 9007199254740991) OR (${table.status} = 'failed' AND ${table.completedAt} IS NOT NULL AND ${table.responseBody} IS NOT NULL AND ${table.responseEtag} IS NULL AND (${table.responseRevision} IS NULL OR ${table.responseRevision} BETWEEN 1 AND 9007199254740991))`,
    ),
  ],
);
