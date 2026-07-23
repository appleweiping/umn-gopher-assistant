from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psycopg
import pytest
from conftest import (
    CORPUS_PATH,
    clone_document,
    fixture_manifest,
    read_corpus,
    rehash,
    write_manifest,
)

from ai_knowledge.config import ConfigurationError, Settings
from ai_knowledge.database import DATABASE_CAPABILITIES_SQL
from ai_knowledge.models import CorpusManifest, FreshnessState, KnowledgeDocument
from ai_knowledge.projection import PROJECTION_METADATA_SQL
from ai_knowledge.sync import (
    CURRENT_CITATIONS_SQL,
    INSERT_CITATION_SQL,
    UPSERT_CHUNK_SQL,
    UPSERT_DOCUMENT_SQL,
    UPSERT_SOURCE_SQL,
    CorpusSyncError,
    _audit_revision_for_unvalidated_artifact,
    _chunk_values,
    _freshness,
    _record_failed_revision,
    _sync_document_evidence,
    _sync_manifest,
    main,
    sync_corpus,
)

FIXED_NOW = datetime(2026, 7, 23, tzinfo=UTC)


class FakeCursor:
    def __init__(self, rows: list[dict[str, Any]] | None = None) -> None:
        self.rows = rows or []

    def fetchone(self) -> dict[str, Any] | None:
        return self.rows[0] if self.rows else None

    def fetchall(self) -> list[dict[str, Any]]:
        return self.rows


@dataclass
class FakeDatabase:
    campuses: set[str] = field(
        default_factory=lambda: {"tc", "duluth", "crookston", "morris", "rochester"}
    )
    documents: dict[str, dict[str, Any]] = field(default_factory=dict)
    sources: dict[str, dict[str, Any]] = field(default_factory=dict)
    chunks: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)
    citations: dict[str, list[dict[str, str]]] = field(default_factory=dict)
    runs: list[dict[str, Any]] = field(default_factory=list)
    citation_inserts: int = 0
    citation_replacements: int = 0
    fail_capabilities_once: bool = False

    def delete_document(self, external_id: str) -> None:
        document = self.documents.pop(external_id, None)
        if document is None:
            return
        document_id = document["document_id"]
        self.chunks = {key: value for key, value in self.chunks.items() if key[0] != document_id}
        self.citations.pop(document_id, None)


class FakeSyncConnection:
    def __init__(self, database: FakeDatabase) -> None:
        self.database = database

    def __enter__(self) -> FakeSyncConnection:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def execute(self, query: str, parameters: tuple[Any, ...] | None = None) -> FakeCursor:
        parameters = parameters or ()
        normalized = " ".join(query.split())
        if query == DATABASE_CAPABILITIES_SQL:
            if self.database.fail_capabilities_once:
                self.database.fail_capabilities_once = False
                raise psycopg.OperationalError("password=must-not-leak")
            return FakeCursor(
                [
                    {
                        "server_version_num": 170006,
                        "vector_version": "0.8.2",
                        "embedding_nullable": True,
                        "document_metadata_ready": True,
                        "source_governance_ready": True,
                        "projection_metadata_ready": True,
                    }
                ]
            )
        if normalized.startswith("SELECT id::text AS campus_id FROM campuses"):
            return FakeCursor(
                [{"campus_id": campus_id} for campus_id in sorted(self.database.campuses)]
            )
        if normalized.startswith("INSERT INTO knowledge_ingestion_runs"):
            status = "failed" if "'failed'" in normalized else "running"
            run = {
                "run_id": f"run-{len(self.database.runs) + 1}",
                "status": status,
                "corpus_version": parameters[0],
                "documents_seen": parameters[1] if status == "failed" else 0,
            }
            self.database.runs.append(run)
            return FakeCursor([run])
        if normalized.startswith("UPDATE knowledge_ingestion_runs"):
            self.database.runs[-1].update(
                status="succeeded",
                documents_seen=parameters[0],
                documents_indexed=parameters[1],
                documents_retired=parameters[2],
                projection_sha256=parameters[3],
                projection_sources=parameters[4],
                projection_documents=parameters[5],
                projection_chunks=parameters[6],
                projection_citations=parameters[7],
            )
            return FakeCursor()
        if query == PROJECTION_METADATA_SQL:
            projection_payload = json.dumps(
                {
                    "sources": self.database.sources,
                    "documents": self.database.documents,
                    "chunks": [
                        [list(key), value] for key, value in sorted(self.database.chunks.items())
                    ],
                    "citations": self.database.citations,
                },
                default=str,
                separators=(",", ":"),
                sort_keys=True,
            )
            return FakeCursor(
                [
                    {
                        "projection_payload": projection_payload,
                        "projection_sources": len(self.database.sources),
                        "projection_documents": len(self.database.documents),
                        "projection_chunks": len(self.database.chunks),
                        "projection_citations": sum(
                            len(rows) for rows in self.database.citations.values()
                        ),
                    }
                ]
            )
        if normalized.startswith("DELETE FROM knowledge_documents WHERE external_id <> ALL"):
            retained = set(parameters[0])
            for external_id in list(self.database.documents):
                if external_id not in retained:
                    self.database.delete_document(external_id)
            return FakeCursor()
        if normalized == "DELETE FROM knowledge_documents WHERE external_id = %s":
            self.database.delete_document(str(parameters[0]))
            return FakeCursor()
        if query == UPSERT_SOURCE_SQL:
            external_id = str(parameters[0])
            self.database.sources[external_id] = {
                "campus_ids": parameters[1],
                "role": parameters[2],
                "source_url": parameters[3],
                "license_status": parameters[4],
                "license_evidence_url": parameters[5],
                "enabled": parameters[6],
            }
            return FakeCursor()
        if query == UPSERT_DOCUMENT_SQL:
            external_id = str(parameters[0])
            existing = self.database.documents.get(external_id)
            document_id = (
                existing["document_id"]
                if existing
                else f"document-{len(self.database.documents) + 1}"
            )
            self.database.documents[external_id] = {
                "document_id": document_id,
                "summary_source_id": parameters[1],
                "verification_source_id": parameters[2],
                "enabled": parameters[17],
                "verification_state": parameters[14],
                "retired_at": parameters[19]
                if existing is None
                else (None if parameters[17] else existing.get("retired_at") or parameters[19]),
            }
            return FakeCursor([{"document_id": document_id}])
        if normalized.startswith(
            "DELETE FROM knowledge_chunks WHERE document_id = %s AND ordinal <> 0"
        ):
            return FakeCursor()
        if query == UPSERT_CHUNK_SQL:
            document_id, locale, content, content_hash, token_count = parameters
            key = str(document_id), str(locale)
            existing = self.database.chunks.get(key)
            chunk_id = existing["chunk_id"] if existing else f"chunk-{document_id}-{locale}"
            embedding = (
                None
                if existing is None or existing["content_hash"] != content_hash
                else existing["embedding"]
            )
            self.database.chunks[key] = {
                "chunk_id": chunk_id,
                "content": content,
                "content_hash": content_hash,
                "token_count": token_count,
                "embedding": embedding,
            }
            return FakeCursor([{"chunk_id": chunk_id}])
        if query == CURRENT_CITATIONS_SQL:
            return FakeCursor(
                sorted(
                    self.database.citations.get(str(parameters[0]), []),
                    key=lambda row: row["citation_key"],
                )
            )
        if normalized == "DELETE FROM knowledge_citations WHERE document_id = %s":
            self.database.citation_replacements += 1
            self.database.citations[str(parameters[0])] = []
            return FakeCursor()
        if query == INSERT_CITATION_SQL:
            citation = dict(
                zip(
                    ("citation_key", "document_id", "chunk_id", "excerpt", "content_hash"),
                    (str(value) for value in parameters),
                    strict=True,
                )
            )
            self.database.citations.setdefault(citation["document_id"], []).append(citation)
            self.database.citation_inserts += 1
            return FakeCursor()
        if normalized == "DELETE FROM knowledge_chunks WHERE document_id = %s":
            document_id = str(parameters[0])
            self.database.chunks = {
                key: value for key, value in self.database.chunks.items() if key[0] != document_id
            }
            self.database.citations.pop(document_id, None)
            return FakeCursor()
        if normalized.startswith("DELETE FROM knowledge_sources WHERE external_id <> ALL"):
            retained = set(parameters[0])
            self.database.sources = {
                key: value for key, value in self.database.sources.items() if key in retained
            }
            return FakeCursor()
        return FakeCursor()


def connector_for(database: FakeDatabase):
    def connector(*_args: object, **_kwargs: object) -> FakeSyncConnection:
        return FakeSyncConnection(database)

    return connector


def test_sync_is_idempotent_and_keeps_embeddings_explicitly_unavailable() -> None:
    database = FakeDatabase()
    connector = connector_for(database)
    first = sync_corpus(
        "postgresql://gopher:secret@postgres/gopher",
        CORPUS_PATH,
        connector=connector,
        clock=lambda: FIXED_NOW,
    )
    assert first.documents_seen == 25
    assert first.documents_indexed == 25
    assert first.documents_retired == 0
    assert len(database.documents) == 25
    assert len(database.sources) == 26
    assert database.sources["uga-ai-summary-corpus-v1"]["license_status"] == "OPEN_REUSE"
    assert all(
        source["license_status"] == "DEEPLINK_ONLY"
        for source_id, source in database.sources.items()
        if source_id != "uga-ai-summary-corpus-v1"
    )
    assert len(database.chunks) == 50
    assert sum(len(rows) for rows in database.citations.values()) == 50
    assert all(row["embedding"] is None for row in database.chunks.values())
    assert database.runs[-1]["projection_sources"] == 26
    assert database.runs[-1]["projection_documents"] == 25
    assert database.runs[-1]["projection_chunks"] == 50
    assert database.runs[-1]["projection_citations"] == 50
    assert len(database.runs[-1]["projection_sha256"]) == 64
    first_document_ids = {
        external_id: row["document_id"] for external_id, row in database.documents.items()
    }
    first_citation_inserts = database.citation_inserts
    first_replacements = database.citation_replacements

    second = sync_corpus(
        "postgresql://gopher:secret@postgres/gopher",
        CORPUS_PATH,
        connector=connector,
        clock=lambda: FIXED_NOW,
    )
    assert second == first
    assert {
        external_id: row["document_id"] for external_id, row in database.documents.items()
    } == first_document_ids
    assert database.citation_inserts == first_citation_inserts
    assert database.citation_replacements == first_replacements


def test_content_change_invalidates_embedding_and_replaces_immutable_citations(
    tmp_path: Path,
) -> None:
    database = FakeDatabase()
    connector = connector_for(database)
    document = clone_document("tc-library-overview")
    path = tmp_path / "corpus.json"
    write_manifest(path, fixture_manifest([document]))
    sync_corpus("postgresql:///gopher", path, connector=connector, clock=lambda: FIXED_NOW)
    document_id = database.documents[document["id"]]["document_id"]
    database.chunks[(document_id, "en")]["embedding"] = [0.25] * 384

    document["content"]["en"] += " Updated guidance."
    rehash(document)
    write_manifest(path, fixture_manifest([document]))
    prior_replacements = database.citation_replacements
    sync_corpus("postgresql:///gopher", path, connector=connector, clock=lambda: FIXED_NOW)
    assert database.chunks[(document_id, "en")]["embedding"] is None
    assert database.citation_replacements == prior_replacements + 1


def test_disabled_retired_reenabled_and_deleted_lifecycle_propagates(tmp_path: Path) -> None:
    database = FakeDatabase()
    connector = connector_for(database)
    document = clone_document("tc-library-overview")
    path = tmp_path / "corpus.json"
    write_manifest(path, fixture_manifest([document]))
    sync_corpus("postgresql:///gopher", path, connector=connector, clock=lambda: FIXED_NOW)
    stable_id = database.documents[document["id"]]["document_id"]

    document["enabled"] = False
    write_manifest(path, fixture_manifest([document]))
    retired = sync_corpus(
        "postgresql:///gopher", path, connector=connector, clock=lambda: FIXED_NOW
    )
    assert retired.documents_retired == 1
    assert database.documents[document["id"]]["enabled"] is False
    assert database.documents[document["id"]]["verification_state"] == "retired"
    assert database.chunks == {}

    document["enabled"] = True
    write_manifest(path, fixture_manifest([document]))
    sync_corpus("postgresql:///gopher", path, connector=connector, clock=lambda: FIXED_NOW)
    assert database.documents[document["id"]]["document_id"] == stable_id
    assert database.documents[document["id"]]["retired_at"] is None

    document["deletedAt"] = "2026-07-23T00:00:00Z"
    write_manifest(path, fixture_manifest([document]))
    deleted = sync_corpus(
        "postgresql:///gopher", path, connector=connector, clock=lambda: FIXED_NOW
    )
    assert deleted.documents_indexed == 0
    assert database.documents == {}


def test_manifest_delete_and_missing_documents_are_physically_removed(tmp_path: Path) -> None:
    database = FakeDatabase()
    connector = connector_for(database)
    documents = [
        clone_document("tc-library-overview"),
        clone_document("tc-dining-overview"),
    ]
    path = tmp_path / "corpus.json"
    write_manifest(path, fixture_manifest(documents))
    sync_corpus("postgresql:///gopher", path, connector=connector, clock=lambda: FIXED_NOW)

    write_manifest(path, fixture_manifest(documents[:1]))
    sync_corpus("postgresql:///gopher", path, connector=connector, clock=lambda: FIXED_NOW)
    assert set(database.documents) == {documents[0]["id"]}

    deleted_manifest = fixture_manifest(documents[:1])
    deleted_manifest["deletedAt"] = "2026-07-23T00:00:00Z"
    write_manifest(path, deleted_manifest)
    sync_corpus("postgresql:///gopher", path, connector=connector, clock=lambda: FIXED_NOW)
    assert database.documents == {}
    assert database.sources == {}


def test_missing_campus_and_database_failure_record_a_failed_revision() -> None:
    database = FakeDatabase(campuses={"tc"})
    with pytest.raises(CorpusSyncError):
        sync_corpus(
            "postgresql://gopher:secret@postgres/gopher",
            CORPUS_PATH,
            connector=connector_for(database),
            clock=lambda: FIXED_NOW,
        )
    assert database.runs[-1]["status"] == "failed"


def test_prevalidation_failure_becomes_the_latest_failed_revision(
    tmp_path: Path,
) -> None:
    database = FakeDatabase()
    connector = connector_for(database)
    sync_corpus("postgresql:///gopher", CORPUS_PATH, connector=connector, clock=lambda: FIXED_NOW)
    assert database.runs[-1]["status"] == "succeeded"

    invalid_bytes = b'{"documents": [invalid]}'
    invalid_path = tmp_path / "invalid-corpus.json"
    invalid_path.write_bytes(invalid_bytes)
    with pytest.raises(CorpusSyncError):
        sync_corpus(
            "postgresql:///gopher",
            invalid_path,
            connector=connector,
            clock=lambda: FIXED_NOW,
        )

    assert database.runs[-1] == {
        "run_id": "run-2",
        "status": "failed",
        "corpus_version": hashlib.sha256(invalid_bytes).hexdigest(),
        "documents_seen": 0,
    }


def test_unavailable_or_oversized_artifact_uses_a_non_sensitive_audit_revision(
    tmp_path: Path,
) -> None:
    missing = tmp_path / "private-name-that-must-not-leak.json"
    revision = _audit_revision_for_unvalidated_artifact(missing)
    assert len(revision) == 64
    assert "private" not in revision

    database = FakeDatabase(fail_capabilities_once=True)
    with pytest.raises(CorpusSyncError) as captured:
        sync_corpus(
            "postgresql://gopher:secret@postgres/gopher",
            CORPUS_PATH,
            connector=connector_for(database),
            clock=lambda: FIXED_NOW,
        )
    assert "must-not-leak" not in str(captured.value)
    assert database.runs[-1]["status"] == "failed"


def test_failed_revision_audit_is_best_effort() -> None:
    def unavailable(*_args: object, **_kwargs: object) -> FakeSyncConnection:
        raise RuntimeError("unavailable")

    _record_failed_revision(
        "postgresql://gopher:secret@postgres/gopher",
        corpus_version="a" * 64,
        documents_seen=25,
        started_at=FIXED_NOW,
        connector=unavailable,
        connect_timeout_seconds=5,
    )


def test_freshness_and_chunk_precomputation_are_deterministic() -> None:
    document = KnowledgeDocument.model_validate(read_corpus()["documents"][0])
    assert _freshness(document, FIXED_NOW) is FreshnessState.FRESH
    assert (
        _freshness(
            document.model_copy(update={"updated_at": datetime(2030, 1, 1, tzinfo=UTC)}),
            FIXED_NOW,
        )
        is FreshnessState.UNKNOWN
    )
    assert (
        _freshness(
            document.model_copy(
                update={"updated_at": datetime(2026, 6, 8, tzinfo=UTC), "fresh_for_days": 30}
            ),
            FIXED_NOW,
        )
        is FreshnessState.STALE
    )
    assert (
        _freshness(
            document.model_copy(
                update={"updated_at": datetime(2020, 1, 1, tzinfo=UTC), "fresh_for_days": 30}
            ),
            FIXED_NOW,
        )
        is FreshnessState.EXPIRED
    )
    digest, token_count = _chunk_values(document.content.zh_cn)
    assert digest == hashlib_sha256(document.content.zh_cn)
    assert token_count > 0
    with pytest.raises(CorpusSyncError, match="token count"):
        _chunk_values("!!!")


def hashlib_sha256(value: str) -> str:
    import hashlib

    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def test_sync_cli_emits_only_safe_capability_metadata(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    settings = Settings(
        corpus_path=CORPUS_PATH,
        backend="postgres",
        database_url="postgresql://gopher:secret@postgres/gopher",
    )
    monkeypatch.setattr(Settings, "from_environment", classmethod(lambda _cls: settings))
    monkeypatch.setattr(
        "ai_knowledge.sync.sync_corpus",
        lambda *_args, **_kwargs: type(
            "Result",
            (),
            {
                "corpus_version": "a" * 64,
                "documents_seen": 25,
                "documents_indexed": 25,
                "documents_retired": 0,
            },
        )(),
    )
    main([])
    output = json.loads(capsys.readouterr().out)
    assert output["vectorSearchEnabled"] is False
    assert "secret" not in json.dumps(output)


def test_sync_cli_rejects_file_backend(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        Settings,
        "from_environment",
        classmethod(lambda _cls: Settings(corpus_path=CORPUS_PATH, backend="file")),
    )
    with pytest.raises(SystemExit) as captured:
        main([])
    assert captured.value.code == 2


class MissingIdentityConnection(FakeSyncConnection):
    def __init__(self, database: FakeDatabase, missing: str) -> None:
        super().__init__(database)
        self.missing = missing

    def execute(self, query: str, parameters: tuple[Any, ...] | None = None) -> FakeCursor:
        normalized = " ".join(query.split())
        if self.missing == "capability" and query == DATABASE_CAPABILITIES_SQL:
            return FakeCursor()
        if self.missing == "run" and normalized.startswith("INSERT INTO knowledge_ingestion_runs"):
            return FakeCursor()
        if self.missing == "document" and query == UPSERT_DOCUMENT_SQL:
            return FakeCursor()
        if self.missing == "chunk" and query == UPSERT_CHUNK_SQL:
            return FakeCursor()
        return super().execute(query, parameters)


@pytest.mark.parametrize(
    ("missing", "message"),
    [
        ("capability", "capabilities are unavailable"),
        ("run", "run returned no identity"),
        ("document", "document upsert returned no identity"),
    ],
)
def test_sync_manifest_rejects_missing_database_identities(missing: str, message: str) -> None:
    manifest = CorpusManifest.model_validate(
        fixture_manifest([clone_document("tc-library-overview")])
    )
    with pytest.raises(CorpusSyncError, match=message):
        _sync_manifest(
            MissingIdentityConnection(FakeDatabase(), missing),
            manifest,
            corpus_version="a" * 64,
            now=FIXED_NOW,
        )


def test_sync_document_rejects_missing_chunk_identity() -> None:
    document = KnowledgeDocument.model_validate(clone_document("tc-library-overview"))
    with pytest.raises(CorpusSyncError, match="chunk upsert returned no identity"):
        _sync_document_evidence(
            MissingIdentityConnection(FakeDatabase(), "chunk"),
            document,
            "document-1",
        )


def test_sync_cli_sanitizes_configuration_and_sync_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def invalid_configuration(_cls: type[Settings]) -> Settings:
        raise ConfigurationError("DATABASE_URL contains secret")

    monkeypatch.setattr(Settings, "from_environment", classmethod(invalid_configuration))
    with pytest.raises(SystemExit) as captured:
        main([])
    assert captured.value.code == 2

    settings = Settings(
        corpus_path=CORPUS_PATH,
        backend="postgres",
        database_url="postgresql://gopher:secret@postgres/gopher",
    )
    monkeypatch.setattr(Settings, "from_environment", classmethod(lambda _cls: settings))
    monkeypatch.setattr(
        "ai_knowledge.sync.sync_corpus",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(CorpusSyncError("secret")),
    )
    with pytest.raises(SystemExit) as captured:
        main([])
    assert captured.value.code == 1
