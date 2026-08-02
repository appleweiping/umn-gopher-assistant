from __future__ import annotations

import copy
import json
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from conftest import CORPUS_PATH, fixture_manifest, read_corpus, write_manifest

from ai_knowledge.corpus import (
    MAX_CORPUS_BYTES,
    CorpusIntegrityError,
    KnowledgeRepository,
    read_corpus_manifest,
)


def test_shipped_corpus_has_complete_five_by_five_coverage(repository: KnowledgeRepository) -> None:
    snapshot = repository.snapshot()
    assert len(snapshot.documents) == 25
    assert {(document.campus_id, document.category) for document in snapshot.documents} == {
        (campus_id, category)
        for campus_id in ("tc", "duluth", "crookston", "morris", "rochester")
        for category in ("library", "student-services", "safety", "transportation", "dining")
    }
    assert all(len(document.content_sha256) == 64 for document in snapshot.documents)
    assert all(document.summary_license == "Apache-2.0" for document in snapshot.documents)
    assert all(document.source_use == "verification-link-only" for document in snapshot.documents)
    assert all(
        document.summary_source_id == "uga-ai-summary-corpus-v1" for document in snapshot.documents
    )


def test_every_verification_link_is_https_and_official(repository: KnowledgeRepository) -> None:
    for document in repository.snapshot().documents:
        parsed = urlsplit(str(document.verification_url))
        assert parsed.scheme == "https"
        assert parsed.hostname == "umn.edu" or parsed.hostname.endswith(".umn.edu")
        assert parsed.username is None
        assert parsed.password is None
        assert parsed.query == ""
        assert parsed.fragment == ""


def test_changed_content_with_old_hash_fails_closed(tmp_path: Path) -> None:
    manifest = read_corpus()
    path = tmp_path / "corpus.json"
    write_manifest(path, manifest)
    repository = KnowledgeRepository(path)
    assert len(repository.snapshot().documents) == 25

    manifest["documents"][0]["content"]["en"] += " Tampered."
    write_manifest(path, manifest)

    with pytest.raises(CorpusIntegrityError):
        repository.snapshot()
    with pytest.raises(CorpusIntegrityError):
        repository.snapshot()


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("enabled", False),
        ("verificationState", "retired"),
        ("deletedAt", "2026-07-22T00:00:00Z"),
    ],
)
def test_record_lifecycle_changes_propagate_on_reload(
    tmp_path: Path, field: str, value: object
) -> None:
    manifest = read_corpus()
    path = tmp_path / "corpus.json"
    write_manifest(path, manifest)
    repository = KnowledgeRepository(path)
    assert len(repository.snapshot().for_campus("tc")) == 5

    target = next(item for item in manifest["documents"] if item["id"] == "tc-library-overview")
    target[field] = value
    write_manifest(path, manifest)

    reloaded = repository.snapshot()
    assert len(reloaded.for_campus("tc")) == 4
    assert all(document.id != "tc-library-overview" for document in reloaded.documents)
    assert "official-tc-library" not in reloaded.source_registry


def test_manifest_kill_switch_removes_all_documents(tmp_path: Path) -> None:
    manifest = read_corpus()
    manifest["enabled"] = False
    path = tmp_path / "corpus.json"
    write_manifest(path, manifest)
    snapshot = KnowledgeRepository(path).snapshot()
    assert snapshot.documents == ()
    assert dict(snapshot.source_registry) == {}


def test_manifest_delete_marker_removes_all_documents(tmp_path: Path) -> None:
    manifest = read_corpus()
    manifest["deletedAt"] = "2026-07-22T00:00:00Z"
    path = tmp_path / "corpus.json"
    write_manifest(path, manifest)
    snapshot = KnowledgeRepository(path).snapshot()
    assert snapshot.documents == ()
    assert dict(snapshot.source_registry) == {}


@pytest.mark.parametrize("verification_state", ["surveyed", "campus-reviewed", "verified"])
def test_active_file_summaries_cannot_claim_review_without_evidence(
    tmp_path: Path, verification_state: str
) -> None:
    manifest = read_corpus()
    manifest["documents"][0]["verificationState"] = verification_state
    path = tmp_path / "corpus.json"
    write_manifest(path, manifest)

    with pytest.raises(CorpusIntegrityError, match="lack supported review evidence"):
        KnowledgeRepository(path).snapshot()


def test_runtime_source_registry_is_immutable_and_exact(repository: KnowledgeRepository) -> None:
    snapshot = repository.snapshot()
    referenced = {
        source_id
        for document in snapshot.documents
        for source_id in (document.summary_source_id, document.verification_source_id)
    }
    assert set(snapshot.source_registry) == referenced
    with pytest.raises(TypeError):
        snapshot.source_registry["unexpected"] = snapshot.source("official-tc-library")  # type: ignore[index]


def test_summary_license_evidence_is_exactly_bound(tmp_path: Path) -> None:
    manifest = read_corpus()
    manifest["sourceRegistry"][0]["licenseEvidenceUrl"] = (
        "https://www.apache.org/licenses/LICENSE-1.0"
    )
    path = tmp_path / "corpus.json"
    write_manifest(path, manifest)

    with pytest.raises(CorpusIntegrityError, match="summary source governance"):
        KnowledgeRepository(path).snapshot()


@pytest.mark.parametrize(
    "source_url",
    [
        "https://github.com/appleweiping/umn-gopher-assistant/blob/../corpus.json",
        "https://github.com/appleweiping/umn-gopher-assistant/blob/./corpus.json",
        "https://github.com/appleweiping/umn-gopher-assistant/blob/%2e%2e/corpus.json",
        "https://github.com/appleweiping/umn-gopher-assistant/blob/%2F/corpus.json",
        "https://github.com/appleweiping/umn-gopher-assistant/blob/main/README.md",
    ],
)
def test_summary_registry_rejects_ambiguous_repository_paths(
    tmp_path: Path, source_url: str
) -> None:
    manifest = read_corpus()
    manifest["sourceRegistry"][0]["sourceUrl"] = source_url
    path = tmp_path / "corpus.json"
    write_manifest(path, manifest)

    with pytest.raises(CorpusIntegrityError):
        KnowledgeRepository(path).snapshot()


def test_summary_registry_accepts_explicit_default_https_port(tmp_path: Path) -> None:
    manifest = read_corpus()
    manifest["sourceRegistry"][0]["sourceUrl"] = manifest["sourceRegistry"][0]["sourceUrl"].replace(
        "github.com/", "github.com:443/"
    )
    path = tmp_path / "corpus.json"
    write_manifest(path, manifest)

    assert len(KnowledgeRepository(path).snapshot().documents) == 25


def test_duplicate_json_keys_are_rejected(tmp_path: Path) -> None:
    path = tmp_path / "corpus.json"
    path.write_text('{"schemaVersion":1,"schemaVersion":1}', encoding="utf-8")
    with pytest.raises(CorpusIntegrityError):
        KnowledgeRepository(path).snapshot()


def test_invalid_utf8_corpus_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "corpus.json"
    path.write_bytes(b"\xff\xfe")
    with pytest.raises(CorpusIntegrityError):
        KnowledgeRepository(path).snapshot()


def test_external_source_url_is_rejected(tmp_path: Path) -> None:
    document = copy.deepcopy(read_corpus()["documents"][0])
    document["verificationUrl"] = "https://example.com/not-official"
    path = tmp_path / "corpus.json"
    write_manifest(path, fixture_manifest([document]))
    with pytest.raises(CorpusIntegrityError):
        KnowledgeRepository(path).snapshot()


def test_required_coverage_cannot_be_accidentally_shrunk(tmp_path: Path) -> None:
    manifest = read_corpus()
    manifest["documents"] = manifest["documents"][:-1]
    path = tmp_path / "corpus.json"
    write_manifest(path, manifest)
    with pytest.raises(CorpusIntegrityError):
        KnowledgeRepository(path).snapshot()


def test_corpus_is_bounded_and_repository_owned() -> None:
    assert CORPUS_PATH.stat().st_size < 2 * 1_024 * 1_024
    raw = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))
    assert raw["summaryContentLicense"] == "Apache-2.0"
    assert raw["provenance"] == "project-authored-summaries"
    assert raw["sourcePolicy"] == "official-links-are-verification-only"


@pytest.mark.parametrize(
    ("mutation", "expected"),
    [
        (lambda manifest: manifest["sourceRegistry"].pop(), "registered"),
        (
            lambda manifest: manifest["sourceRegistry"][0]["killSwitch"].update(
                defaultState="DISABLED"
            ),
            "disabled",
        ),
        (
            lambda manifest: manifest["sourceRegistry"][0].update(
                licenseStatus="DEEPLINK_ONLY", licenseEvidenceUrl=None
            ),
            "OPEN_REUSE",
        ),
        (
            lambda manifest: manifest["sourceRegistry"][1].update(
                licenseStatus="OPEN_REUSE",
                licenseEvidenceUrl="https://www.apache.org/licenses/LICENSE-2.0",
            ),
            "DEEPLINK_ONLY",
        ),
    ],
)
def test_source_governance_mismatch_fails_closed(
    tmp_path: Path, mutation: object, expected: str
) -> None:
    manifest = read_corpus()
    mutation(manifest)  # type: ignore[operator]
    path = tmp_path / "corpus.json"
    write_manifest(path, manifest)
    with pytest.raises(CorpusIntegrityError) as captured:
        KnowledgeRepository(path).snapshot()
    assert captured.value.__cause__ is not None
    assert expected in str(captured.value.__cause__)


def test_document_and_registered_verification_url_must_match(tmp_path: Path) -> None:
    manifest = read_corpus()
    manifest["documents"][0]["verificationUrl"] = "https://safe-campus.umn.edu/"
    path = tmp_path / "corpus.json"
    write_manifest(path, manifest)
    with pytest.raises(CorpusIntegrityError):
        KnowledgeRepository(path).snapshot()


def test_repository_path_failures_and_force_reload_are_explicit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    missing = tmp_path / "missing.json"
    with pytest.raises(CorpusIntegrityError, match="unavailable"):
        read_corpus_manifest(missing)
    with pytest.raises(CorpusIntegrityError, match="unavailable"):
        KnowledgeRepository(missing).snapshot()

    with pytest.raises(CorpusIntegrityError, match="regular file"):
        read_corpus_manifest(tmp_path)
    with pytest.raises(CorpusIntegrityError, match="regular file"):
        KnowledgeRepository(tmp_path).snapshot()

    path = tmp_path / "corpus.json"
    path.write_bytes(b"x" * (MAX_CORPUS_BYTES + 1))
    with pytest.raises(CorpusIntegrityError, match="size limit"):
        read_corpus_manifest(path)
    with pytest.raises(CorpusIntegrityError, match="size limit"):
        KnowledgeRepository(path).snapshot()

    path.write_bytes(CORPUS_PATH.read_bytes())
    repository = KnowledgeRepository(path)
    assert repository.corpus_path == path.resolve()
    first = repository.snapshot()
    assert repository.force_reload() == first

    original_read_bytes = Path.read_bytes

    def unreadable(candidate: Path) -> bytes:
        if candidate == path.resolve():
            raise OSError("denied")
        return original_read_bytes(candidate)

    monkeypatch.setattr(Path, "read_bytes", unreadable)
    with pytest.raises(CorpusIntegrityError, match="cannot be read"):
        read_corpus_manifest(path)


def test_corpus_size_is_rechecked_after_read(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "growing.json"
    path.write_text("{}", encoding="utf-8")
    original_read_bytes = Path.read_bytes

    def growing_read(candidate: Path) -> bytes:
        if candidate == path.resolve():
            return b"x" * (MAX_CORPUS_BYTES + 1)
        return original_read_bytes(candidate)

    monkeypatch.setattr(Path, "read_bytes", growing_read)
    with pytest.raises(CorpusIntegrityError, match="size limit"):
        read_corpus_manifest(path)
