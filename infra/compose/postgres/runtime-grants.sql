\set ON_ERROR_STOP on

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

REVOKE ALL PRIVILEGES ON DATABASE :DBNAME FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE USAGE ON TYPE campus_id, license_status, freshness_state, verification_state, ai_locale, knowledge_category, knowledge_ingestion_status, knowledge_source_role, account_status, personal_vault_command_actor_kind, personal_vault_command_status, personal_vault_device_status, personal_vault_pairing_state FROM PUBLIC;

SELECT format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I', current_database(), :'ai_reader_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I', current_database(), :'ai_sync_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I', current_database(), :'api_personal_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I', current_database(), :'keycloak_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON SCHEMA public FROM %I', :'ai_reader_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON SCHEMA public FROM %I', :'ai_sync_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON SCHEMA public FROM %I', :'api_personal_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', :'ai_reader_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', :'ai_sync_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', :'api_personal_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', :'ai_reader_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', :'ai_sync_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', :'api_personal_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I', :'ai_reader_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I', :'ai_sync_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I', :'api_personal_user')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'ai_reader_user')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'ai_sync_user')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'api_personal_user')
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'ai_reader_user')
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'ai_sync_user')
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'api_personal_user')
\gexec

SELECT format(
  'GRANT SELECT ON TABLE knowledge_sources, knowledge_documents, knowledge_chunks, knowledge_citations, knowledge_ingestion_runs TO %I',
  :'ai_reader_user'
)
\gexec

SELECT format(
  'GRANT SELECT ON TABLE campuses, knowledge_sources, knowledge_documents, knowledge_chunks, knowledge_citations, knowledge_ingestion_runs TO %I',
  :'ai_sync_user'
)
\gexec
SELECT format(
  'GRANT INSERT, UPDATE, DELETE ON TABLE knowledge_sources, knowledge_documents, knowledge_chunks TO %I',
  :'ai_sync_user'
)
\gexec
SELECT format(
  'GRANT INSERT, DELETE ON TABLE knowledge_citations TO %I',
  :'ai_sync_user'
)
\gexec
SELECT format(
  'GRANT INSERT, UPDATE ON TABLE knowledge_ingestion_runs TO %I',
  :'ai_sync_user'
)
\gexec
SELECT format('REVOKE UPDATE ON TABLE knowledge_citations FROM %I', :'ai_sync_user')
\gexec
SELECT format(
  'GRANT USAGE ON TYPE campus_id, license_status, freshness_state, verification_state, ai_locale, knowledge_category, knowledge_ingestion_status, knowledge_source_role TO %I',
  :'ai_reader_user'
)
\gexec
SELECT format(
  'GRANT USAGE ON TYPE campus_id, license_status, freshness_state, verification_state, ai_locale, knowledge_category, knowledge_ingestion_status, knowledge_source_role TO %I',
  :'ai_sync_user'
)
\gexec
-- Assigning into vector(384) invokes pgvector's implicit self-cast even when the
-- supplied embedding is NULL. The sync role needs only that typmod coercion;
-- vector search, distance, and output functions remain unavailable.
SELECT format(
  'GRANT EXECUTE ON FUNCTION public.vector(public.vector, integer, boolean) TO %I',
  :'ai_sync_user'
)
\gexec

SELECT format(
  'GRANT EXECUTE ON FUNCTION resolve_personal_account(bytea, smallint, bytea, smallint) TO %I',
  :'api_personal_user'
)
\gexec
SELECT format(
  'GRANT EXECUTE ON FUNCTION assert_account_hmac_key_continuity(smallint, bytea, smallint, bytea, boolean, boolean) TO %I',
  :'api_personal_user'
)
\gexec
SELECT format(
  'GRANT SELECT, INSERT, UPDATE ON TABLE personal_vaults TO %I',
  :'api_personal_user'
)
\gexec
SELECT format(
  'GRANT SELECT, INSERT ON TABLE personal_vault_payloads, personal_vault_keyrings, personal_vault_manifests, personal_vault_commits TO %I',
  :'api_personal_user'
)
\gexec
SELECT format(
  'GRANT SELECT, INSERT, UPDATE ON TABLE personal_vault_devices, personal_vault_pairings, personal_vault_commands TO %I',
  :'api_personal_user'
)
\gexec
SELECT format(
  'GRANT USAGE ON TYPE personal_vault_command_actor_kind, personal_vault_command_status, personal_vault_device_status, personal_vault_pairing_state TO %I',
  :'api_personal_user'
)
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC',
  :'migration_user'
)
\gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC',
  :'migration_user'
)
\gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON TYPES FROM PUBLIC',
  :'migration_user'
)
\gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
  :'migration_user'
)
\gexec

COMMIT;
