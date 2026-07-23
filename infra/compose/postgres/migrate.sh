#!/bin/sh
set -eu

: "${POSTGRES_HOST:=postgres}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_USER:=gopher}"
: "${POSTGRES_DB:=gopher}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${AI_KNOWLEDGE_READER_DB_USER:=gopher_ai_reader}"
: "${AI_KNOWLEDGE_READER_DB_PASSWORD:?AI_KNOWLEDGE_READER_DB_PASSWORD is required}"
: "${AI_KNOWLEDGE_SYNC_DB_USER:=gopher_ai_sync}"
: "${AI_KNOWLEDGE_SYNC_DB_PASSWORD:?AI_KNOWLEDGE_SYNC_DB_PASSWORD is required}"
: "${KEYCLOAK_DB:=keycloak}"
: "${KEYCLOAK_DB_USER:=gopher_keycloak}"
: "${KEYCLOAK_DB_PASSWORD:?KEYCLOAK_DB_PASSWORD is required}"

export PGPASSWORD="$POSTGRES_PASSWORD"

psql_platform() {
  psql \
    --host="$POSTGRES_HOST" \
    --port="$POSTGRES_PORT" \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --set=ON_ERROR_STOP=1 \
    "$@"
}

# A healthy dependency can still restart between Compose's last probe and this
# one-shot container opening its first connection. Bound the readiness wait and
# use an actual SQL round trip; no credentials or connection URL are logged.
readiness_attempt=1
until psql_platform --tuples-only --no-align --command="SELECT 1" >/dev/null 2>&1; do
  if [ "$readiness_attempt" -ge 30 ]; then
    echo "PostgreSQL did not accept a migration connection within 30 seconds" >&2
    exit 1
  fi
  readiness_attempt=$((readiness_attempt + 1))
  sleep 1
done

# This also runs during first-cluster initialization. Running it again here is
# intentional: retained pre-hardening volumes gain the same separated roles,
# password rotation, and dedicated Keycloak database ownership.
sh /migrations/bootstrap-runtime-roles.sh

checksum_for() {
  sha256sum "$1" | awk '{print $1}'
}

record_baseline() {
  version="$1"
  checksum="$2"
  psql_platform --set=version="$version" --set=checksum="$checksum" <<'SQL'
INSERT INTO platform_schema_migrations (version, checksum)
VALUES (:'version', :'checksum')
ON CONFLICT (version) DO NOTHING;
SQL
}

psql_platform <<'SQL'
CREATE TABLE IF NOT EXISTS platform_schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_schema_migrations_version_check
    CHECK (version ~ '^[0-9]{4}_[a-z0-9_]+$'),
  CONSTRAINT platform_schema_migrations_checksum_check
    CHECK (checksum ~ '^[a-f0-9]{64}$')
);
COMMENT ON TABLE platform_schema_migrations IS
  'owner: platform-migrations; immutable ledger for ordered SQL migrations';
REVOKE UPDATE, DELETE, TRUNCATE ON platform_schema_migrations FROM PUBLIC;

CREATE OR REPLACE FUNCTION reject_platform_schema_migration_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'platform migration ledger is immutable';
END;
$$;

CREATE OR REPLACE TRIGGER platform_schema_migrations_immutable
BEFORE UPDATE OR DELETE OR TRUNCATE ON platform_schema_migrations
FOR EACH STATEMENT EXECUTE FUNCTION reject_platform_schema_migration_mutation();
SQL

# Releases before the migration ledger mounted SQL files directly into
# docker-entrypoint-initdb.d. Baseline those two known schemas only after their
# identifying objects are present, so an existing development volume upgrades
# without re-running non-idempotent CREATE TYPE statements.
foundation_present="$(psql_platform --tuples-only --no-align --command="
  SELECT to_regclass('public.campuses') IS NOT NULL
     AND to_regclass('public.sources') IS NOT NULL
     AND to_regclass('public.source_snapshots') IS NOT NULL
     AND to_regclass('public.outbox_events') IS NOT NULL
     AND to_regclass('public.world_manifests') IS NOT NULL
     AND to_regclass('public.audit_events') IS NOT NULL
     AND to_regclass('public.sources_external_id_uidx') IS NOT NULL
     AND to_regclass('public.source_snapshots_source_hash_uidx') IS NOT NULL
     AND to_regclass('public.outbox_events_unpublished_idx') IS NOT NULL
     AND to_regclass('public.world_manifests_campus_version_revision_uidx') IS NOT NULL
     AND to_regclass('public.audit_events_target_occurred_idx') IS NOT NULL
     AND to_regtype('public.campus_id') IS NOT NULL
     AND to_regtype('public.academic_institution_code') IS NOT NULL
     AND to_regtype('public.license_status') IS NOT NULL
     AND to_regtype('public.freshness_state') IS NOT NULL
     AND to_regtype('public.verification_state') IS NOT NULL
     AND to_regtype('public.official_status') IS NOT NULL
     AND to_regtype('public.cache_policy') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector');
")"
if [ "$foundation_present" = "t" ]; then
  foundation_checksum="$(checksum_for /migrations/0000_foundation.sql)"
  record_baseline "0000_foundation" "$foundation_checksum"
fi

knowledge_present="$(psql_platform --tuples-only --no-align --command="
  SELECT to_regclass('public.knowledge_sources') IS NOT NULL
     AND to_regclass('public.knowledge_documents') IS NOT NULL
     AND to_regclass('public.knowledge_chunks') IS NOT NULL
     AND to_regclass('public.knowledge_citations') IS NOT NULL
     AND to_regclass('public.knowledge_ingestion_runs') IS NOT NULL
     AND to_regclass('public.knowledge_documents_external_id_uidx') IS NOT NULL
     AND to_regclass('public.knowledge_chunks_search_gin_idx') IS NOT NULL
     AND to_regclass('public.knowledge_citations_key_uidx') IS NOT NULL
     AND to_regclass('public.knowledge_ingestion_runs_started_idx') IS NOT NULL
     AND to_regtype('public.ai_locale') IS NOT NULL
     AND to_regtype('public.knowledge_category') IS NOT NULL
     AND to_regtype('public.knowledge_ingestion_status') IS NOT NULL
     AND to_regtype('public.knowledge_source_role') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'knowledge_ingestion_runs'
         AND column_name = 'projection_sha256'
     )
     AND EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conrelid = to_regclass('public.knowledge_ingestion_runs')
         AND conname = 'knowledge_ingestion_runs_projection_check'
     )
     AND EXISTS (
       SELECT 1
       FROM pg_trigger
       WHERE tgrelid = to_regclass('public.knowledge_citations')
         AND tgname = 'knowledge_citations_immutable'
         AND NOT tgisinternal
     );
")"
if [ "$knowledge_present" = "t" ]; then
  knowledge_checksum="$(checksum_for /migrations/0001_ai_knowledge.sql)"
  record_baseline "0001_ai_knowledge" "$knowledge_checksum"
fi

found_migration=false
for migration in /migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  if [ ! -f "$migration" ]; then
    continue
  fi
  found_migration=true
  filename="$(basename "$migration")"
  version="${filename%.sql}"
  if ! printf '%s\n' "$version" | grep -Eq '^[0-9]{4}_[a-z0-9_]+$'; then
    echo "Refusing migration with an invalid filename" >&2
    exit 1
  fi
  checksum="$(checksum_for "$migration")"
  if [ "${#checksum}" -ne 64 ]; then
    echo "Could not calculate a migration checksum" >&2
    exit 1
  fi
  case "$checksum" in
    *[!a-f0-9]*)
      echo "Migration checksum is not canonical SHA-256" >&2
      exit 1
      ;;
  esac

  applied_checksum="$(
    psql_platform --tuples-only --no-align --set=version="$version" <<'SQL'
SELECT checksum FROM platform_schema_migrations WHERE version = :'version';
SQL
  )"
  if [ -n "$applied_checksum" ]; then
    if [ "$applied_checksum" != "$checksum" ]; then
      echo "Applied migration checksum does not match the repository" >&2
      exit 1
    fi
    echo "Migration $version already applied"
    continue
  fi

  echo "Applying migration $version"
  {
    cat "$migration"
    printf "\nINSERT INTO platform_schema_migrations (version, checksum) VALUES ('%s', '%s');\n" \
      "$version" "$checksum"
  } | psql_platform --single-transaction
done

if [ "$found_migration" != "true" ]; then
  echo "No platform migrations were mounted" >&2
  exit 1
fi

# Schema migration is the sole owner path. Runtime services receive only the
# table/type privileges required by their reader or sync responsibilities.
psql_platform \
  --set=migration_user="$POSTGRES_USER" \
  --set=ai_reader_user="$AI_KNOWLEDGE_READER_DB_USER" \
  --set=ai_sync_user="$AI_KNOWLEDGE_SYNC_DB_USER" \
  --set=keycloak_user="$KEYCLOAK_DB_USER" \
  --file=/migrations/runtime-grants.sql

psql_platform --tuples-only --no-align --command="
  SELECT 'MIGRATIONS_OK count=' || count(*) FROM platform_schema_migrations;
"
