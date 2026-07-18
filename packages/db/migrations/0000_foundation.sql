CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE campus_id AS ENUM ('tc', 'duluth', 'crookston', 'morris', 'rochester');
CREATE TYPE academic_institution_code AS ENUM ('UMNTC', 'UMNDL', 'UMNCR', 'UMNMO');
CREATE TYPE license_status AS ENUM ('OPEN_REUSE', 'LIVE_ONLY', 'DEEPLINK_ONLY', 'APPROVAL_REQUIRED', 'PROHIBITED');
CREATE TYPE freshness_state AS ENUM ('FRESH', 'STALE', 'EXPIRED', 'UNKNOWN');
CREATE TYPE verification_state AS ENUM ('schematic', 'surveyed', 'campus-reviewed', 'verified', 'retired');
CREATE TYPE official_status AS ENUM ('UNVERIFIED', 'PUBLISHER_ASSERTED', 'PARTNERSHIP_VERIFIED');
CREATE TYPE cache_policy AS ENUM ('CACHE_ALLOWED', 'METADATA_ONLY', 'NO_CONTENT_CACHE', 'NO_ACCESS');

CREATE TABLE campuses (
  id campus_id PRIMARY KEY,
  name_en text NOT NULL,
  name_zh_cn text NOT NULL,
  city_en text NOT NULL,
  city_zh_cn text NOT NULL,
  time_zone text NOT NULL,
  academic_institution_code academic_institution_code NOT NULL,
  academic_calendar_campus_id campus_id NOT NULL,
  source_url text NOT NULL CHECK (source_url LIKE 'https://%'),
  official_status official_status NOT NULL DEFAULT 'UNVERIFIED',
  centroid geometry(Point, 4326),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rochester_academic_calendar_check CHECK (id <> 'rochester' OR academic_calendar_campus_id = 'tc')
);
COMMENT ON TABLE campuses IS 'owner: campus-catalog; canonical public campus metadata';

CREATE TABLE sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL UNIQUE,
  campus_ids campus_id[] NOT NULL CHECK (cardinality(campus_ids) > 0),
  name_en text NOT NULL,
  name_zh_cn text NOT NULL,
  publisher text NOT NULL,
  source_url text NOT NULL CHECK (source_url LIKE 'https://%'),
  license_status license_status NOT NULL,
  freshness_state freshness_state NOT NULL DEFAULT 'UNKNOWN',
  verification_state verification_state NOT NULL DEFAULT 'surveyed',
  official_status official_status NOT NULL DEFAULT 'UNVERIFIED',
  attribution text NOT NULL,
  cache_policy cache_policy NOT NULL,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prohibited_source_access_check CHECK (license_status <> 'PROHIBITED' OR cache_policy = 'NO_ACCESS')
);
COMMENT ON TABLE sources IS 'owner: source-registry; connector policy and provenance, never credentials';

CREATE TABLE source_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  captured_at timestamptz NOT NULL,
  normalized_payload jsonb NOT NULL,
  raw_object_key text,
  parse_version text NOT NULL,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, content_hash)
);
CREATE INDEX source_snapshots_source_captured_idx ON source_snapshots (source_id, captured_at DESC);
CREATE INDEX source_snapshots_embedding_hnsw_idx ON source_snapshots USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL;
COMMENT ON TABLE source_snapshots IS 'owner: ingestion; immutable normalized snapshots subject to source cache policy';

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text
);
CREATE INDEX outbox_events_unpublished_idx ON outbox_events (available_at) WHERE published_at IS NULL;
COMMENT ON TABLE outbox_events IS 'owner: platform-event-relay; transactional outbox for versioned AsyncAPI events';

CREATE TABLE world_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id campus_id NOT NULL REFERENCES campuses(id) ON DELETE RESTRICT,
  world_version text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  verification_state verification_state NOT NULL,
  etag text NOT NULL,
  source_ids jsonb NOT NULL,
  manifest jsonb NOT NULL,
  generated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campus_id, world_version, revision)
);
COMMENT ON TABLE world_manifests IS 'owner: world-catalog; signed metadata only, binary assets remain in object storage';

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  actor jsonb NOT NULL,
  action text NOT NULL,
  target jsonb NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('SUCCESS', 'DENIED', 'FAILURE')),
  trace_id text NOT NULL,
  metadata jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_target_occurred_idx ON audit_events (action, occurred_at DESC);
COMMENT ON TABLE audit_events IS 'owner: trust-and-safety; append-only security and moderation audit trail';

REVOKE UPDATE, DELETE ON audit_events FROM PUBLIC;
