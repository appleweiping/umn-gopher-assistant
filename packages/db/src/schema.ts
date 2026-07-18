import {
  geometry,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const campusIdEnum = pgEnum("campus_id", ["tc", "duluth", "crookston", "morris", "rochester"]);
export const licenseStatusEnum = pgEnum("license_status", [
  "OPEN_REUSE",
  "LIVE_ONLY",
  "DEEPLINK_ONLY",
  "APPROVAL_REQUIRED",
  "PROHIBITED",
]);
export const freshnessStateEnum = pgEnum("freshness_state", ["FRESH", "STALE", "EXPIRED", "UNKNOWN"]);
export const verificationStateEnum = pgEnum("verification_state", [
  "SCHEMATIC",
  "UNVERIFIED",
  "VERIFIED",
  "REJECTED",
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

export const campuses = pgTable("campuses", {
  id: campusIdEnum("id").primaryKey(),
  nameEn: text("name_en").notNull(),
  nameZhCn: text("name_zh_cn").notNull(),
  cityEn: text("city_en").notNull(),
  cityZhCn: text("city_zh_cn").notNull(),
  timeZone: text("time_zone").notNull(),
  academicCalendarCampusId: campusIdEnum("academic_calendar_campus_id").notNull(),
  sourceUrl: text("source_url").notNull(),
  officialStatus: officialStatusEnum("official_status").notNull().default("UNVERIFIED"),
  centroid: geometry("centroid", { type: "point", mode: "xy", srid: 4326 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
    verificationState: verificationStateEnum("verification_state").notNull().default("UNVERIFIED"),
    officialStatus: officialStatusEnum("official_status").notNull().default("UNVERIFIED"),
    attribution: text("attribution").notNull(),
    cachePolicy: cachePolicyEnum("cache_policy").notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("sources_external_id_uidx").on(table.externalId)],
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
    index("source_snapshots_source_captured_idx").on(table.sourceId, table.capturedAt),
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
  (table) => [index("outbox_events_unpublished_idx").on(table.publishedAt, table.availableAt)],
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
  (table) => [index("audit_events_target_occurred_idx").on(table.action, table.occurredAt)],
);
