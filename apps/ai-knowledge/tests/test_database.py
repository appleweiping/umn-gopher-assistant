from __future__ import annotations

import hashlib
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import psycopg
import pytest
from conftest import CORPUS_PATH, FIXED_NOW, read_corpus

from ai_knowledge.corpus import CorpusIntegrityError, CorpusSnapshot, KnowledgeRepository
from ai_knowledge.database import (
    ACTIVE_CHUNKS_SQL,
    ACTIVE_CITATIONS_SQL,
    ACTIVE_DOCUMENTS_SQL,
    ACTIVE_SOURCES_SQL,
    DATABASE_CAPABILITIES_SQL,
    LATEST_INGESTION_SQL,
    PostgreSQLKnowledgeRepository,
    verify_database_capabilities,
)
from ai_knowledge.database import (
    _build_snapshot as _build_snapshot_from_rows,
)
from ai_knowledge.models import KnowledgeDocument, QueryRequest
from ai_knowledge.projection import PROJECTION_METADATA_SQL
from ai_knowledge.retrieval import HybridRetriever


def database_source_rows() -> list[dict[str, Any]]:
    manifest = read_corpus()
    document = manifest["documents"][0]
    source_ids = {document["summarySourceId"], document["verificationSourceId"]}
    rows: list[dict[str, Any]] = []
    for source in manifest["sourceRegistry"]:
        if source["id"] not in source_ids:
            continue
        rows.append(
            {
                "external_id": source["id"],
                "campus_ids": source["campusIds"],
                "role": (
                    "PROJECT_SUMMARY"
                    if source["resourceKinds"] == ["AI_KNOWLEDGE_SUMMARY"]
                    else "OFFICIAL_VERIFICATION"
                ),
                "source_url": source["sourceUrl"],
                "license_status": source["licenseStatus"],
                "license_evidence_url": source["licenseEvidenceUrl"],
                "enabled": source["killSwitch"]["defaultState"] == "ENABLED",
            }
        )
    return rows


def _build_snapshot(**kwargs: Any) -> CorpusSnapshot:
    kwargs.setdefault("source_rows", database_source_rows())
    return _build_snapshot_from_rows(**kwargs)


def database_rows() -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    document = KnowledgeDocument.model_validate(read_corpus()["documents"][0])
    document_id = "00000000-0000-4000-8000-000000000001"
    document_row = {
        "document_id": document_id,
        "external_id": document.id,
        "summary_source_id": document.summary_source_id,
        "verification_source_id": document.verification_source_id,
        "campus_id": document.campus_id,
        "category": document.category,
        "title_en": document.title.en,
        "title_zh_cn": document.title.zh_cn,
        "body_en": document.content.en,
        "body_zh_cn": document.content.zh_cn,
        "keywords_en": document.keywords.en,
        "keywords_zh_cn": document.keywords.zh_cn,
        "summary_source_campus_ids": ["tc", "duluth", "crookston", "morris", "rochester"],
        "summary_source_role": "PROJECT_SUMMARY",
        "summary_source_url": "https://github.com/appleweiping/umn-gopher-assistant/blob/main/apps/ai-knowledge/ai_knowledge/data/corpus.json",
        "summary_license_status": "OPEN_REUSE",
        "summary_license_evidence_url": "https://www.apache.org/licenses/LICENSE-2.0",
        "summary_source_enabled": True,
        "verification_source_campus_ids": [document.campus_id],
        "verification_source_role": "OFFICIAL_VERIFICATION",
        "verification_url": str(document.verification_url),
        "verification_license_status": "DEEPLINK_ONLY",
        "verification_license_evidence_url": None,
        "verification_source_enabled": True,
        "content_hash": document.content_sha256,
        "freshness_state": "FRESH",
        "fresh_for_days": document.fresh_for_days,
        "verification_state": document.verification_state.value,
        "enabled": True,
        "reviewed_at": document.updated_at,
        "retired_at": None,
        "conflict_group": document.conflict_group,
        "conflict_variant": document.conflict_variant,
    }
    chunks: list[dict[str, Any]] = []
    citations: list[dict[str, Any]] = []
    for index, (locale, content) in enumerate(
        (("en", document.content.en), ("zh-CN", document.content.zh_cn)),
        start=1,
    ):
        chunk_id = f"00000000-0000-4000-8000-{index:012d}"
        content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
        chunks.append(
            {
                "chunk_id": chunk_id,
                "document_id": document_id,
                "locale": locale,
                "ordinal": 0,
                "content": content,
                "content_hash": content_hash,
                "token_count": 10,
                "document_campus_id": document.campus_id,
            }
        )
        citations.append(
            {
                "citation_id": f"10000000-0000-4000-8000-{index:012d}",
                "citation_key": f"{document.id}:{locale.casefold()}",
                "document_id": document_id,
                "chunk_id": chunk_id,
                "excerpt": content[:500],
                "content_hash": content_hash,
                "chunk_document_id": document_id,
                "chunk_locale": locale,
                "chunk_ordinal": 0,
                "document_campus_id": document.campus_id,
                "chunk_document_campus_id": document.campus_id,
            }
        )
    return [document_row], chunks, citations


def test_database_rows_rebuild_the_existing_deterministic_corpus_model() -> None:
    documents, chunks, citations = database_rows()
    snapshot = _build_snapshot(
        corpus_version="a" * 64,
        document_rows=documents,
        chunk_rows=chunks,
        citation_rows=citations,
    )
    assert snapshot.corpus_sha256 == "a" * 64
    assert len(snapshot.documents) == 1
    assert (
        snapshot.documents[0].model_dump()
        == KnowledgeDocument.model_validate(read_corpus()["documents"][0]).model_dump()
    )


def test_file_and_postgres_snapshots_emit_identical_citation_provenance() -> None:
    local_snapshot = KnowledgeRepository(CORPUS_PATH).snapshot()
    documents, chunks, citations = database_rows()
    database_snapshot = _build_snapshot(
        corpus_version=local_snapshot.corpus_sha256,
        document_rows=documents,
        chunk_rows=chunks,
        citation_rows=citations,
    )
    request = QueryRequest(campusId="tc", locale="en", query="library research catalog")
    retriever = HybridRetriever(clock=lambda: FIXED_NOW)

    local = retriever.query(request, local_snapshot)
    projected = retriever.query(request, database_snapshot)

    assert projected.state == local.state
    assert projected.paragraphs == local.paragraphs
    assert projected.citations == local.citations


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("enabled", False),
        ("retired_at", "2026-07-23T00:00:00Z"),
        ("verification_state", "retired"),
        ("campus_id", "unknown"),
    ],
)
def test_loader_rejects_any_nonpublishable_row_that_escapes_sql_filtering(
    field: str, value: object
) -> None:
    documents, chunks, citations = database_rows()
    documents[0][field] = value
    with pytest.raises(CorpusIntegrityError, match="escaped database filtering"):
        _build_snapshot(
            corpus_version="a" * 64,
            document_rows=documents,
            chunk_rows=chunks,
            citation_rows=citations,
        )


@pytest.mark.parametrize("verification_state", ["surveyed", "campus-reviewed", "verified"])
def test_loader_rejects_active_review_claims_without_evidence(
    verification_state: str,
) -> None:
    documents, chunks, citations = database_rows()
    documents[0]["verification_state"] = verification_state
    with pytest.raises(CorpusIntegrityError, match="lack supported review evidence"):
        _build_snapshot(
            corpus_version="a" * 64,
            document_rows=documents,
            chunk_rows=chunks,
            citation_rows=citations,
        )


@pytest.mark.parametrize(
    ("source_index", "field", "value", "message"),
    [
        (
            0,
            "license_evidence_url",
            "https://www.apache.org/licenses/LICENSE-1.0",
            "summary source governance",
        ),
        (0, "enabled", False, "summary source governance"),
        (1, "source_url", "https://safe-campus.umn.edu/", "verification source governance"),
        (
            1,
            "license_evidence_url",
            "https://www.apache.org/licenses/LICENSE-2.0",
            "source validation",
        ),
        (1, "enabled", False, "verification source governance"),
    ],
)
def test_loader_binds_active_source_rows_exactly(
    source_index: int, field: str, value: object, message: str
) -> None:
    documents, chunks, citations = database_rows()
    sources = database_source_rows()
    sources[source_index][field] = value
    with pytest.raises(CorpusIntegrityError, match=message):
        _build_snapshot(
            corpus_version="a" * 64,
            source_rows=sources,
            document_rows=documents,
            chunk_rows=chunks,
            citation_rows=citations,
        )


def test_loader_requires_exact_active_source_registry() -> None:
    documents, chunks, citations = database_rows()
    sources = database_source_rows()
    with pytest.raises(CorpusIntegrityError, match="exactly match"):
        _build_snapshot(
            corpus_version="a" * 64,
            source_rows=sources[:1],
            document_rows=documents,
            chunk_rows=chunks,
            citation_rows=citations,
        )

    orphan = {**sources[1], "external_id": "official-tc-orphan"}
    with pytest.raises(CorpusIntegrityError, match="exactly match"):
        _build_snapshot(
            corpus_version="a" * 64,
            source_rows=[*sources, orphan],
            document_rows=documents,
            chunk_rows=chunks,
            citation_rows=citations,
        )


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("summary_source_role", "OFFICIAL_VERIFICATION", "summary source governance"),
        ("summary_license_status", "DEEPLINK_ONLY", "summary source governance"),
        ("summary_license_evidence_url", None, "summary license evidence"),
        ("summary_source_enabled", False, "summary source governance"),
        ("summary_source_campus_ids", ["tc"], "summary source governance"),
        ("verification_source_role", "PROJECT_SUMMARY", "verification source governance"),
        ("verification_license_status", "OPEN_REUSE", "verification source governance"),
        (
            "verification_license_evidence_url",
            "https://www.apache.org/licenses/LICENSE-2.0",
            "verification source governance",
        ),
        ("verification_source_enabled", False, "verification source governance"),
        ("verification_source_campus_ids", ["morris"], "verification source governance"),
        ("verification_url", "https://example.test/", "verification source governance"),
    ],
)
def test_loader_fails_closed_for_wrong_or_disabled_source_governance(
    field: str, value: object, message: str
) -> None:
    documents, chunks, citations = database_rows()
    documents[0][field] = value
    with pytest.raises(CorpusIntegrityError, match=message):
        _build_snapshot(
            corpus_version="a" * 64,
            document_rows=documents,
            chunk_rows=chunks,
            citation_rows=citations,
        )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("chunk_document_id", "different-document"),
        ("chunk_document_campus_id", "morris"),
        ("content_hash", "b" * 64),
        ("excerpt", "different excerpt"),
    ],
)
def test_loader_validates_citation_chunk_document_and_campus_consistency(
    field: str, value: object
) -> None:
    documents, chunks, citations = database_rows()
    citations[0][field] = value
    with pytest.raises(CorpusIntegrityError, match="inconsistent"):
        _build_snapshot(
            corpus_version="a" * 64,
            document_rows=documents,
            chunk_rows=chunks,
            citation_rows=citations,
        )


def test_loader_rejects_missing_or_orphaned_evidence() -> None:
    documents, chunks, citations = database_rows()
    with pytest.raises(CorpusIntegrityError, match="one chunk per locale"):
        _build_snapshot(
            corpus_version="a" * 64,
            document_rows=documents,
            chunk_rows=chunks[:1],
            citation_rows=citations[:1],
        )


@pytest.mark.parametrize(
    ("target", "field", "value", "message"),
    [
        ("version", "", "not-a-hash", "revision"),
        ("chunk", "locale", "fr", "chunk identity"),
        ("chunk", "content", " ", "chunk content"),
        ("chunk", "token_count", True, "chunk content"),
        ("citation", "citation_key", "", "citation identity"),
        ("citation", "chunk_id", "missing", "unavailable chunk"),
        ("document", "external_id", 42, "document identity"),
        ("document", "verification_source_id", "INVALID", "document validation"),
        ("document", "summary_license_evidence_url", 42, "license evidence"),
        (
            "document",
            "summary_license_evidence_url",
            "http://example.test/license",
            "license evidence",
        ),
    ],
)
def test_loader_rejects_malformed_database_projections(
    target: str, field: str, value: object, message: str
) -> None:
    documents, chunks, citations = database_rows()
    version: object = "a" * 64
    if target == "version":
        version = value
    elif target == "chunk":
        chunks[0][field] = value
    elif target == "citation":
        citations[0][field] = value
    else:
        documents[0][field] = value
    with pytest.raises(CorpusIntegrityError, match=message):
        _build_snapshot(
            corpus_version=version,
            document_rows=documents,
            chunk_rows=chunks,
            citation_rows=citations,
        )


def test_loader_rejects_duplicate_chunks_citations_documents_and_missing_locale_citation() -> None:
    documents, chunks, citations = database_rows()
    with pytest.raises(CorpusIntegrityError, match="chunks are not unique"):
        _build_snapshot(
            corpus_version="a" * 64,
            document_rows=documents,
            chunk_rows=[*chunks, {**chunks[0]}],
            citation_rows=citations,
        )

    with pytest.raises(CorpusIntegrityError, match="citation identity"):
        _build_snapshot(
            corpus_version="a" * 64,
            document_rows=documents,
            chunk_rows=chunks,
            citation_rows=[*citations, {**citations[0]}],
        )

    with pytest.raises(CorpusIntegrityError, match="document identity"):
        _build_snapshot(
            corpus_version="a" * 64,
            document_rows=[*documents, {**documents[0]}],
            chunk_rows=chunks,
            citation_rows=citations,
        )

    with pytest.raises(CorpusIntegrityError, match="one citation per locale"):
        _build_snapshot(
            corpus_version="a" * 64,
            document_rows=documents,
            chunk_rows=chunks,
            citation_rows=citations[:1],
        )

    changed_content = "A valid but inconsistent database chunk."
    changed_hash = hashlib.sha256(changed_content.encode("utf-8")).hexdigest()
    chunks[0].update(content=changed_content, content_hash=changed_hash)
    citations[0].update(excerpt=changed_content, content_hash=changed_hash)
    with pytest.raises(CorpusIntegrityError, match="chunks do not match"):
        _build_snapshot(
            corpus_version="a" * 64,
            document_rows=documents,
            chunk_rows=chunks,
            citation_rows=citations,
        )

    documents, chunks, citations = database_rows()
    orphan_chunk = {**chunks[0], "chunk_id": "orphan", "document_id": "orphan-document"}
    with pytest.raises(CorpusIntegrityError, match="orphaned"):
        _build_snapshot(
            corpus_version="a" * 64,
            document_rows=documents,
            chunk_rows=[*chunks, orphan_chunk],
            citation_rows=citations,
        )


@pytest.mark.parametrize(
    "capabilities",
    [
        {
            "server_version_num": 160000,
            "vector_version": "0.8.2",
            "embedding_nullable": True,
            "document_metadata_ready": True,
            "source_governance_ready": True,
            "projection_metadata_ready": True,
        },
        {
            "server_version_num": 170000,
            "vector_version": "",
            "embedding_nullable": True,
            "document_metadata_ready": True,
            "source_governance_ready": True,
            "projection_metadata_ready": True,
        },
        {
            "server_version_num": 170000,
            "vector_version": "0.8.2",
            "embedding_nullable": False,
            "document_metadata_ready": True,
            "source_governance_ready": True,
            "projection_metadata_ready": True,
        },
        {
            "server_version_num": 170000,
            "vector_version": "0.8.2",
            "embedding_nullable": True,
            "document_metadata_ready": False,
            "source_governance_ready": True,
            "projection_metadata_ready": True,
        },
        {
            "server_version_num": 170000,
            "vector_version": "0.8.2",
            "embedding_nullable": True,
            "document_metadata_ready": True,
            "source_governance_ready": False,
            "projection_metadata_ready": True,
        },
        {
            "server_version_num": 170000,
            "vector_version": "0.8.2",
            "embedding_nullable": True,
            "document_metadata_ready": True,
            "source_governance_ready": True,
            "projection_metadata_ready": False,
        },
    ],
)
def test_database_capabilities_fail_closed(capabilities: Mapping[str, object]) -> None:
    with pytest.raises(CorpusIntegrityError):
        verify_database_capabilities(capabilities)


class FakeCursor:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    def fetchone(self) -> dict[str, Any] | None:
        return self.rows[0] if self.rows else None

    def fetchall(self) -> list[dict[str, Any]]:
        return self.rows


class FakeReadConnection:
    def __init__(
        self,
        *,
        ingestion_status: str = "succeeded",
        corpus_version: str = "c" * 64,
        missing_capabilities: bool = False,
        projection_payload: str = '{"projection":"current"}',
        expected_projection_payload: str | None = None,
    ) -> None:
        documents, chunks, citations = database_rows()
        sources = database_source_rows()
        expected_payload = expected_projection_payload or projection_payload
        projection_sha256 = hashlib.sha256(expected_payload.encode("utf-8")).hexdigest()
        self.responses = {
            DATABASE_CAPABILITIES_SQL: []
            if missing_capabilities
            else [
                {
                    "server_version_num": 170006,
                    "vector_version": "0.8.2",
                    "embedding_nullable": True,
                    "document_metadata_ready": True,
                    "source_governance_ready": True,
                    "projection_metadata_ready": True,
                }
            ],
            LATEST_INGESTION_SQL: [
                {
                    "status": ingestion_status,
                    "corpus_version": corpus_version,
                    "projection_sha256": projection_sha256
                    if ingestion_status == "succeeded"
                    else None,
                    "projection_sources": 2 if ingestion_status == "succeeded" else None,
                    "projection_documents": 1 if ingestion_status == "succeeded" else None,
                    "projection_chunks": 2 if ingestion_status == "succeeded" else None,
                    "projection_citations": 2 if ingestion_status == "succeeded" else None,
                }
            ],
            PROJECTION_METADATA_SQL: [
                {
                    "projection_payload": projection_payload,
                    "projection_sources": 2,
                    "projection_documents": 1,
                    "projection_chunks": 2,
                    "projection_citations": 2,
                }
            ],
            ACTIVE_SOURCES_SQL: sources,
            ACTIVE_DOCUMENTS_SQL: documents,
            ACTIVE_CHUNKS_SQL: chunks,
            ACTIVE_CITATIONS_SQL: citations,
        }
        self.executed: list[str] = []

    def __enter__(self) -> FakeReadConnection:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def execute(self, query: str, _parameters: object = None) -> FakeCursor:
        self.executed.append(query)
        return FakeCursor(self.responses.get(query, []))


def test_postgres_repository_uses_a_read_only_consistent_transaction() -> None:
    connection = FakeReadConnection()
    captured: dict[str, object] = {}

    def connector(database_url: str, **kwargs: object) -> FakeReadConnection:
        captured.update(database_url=database_url, **kwargs)
        return connection

    repository = PostgreSQLKnowledgeRepository(
        "postgresql://gopher:secret@postgres/gopher",
        connector=connector,
    )
    snapshot = repository.snapshot()
    assert len(snapshot.documents) == 1
    assert connection.executed[0] == "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
    assert captured["connect_timeout"] == 5
    assert "secret" not in repr(repository)


def test_latest_failed_ingestion_and_connection_errors_are_sanitized() -> None:
    repository = PostgreSQLKnowledgeRepository(
        "postgresql://gopher:secret@postgres/gopher",
        connector=lambda *_args, **_kwargs: FakeReadConnection(ingestion_status="failed"),
    )
    with pytest.raises(CorpusIntegrityError, match="no usable ingestion"):
        repository.snapshot()

    def failed_connector(*_args: object, **_kwargs: object) -> FakeReadConnection:
        raise psycopg.OperationalError("password=do-not-expose")

    repository = PostgreSQLKnowledgeRepository(
        "postgresql://gopher:secret@postgres/gopher",
        connector=failed_connector,
    )
    with pytest.raises(CorpusIntegrityError) as captured:
        repository.snapshot()
    assert "do-not-expose" not in str(captured.value)

    repository = PostgreSQLKnowledgeRepository(
        "postgresql:///gopher",
        connector=lambda *_args, **_kwargs: FakeReadConnection(missing_capabilities=True),
    )
    with pytest.raises(CorpusIntegrityError, match="capabilities are unavailable"):
        repository.snapshot()


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("projection_payload", '{"projection":"tampered"}'),
        ("projection_sources", 1),
        ("projection_documents", 0),
        ("projection_chunks", 1),
        ("projection_citations", 1),
    ],
)
def test_projection_digest_and_counts_fail_closed_for_deleted_or_tampered_rows(
    field: str, value: object
) -> None:
    connection = FakeReadConnection()
    connection.responses[PROJECTION_METADATA_SQL][0][field] = value
    repository = PostgreSQLKnowledgeRepository(
        "postgresql:///gopher", connector=lambda *_args, **_kwargs: connection
    )
    with pytest.raises(CorpusIntegrityError, match="projection integrity"):
        repository.snapshot()


def test_cached_projection_is_reverified_at_the_bounded_snapshot_ttl() -> None:
    clock = ManualClock()
    connection = FakeReadConnection()
    repository = PostgreSQLKnowledgeRepository(
        "postgresql:///gopher",
        connector=lambda *_args, **_kwargs: connection,
        clock=clock,
        snapshot_cache_ttl_seconds=30,
        revision_check_interval_seconds=1,
    )
    assert len(repository.snapshot().documents) == 1
    connection.responses[PROJECTION_METADATA_SQL][0]["projection_payload"] = (
        '{"projection":"tampered"}'
    )
    clock.value += 30.1
    with pytest.raises(CorpusIntegrityError, match="projection integrity"):
        repository.snapshot()


def test_succeeded_ingestion_requires_complete_projection_metadata() -> None:
    connection = FakeReadConnection()
    connection.responses[LATEST_INGESTION_SQL][0]["projection_sha256"] = None
    repository = PostgreSQLKnowledgeRepository(
        "postgresql:///gopher", connector=lambda *_args, **_kwargs: connection
    )
    with pytest.raises(CorpusIntegrityError, match="projection metadata"):
        repository.snapshot()


@dataclass
class ManualClock:
    value: float = 100.0

    def __call__(self) -> float:
        return self.value


class FakeConnectionPool:
    def __init__(self, connection_factory) -> None:
        self._connection_factory = connection_factory
        self.connections: list[FakeReadConnection] = []
        self.open_calls: list[dict[str, object]] = []
        self.wait_timeouts: list[float] = []
        self.closed = False

    def open(self, **kwargs: object) -> None:
        self.open_calls.append(kwargs)

    def connection(self, *, timeout: float) -> FakeReadConnection:
        self.wait_timeouts.append(timeout)
        connection = self._connection_factory()
        self.connections.append(connection)
        return connection

    def close(self) -> None:
        self.closed = True


def test_production_repository_pools_and_reuses_hot_snapshots() -> None:
    captured: dict[str, object] = {}
    pool = FakeConnectionPool(FakeReadConnection)

    def pool_factory(**kwargs: object) -> FakeConnectionPool:
        captured.update(kwargs)
        return pool

    repository = PostgreSQLKnowledgeRepository(
        "postgresql://gopher:secret@postgres/gopher",
        pool_min_size=2,
        pool_max_size=7,
        pool_wait_seconds=2,
        pool_factory=pool_factory,
    )
    first = repository.snapshot()
    for _ in range(100):
        assert repository.snapshot() is first

    assert len(pool.connections) == 2  # one revision probe and one full load
    full_document_queries = sum(
        connection.executed.count(ACTIVE_DOCUMENTS_SQL) for connection in pool.connections
    )
    assert full_document_queries == 1
    assert pool.open_calls == [{"wait": True, "timeout": 5.0}]
    assert pool.wait_timeouts == [2, 2]
    assert captured["min_size"] == 2
    assert captured["max_size"] == 7
    assert captured["max_waiting"] == 28
    assert captured["open"] is False
    assert "secret" not in repr(repository)

    repository.close()
    assert pool.closed
    with pytest.raises(CorpusIntegrityError, match="closed"):
        repository.snapshot()


def test_revision_change_reloads_and_failed_revision_invalidates_old_snapshot() -> None:
    clock = ManualClock()
    revision = {"status": "succeeded", "version": "c" * 64}
    pool = FakeConnectionPool(
        lambda: FakeReadConnection(
            ingestion_status=revision["status"], corpus_version=revision["version"]
        )
    )
    repository = PostgreSQLKnowledgeRepository(
        "postgresql:///gopher",
        pool_factory=lambda **_kwargs: pool,
        clock=clock,
        revision_check_interval_seconds=1,
    )
    assert repository.snapshot().corpus_sha256 == "c" * 64

    revision["version"] = "d" * 64
    clock.value += 1.1
    assert repository.snapshot().corpus_sha256 == "d" * 64

    revision.update(status="failed", version="e" * 64)
    clock.value += 1.1
    with pytest.raises(CorpusIntegrityError, match="no usable ingestion"):
        repository.snapshot()
    assert len(pool.connections) == 5
