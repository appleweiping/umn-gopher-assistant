#!/bin/sh
set -eu

: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_USER:=gopher}"
: "${POSTGRES_DB:=gopher}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${AI_KNOWLEDGE_READER_DB_USER:=gopher_ai_reader}"
: "${AI_KNOWLEDGE_READER_DB_PASSWORD:?AI_KNOWLEDGE_READER_DB_PASSWORD is required}"
: "${AI_KNOWLEDGE_SYNC_DB_USER:=gopher_ai_sync}"
: "${AI_KNOWLEDGE_SYNC_DB_PASSWORD:?AI_KNOWLEDGE_SYNC_DB_PASSWORD is required}"
: "${API_PERSONAL_DB_USER:=gopher_api_personal}"
: "${API_PERSONAL_DB_PASSWORD:?API_PERSONAL_DB_PASSWORD is required}"
: "${KEYCLOAK_DB:=keycloak}"
: "${KEYCLOAK_DB_USER:=gopher_keycloak}"
: "${KEYCLOAK_DB_PASSWORD:?KEYCLOAK_DB_PASSWORD is required}"

validate_identifier() {
  identifier_name="$1"
  identifier_value="$2"
  case "$identifier_value" in
    ""|[0-9]*|*[!a-z0-9_]*)
      echo "$identifier_name must be a lowercase PostgreSQL identifier" >&2
      return 1
      ;;
  esac
  if [ "${#identifier_value}" -gt 63 ]; then
    echo "$identifier_name exceeds PostgreSQL's 63-byte identifier limit" >&2
    return 1
  fi
}

validate_identifier POSTGRES_USER "$POSTGRES_USER"
validate_identifier POSTGRES_DB "$POSTGRES_DB"
validate_identifier AI_KNOWLEDGE_READER_DB_USER "$AI_KNOWLEDGE_READER_DB_USER"
validate_identifier AI_KNOWLEDGE_SYNC_DB_USER "$AI_KNOWLEDGE_SYNC_DB_USER"
validate_identifier API_PERSONAL_DB_USER "$API_PERSONAL_DB_USER"
validate_identifier KEYCLOAK_DB "$KEYCLOAK_DB"
validate_identifier KEYCLOAK_DB_USER "$KEYCLOAK_DB_USER"

case "$KEYCLOAK_DB" in
  "$POSTGRES_DB"|postgres|template0|template1)
    echo "KEYCLOAK_DB must be a dedicated non-system database distinct from POSTGRES_DB" >&2
    exit 1
    ;;
esac

if [ "$AI_KNOWLEDGE_READER_DB_USER" = "$AI_KNOWLEDGE_SYNC_DB_USER" ] \
  || [ "$AI_KNOWLEDGE_READER_DB_USER" = "$API_PERSONAL_DB_USER" ] \
  || [ "$AI_KNOWLEDGE_READER_DB_USER" = "$KEYCLOAK_DB_USER" ] \
  || [ "$AI_KNOWLEDGE_SYNC_DB_USER" = "$API_PERSONAL_DB_USER" ] \
  || [ "$AI_KNOWLEDGE_SYNC_DB_USER" = "$KEYCLOAK_DB_USER" ] \
  || [ "$API_PERSONAL_DB_USER" = "$KEYCLOAK_DB_USER" ] \
  || [ "$POSTGRES_USER" = "$AI_KNOWLEDGE_READER_DB_USER" ] \
  || [ "$POSTGRES_USER" = "$AI_KNOWLEDGE_SYNC_DB_USER" ] \
  || [ "$POSTGRES_USER" = "$API_PERSONAL_DB_USER" ] \
  || [ "$POSTGRES_USER" = "$KEYCLOAK_DB_USER" ]; then
  echo "Migration, AI reader, AI sync, personal API, and Keycloak roles must all be distinct" >&2
  exit 1
fi

export PGPASSWORD="$POSTGRES_PASSWORD"

bootstrap_psql() {
  database_name="$1"
  shift
  if [ -n "${POSTGRES_HOST:-}" ]; then
    psql \
      --host="$POSTGRES_HOST" \
      --port="$POSTGRES_PORT" \
      --username="$POSTGRES_USER" \
      --dbname="$database_name" \
      --set=ON_ERROR_STOP=1 \
      "$@"
  else
    psql \
      --username="$POSTGRES_USER" \
      --dbname="$database_name" \
      --set=ON_ERROR_STOP=1 \
      "$@"
  fi
}

bootstrap_psql "$POSTGRES_DB" \
  --set=ai_reader_user="$AI_KNOWLEDGE_READER_DB_USER" \
  --set=ai_reader_password="$AI_KNOWLEDGE_READER_DB_PASSWORD" \
  --set=ai_sync_user="$AI_KNOWLEDGE_SYNC_DB_USER" \
  --set=ai_sync_password="$AI_KNOWLEDGE_SYNC_DB_PASSWORD" \
  --set=api_personal_user="$API_PERSONAL_DB_USER" \
  --set=api_personal_password="$API_PERSONAL_DB_PASSWORD" \
  --set=keycloak_user="$KEYCLOAK_DB_USER" \
  --set=keycloak_password="$KEYCLOAK_DB_PASSWORD" \
  --set=keycloak_db="$KEYCLOAK_DB" <<'SQL'
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'ai_reader_user', :'ai_reader_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'ai_reader_user')
\gexec
SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'ai_reader_user', :'ai_reader_password'
)
\gexec

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'ai_sync_user', :'ai_sync_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'ai_sync_user')
\gexec
SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'ai_sync_user', :'ai_sync_password'
)
\gexec

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'api_personal_user', :'api_personal_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'api_personal_user')
\gexec
SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'api_personal_user', :'api_personal_password'
)
\gexec

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'keycloak_user', :'keycloak_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'keycloak_user')
\gexec
SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'keycloak_user', :'keycloak_password'
)
\gexec

-- NOINHERIT does not prevent explicit SET ROLE. Retained development volumes
-- may contain accidental memberships from older local experiments, so remove
-- every role granted to a runtime identity before issuing runtime privileges.
SELECT format('REVOKE %I FROM %I', granted.rolname, member.rolname)
FROM pg_auth_members AS membership
JOIN pg_roles AS granted ON granted.oid = membership.roleid
JOIN pg_roles AS member ON member.oid = membership.member
WHERE member.rolname IN (
  :'ai_reader_user',
  :'ai_sync_user',
  :'api_personal_user',
  :'keycloak_user'
)
\gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'keycloak_db', :'keycloak_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'keycloak_db')
\gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', :'keycloak_db', :'keycloak_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM PUBLIC', :'keycloak_db')
\gexec
SELECT format(
  'GRANT CONNECT, CREATE, TEMPORARY ON DATABASE %I TO %I',
  :'keycloak_db', :'keycloak_user'
)
\gexec
SQL

# Older local releases connected Keycloak as the platform migration owner. A
# retained development database may therefore contain Keycloak-owned objects
# under that old role. Move only objects inside the dedicated Keycloak database;
# never use REASSIGN OWNED, which could also mutate shared ownership.
bootstrap_psql "$KEYCLOAK_DB" --set=keycloak_user="$KEYCLOAK_DB_USER" <<'SQL'
SELECT format('ALTER SCHEMA %I OWNER TO %I', n.nspname, :'keycloak_user')
FROM pg_namespace AS n
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
\gexec

SELECT format(
  'ALTER %s %I.%I OWNER TO %I',
  CASE c.relkind
    WHEN 'r' THEN 'TABLE'
    WHEN 'p' THEN 'TABLE'
    WHEN 'S' THEN 'SEQUENCE'
    WHEN 'v' THEN 'VIEW'
    WHEN 'm' THEN 'MATERIALIZED VIEW'
    WHEN 'f' THEN 'FOREIGN TABLE'
  END,
  n.nspname,
  c.relname,
  :'keycloak_user'
)
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
\gexec

SELECT format(
  'ALTER %s %I.%I(%s) OWNER TO %I',
  CASE p.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
  n.nspname,
  p.proname,
  pg_get_function_identity_arguments(p.oid),
  :'keycloak_user'
)
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
\gexec
SQL
