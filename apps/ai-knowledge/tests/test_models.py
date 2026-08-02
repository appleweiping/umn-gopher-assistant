from __future__ import annotations

import copy
from datetime import datetime

import pytest
from conftest import CORPUS_PATH, FIXED_NOW, fixture_manifest, read_corpus, rehash
from pydantic import ValidationError

from ai_knowledge.corpus import KnowledgeRepository
from ai_knowledge.models import (
    CorpusManifest,
    KnowledgeDocument,
    QueryRequest,
    QueryResponse,
    VerificationState,
)
from ai_knowledge.retrieval import HybridRetriever


def first_document() -> dict[str, object]:
    return copy.deepcopy(read_corpus()["documents"][0])


def test_text_and_keyword_validation_covers_whitespace_and_duplicates() -> None:
    with pytest.raises(ValidationError, match="leading or trailing whitespace"):
        QueryRequest(campusId="tc", locale="en", query=" library")

    document = first_document()
    document["keywords"]["en"] = ["library", "library"]  # type: ignore[index]
    with pytest.raises(ValidationError, match="keywords must be unique"):
        KnowledgeDocument.model_validate(document)


@pytest.mark.parametrize(
    "source_url",
    [
        "http://www.umn.edu/library",
        "https://user:password@www.umn.edu/library",
        "https://www.umn.edu:8443/library",
        "https://www.umn.edu/library?secret=value",
    ],
)
def test_source_url_rejects_unsafe_transport_and_authority(source_url: str) -> None:
    document = first_document()
    document["verificationUrl"] = source_url
    with pytest.raises(ValidationError):
        KnowledgeDocument.model_validate(document)


@pytest.mark.parametrize(
    "updated_at",
    ["not-a-timestamp", 42, "2026-07-23T00:00:00"],
)
def test_document_timestamp_must_be_parseable_typed_and_timezone_aware(
    updated_at: object,
) -> None:
    document = first_document()
    document["updatedAt"] = updated_at
    with pytest.raises(ValidationError, match="timestamps"):
        KnowledgeDocument.model_validate(document)


def test_enum_instance_is_accepted_and_conflict_metadata_must_be_paired() -> None:
    document = first_document()
    document["verificationState"] = VerificationState.SCHEMATIC
    assert (
        KnowledgeDocument.model_validate(document).verification_state is VerificationState.SCHEMATIC
    )

    document["conflictGroup"] = "release-group"
    with pytest.raises(ValidationError, match="must be supplied together"):
        KnowledgeDocument.model_validate(document)


@pytest.mark.parametrize("deleted_at", ["bad-date", 42, datetime(2026, 7, 23)])
def test_manifest_delete_timestamp_is_strict(deleted_at: object) -> None:
    manifest = fixture_manifest([first_document()])
    manifest["deletedAt"] = deleted_at
    with pytest.raises(ValidationError, match="deletedAt"):
        CorpusManifest.model_validate(manifest)


def test_manifest_rejects_duplicate_document_and_registry_identities() -> None:
    first = first_document()
    duplicate_id = copy.deepcopy(first)
    duplicate_id["verificationSourceId"] = "different-source-id"
    rehash(duplicate_id)
    with pytest.raises(ValidationError, match="document ids must be unique"):
        CorpusManifest.model_validate(fixture_manifest([first, duplicate_id]))

    manifest = fixture_manifest([first])
    manifest["sourceRegistry"].append(copy.deepcopy(manifest["sourceRegistry"][0]))
    with pytest.raises(ValidationError, match="source ids must be unique"):
        CorpusManifest.model_validate(manifest)


def answered_response() -> dict[str, object]:
    result = HybridRetriever(clock=lambda: FIXED_NOW).query(
        QueryRequest(campusId="tc", locale="en", query="library research catalog"),
        KnowledgeRepository(CORPUS_PATH).snapshot(),
    )
    return result.model_dump(mode="json", by_alias=True)


def conflict_response() -> dict[str, object]:
    response = answered_response()
    first_citation = copy.deepcopy(response["citations"][0])  # type: ignore[index]
    first_paragraph = response["paragraphs"][0]  # type: ignore[index]
    second_citation = copy.deepcopy(first_citation)
    second_citation.update(
        id="citation-conflicting",
        documentId="tc-library-conflicting",
        contentSha256="b" * 64,
    )
    second_citation["verificationLink"]["sourceId"] = "official-tc-library-conflicting"
    first_paragraph["citationIds"] = [first_citation["id"], second_citation["id"]]
    response["state"] = "conflict"
    response["citations"] = [first_citation, second_citation]
    return response


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (
            lambda value: value["paragraphs"][0]["citationIds"].append("citation-missing"),
            "must resolve",
        ),
        (
            lambda value: value["citations"].append(
                {**value["citations"][0], "id": "citation-unused"}
            ),
            "every citation",
        ),
        (
            lambda value: value["citations"][0].update(campusId="morris"),
            "cross-campus",
        ),
        (
            lambda value: value["citations"][0].update(summaryVerificationState="verified"),
            "schematic",
        ),
        (
            lambda value: value["citations"][0].update(summaryFreshnessState="UNKNOWN"),
            "FRESH",
        ),
        (
            lambda value: value["citations"][0].update(summaryFreshnessState="STALE"),
            "only FRESH",
        ),
    ],
)
def test_query_response_rejects_invalid_evidence_graphs(mutation: object, message: str) -> None:
    response = answered_response()
    mutation(response)  # type: ignore[operator]
    with pytest.raises(ValidationError, match=message):
        QueryResponse.model_validate(response)


def test_query_response_requires_unique_ids_and_state_specific_evidence() -> None:
    response = answered_response()
    duplicate_paragraph = copy.deepcopy(response["paragraphs"][0])  # type: ignore[index]
    response["paragraphs"].append(duplicate_paragraph)  # type: ignore[union-attr]
    with pytest.raises(ValidationError, match="paragraph ids must be unique"):
        QueryResponse.model_validate(response)

    response = answered_response()
    response["citations"].append(copy.deepcopy(response["citations"][0]))  # type: ignore[union-attr,index]
    with pytest.raises(ValidationError, match="citation ids must be unique"):
        QueryResponse.model_validate(response)

    response = answered_response()
    response["paragraphs"][0]["citationIds"] *= 2  # type: ignore[index]
    with pytest.raises(ValidationError, match="unique within a paragraph"):
        QueryResponse.model_validate(response)

    response = answered_response()
    response["state"] = "stale"
    with pytest.raises(ValidationError, match="STALE or EXPIRED"):
        QueryResponse.model_validate(response)

    response = answered_response()
    response["state"] = "no-results"
    with pytest.raises(ValidationError, match="cannot contain evidence"):
        QueryResponse.model_validate(response)

    response = answered_response()
    response["paragraphs"] = []
    response["citations"] = []
    with pytest.raises(ValidationError, match="require evidence"):
        QueryResponse.model_validate(response)


@pytest.mark.parametrize(
    "mutation",
    [
        lambda value: value["paragraphs"][0].update(text=" padded"),
        lambda value: value["paragraphs"][0].update(text="<strong>unsafe</strong>"),
        lambda value: value["citations"][0].update(excerpt="unsafe\u202etext"),
        lambda value: value["citations"][0].update(excerpt="&#x3c;script&#x3e;"),
        lambda value: value["citations"][0].update(excerpt="unsafe &notanentity"),
        lambda value: value["citations"][0]["title"].update(en="cafe\u0301"),
    ],
)
def test_query_response_rejects_unsafe_evidence_text(mutation: object) -> None:
    response = answered_response()
    mutation(response)  # type: ignore[operator]
    with pytest.raises(ValidationError):
        QueryResponse.model_validate(response)


def test_conflict_response_requires_distinct_records_links_and_content() -> None:
    response = conflict_response()
    assert QueryResponse.model_validate(response).state == "conflict"

    one_citation = conflict_response()
    one_citation["citations"] = one_citation["citations"][:1]  # type: ignore[index]
    one_citation["paragraphs"][0]["citationIds"] = [  # type: ignore[index]
        one_citation["citations"][0]["id"]  # type: ignore[index]
    ]
    with pytest.raises(ValidationError, match="at least two citations"):
        QueryResponse.model_validate(one_citation)

    same_record = conflict_response()
    same_record["citations"][1]["documentId"] = same_record["citations"][0]["documentId"]  # type: ignore[index]
    with pytest.raises(ValidationError, match="distinct records"):
        QueryResponse.model_validate(same_record)

    same_verification_link = conflict_response()
    same_verification_link["citations"][1]["verificationLink"]["sourceId"] = (  # type: ignore[index]
        same_verification_link["citations"][0]["verificationLink"]["sourceId"]  # type: ignore[index]
    )
    with pytest.raises(ValidationError, match="distinct verification links"):
        QueryResponse.model_validate(same_verification_link)

    same_content = conflict_response()
    same_content["citations"][1]["contentSha256"] = same_content["citations"][0][  # type: ignore[index]
        "contentSha256"
    ]
    with pytest.raises(ValidationError, match="genuinely different"):
        QueryResponse.model_validate(same_content)

    mixed_revision = conflict_response()
    mixed_revision["citations"][1]["summarySource"]["corpusSha256"] = "f" * 64  # type: ignore[index]
    with pytest.raises(ValidationError, match="cannot mix summary corpus revisions"):
        QueryResponse.model_validate(mixed_revision)


@pytest.mark.parametrize(
    "mutation",
    [
        lambda citation: citation.update(sourceId="official-tc-library"),
        lambda citation: citation.update(sourceUrl="https://www.lib.umn.edu/"),
        lambda citation: citation["summarySource"].update(
            sourceId=citation["verificationLink"]["sourceId"]
        ),
        lambda citation: citation["summarySource"]["license"].update(
            evidenceUrl="https://www.apache.org/licenses/LICENSE-1.0"
        ),
        lambda citation: citation["verificationLink"].update(contentRetrieved=True),
    ],
)
def test_citation_provenance_shape_fails_closed(mutation: object) -> None:
    response = answered_response()
    mutation(response["citations"][0])  # type: ignore[operator,index]
    with pytest.raises(ValidationError):
        QueryResponse.model_validate(response)


@pytest.mark.parametrize(
    "source_url",
    [
        "https://github.com/appleweiping/umn-gopher-assistant/blob/../corpus.json",
        "https://github.com/appleweiping/umn-gopher-assistant/blob/./corpus.json",
        "https://github.com/appleweiping/umn-gopher-assistant/blob/%2e%2e/corpus.json",
        "https://github.com/appleweiping/umn-gopher-assistant/blob/%2F/corpus.json",
    ],
)
def test_citation_summary_source_rejects_ambiguous_repository_paths(source_url: str) -> None:
    response = answered_response()
    response["citations"][0]["summarySource"]["sourceUrl"] = source_url  # type: ignore[index]

    with pytest.raises(ValidationError, match="identify this repository"):
        QueryResponse.model_validate(response)


def test_citation_summary_source_accepts_explicit_default_https_port() -> None:
    response = answered_response()
    source_url = response["citations"][0]["summarySource"]["sourceUrl"]  # type: ignore[index]
    response["citations"][0]["summarySource"]["sourceUrl"] = source_url.replace(  # type: ignore[index,union-attr]
        "github.com/", "github.com:443/"
    )

    assert QueryResponse.model_validate(response).citations
