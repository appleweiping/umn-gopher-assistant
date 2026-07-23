from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from .models import CampusId, CorpusManifest, KnowledgeDocument

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
class CorpusSnapshot:
    documents: tuple[KnowledgeDocument, ...]
    corpus_sha256: str

    def for_campus(self, campus_id: CampusId) -> tuple[KnowledgeDocument, ...]:
        return tuple(document for document in self.documents if document.campus_id == campus_id)


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

        return CorpusSnapshot(
            documents=documents,
            corpus_sha256=corpus_sha256,
        )
