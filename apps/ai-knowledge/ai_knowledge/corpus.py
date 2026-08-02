from __future__ import annotations

import hashlib
import json
import threading
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any

from pydantic import ValidationError

from .models import (
    CampusId,
    CorpusManifest,
    KnowledgeDocument,
    KnowledgeSourceDescriptor,
    KnowledgeSourceResourceKind,
    LicenseStatus,
    VerificationState,
)

MAX_CORPUS_BYTES = 2 * 1_024 * 1_024


class CorpusIntegrityError(RuntimeError):
    """The local corpus failed closed because its integrity could not be established."""


def read_corpus_manifest(corpus_path: Path) -> tuple[CorpusManifest, str]:
    """Read and validate a release artifact without applying lifecycle filtering."""

    resolved_path = corpus_path.resolve()
    try:
        stat = resolved_path.stat()
    except OSError as error:
        raise CorpusIntegrityError("corpus is unavailable") from error
    if not resolved_path.is_file():
        raise CorpusIntegrityError("corpus path is not a regular file")
    if stat.st_size > MAX_CORPUS_BYTES:
        raise CorpusIntegrityError("corpus exceeds the configured size limit")
    try:
        raw = resolved_path.read_bytes()
    except OSError as error:
        raise CorpusIntegrityError("corpus cannot be read") from error
    if len(raw) > MAX_CORPUS_BYTES:
        raise CorpusIntegrityError("corpus exceeds the configured size limit")
    try:
        text = raw.decode("utf-8", errors="strict")
        decoded = json.loads(text, object_pairs_hook=_reject_duplicate_keys)
        manifest = CorpusManifest.model_validate(decoded)
    except (
        UnicodeDecodeError,
        json.JSONDecodeError,
        ValueError,
        TypeError,
        RecursionError,
        ValidationError,
    ) as error:
        raise CorpusIntegrityError("corpus validation failed") from error
    return manifest, hashlib.sha256(raw).hexdigest()


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


@dataclass(frozen=True, slots=True)
class KnowledgeSourceSnapshot:
    id: str
    campus_ids: tuple[CampusId, ...]
    resource_kind: KnowledgeSourceResourceKind
    source_url: str
    license_status: LicenseStatus
    license_evidence_url: str | None
    enabled: bool

    @classmethod
    def from_descriptor(cls, source: KnowledgeSourceDescriptor) -> KnowledgeSourceSnapshot:
        return cls(
            id=source.id,
            campus_ids=tuple(source.campus_ids),
            resource_kind=source.resource_kinds[0],
            source_url=str(source.source_url),
            license_status=source.license_status,
            license_evidence_url=(
                str(source.license_evidence_url)
                if source.license_evidence_url is not None
                else None
            ),
            enabled=source.is_enabled(),
        )


@dataclass(frozen=True, slots=True)
class CorpusSnapshot:
    documents: tuple[KnowledgeDocument, ...]
    source_registry: Mapping[str, KnowledgeSourceSnapshot]
    corpus_sha256: str

    def __post_init__(self) -> None:
        registry = dict(self.source_registry)
        if any(key != source.id for key, source in registry.items()):
            raise CorpusIntegrityError("knowledge source registry identity is invalid")
        referenced_source_ids = {
            source_id
            for document in self.documents
            for source_id in (document.summary_source_id, document.verification_source_id)
        }
        if set(registry) != referenced_source_ids:
            raise CorpusIntegrityError(
                "knowledge source registry must exactly match active document references"
            )
        object.__setattr__(self, "source_registry", MappingProxyType(registry))

        for document in self.documents:
            if document.verification_state is not VerificationState.SCHEMATIC:
                raise CorpusIntegrityError(
                    "active knowledge summaries lack supported review evidence"
                )
            summary = self.source(document.summary_source_id)
            verification = self.source(document.verification_source_id)
            if (
                not summary.enabled
                or summary.resource_kind is not KnowledgeSourceResourceKind.SUMMARY
                or summary.license_status is not LicenseStatus.OPEN_REUSE
                or summary.license_evidence_url != "https://www.apache.org/licenses/LICENSE-2.0"
                or document.campus_id not in summary.campus_ids
            ):
                raise CorpusIntegrityError("knowledge summary source governance is invalid")
            if (
                summary.id == verification.id
                or not verification.enabled
                or verification.resource_kind is not KnowledgeSourceResourceKind.VERIFICATION_LINK
                or verification.license_status is not LicenseStatus.DEEPLINK_ONLY
                or verification.license_evidence_url is not None
                or verification.campus_ids != (document.campus_id,)
                or verification.source_url != str(document.verification_url)
            ):
                raise CorpusIntegrityError("knowledge verification source governance is invalid")

    def for_campus(self, campus_id: CampusId) -> tuple[KnowledgeDocument, ...]:
        return tuple(document for document in self.documents if document.campus_id == campus_id)

    def source(self, source_id: str) -> KnowledgeSourceSnapshot:
        try:
            return self.source_registry[source_id]
        except KeyError:
            raise CorpusIntegrityError("knowledge document source is unavailable") from None


class KnowledgeRepository:
    """Atomically reloads and verifies a small, repository-owned corpus.

    A changed file is validated before it replaces the current snapshot. If validation
    fails, the request fails closed; the previous snapshot is never served after a
    detected change. This makes disable, retire, and delete propagation predictable.
    """

    def __init__(self, corpus_path: Path) -> None:
        self._corpus_path = corpus_path.resolve()
        self._lock = threading.RLock()
        self._fingerprint: tuple[int, int] | None = None
        self._snapshot: CorpusSnapshot | None = None
        self._failed_fingerprint: tuple[int, int] | None = None

    @property
    def corpus_path(self) -> Path:
        return self._corpus_path

    def snapshot(self) -> CorpusSnapshot:
        with self._lock:
            fingerprint = self._stat_fingerprint()
            if self._failed_fingerprint == fingerprint:
                raise CorpusIntegrityError("corpus validation failed for the current revision")
            if self._snapshot is None or self._fingerprint != fingerprint:
                try:
                    snapshot = self._load()
                except CorpusIntegrityError:
                    self._failed_fingerprint = fingerprint
                    self._snapshot = None
                    self._fingerprint = None
                    raise
                self._snapshot = snapshot
                self._fingerprint = fingerprint
                self._failed_fingerprint = None
            return self._snapshot

    def force_reload(self) -> CorpusSnapshot:
        with self._lock:
            self._fingerprint = None
            self._failed_fingerprint = None
            return self.snapshot()

    def _stat_fingerprint(self) -> tuple[int, int]:
        try:
            stat = self._corpus_path.stat()
        except OSError as error:
            raise CorpusIntegrityError("corpus is unavailable") from error
        if not self._corpus_path.is_file():
            raise CorpusIntegrityError("corpus path is not a regular file")
        if stat.st_size > MAX_CORPUS_BYTES:
            raise CorpusIntegrityError("corpus exceeds the configured size limit")
        return stat.st_mtime_ns, stat.st_size

    def _load(self) -> CorpusSnapshot:
        manifest, corpus_sha256 = read_corpus_manifest(self._corpus_path)

        if not manifest.is_publishable():
            documents: tuple[KnowledgeDocument, ...] = ()
        else:
            documents = tuple(
                document for document in manifest.documents if document.is_publishable()
            )

        referenced_source_ids = {
            source_id
            for document in documents
            for source_id in (document.summary_source_id, document.verification_source_id)
        }
        return CorpusSnapshot(
            documents=documents,
            source_registry={
                source.id: KnowledgeSourceSnapshot.from_descriptor(source)
                for source in manifest.source_registry
                if source.id in referenced_source_ids
            },
            corpus_sha256=corpus_sha256,
        )
