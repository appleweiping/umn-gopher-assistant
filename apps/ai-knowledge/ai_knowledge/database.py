from __future__ import annotations

import re
import time
from collections import defaultdict
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from threading import Lock
from typing import Any

import psycopg
from psycopg.rows import dict_row
from pydantic import ValidationError

from .corpus import CorpusIntegrityError, CorpusSnapshot
from .models import FreshnessState, KnowledgeDocument
from .projection import ProjectionIntegrityError, ProjectionMetadata, verify_projection_metadata
from .revision_cache import IngestionRevision, RevisionAwareSnapshotCache
from .url_policy import is_official_umn_url

_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
_EXPECTED_CAMPUSES = frozenset({"tc", "duluth", "crookston", "morris", "rochester"})

DATABASE_CAPABILITIES_SQL = """
SELECT
  current_setting('server_version_num')::integer AS server_version_num,
  COALESCE((SELECT extversion FROM pg_extension WHERE extname = 'vector'), '') AS vector_version,
  COALESCE(
    (
      SELECT is_nullable = 'YES'
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'knowledge_chunks'
        AND column_name = 'embedding'
    ),
    false
  ) AS embedding_nullable,
  (
      SELECT count(*) = 7
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'knowledge_documents'
      AND column_name IN (
        'summary_source_id',
        'verification_source_id',
        'keywords_en',
        'keywords_zh_cn',
        'fresh_for_days',
        'conflict_group',
        'conflict_variant'
      )
  ) AS document_metadata_ready
  ,
  (
    SELECT count(*) = 7
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'knowledge_sources'
      AND column_name IN (
        'external_id',
        'campus_ids',
        'role',
        'source_url',
        'license_status',
        'license_evidence_url',
        'enabled'
      )
  ) AS source_governance_ready
  ,
  (
    SELECT count(*) = 5
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'knowledge_ingestion_runs'
      AND column_name IN (
        'projection_sha256',
        'projection_sources',
        'projection_documents',
        'projection_chunks',
        'projection_citations'
      )
  ) AS projection_metadata_ready
"""

LATEST_INGESTION_SQL = """
SELECT
  status::text AS status,
  corpus_version,
  projection_sha256,
  projection_sources,
  projection_documents,
  projection_chunks,
  projection_citations
FROM knowledge_ingestion_runs
ORDER BY started_at DESC, created_at DESC, id DESC
LIMIT 1
"""

ACTIVE_DOCUMENTS_SQL = """
SELECT
  d.id::text AS document_id,
  d.external_id,
  d.summary_source_id,
  d.verification_source_id,
  d.campus_id::text AS campus_id,
  d.category::text AS category,
  d.title_en,
  d.title_zh_cn,
  d.body_en,
  d.body_zh_cn,
  d.keywords_en,
  d.keywords_zh_cn,
  summary_source.campus_ids::text[] AS summary_source_campus_ids,
  summary_source.role::text AS summary_source_role,
  summary_source.source_url AS summary_source_url,
  summary_source.license_status::text AS summary_license_status,
  summary_source.license_evidence_url AS summary_license_evidence_url,
  summary_source.enabled AS summary_source_enabled,
  verification_source.campus_ids::text[] AS verification_source_campus_ids,
  verification_source.role::text AS verification_source_role,
  verification_source.source_url AS verification_url,
  verification_source.license_status::text AS verification_license_status,
  verification_source.license_evidence_url AS verification_license_evidence_url,
  verification_source.enabled AS verification_source_enabled,
  d.content_hash,
  d.freshness_state::text AS freshness_state,
  d.fresh_for_days,
  d.verification_state::text AS verification_state,
  d.enabled,
  d.reviewed_at,
  d.retired_at,
  d.conflict_group,
  d.conflict_variant
FROM knowledge_documents AS d
JOIN knowledge_sources AS summary_source
  ON summary_source.external_id = d.summary_source_id
JOIN knowledge_sources AS verification_source
  ON verification_source.external_id = d.verification_source_id
WHERE d.enabled IS TRUE
  AND d.retired_at IS NULL
  AND d.verification_state <> 'retired'
ORDER BY d.external_id
"""

ACTIVE_CHUNKS_SQL = """
SELECT
  c.id::text AS chunk_id,
  c.document_id::text AS document_id,
  c.locale::text AS locale,
  c.ordinal,
  c.content,
  c.content_hash,
  c.token_count,
  d.campus_id::text AS document_campus_id
FROM knowledge_chunks AS c
JOIN knowledge_documents AS d ON d.id = c.document_id
WHERE d.enabled IS TRUE
  AND d.retired_at IS NULL
  AND d.verification_state <> 'retired'
ORDER BY d.external_id, c.locale, c.ordinal
"""

ACTIVE_CITATIONS_SQL = """
SELECT
  ci.id::text AS citation_id,
  ci.citation_key,
  ci.document_id::text AS document_id,
  ci.chunk_id::text AS chunk_id,
  ci.excerpt,
  ci.content_hash,
  c.document_id::text AS chunk_document_id,
  c.locale::text AS chunk_locale,
  c.ordinal AS chunk_ordinal,
  d.campus_id::text AS document_campus_id,
  chunk_document.campus_id::text AS chunk_document_campus_id
FROM knowledge_citations AS ci
JOIN knowledge_documents AS d ON d.id = ci.document_id
JOIN knowledge_chunks AS c ON c.id = ci.chunk_id
JOIN knowledge_documents AS chunk_document ON chunk_document.id = c.document_id
WHERE d.enabled IS TRUE
  AND d.retired_at IS NULL
  AND d.verification_state <> 'retired'
ORDER BY d.external_id, c.locale, ci.citation_key
"""


def verify_database_capabilities(row: Mapping[str, Any]) -> None:
    """Fail closed unless the connection targets the reviewed PostgreSQL 17 schema."""

    server_version = row.get("server_version_num")
    vector_version = row.get("vector_version")
    if not isinstance(server_version, int) or server_version // 10_000 != 17:
        raise CorpusIntegrityError("knowledge database must run PostgreSQL 17")
    if not isinstance(vector_version, str) or not vector_version:
        raise CorpusIntegrityError("knowledge database requires the pgvector extension")
    if row.get("embedding_nullable") is not True:
        raise CorpusIntegrityError("knowledge database must permit unavailable embeddings")
    if row.get("document_metadata_ready") is not True:
        raise CorpusIntegrityError("knowledge database metadata schema is incomplete")
    if row.get("source_governance_ready") is not True:
        raise CorpusIntegrityError("knowledge database source governance schema is incomplete")
    if row.get("projection_metadata_ready") is not True:
        raise CorpusIntegrityError("knowledge database projection metadata schema is incomplete")


def _verify_committed_projection(connection: Any, ingestion: Mapping[str, Any]) -> None:
    try:
        verify_projection_metadata(connection, ingestion)
    except ProjectionIntegrityError:
        raise CorpusIntegrityError("knowledge database projection integrity check failed") from None


def _validate_ingestion_projection_metadata(ingestion: Mapping[str, Any]) -> None:
    try:
        ProjectionMetadata.from_ingestion(ingestion)
    except ProjectionIntegrityError:
        raise CorpusIntegrityError("knowledge ingestion projection metadata is invalid") from None


def _validate_license_evidence_url(value: object) -> None:
    if value != "https://www.apache.org/licenses/LICENSE-2.0":
        raise CorpusIntegrityError("knowledge summary license evidence is invalid")


def _build_snapshot(
    *,
    corpus_version: object,
    document_rows: Sequence[Mapping[str, Any]],
    chunk_rows: Sequence[Mapping[str, Any]],
    citation_rows: Sequence[Mapping[str, Any]],
) -> CorpusSnapshot:
    if not isinstance(corpus_version, str) or not _SHA256_RE.fullmatch(corpus_version):
        raise CorpusIntegrityError("knowledge ingestion revision is invalid")

    chunks_by_document: dict[str, dict[tuple[str, int], Mapping[str, Any]]] = defaultdict(dict)
    chunks_by_id: dict[str, Mapping[str, Any]] = {}
    for row in chunk_rows:
        document_id = str(row.get("document_id", ""))
        chunk_id = str(row.get("chunk_id", ""))
        locale = row.get("locale")
        ordinal = row.get("ordinal")
        if not document_id or not chunk_id or locale not in {"en", "zh-CN"} or ordinal != 0:
            raise CorpusIntegrityError("knowledge chunk identity is invalid")
        key = (locale, ordinal)
        if key in chunks_by_document[document_id] or chunk_id in chunks_by_id:
            raise CorpusIntegrityError("knowledge chunks are not unique")
        content = row.get("content")
        content_hash = row.get("content_hash")
        token_count = row.get("token_count")
        if (
            not isinstance(content, str)
            or not content.strip()
            or not isinstance(content_hash, str)
            or not _SHA256_RE.fullmatch(content_hash)
            or not isinstance(token_count, int)
            or isinstance(token_count, bool)
            or not 1 <= token_count <= 4_096
        ):
            raise CorpusIntegrityError("knowledge chunk content is invalid")
        chunks_by_document[document_id][key] = row
        chunks_by_id[chunk_id] = row

    citations_by_document: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    seen_citation_ids: set[str] = set()
    seen_citation_keys: set[str] = set()
    for row in citation_rows:
        citation_id = str(row.get("citation_id", ""))
        citation_key = row.get("citation_key")
        document_id = str(row.get("document_id", ""))
        chunk_id = str(row.get("chunk_id", ""))
        if (
            not citation_id
            or citation_id in seen_citation_ids
            or not isinstance(citation_key, str)
            or not citation_key.strip()
            or citation_key in seen_citation_keys
        ):
            raise CorpusIntegrityError("knowledge citation identity is invalid")
        chunk = chunks_by_id.get(chunk_id)
        if chunk is None:
            raise CorpusIntegrityError("knowledge citation references an unavailable chunk")
        document_campus = row.get("document_campus_id")
        if (
            str(row.get("chunk_document_id", "")) != document_id
            or str(chunk.get("document_id", "")) != document_id
            or row.get("chunk_document_campus_id") != document_campus
            or chunk.get("document_campus_id") != document_campus
            or row.get("chunk_locale") != chunk.get("locale")
            or row.get("chunk_ordinal") != chunk.get("ordinal")
            or row.get("content_hash") != chunk.get("content_hash")
            or row.get("excerpt") != str(chunk.get("content"))[:500]
        ):
            raise CorpusIntegrityError(
                "knowledge citation, chunk, document, and campus are inconsistent"
            )
        seen_citation_ids.add(citation_id)
        seen_citation_keys.add(citation_key)
        citations_by_document[document_id].append(row)

    documents: list[KnowledgeDocument] = []
    seen_document_ids: set[str] = set()
    seen_external_ids: set[str] = set()
    for row in document_rows:
        document_id = str(row.get("document_id", ""))
        external_id = row.get("external_id")
        if (
            not document_id
            or document_id in seen_document_ids
            or not isinstance(external_id, str)
            or external_id in seen_external_ids
        ):
            raise CorpusIntegrityError("knowledge document identity is invalid")
        if (
            row.get("enabled") is not True
            or row.get("retired_at") is not None
            or row.get("verification_state") == "retired"
            or row.get("campus_id") not in _EXPECTED_CAMPUSES
        ):
            raise CorpusIntegrityError(
                "inactive or non-reusable knowledge escaped database filtering"
            )
        campus_id = row.get("campus_id")
        if (
            row.get("summary_source_role") != "PROJECT_SUMMARY"
            or row.get("summary_license_status") != "OPEN_REUSE"
            or row.get("summary_source_enabled") is not True
            or set(row.get("summary_source_campus_ids") or ()) != _EXPECTED_CAMPUSES
            or row.get("summary_source_url")
            != "https://github.com/appleweiping/umn-gopher-assistant/blob/main/apps/ai-knowledge/ai_knowledge/data/corpus.json"
        ):
            raise CorpusIntegrityError("knowledge summary source governance is invalid")
        _validate_license_evidence_url(row.get("summary_license_evidence_url"))
        verification_url = row.get("verification_url")
        if (
            row.get("verification_source_role") != "OFFICIAL_VERIFICATION"
            or row.get("verification_license_status") != "DEEPLINK_ONLY"
            or row.get("verification_license_evidence_url") is not None
            or row.get("verification_source_enabled") is not True
            or row.get("verification_source_campus_ids") != [campus_id]
            or not is_official_umn_url(verification_url)
        ):
            raise CorpusIntegrityError("knowledge verification source governance is invalid")
        try:
            FreshnessState(str(row.get("freshness_state")))
            document = KnowledgeDocument(
                id=external_id,
                campusId=campus_id,
                category=row.get("category"),
                summarySourceId=row.get("summary_source_id"),
                verificationSourceId=row.get("verification_source_id"),
                verificationUrl=verification_url,
                sourceUse="verification-link-only",
                summaryLicense="Apache-2.0",
                title={"en": row.get("title_en"), "zh-CN": row.get("title_zh_cn")},
                content={"en": row.get("body_en"), "zh-CN": row.get("body_zh_cn")},
                keywords={"en": row.get("keywords_en"), "zh-CN": row.get("keywords_zh_cn")},
                contentSha256=row.get("content_hash"),
                updatedAt=row.get("reviewed_at"),
                freshForDays=row.get("fresh_for_days"),
                verificationState=row.get("verification_state"),
                enabled=True,
                deletedAt=None,
                conflictGroup=row.get("conflict_group"),
                conflictVariant=row.get("conflict_variant"),
            )
        except (TypeError, ValueError, ValidationError) as error:
            raise CorpusIntegrityError("knowledge document validation failed") from error

        document_chunks = chunks_by_document.get(document_id, {})
        expected_chunk_keys = {("en", 0), ("zh-CN", 0)}
        if set(document_chunks) != expected_chunk_keys:
            raise CorpusIntegrityError("knowledge document must have one chunk per locale")
        if (
            document_chunks[("en", 0)].get("content") != document.content.en
            or document_chunks[("zh-CN", 0)].get("content") != document.content.zh_cn
        ):
            raise CorpusIntegrityError("knowledge chunks do not match their document")
        document_citations = citations_by_document.get(document_id, [])
        if len(document_citations) != 2 or {
            citation.get("chunk_locale") for citation in document_citations
        } != {"en", "zh-CN"}:
            raise CorpusIntegrityError("knowledge document must have one citation per locale")

        seen_document_ids.add(document_id)
        seen_external_ids.add(external_id)
        documents.append(document)

    if (
        set(chunks_by_document) != seen_document_ids
        or set(citations_by_document) != seen_document_ids
    ):
        raise CorpusIntegrityError("orphaned active knowledge evidence was loaded")
    return CorpusSnapshot(documents=tuple(documents), corpus_sha256=corpus_version)


class PostgreSQLKnowledgeRepository:
    """Pool, validate, and revision-cache the PostgreSQL knowledge projection."""

    def __init__(
        self,
        database_url: str,
        *,
        connect_timeout_seconds: int = 5,
        pool_min_size: int = 1,
        pool_max_size: int = 10,
        pool_wait_seconds: float = 3,
        snapshot_cache_ttl_seconds: float = 30,
        revision_check_interval_seconds: float = 1,
        connector: Callable[..., Any] = psycopg.connect,
        pool_factory: Callable[..., Any] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._database_url = database_url
        self._connect_timeout_seconds = connect_timeout_seconds
        self._pool_wait_seconds = pool_wait_seconds
        self._connector: Callable[..., Any] | None = connector
        self._pool: Any | None = None
        self._pool_opened = False
        self._pool_lock = Lock()

        if connector is psycopg.connect:
            if pool_factory is None:
                from psycopg_pool import ConnectionPool

                pool_factory = ConnectionPool
            self._pool = pool_factory(
                conninfo=database_url,
                kwargs={
                    "connect_timeout": connect_timeout_seconds,
                    "application_name": "umn-gopher-ai-knowledge",
                    "row_factory": dict_row,
                },
                min_size=pool_min_size,
                max_size=pool_max_size,
                timeout=pool_wait_seconds,
                max_waiting=max(8, pool_max_size * 4),
                open=False,
                name="umn-gopher-ai-knowledge",
            )
            self._connector = None

        self._cache = RevisionAwareSnapshotCache(
            revision_probe=self._latest_revision,
            snapshot_loader=self._load_snapshot,
            cache_ttl_seconds=snapshot_cache_ttl_seconds,
            revision_check_interval_seconds=revision_check_interval_seconds,
            clock=clock,
        )

    def snapshot(self) -> CorpusSnapshot:
        return self._cache.snapshot()

    def __enter__(self) -> PostgreSQLKnowledgeRepository:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def close(self) -> None:
        self._cache.close()
        if self._pool is not None:
            self._pool.close()

    def _ensure_pool_open(self) -> None:
        if self._pool is None or self._pool_opened:
            return
        with self._pool_lock:
            if self._pool_opened:
                return
            self._pool.open(
                wait=True,
                timeout=max(float(self._connect_timeout_seconds), self._pool_wait_seconds),
            )
            self._pool_opened = True

    @contextmanager
    def _connection(self) -> Iterator[Any]:
        if self._pool is not None:
            self._ensure_pool_open()
            with self._pool.connection(timeout=self._pool_wait_seconds) as connection:
                yield connection
            return
        assert self._connector is not None
        with self._connector(
            self._database_url,
            connect_timeout=self._connect_timeout_seconds,
            application_name="umn-gopher-ai-knowledge",
            row_factory=dict_row,
        ) as connection:
            yield connection

    def _latest_revision(self) -> IngestionRevision:
        try:
            with self._connection() as connection:
                connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
                connection.execute("SET LOCAL statement_timeout = '3s'")
                ingestion = connection.execute(LATEST_INGESTION_SQL).fetchone()
            if ingestion is None:
                return IngestionRevision(status="missing", corpus_version="")
            if ingestion.get("status") == "succeeded":
                _validate_ingestion_projection_metadata(ingestion)
            return IngestionRevision(
                status=str(ingestion.get("status", "missing")),
                corpus_version=str(ingestion.get("corpus_version", "")),
            )
        except CorpusIntegrityError:
            raise
        except (psycopg.Error, KeyError, TypeError, ValueError, ValidationError):
            raise CorpusIntegrityError("knowledge database is unavailable or invalid") from None

    def _load_snapshot(self, expected_revision: str) -> CorpusSnapshot:
        try:
            with self._connection() as connection:
                connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
                connection.execute("SET LOCAL statement_timeout = '10s'")
                capability_row = connection.execute(DATABASE_CAPABILITIES_SQL).fetchone()
                if capability_row is None:
                    raise CorpusIntegrityError("knowledge database capabilities are unavailable")
                verify_database_capabilities(capability_row)
                ingestion = connection.execute(LATEST_INGESTION_SQL).fetchone()
                if (
                    ingestion is None
                    or ingestion.get("status") != "succeeded"
                    or ingestion.get("corpus_version") != expected_revision
                ):
                    raise CorpusIntegrityError(
                        "knowledge ingestion revision changed during snapshot loading"
                    )
                _verify_committed_projection(connection, ingestion)
                document_rows = connection.execute(ACTIVE_DOCUMENTS_SQL).fetchall()
                chunk_rows = connection.execute(ACTIVE_CHUNKS_SQL).fetchall()
                citation_rows = connection.execute(ACTIVE_CITATIONS_SQL).fetchall()
            return _build_snapshot(
                corpus_version=expected_revision,
                document_rows=document_rows,
                chunk_rows=chunk_rows,
                citation_rows=citation_rows,
            )
        except CorpusIntegrityError:
            raise
        except (psycopg.Error, KeyError, TypeError, ValueError, ValidationError):
            raise CorpusIntegrityError("knowledge database is unavailable or invalid") from None
