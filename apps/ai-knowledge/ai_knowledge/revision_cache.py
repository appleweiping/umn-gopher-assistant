from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from threading import Condition

from .corpus import CorpusIntegrityError, CorpusSnapshot


@dataclass(frozen=True, slots=True)
class IngestionRevision:
    status: str
    corpus_version: str


class RevisionAwareSnapshotCache:
    """A bounded, fail-closed snapshot cache with one database loader in flight.

    The inexpensive revision probe runs much more frequently than the full
    snapshot loader.  A new or failed ingestion revision invalidates the old
    snapshot; the full snapshot is also rebuilt at the finite TTL even if the
    revision identifier has not changed.
    """

    def __init__(
        self,
        *,
        revision_probe: Callable[[], IngestionRevision],
        snapshot_loader: Callable[[str], CorpusSnapshot],
        cache_ttl_seconds: float,
        revision_check_interval_seconds: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._revision_probe = revision_probe
        self._snapshot_loader = snapshot_loader
        self._cache_ttl_seconds = cache_ttl_seconds
        self._revision_check_interval_seconds = revision_check_interval_seconds
        self._clock = clock
        self._condition = Condition()
        self._loading = False
        self._closed = False
        self._snapshot: CorpusSnapshot | None = None
        self._snapshot_loaded_at = 0.0
        self._next_revision_check_at = 0.0
        self._failure_until = 0.0

    def snapshot(self) -> CorpusSnapshot:
        while True:
            with self._condition:
                now = self._clock()
                if self._closed:
                    raise CorpusIntegrityError("knowledge repository is closed")
                if self._loading:
                    self._condition.wait()
                    continue
                if now < self._failure_until:
                    raise CorpusIntegrityError(
                        "knowledge database has no usable ingestion revision"
                    )
                if (
                    self._snapshot is not None
                    and now < self._next_revision_check_at
                    and now - self._snapshot_loaded_at < self._cache_ttl_seconds
                ):
                    return self._snapshot
                self._loading = True
                break

        try:
            revision = self._revision_probe()
            if revision.status != "succeeded":
                raise CorpusIntegrityError("knowledge database has no usable ingestion revision")
            if not revision.corpus_version:
                raise CorpusIntegrityError("knowledge ingestion revision is invalid")

            now = self._clock()
            with self._condition:
                cached = self._snapshot
                cache_is_current = (
                    cached is not None
                    and cached.corpus_sha256 == revision.corpus_version
                    and now - self._snapshot_loaded_at < self._cache_ttl_seconds
                )
            snapshot = (
                cached if cache_is_current else self._snapshot_loader(revision.corpus_version)
            )
            if snapshot is None or snapshot.corpus_sha256 != revision.corpus_version:
                raise CorpusIntegrityError("knowledge snapshot revision changed during loading")
        except CorpusIntegrityError:
            with self._condition:
                self._snapshot = None
                self._failure_until = self._clock() + self._revision_check_interval_seconds
                self._loading = False
                self._condition.notify_all()
            raise
        except Exception:
            with self._condition:
                self._snapshot = None
                self._failure_until = self._clock() + self._revision_check_interval_seconds
                self._loading = False
                self._condition.notify_all()
            raise CorpusIntegrityError("knowledge database is unavailable or invalid") from None

        with self._condition:
            if self._closed:
                self._loading = False
                self._condition.notify_all()
                raise CorpusIntegrityError("knowledge repository is closed")
            loaded_at = self._clock()
            self._snapshot = snapshot
            if not cache_is_current:
                self._snapshot_loaded_at = loaded_at
            self._next_revision_check_at = loaded_at + self._revision_check_interval_seconds
            self._failure_until = 0.0
            self._loading = False
            self._condition.notify_all()
            return snapshot

    def close(self) -> None:
        with self._condition:
            self._closed = True
            self._snapshot = None
            self._condition.notify_all()
