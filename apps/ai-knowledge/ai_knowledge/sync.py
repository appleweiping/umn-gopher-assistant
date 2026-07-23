from __future__ import annotations

import argparse
import hashlib
import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

from .config import ConfigurationError, Settings
from .corpus import MAX_CORPUS_BYTES, CorpusIntegrityError, read_corpus_manifest
from .database import DATABASE_CAPABILITIES_SQL, verify_database_capabilities
from .models import (
    CorpusManifest,
    FreshnessState,
    KnowledgeDocument,
    KnowledgeSourceDescriptor,
    KnowledgeSourceResourceKind,
    VerificationState,
)
from .projection import ProjectionIntegrityError, calculate_projection_metadata
from .retrieval import search_terms

_EXPECTED_CAMPUSES = frozenset({"tc", "duluth", "crookston", "morris", "rochester"})
_SYNC_ADVISORY_LOCK_KEY = 7_609_668_779_281_051_225

UPSERT_SOURCE_SQL = """
INSERT INTO knowledge_sources (
  external_id,
  campus_ids,
  role,
  source_url,
  license_status,
  license_evidence_url,
  enabled
) VALUES (%s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (external_id) DO UPDATE SET
  campus_ids = EXCLUDED.campus_ids,
  role = EXCLUDED.role,
  source_url = EXCLUDED.source_url,
  license_status = EXCLUDED.license_status,
  license_evidence_url = EXCLUDED.license_evidence_url,
  enabled = EXCLUDED.enabled,
  updated_at = CASE
    WHEN knowledge_sources.campus_ids IS DISTINCT FROM EXCLUDED.campus_ids
      OR knowledge_sources.role IS DISTINCT FROM EXCLUDED.role
      OR knowledge_sources.source_url IS DISTINCT FROM EXCLUDED.source_url
      OR knowledge_sources.license_status IS DISTINCT FROM EXCLUDED.license_status
      OR knowledge_sources.license_evidence_url IS DISTINCT FROM EXCLUDED.license_evidence_url
      OR knowledge_sources.enabled IS DISTINCT FROM EXCLUDED.enabled
    THEN now()
    ELSE knowledge_sources.updated_at
  END
"""

UPSERT_DOCUMENT_SQL = """
INSERT INTO knowledge_documents (
  external_id,
  summary_source_id,
  verification_source_id,
  campus_id,
  category,
  title_en,
  title_zh_cn,
  body_en,
  body_zh_cn,
  keywords_en,
  keywords_zh_cn,
  content_hash,
  fresh_for_days,
  freshness_state,
  verification_state,
  conflict_group,
  conflict_variant,
  enabled,
  reviewed_at,
  retired_at
) VALUES (
  %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
  %s, %s, %s, %s, %s, %s, %s, %s, %s
)
ON CONFLICT (external_id) DO UPDATE SET
  summary_source_id = EXCLUDED.summary_source_id,
  verification_source_id = EXCLUDED.verification_source_id,
  campus_id = EXCLUDED.campus_id,
  category = EXCLUDED.category,
  title_en = EXCLUDED.title_en,
  title_zh_cn = EXCLUDED.title_zh_cn,
  body_en = EXCLUDED.body_en,
  body_zh_cn = EXCLUDED.body_zh_cn,
  keywords_en = EXCLUDED.keywords_en,
  keywords_zh_cn = EXCLUDED.keywords_zh_cn,
  content_hash = EXCLUDED.content_hash,
  fresh_for_days = EXCLUDED.fresh_for_days,
  freshness_state = EXCLUDED.freshness_state,
  verification_state = EXCLUDED.verification_state,
  conflict_group = EXCLUDED.conflict_group,
  conflict_variant = EXCLUDED.conflict_variant,
  enabled = EXCLUDED.enabled,
  reviewed_at = EXCLUDED.reviewed_at,
  retired_at = CASE
    WHEN EXCLUDED.enabled THEN NULL
    ELSE COALESCE(knowledge_documents.retired_at, EXCLUDED.retired_at)
  END,
  updated_at = CASE
    WHEN knowledge_documents.summary_source_id IS DISTINCT FROM EXCLUDED.summary_source_id
      OR knowledge_documents.verification_source_id IS DISTINCT FROM EXCLUDED.verification_source_id
      OR knowledge_documents.campus_id IS DISTINCT FROM EXCLUDED.campus_id
      OR knowledge_documents.category IS DISTINCT FROM EXCLUDED.category
      OR knowledge_documents.title_en IS DISTINCT FROM EXCLUDED.title_en
      OR knowledge_documents.title_zh_cn IS DISTINCT FROM EXCLUDED.title_zh_cn
      OR knowledge_documents.body_en IS DISTINCT FROM EXCLUDED.body_en
      OR knowledge_documents.body_zh_cn IS DISTINCT FROM EXCLUDED.body_zh_cn
      OR knowledge_documents.keywords_en IS DISTINCT FROM EXCLUDED.keywords_en
      OR knowledge_documents.keywords_zh_cn IS DISTINCT FROM EXCLUDED.keywords_zh_cn
      OR knowledge_documents.content_hash IS DISTINCT FROM EXCLUDED.content_hash
      OR knowledge_documents.fresh_for_days IS DISTINCT FROM EXCLUDED.fresh_for_days
      OR knowledge_documents.freshness_state IS DISTINCT FROM EXCLUDED.freshness_state
      OR knowledge_documents.verification_state IS DISTINCT FROM EXCLUDED.verification_state
      OR knowledge_documents.conflict_group IS DISTINCT FROM EXCLUDED.conflict_group
      OR knowledge_documents.conflict_variant IS DISTINCT FROM EXCLUDED.conflict_variant
      OR knowledge_documents.enabled IS DISTINCT FROM EXCLUDED.enabled
      OR knowledge_documents.reviewed_at IS DISTINCT FROM EXCLUDED.reviewed_at
    THEN now()
    ELSE knowledge_documents.updated_at
  END
RETURNING id::text AS document_id
"""

UPSERT_CHUNK_SQL = """
INSERT INTO knowledge_chunks (
  document_id, locale, ordinal, content, content_hash, token_count, embedding
) VALUES (%s, %s, 0, %s, %s, %s, NULL)
ON CONFLICT (document_id, locale, ordinal) DO UPDATE SET
  content = EXCLUDED.content,
  content_hash = EXCLUDED.content_hash,
  token_count = EXCLUDED.token_count,
  embedding = CASE
    WHEN knowledge_chunks.content_hash IS DISTINCT FROM EXCLUDED.content_hash THEN NULL
    ELSE knowledge_chunks.embedding
  END
RETURNING id::text AS chunk_id
"""

CURRENT_CITATIONS_SQL = """
SELECT
  citation_key,
  document_id::text AS document_id,
  chunk_id::text AS chunk_id,
  excerpt,
  content_hash
FROM knowledge_citations
WHERE document_id = %s
ORDER BY citation_key
"""

INSERT_CITATION_SQL = """
INSERT INTO knowledge_citations (
  citation_key, document_id, chunk_id, excerpt, content_hash
) VALUES (%s, %s, %s, %s, %s)
"""


class CorpusSyncError(RuntimeError):
    """A corpus revision could not be committed atomically."""


@dataclass(frozen=True, slots=True)
class SyncResult:
    corpus_version: str
    documents_seen: int
    documents_indexed: int
    documents_retired: int


def _freshness(document: KnowledgeDocument, now: datetime) -> FreshnessState:
    updated_at = document.updated_at.astimezone(UTC)
    now_utc = now.astimezone(UTC)
    if updated_at > now_utc + timedelta(minutes=5):
        return FreshnessState.UNKNOWN
    age = now_utc - updated_at
    fresh_window = timedelta(days=document.fresh_for_days)
    if age <= fresh_window:
        return FreshnessState.FRESH
    if age <= fresh_window * 2:
        return FreshnessState.STALE
    return FreshnessState.EXPIRED


def _chunk_values(content: str) -> tuple[str, int]:
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    token_count = len(search_terms(content))
    if not 1 <= token_count <= 4_096:
        raise CorpusSyncError("knowledge chunk token count is outside the supported range")
    return digest, token_count


def _document_values(
    document: KnowledgeDocument,
    *,
    active: bool,
    now: datetime,
) -> tuple[object, ...]:
    verification_state: VerificationState = (
        document.verification_state if active else VerificationState.RETIRED
    )
    return (
        document.id,
        document.summary_source_id,
        document.verification_source_id,
        document.campus_id,
        document.category,
        document.title.en,
        document.title.zh_cn,
        document.content.en,
        document.content.zh_cn,
        document.keywords.en,
        document.keywords.zh_cn,
        document.content_sha256,
        document.fresh_for_days,
        _freshness(document, now).value,
        verification_state.value,
        document.conflict_group,
        document.conflict_variant,
        active,
        document.updated_at,
        None if active else now,
    )


def _source_values(source: KnowledgeSourceDescriptor) -> tuple[object, ...]:
    role = (
        "PROJECT_SUMMARY"
        if source.resource_kinds == [KnowledgeSourceResourceKind.SUMMARY]
        else "OFFICIAL_VERIFICATION"
    )
    return (
        source.id,
        source.campus_ids,
        role,
        str(source.source_url),
        source.license_status.value,
        str(source.license_evidence_url) if source.license_evidence_url is not None else None,
        source.is_enabled(),
    )


def _expected_citations(
    document: KnowledgeDocument,
    document_id: str,
    chunks: Mapping[str, tuple[str, str]],
) -> list[dict[str, str]]:
    expected: list[dict[str, str]] = []
    for locale, content in (("en", document.content.en), ("zh-CN", document.content.zh_cn)):
        chunk_id, content_hash = chunks[locale]
        expected.append(
            {
                "citation_key": f"{document.id}:{locale.casefold()}",
                "document_id": document_id,
                "chunk_id": chunk_id,
                "excerpt": content[:500],
                "content_hash": content_hash,
            }
        )
    return sorted(expected, key=lambda row: row["citation_key"])


def _citations_match(
    current: Sequence[Mapping[str, Any]], expected: Sequence[Mapping[str, str]]
) -> bool:
    if len(current) != len(expected):
        return False
    fields = ("citation_key", "document_id", "chunk_id", "excerpt", "content_hash")
    normalized_current = [{field: str(row.get(field, "")) for field in fields} for row in current]
    return normalized_current == list(expected)


def _sync_document_evidence(
    connection: Any,
    document: KnowledgeDocument,
    document_id: str,
) -> None:
    connection.execute(
        "DELETE FROM knowledge_chunks WHERE document_id = %s AND ordinal <> 0",
        (document_id,),
    )
    chunks: dict[str, tuple[str, str]] = {}
    for locale, content in (("en", document.content.en), ("zh-CN", document.content.zh_cn)):
        content_hash, token_count = _chunk_values(content)
        row = connection.execute(
            UPSERT_CHUNK_SQL,
            (document_id, locale, content, content_hash, token_count),
        ).fetchone()
        if row is None or not row.get("chunk_id"):
            raise CorpusSyncError("knowledge chunk upsert returned no identity")
        chunks[locale] = str(row["chunk_id"]), content_hash

    expected = _expected_citations(document, document_id, chunks)
    current = connection.execute(CURRENT_CITATIONS_SQL, (document_id,)).fetchall()
    if _citations_match(current, expected):
        return
    # Citations are immutable by schema trigger. A changed projection is replaced,
    # while an identical rerun preserves its stable rows and identifiers.
    connection.execute("DELETE FROM knowledge_citations WHERE document_id = %s", (document_id,))
    for citation in expected:
        connection.execute(
            INSERT_CITATION_SQL,
            tuple(
                citation[field]
                for field in (
                    "citation_key",
                    "document_id",
                    "chunk_id",
                    "excerpt",
                    "content_hash",
                )
            ),
        )


def _verify_campuses(connection: Any) -> None:
    rows = connection.execute(
        "SELECT id::text AS campus_id FROM campuses WHERE id::text = ANY(%s) ORDER BY id",
        (sorted(_EXPECTED_CAMPUSES),),
    ).fetchall()
    available = {row.get("campus_id") for row in rows}
    if available != _EXPECTED_CAMPUSES:
        raise CorpusSyncError("canonical campus metadata is incomplete")


def _sync_manifest(
    connection: Any,
    manifest: CorpusManifest,
    *,
    corpus_version: str,
    now: datetime,
) -> SyncResult:
    connection.execute("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
    connection.execute("SET LOCAL statement_timeout = '30s'")
    connection.execute("SET LOCAL lock_timeout = '5s'")
    capability_row = connection.execute(DATABASE_CAPABILITIES_SQL).fetchone()
    if capability_row is None:
        raise CorpusSyncError("knowledge database capabilities are unavailable")
    verify_database_capabilities(capability_row)
    _verify_campuses(connection)
    connection.execute("SELECT pg_advisory_xact_lock(%s)", (_SYNC_ADVISORY_LOCK_KEY,))

    run = connection.execute(
        """
        INSERT INTO knowledge_ingestion_runs (
          corpus_version, status, documents_seen, documents_indexed,
          documents_retired, started_at
        ) VALUES (%s, 'running', 0, 0, 0, %s)
        RETURNING id::text AS run_id
        """,
        (corpus_version, now),
    ).fetchone()
    if run is None or not run.get("run_id"):
        raise CorpusSyncError("knowledge ingestion run returned no identity")
    run_id = str(run["run_id"])

    if manifest.deleted_at is None:
        for source in sorted(manifest.source_registry, key=lambda item: item.id):
            connection.execute(UPSERT_SOURCE_SQL, _source_values(source))

    all_external_ids = [document.id for document in manifest.documents]
    retained_external_ids = (
        []
        if manifest.deleted_at is not None
        else [document.id for document in manifest.documents if document.deleted_at is None]
    )
    connection.execute(
        "DELETE FROM knowledge_documents WHERE external_id <> ALL(%s::text[])",
        (retained_external_ids,),
    )

    indexed = 0
    retired = 0
    if manifest.deleted_at is None:
        for document in sorted(manifest.documents, key=lambda item: item.id):
            if document.deleted_at is not None:
                connection.execute(
                    "DELETE FROM knowledge_documents WHERE external_id = %s",
                    (document.id,),
                )
                continue
            active = manifest.enabled and document.is_publishable()
            row = connection.execute(
                UPSERT_DOCUMENT_SQL,
                _document_values(document, active=active, now=now),
            ).fetchone()
            if row is None or not row.get("document_id"):
                raise CorpusSyncError("knowledge document upsert returned no identity")
            document_id = str(row["document_id"])
            if active:
                indexed += 1
                _sync_document_evidence(connection, document, document_id)
            else:
                retired += 1
                connection.execute(
                    "DELETE FROM knowledge_chunks WHERE document_id = %s",
                    (document_id,),
                )

    retained_source_ids = (
        []
        if manifest.deleted_at is not None
        else [source.id for source in manifest.source_registry]
    )
    connection.execute(
        "DELETE FROM knowledge_sources WHERE external_id <> ALL(%s::text[])",
        (retained_source_ids,),
    )

    result = SyncResult(
        corpus_version=corpus_version,
        documents_seen=len(all_external_ids),
        documents_indexed=indexed,
        documents_retired=retired,
    )
    try:
        projection = calculate_projection_metadata(connection)
    except ProjectionIntegrityError as error:
        raise CorpusSyncError("knowledge projection metadata could not be calculated") from error
    completed_at = datetime.now(UTC)
    connection.execute(
        """
        UPDATE knowledge_ingestion_runs
        SET status = 'succeeded',
            documents_seen = %s,
            documents_indexed = %s,
            documents_retired = %s,
            projection_sha256 = %s,
            projection_sources = %s,
            projection_documents = %s,
            projection_chunks = %s,
            projection_citations = %s,
            completed_at = %s
        WHERE id = %s
        """,
        (
            result.documents_seen,
            result.documents_indexed,
            result.documents_retired,
            projection.sha256,
            projection.sources,
            projection.documents,
            projection.chunks,
            projection.citations,
            completed_at,
            run_id,
        ),
    )
    return result


def _record_failed_revision(
    database_url: str,
    *,
    corpus_version: str,
    documents_seen: int,
    started_at: datetime,
    connector: Callable[..., Any],
    connect_timeout_seconds: int,
) -> None:
    try:
        with connector(
            database_url,
            connect_timeout=connect_timeout_seconds,
            application_name="umn-gopher-ai-knowledge-sync",
            row_factory=dict_row,
        ) as connection:
            connection.execute("SET LOCAL statement_timeout = '5s'")
            connection.execute(
                """
                INSERT INTO knowledge_ingestion_runs (
                  corpus_version, status, documents_seen, documents_indexed,
                  documents_retired, started_at, completed_at, error_summary
                ) VALUES (%s, 'failed', %s, 0, 0, %s, %s, %s)
                """,
                (
                    corpus_version,
                    documents_seen,
                    started_at,
                    datetime.now(UTC),
                    "corpus synchronization failed",
                ),
            )
    except Exception:
        # The original failure is authoritative. This best-effort audit path never
        # emits connection details, SQL, or credentials.
        return


def _audit_revision_for_unvalidated_artifact(corpus_path: Path) -> str:
    """Return a non-sensitive revision key even when the artifact cannot validate."""

    try:
        resolved_path = corpus_path.resolve()
        stat = resolved_path.stat()
        if resolved_path.is_file() and stat.st_size <= MAX_CORPUS_BYTES:
            raw = resolved_path.read_bytes()
            if len(raw) <= MAX_CORPUS_BYTES:
                return hashlib.sha256(raw).hexdigest()
    except OSError:
        pass
    return hashlib.sha256(b"invalid-or-unavailable-knowledge-corpus").hexdigest()


def sync_corpus(
    database_url: str,
    corpus_path: Path,
    *,
    connector: Callable[..., Any] = psycopg.connect,
    clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    connect_timeout_seconds: int = 5,
) -> SyncResult:
    started_at = clock().astimezone(UTC)
    try:
        manifest, corpus_version = read_corpus_manifest(corpus_path)
    except CorpusIntegrityError:
        _record_failed_revision(
            database_url,
            corpus_version=_audit_revision_for_unvalidated_artifact(corpus_path),
            documents_seen=0,
            started_at=started_at,
            connector=connector,
            connect_timeout_seconds=connect_timeout_seconds,
        )
        raise CorpusSyncError("knowledge corpus synchronization failed") from None
    try:
        with connector(
            database_url,
            connect_timeout=connect_timeout_seconds,
            application_name="umn-gopher-ai-knowledge-sync",
            row_factory=dict_row,
        ) as connection:
            return _sync_manifest(
                connection,
                manifest,
                corpus_version=corpus_version,
                now=started_at,
            )
    except (CorpusIntegrityError, CorpusSyncError, psycopg.Error, KeyError, TypeError, ValueError):
        _record_failed_revision(
            database_url,
            corpus_version=corpus_version,
            documents_seen=len(manifest.documents),
            started_at=started_at,
            connector=connector,
            connect_timeout_seconds=connect_timeout_seconds,
        )
        raise CorpusSyncError("knowledge corpus synchronization failed") from None


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Atomically synchronize the reviewed AI corpus")
    parser.add_argument("--corpus", type=Path, help="reviewed corpus release artifact")
    arguments = parser.parse_args(argv)
    try:
        settings = Settings.from_environment()
    except ConfigurationError:
        parser.exit(2, "AI knowledge configuration is invalid\n")
    if settings.backend != "postgres" or settings.database_url is None:
        parser.exit(2, "AI_KNOWLEDGE_BACKEND=postgres and DATABASE_URL are required\n")
    corpus_path = arguments.corpus.resolve() if arguments.corpus else settings.corpus_path
    try:
        result = sync_corpus(
            settings.database_url,
            corpus_path,
            connect_timeout_seconds=settings.database_connect_timeout_seconds,
        )
    except (CorpusIntegrityError, CorpusSyncError):
        parser.exit(1, "Knowledge corpus synchronization failed\n")
    print(
        json.dumps(
            {
                "corpusSha256": result.corpus_version,
                "documentsSeen": result.documents_seen,
                "documentsIndexed": result.documents_indexed,
                "documentsRetired": result.documents_retired,
                "vectorSearchEnabled": False,
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )


if __name__ == "__main__":  # pragma: no cover - exercised through the installed entry point
    main()
