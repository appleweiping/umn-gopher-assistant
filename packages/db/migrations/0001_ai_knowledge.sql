CREATE TYPE "public"."ai_locale" AS ENUM('en', 'zh-CN');--> statement-breakpoint
CREATE TYPE "public"."knowledge_category" AS ENUM('library', 'student-services', 'safety', 'transportation', 'dining');--> statement-breakpoint
CREATE TYPE "public"."knowledge_ingestion_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."knowledge_source_role" AS ENUM('PROJECT_SUMMARY', 'OFFICIAL_VERIFICATION');--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"locale" "ai_locale" NOT NULL,
	"ordinal" smallint NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"token_count" integer NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', "content")) STORED NOT NULL,
	"embedding" vector(384),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_chunks_ordinal_check" CHECK ("knowledge_chunks"."ordinal" >= 0),
	CONSTRAINT "knowledge_chunks_content_check" CHECK (char_length(btrim("knowledge_chunks"."content")) > 0 AND "knowledge_chunks"."token_count" > 0 AND "knowledge_chunks"."token_count" <= 4096),
	CONSTRAINT "knowledge_chunks_hash_check" CHECK ("knowledge_chunks"."content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "knowledge_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"citation_key" text NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"excerpt" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_citations_nonempty_check" CHECK (char_length(btrim("knowledge_citations"."citation_key")) > 0 AND char_length(btrim("knowledge_citations"."excerpt")) > 0),
	CONSTRAINT "knowledge_citations_hash_check" CHECK ("knowledge_citations"."content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"summary_source_id" text NOT NULL,
	"verification_source_id" text NOT NULL,
	"campus_id" "campus_id" NOT NULL,
	"category" "knowledge_category" NOT NULL,
	"title_en" text NOT NULL,
	"title_zh_cn" text NOT NULL,
	"body_en" text NOT NULL,
	"body_zh_cn" text NOT NULL,
	"keywords_en" text[] NOT NULL,
	"keywords_zh_cn" text[] NOT NULL,
	"content_hash" text NOT NULL,
	"fresh_for_days" integer NOT NULL,
	"freshness_state" "freshness_state" NOT NULL,
	"verification_state" "verification_state" DEFAULT 'schematic' NOT NULL,
	"conflict_group" text,
	"conflict_variant" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_documents_nonempty_check" CHECK (char_length(btrim("knowledge_documents"."external_id")) > 0 AND "knowledge_documents"."summary_source_id" ~ '^[a-z0-9][a-z0-9-]{2,127}$' AND "knowledge_documents"."verification_source_id" ~ '^[a-z0-9][a-z0-9-]{2,127}$' AND "knowledge_documents"."summary_source_id" <> "knowledge_documents"."verification_source_id" AND char_length(btrim("knowledge_documents"."title_en")) > 0 AND char_length(btrim("knowledge_documents"."title_zh_cn")) > 0 AND char_length(btrim("knowledge_documents"."body_en")) > 0 AND char_length(btrim("knowledge_documents"."body_zh_cn")) > 0),
	CONSTRAINT "knowledge_documents_hash_check" CHECK ("knowledge_documents"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "knowledge_documents_retrieval_metadata_check" CHECK (cardinality("knowledge_documents"."keywords_en") BETWEEN 1 AND 24 AND cardinality("knowledge_documents"."keywords_zh_cn") BETWEEN 1 AND 24 AND "knowledge_documents"."fresh_for_days" BETWEEN 1 AND 3650),
	CONSTRAINT "knowledge_documents_conflict_metadata_check" CHECK (("knowledge_documents"."conflict_group" IS NULL AND "knowledge_documents"."conflict_variant" IS NULL) OR ("knowledge_documents"."conflict_group" ~ '^[a-z0-9][a-z0-9-]{2,127}$' AND "knowledge_documents"."conflict_variant" ~ '^[a-z0-9][a-z0-9-]{2,127}$')),
	CONSTRAINT "knowledge_documents_retirement_check" CHECK (("knowledge_documents"."enabled" AND "knowledge_documents"."retired_at" IS NULL AND "knowledge_documents"."verification_state" <> 'retired') OR (NOT "knowledge_documents"."enabled" AND "knowledge_documents"."retired_at" IS NOT NULL AND "knowledge_documents"."verification_state" = 'retired'))
);
--> statement-breakpoint
CREATE TABLE "knowledge_ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corpus_version" text NOT NULL,
	"status" "knowledge_ingestion_status" NOT NULL,
	"documents_seen" integer DEFAULT 0 NOT NULL,
	"documents_indexed" integer DEFAULT 0 NOT NULL,
	"documents_retired" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"error_summary" text,
	"projection_sha256" text,
	"projection_sources" integer,
	"projection_documents" integer,
	"projection_chunks" integer,
	"projection_citations" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_ingestion_runs_counts_check" CHECK ("knowledge_ingestion_runs"."documents_seen" >= 0 AND "knowledge_ingestion_runs"."documents_indexed" >= 0 AND "knowledge_ingestion_runs"."documents_retired" >= 0 AND "knowledge_ingestion_runs"."documents_indexed" + "knowledge_ingestion_runs"."documents_retired" <= "knowledge_ingestion_runs"."documents_seen"),
	CONSTRAINT "knowledge_ingestion_runs_lifecycle_check" CHECK (("knowledge_ingestion_runs"."status" = 'running' AND "knowledge_ingestion_runs"."completed_at" IS NULL AND "knowledge_ingestion_runs"."error_summary" IS NULL) OR ("knowledge_ingestion_runs"."status" = 'succeeded' AND "knowledge_ingestion_runs"."completed_at" IS NOT NULL AND "knowledge_ingestion_runs"."error_summary" IS NULL) OR ("knowledge_ingestion_runs"."status" = 'failed' AND "knowledge_ingestion_runs"."completed_at" IS NOT NULL AND char_length(btrim("knowledge_ingestion_runs"."error_summary")) > 0)),
	CONSTRAINT "knowledge_ingestion_runs_projection_check" CHECK (("knowledge_ingestion_runs"."status" = 'succeeded' AND "knowledge_ingestion_runs"."projection_sha256" IS NOT NULL AND "knowledge_ingestion_runs"."projection_sha256" ~ '^[a-f0-9]{64}$' AND "knowledge_ingestion_runs"."projection_sources" IS NOT NULL AND "knowledge_ingestion_runs"."projection_sources" >= 0 AND "knowledge_ingestion_runs"."projection_documents" IS NOT NULL AND "knowledge_ingestion_runs"."projection_documents" >= 0 AND "knowledge_ingestion_runs"."projection_chunks" IS NOT NULL AND "knowledge_ingestion_runs"."projection_chunks" >= 0 AND "knowledge_ingestion_runs"."projection_citations" IS NOT NULL AND "knowledge_ingestion_runs"."projection_citations" >= 0) OR ("knowledge_ingestion_runs"."status" IN ('running', 'failed') AND "knowledge_ingestion_runs"."projection_sha256" IS NULL AND "knowledge_ingestion_runs"."projection_sources" IS NULL AND "knowledge_ingestion_runs"."projection_documents" IS NULL AND "knowledge_ingestion_runs"."projection_chunks" IS NULL AND "knowledge_ingestion_runs"."projection_citations" IS NULL)),
	CONSTRAINT "knowledge_ingestion_runs_version_check" CHECK (char_length(btrim("knowledge_ingestion_runs"."corpus_version")) > 0)
);
--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"external_id" text PRIMARY KEY NOT NULL,
	"campus_ids" "campus_id"[] NOT NULL,
	"role" "knowledge_source_role" NOT NULL,
	"source_url" text NOT NULL,
	"license_status" "license_status" NOT NULL,
	"license_evidence_url" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_sources_identity_check" CHECK ("knowledge_sources"."external_id" ~ '^[a-z0-9][a-z0-9-]{2,127}$' AND cardinality("knowledge_sources"."campus_ids") BETWEEN 1 AND 5),
	CONSTRAINT "knowledge_sources_url_check" CHECK ("knowledge_sources"."source_url" LIKE 'https://%'),
	CONSTRAINT "knowledge_sources_governance_check" CHECK (("knowledge_sources"."role" = 'PROJECT_SUMMARY' AND cardinality("knowledge_sources"."campus_ids") = 5 AND "knowledge_sources"."source_url" = 'https://github.com/appleweiping/umn-gopher-assistant/blob/main/apps/ai-knowledge/ai_knowledge/data/corpus.json' AND "knowledge_sources"."license_status" = 'OPEN_REUSE' AND "knowledge_sources"."license_evidence_url" = 'https://www.apache.org/licenses/LICENSE-2.0') OR ("knowledge_sources"."role" = 'OFFICIAL_VERIFICATION' AND cardinality("knowledge_sources"."campus_ids") = 1 AND "knowledge_sources"."source_url" = lower(btrim("knowledge_sources"."source_url")) AND "knowledge_sources"."source_url" !~ '[[:space:]@?#]' AND "knowledge_sources"."source_url" LIKE 'https://%/%' AND char_length(split_part(split_part(substring("knowledge_sources"."source_url" from 9), '/', 1), ':', 1)) BETWEEN 1 AND 253 AND translate(split_part(split_part(substring("knowledge_sources"."source_url" from 9), '/', 1), ':', 1), 'abcdefghijklmnopqrstuvwxyz0123456789-.', '') = '' AND split_part(split_part(substring("knowledge_sources"."source_url" from 9), '/', 1), ':', 1) NOT LIKE '.%' AND split_part(split_part(substring("knowledge_sources"."source_url" from 9), '/', 1), ':', 1) NOT LIKE '-%' AND split_part(split_part(substring("knowledge_sources"."source_url" from 9), '/', 1), ':', 1) NOT LIKE '%..%' AND split_part(split_part(substring("knowledge_sources"."source_url" from 9), '/', 1), ':', 1) NOT LIKE '%.-%' AND split_part(split_part(substring("knowledge_sources"."source_url" from 9), '/', 1), ':', 1) NOT LIKE '%-.%' AND (split_part(split_part(substring("knowledge_sources"."source_url" from 9), '/', 1), ':', 1) = 'umn.edu' OR right(split_part(split_part(substring("knowledge_sources"."source_url" from 9), '/', 1), ':', 1), 8) = '.umn.edu') AND (split_part(substring("knowledge_sources"."source_url" from 9), '/', 1) = split_part(split_part(substring("knowledge_sources"."source_url" from 9), '/', 1), ':', 1) OR split_part(substring("knowledge_sources"."source_url" from 9), '/', 1) = split_part(split_part(substring("knowledge_sources"."source_url" from 9), '/', 1), ':', 1) || ':443') AND "knowledge_sources"."license_status" = 'DEEPLINK_ONLY' AND "knowledge_sources"."license_evidence_url" IS NULL))
);
--> statement-breakpoint
INSERT INTO "campuses" (
	"id", "name_en", "name_zh_cn", "city_en", "city_zh_cn", "time_zone",
	"academic_institution_code", "academic_calendar_campus_id", "source_url", "official_status"
) VALUES
	('tc', 'Twin Cities', '双城校区', 'Minneapolis and Saint Paul', '明尼阿波利斯与圣保罗', 'America/Chicago', 'UMNTC', 'tc', 'https://twin-cities.umn.edu/', 'UNVERIFIED'),
	('duluth', 'Duluth', '德卢斯校区', 'Duluth', '德卢斯', 'America/Chicago', 'UMNDL', 'duluth', 'https://www.d.umn.edu/', 'UNVERIFIED'),
	('crookston', 'Crookston', '克鲁克斯顿校区', 'Crookston', '克鲁克斯顿', 'America/Chicago', 'UMNCR', 'crookston', 'https://crk.umn.edu/', 'UNVERIFIED'),
	('morris', 'Morris', '莫里斯校区', 'Morris', '莫里斯', 'America/Chicago', 'UMNMO', 'morris', 'https://morris.umn.edu/', 'UNVERIFIED'),
	('rochester', 'Rochester', '罗切斯特校区', 'Rochester', '罗切斯特', 'America/Chicago', 'UMNTC', 'tc', 'https://r.umn.edu/', 'UNVERIFIED')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_id_document_uidx" ON "knowledge_chunks" USING btree ("id","document_id");
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_citations" ADD CONSTRAINT "knowledge_citations_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_citations" ADD CONSTRAINT "knowledge_citations_chunk_document_fk" FOREIGN KEY ("chunk_id","document_id") REFERENCES "public"."knowledge_chunks"("id","document_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_campus_id_campuses_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_summary_source_fk" FOREIGN KEY ("summary_source_id") REFERENCES "public"."knowledge_sources"("external_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_verification_source_fk" FOREIGN KEY ("verification_source_id") REFERENCES "public"."knowledge_sources"("external_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_document_locale_ordinal_uidx" ON "knowledge_chunks" USING btree ("document_id","locale","ordinal");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_search_gin_idx" ON "knowledge_chunks" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_embedding_hnsw_idx" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops) WHERE "knowledge_chunks"."embedding" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_citations_key_uidx" ON "knowledge_citations" USING btree ("citation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_citations_document_chunk_uidx" ON "knowledge_citations" USING btree ("document_id","chunk_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_documents_external_id_uidx" ON "knowledge_documents" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "knowledge_documents_campus_category_idx" ON "knowledge_documents" USING btree ("campus_id","category");--> statement-breakpoint
CREATE INDEX "knowledge_documents_summary_source_idx" ON "knowledge_documents" USING btree ("summary_source_id");--> statement-breakpoint
CREATE INDEX "knowledge_documents_verification_source_idx" ON "knowledge_documents" USING btree ("verification_source_id");--> statement-breakpoint
CREATE INDEX "knowledge_ingestion_runs_started_idx" ON "knowledge_ingestion_runs" USING btree ("started_at" DESC NULLS LAST);
--> statement-breakpoint
COMMENT ON TABLE "knowledge_sources" IS 'owner: ai-knowledge; separate governed summary and official verification identities with per-row kill switches';
--> statement-breakpoint
COMMENT ON TABLE "knowledge_documents" IS 'owner: ai-knowledge; Apache-2.0 project-authored bilingual records referencing separate verification-only links';
--> statement-breakpoint
COMMENT ON TABLE "knowledge_chunks" IS 'owner: ai-knowledge; lexical index with optional operator-supplied 384-dimensional embeddings';
--> statement-breakpoint
COMMENT ON TABLE "knowledge_citations" IS 'owner: ai-knowledge; immutable evidence projection deleted with its source document';
--> statement-breakpoint
COMMENT ON TABLE "knowledge_ingestion_runs" IS 'owner: ai-knowledge; corpus rebuild, retirement, deletion, source-governance, and projection-integrity audit trail';
--> statement-breakpoint
CREATE FUNCTION "reject_knowledge_citation_update"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'knowledge citations are immutable; delete and insert a new projection';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "knowledge_citations_immutable"
BEFORE UPDATE ON "knowledge_citations"
FOR EACH ROW EXECUTE FUNCTION "reject_knowledge_citation_update"();
--> statement-breakpoint
REVOKE UPDATE ON "knowledge_citations" FROM PUBLIC;
