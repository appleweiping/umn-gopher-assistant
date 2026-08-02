from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from threading import Barrier, Lock

import pytest

from ai_knowledge.corpus import CorpusIntegrityError, CorpusSnapshot
from ai_knowledge.revision_cache import IngestionRevision, RevisionAwareSnapshotCache


@dataclass
class ManualClock:
    value: float = 100.0

    def __call__(self) -> float:
        return self.value


def empty_snapshot(revision: str) -> CorpusSnapshot:
    return CorpusSnapshot(documents=(), source_registry={}, corpus_sha256=revision)


def test_snapshot_cache_coalesces_concurrent_cold_loads() -> None:
    calls = {"probe": 0, "load": 0}
    calls_lock = Lock()
    worker_count = 24
    barrier = Barrier(worker_count)

    def probe() -> IngestionRevision:
        with calls_lock:
            calls["probe"] += 1
        return IngestionRevision("succeeded", "a" * 64)

    def load(revision: str) -> CorpusSnapshot:
        with calls_lock:
            calls["load"] += 1
        return empty_snapshot(revision)

    cache = RevisionAwareSnapshotCache(
        revision_probe=probe,
        snapshot_loader=load,
        cache_ttl_seconds=30,
        revision_check_interval_seconds=1,
    )

    def read() -> CorpusSnapshot:
        barrier.wait()
        return cache.snapshot()

    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        results = list(executor.map(lambda _index: read(), range(worker_count)))

    assert {result.corpus_sha256 for result in results} == {"a" * 64}
    assert calls == {"probe": 1, "load": 1}


def test_new_and_failed_revisions_invalidate_the_previous_snapshot() -> None:
    clock = ManualClock()
    revision = IngestionRevision("succeeded", "a" * 64)
    loaded: list[str] = []
    cache = RevisionAwareSnapshotCache(
        revision_probe=lambda: revision,
        snapshot_loader=lambda value: loaded.append(value) or empty_snapshot(value),
        cache_ttl_seconds=30,
        revision_check_interval_seconds=1,
        clock=clock,
    )

    assert cache.snapshot().corpus_sha256 == "a" * 64
    revision = IngestionRevision("succeeded", "b" * 64)
    clock.value += 1.1
    assert cache.snapshot().corpus_sha256 == "b" * 64

    revision = IngestionRevision("failed", "c" * 64)
    clock.value += 1.1
    with pytest.raises(CorpusIntegrityError, match="no usable ingestion"):
        cache.snapshot()
    with pytest.raises(CorpusIntegrityError, match="no usable ingestion"):
        cache.snapshot()
    assert loaded == ["a" * 64, "b" * 64]


def test_finite_ttl_reloads_an_unchanged_revision() -> None:
    clock = ManualClock()
    loads = 0

    def load(revision: str) -> CorpusSnapshot:
        nonlocal loads
        loads += 1
        return empty_snapshot(revision)

    cache = RevisionAwareSnapshotCache(
        revision_probe=lambda: IngestionRevision("succeeded", "a" * 64),
        snapshot_loader=load,
        cache_ttl_seconds=5,
        revision_check_interval_seconds=1,
        clock=clock,
    )
    cache.snapshot()
    clock.value += 1.1
    cache.snapshot()
    assert loads == 1
    clock.value += 4
    cache.snapshot()
    assert loads == 2


def test_loader_failure_is_sanitized_and_shared_for_the_failure_window() -> None:
    clock = ManualClock()
    probes = 0

    def probe() -> IngestionRevision:
        nonlocal probes
        probes += 1
        return IngestionRevision("succeeded", "a" * 64)

    def load(_revision: str) -> CorpusSnapshot:
        raise RuntimeError("password=must-not-leak")

    cache = RevisionAwareSnapshotCache(
        revision_probe=probe,
        snapshot_loader=load,
        cache_ttl_seconds=30,
        revision_check_interval_seconds=1,
        clock=clock,
    )
    with pytest.raises(CorpusIntegrityError) as captured:
        cache.snapshot()
    assert "must-not-leak" not in str(captured.value)
    with pytest.raises(CorpusIntegrityError):
        cache.snapshot()
    assert probes == 1


def test_closed_cache_fails_closed() -> None:
    cache = RevisionAwareSnapshotCache(
        revision_probe=lambda: IngestionRevision("succeeded", "a" * 64),
        snapshot_loader=empty_snapshot,
        cache_ttl_seconds=30,
        revision_check_interval_seconds=1,
    )
    cache.close()
    with pytest.raises(CorpusIntegrityError, match="closed"):
        cache.snapshot()


def test_empty_or_changed_revision_fails_closed() -> None:
    empty_revision = RevisionAwareSnapshotCache(
        revision_probe=lambda: IngestionRevision("succeeded", ""),
        snapshot_loader=empty_snapshot,
        cache_ttl_seconds=30,
        revision_check_interval_seconds=1,
    )
    with pytest.raises(CorpusIntegrityError, match="revision is invalid"):
        empty_revision.snapshot()

    changed_revision = RevisionAwareSnapshotCache(
        revision_probe=lambda: IngestionRevision("succeeded", "a" * 64),
        snapshot_loader=lambda _revision: empty_snapshot("b" * 64),
        cache_ttl_seconds=30,
        revision_check_interval_seconds=1,
    )
    with pytest.raises(CorpusIntegrityError, match="changed during loading"):
        changed_revision.snapshot()


def test_close_during_a_load_discards_the_loaded_snapshot() -> None:
    cache: RevisionAwareSnapshotCache

    def close_while_loading(revision: str) -> CorpusSnapshot:
        cache.close()
        return empty_snapshot(revision)

    cache = RevisionAwareSnapshotCache(
        revision_probe=lambda: IngestionRevision("succeeded", "a" * 64),
        snapshot_loader=close_while_loading,
        cache_ttl_seconds=30,
        revision_check_interval_seconds=1,
    )
    with pytest.raises(CorpusIntegrityError, match="closed"):
        cache.snapshot()
