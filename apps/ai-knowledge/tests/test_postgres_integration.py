from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime
from pathlib import Path

import psycopg
import pytest
from conftest import CORPUS_PATH
from psycopg.rows import dict_row

from ai_knowledge.corpus import CorpusIntegrityError
from ai_knowledge.database import PostgreSQLKnowledgeRepository
from ai_knowledge.models import QueryRequest
from ai_knowledge.retrieval import HybridRetriever
from ai_knowledge.sync import CorpusSyncError, sync_corpus

pytestmark = pytest.mark.integration


def integration_database_url() -> str:
    database_url = os.environ.get("AI_KNOWLEDGE_INTEGRATION_DATABASE_URL")
    if not database_url:
        pytest.skip(
            "set AI_KNOWLEDGE_INTEGRATION_DATABASE_URL to a migrated disposable "
            "PostgreSQL 17 database"
        )
    return database_url


def corpus_identities(
    database_url: str,
) -> tuple[list[tuple[object, ...]], list[tuple[object, ...]]]:
    with psycopg.connect(database_url) as connection:
        documents = connection.execute(
            "SELECT external_id, id::text FROM knowledge_documents ORDER BY external_id"
        ).fetchall()
        citations = connection.execute(
            "SELECT citation_key, id::text FROM knowledge_citations ORDER BY citation_key"
        ).fetchall()
    return documents, citations


def test_postgres_17_sync_loader_and_database_guards(tmp_path: Path) -> None:
    database_url = integration_database_url()
    first = sync_corpus(database_url, Path(CORPUS_PATH))
    first_identities = corpus_identities(database_url)
    second = sync_corpus(database_url, Path(CORPUS_PATH))
    assert second == first
    assert corpus_identities(database_url) == first_identities

    with PostgreSQLKnowledgeRepository(database_url) as repository:
        snapshot = repository.snapshot()
    result = HybridRetriever(clock=lambda: datetime(2026, 7, 22, tzinfo=UTC)).query(
        QueryRequest(campusId="tc", locale="en", query="library research help"),
        snapshot,
    )
    assert len(snapshot.documents) == 25
    assert result.state == "answered"
    assert result.citations[0].verification_link.source_id == "official-tc-library"
    assert result.citations[0].summary_source.corpus_sha256 == first.corpus_version
    assert result.retrieval.mode == "no-key-hybrid"

    with psycopg.connect(database_url, row_factory=dict_row) as connection:
        chunk_capability = connection.execute(
            """
            SELECT search_vector IS NOT NULL AS generated_lexical,
                   embedding IS NULL AS embedding_unavailable
            FROM knowledge_chunks
            ORDER BY document_id, locale, ordinal
            LIMIT 1
            """
        ).fetchone()
        assert chunk_capability == {
            "generated_lexical": True,
            "embedding_unavailable": True,
        }
        governance = connection.execute(
            """
            SELECT
              count(*) AS total,
              count(*) FILTER (
                WHERE role = 'PROJECT_SUMMARY'
                  AND license_status = 'OPEN_REUSE'
                  AND license_evidence_url = 'https://www.apache.org/licenses/LICENSE-2.0'
              ) AS summaries,
              count(*) FILTER (
                WHERE role = 'OFFICIAL_VERIFICATION'
                  AND license_status = 'DEEPLINK_ONLY'
                  AND license_evidence_url IS NULL
              ) AS verification_links
            FROM knowledge_sources
            """
        ).fetchone()
        assert governance == {"total": 26, "summaries": 1, "verification_links": 25}
        evidence = connection.execute(
            """
            SELECT
              first_document.id::text AS first_document_id,
              second_chunk.id::text AS second_chunk_id,
              citation.id::text AS citation_id
            FROM knowledge_documents AS first_document
            CROSS JOIN LATERAL (
              SELECT chunk.id
              FROM knowledge_chunks AS chunk
              WHERE chunk.document_id <> first_document.id
              ORDER BY chunk.id
              LIMIT 1
            ) AS second_chunk
            CROSS JOIN LATERAL (
              SELECT id FROM knowledge_citations ORDER BY id LIMIT 1
            ) AS citation
            ORDER BY first_document.id
            LIMIT 1
            """
        ).fetchone()
        assert evidence is not None

    with (
        pytest.raises(psycopg.errors.ForeignKeyViolation),
        psycopg.connect(database_url) as connection,
    ):
        connection.execute(
            """
            INSERT INTO knowledge_citations (
              citation_key, document_id, chunk_id, excerpt, content_hash
            ) VALUES (%s, %s, %s, %s, %s)
            """,
            (
                f"integration-cross-document-{uuid.uuid4()}",
                evidence["first_document_id"],
                evidence["second_chunk_id"],
                "must be rejected",
                "a" * 64,
            ),
        )

    with (
        pytest.raises(psycopg.errors.RaiseException),
        psycopg.connect(database_url) as connection,
    ):
        connection.execute(
            "UPDATE knowledge_citations SET excerpt = excerpt || ' changed' WHERE id = %s",
            (evidence["citation_id"],),
        )

    with (
        pytest.raises(psycopg.errors.CheckViolation),
        psycopg.connect(database_url) as connection,
    ):
        connection.execute(
            """
            UPDATE knowledge_sources
            SET license_status = 'OPEN_REUSE',
                license_evidence_url = 'https://www.apache.org/licenses/LICENSE-2.0'
            WHERE external_id = 'official-tc-library'
            """
        )

    with psycopg.connect(database_url) as connection:
        connection.execute(
            "UPDATE knowledge_sources SET enabled = false WHERE external_id = 'official-tc-library'"
        )
    with (
        PostgreSQLKnowledgeRepository(database_url) as repository,
        pytest.raises(CorpusIntegrityError, match="projection integrity"),
    ):
        repository.snapshot()
    sync_corpus(database_url, Path(CORPUS_PATH))

    for table in ("knowledge_citations", "knowledge_chunks"):
        with psycopg.connect(database_url) as connection:
            connection.execute(
                f"DELETE FROM {table} WHERE id = (SELECT id FROM {table} ORDER BY id LIMIT 1)"
            )
        with (
            PostgreSQLKnowledgeRepository(database_url) as repository,
            pytest.raises(CorpusIntegrityError, match="projection integrity"),
        ):
            repository.snapshot()
        sync_corpus(database_url, Path(CORPUS_PATH))

    invalid_corpus = tmp_path / "invalid-corpus.json"
    invalid_corpus.write_bytes(b'{"documents":[invalid]}')
    with pytest.raises(CorpusSyncError):
        sync_corpus(database_url, invalid_corpus)
    with psycopg.connect(database_url, row_factory=dict_row) as connection:
        latest_ingestion = connection.execute(
            """
            SELECT status::text AS status, documents_seen
            FROM knowledge_ingestion_runs
            ORDER BY started_at DESC, created_at DESC, id DESC
            LIMIT 1
            """
        ).fetchone()
    assert latest_ingestion == {"status": "failed", "documents_seen": 0}
    with (
        PostgreSQLKnowledgeRepository(database_url) as repository,
        pytest.raises(CorpusIntegrityError, match="no usable ingestion"),
    ):
        repository.snapshot()
    sync_corpus(database_url, Path(CORPUS_PATH))

    try:
        with psycopg.connect(database_url, row_factory=dict_row) as connection:
            deleted = connection.execute(
                """
                SELECT d.id::text AS document_id,
                       count(DISTINCT c.id) AS chunks,
                       count(DISTINCT ci.id) AS citations
                FROM knowledge_documents AS d
                JOIN knowledge_chunks AS c ON c.document_id = d.id
                JOIN knowledge_citations AS ci ON ci.document_id = d.id
                GROUP BY d.id
                ORDER BY d.id
                LIMIT 1
                """
            ).fetchone()
            assert deleted is not None and deleted["chunks"] > 0 and deleted["citations"] > 0
            connection.execute(
                "DELETE FROM knowledge_documents WHERE id = %s",
                (deleted["document_id"],),
            )
            remaining = connection.execute(
                """
                SELECT
                  (SELECT count(*) FROM knowledge_chunks WHERE document_id = %s) AS chunks,
                  (SELECT count(*) FROM knowledge_citations WHERE document_id = %s) AS citations
                """,
                (deleted["document_id"], deleted["document_id"]),
            ).fetchone()
            assert remaining == {"chunks": 0, "citations": 0}
        with (
            PostgreSQLKnowledgeRepository(database_url) as repository,
            pytest.raises(CorpusIntegrityError, match="projection integrity"),
        ):
            repository.snapshot()
    finally:
        sync_corpus(database_url, Path(CORPUS_PATH))
