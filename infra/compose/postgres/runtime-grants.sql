\set ON_ERROR_STOP on

REVOKE ALL PRIVILEGES ON DATABASE :DBNAME FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE USAGE ON TYPE campus_id, license_status, freshness_state, verification_state, ai_locale, knowledge_category, knowledge_ingestion_status, knowledge_source_role FROM PUBLIC;

SELECT format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I', current_database(), :'ai_reader_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I', current_database(), :'ai_sync_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I', current_database(), :'keycloak_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON SCHEMA public FROM %I', :'ai_reader_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON SCHEMA public FROM %I', :'ai_sync_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', :'ai_reader_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', :'ai_sync_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', :'ai_reader_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', :'ai_sync_user')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'ai_reader_user')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'ai_sync_user')
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'ai_reader_user')
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'ai_sync_user')
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
