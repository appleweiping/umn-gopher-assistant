from __future__ import annotations

import base64
import copy
import hashlib
import json
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from ai_knowledge.app import create_app
from ai_knowledge.config import Settings
from ai_knowledge.corpus import KnowledgeRepository
from ai_knowledge.retrieval import HybridRetriever
from ai_knowledge.service_auth import sign_service_request

SERVICE_ROOT = Path(__file__).resolve().parent.parent
CORPUS_PATH = SERVICE_ROOT / "ai_knowledge" / "data" / "corpus.json"
FIXED_NOW = datetime(2026, 7, 23, tzinfo=UTC)
TEST_SERVICE_HMAC_KEY = b"development-only-ai-service-hmac-key-v1"


def signed_query_headers(
    body: bytes,
    *,
    timestamp: int | None = None,
    trace_id: str | None = None,
    nonce: str | None = None,
) -> dict[str, str]:
    resolved_timestamp = str(int(time.time()) if timestamp is None else timestamp)
    resolved_trace_id = trace_id or f"test-{uuid.uuid4()}"
    resolved_nonce = nonce or base64.urlsafe_b64encode(uuid.uuid4().bytes).rstrip(b"=").decode()
    return {
        "X-Ai-Service-Signature": sign_service_request(
            TEST_SERVICE_HMAC_KEY,
            body=body,
            trace_id=resolved_trace_id,
            timestamp=resolved_timestamp,
            nonce=resolved_nonce,
        ),
        "X-Ai-Service-Nonce": resolved_nonce,
        "X-Ai-Service-Timestamp": resolved_timestamp,
        "X-Request-Id": resolved_trace_id,
    }


class SignedTestClient(TestClient):
    def post(self, url: object, **kwargs: Any):  # type: ignore[override]
        if str(url).split("?", maxsplit=1)[0] != "/v1/query":
            return super().post(url, **kwargs)  # type: ignore[arg-type]

        json_body = kwargs.pop("json", None)
        content = kwargs.pop("content", None)
        if json_body is not None:
            body = json.dumps(
                json_body,
                ensure_ascii=False,
                separators=(",", ":"),
                allow_nan=False,
            ).encode("utf-8")
        elif isinstance(content, str):
            body = content.encode("utf-8")
        elif content is None:
            body = b""
        else:
            body = bytes(content)

        supplied_headers = dict(kwargs.pop("headers", {}) or {})
        normalized_headers = {key.casefold(): value for key, value in supplied_headers.items()}
        trace_id = normalized_headers.get("x-request-id") or f"test-{uuid.uuid4()}"
        timestamp = int(time.time())
        if "content-type" not in normalized_headers:
            supplied_headers["Content-Type"] = "application/json"
        if "x-request-id" not in normalized_headers:
            supplied_headers["X-Request-Id"] = trace_id
        supplied_headers.update(signed_query_headers(body, timestamp=timestamp, trace_id=trace_id))
        return super().post(  # type: ignore[arg-type]
            url,
            content=body,
            headers=supplied_headers,
            **kwargs,
        )


def read_corpus() -> dict[str, Any]:
    return json.loads(CORPUS_PATH.read_text(encoding="utf-8"))


def canonical_record_digest(document: dict[str, Any]) -> str:
    payload = {
        "campusId": document["campusId"],
        "category": document["category"],
        "content": document["content"],
        "id": document["id"],
        "title": document["title"],
    }
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def rehash(document: dict[str, Any]) -> dict[str, Any]:
    document["contentSha256"] = canonical_record_digest(document)
    return document


def fixture_manifest(documents: list[dict[str, Any]], *, enabled: bool = True) -> dict[str, Any]:
    shipped = read_corpus()
    source_ids = {
        source_id
        for document in documents
        for source_id in (document["summarySourceId"], document["verificationSourceId"])
    }
    sources_by_id = {source["id"]: copy.deepcopy(source) for source in shipped["sourceRegistry"]}
    for document in documents:
        verification_id = document["verificationSourceId"]
        if verification_id not in sources_by_id:
            template = next(
                source
                for source in shipped["sourceRegistry"]
                if source["resourceKinds"] == ["AI_VERIFICATION_LINK"]
                and source["campusIds"] == [document["campusId"]]
                and source["sourceUrl"] == document["verificationUrl"]
            )
            replacement = copy.deepcopy(template)
            replacement["id"] = verification_id
            replacement["killSwitch"]["key"] = f"source.{verification_id}.enabled"
            sources_by_id[verification_id] = replacement
    return {
        "schemaVersion": 1,
        "summaryContentLicense": "Apache-2.0",
        "provenance": "project-authored-summaries",
        "sourcePolicy": "official-links-are-verification-only",
        "enforceCoverage": False,
        "enabled": enabled,
        "deletedAt": None,
        "sourceRegistry": [sources_by_id[source_id] for source_id in sorted(source_ids)],
        "documents": documents,
    }


def write_manifest(path: Path, manifest: dict[str, Any]) -> None:
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def clone_document(document_id: str, **changes: Any) -> dict[str, Any]:
    document = copy.deepcopy(
        next(item for item in read_corpus()["documents"] if item["id"] == document_id)
    )
    document.update(changes)
    return rehash(document)


@pytest.fixture
def repository() -> KnowledgeRepository:
    return KnowledgeRepository(CORPUS_PATH)


@pytest.fixture
def retriever() -> HybridRetriever:
    return HybridRetriever(clock=lambda: FIXED_NOW)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> SignedTestClient:
    monkeypatch.delenv("AI_KNOWLEDGE_ENABLED", raising=False)
    settings = Settings(corpus_path=CORPUS_PATH)
    app = create_app(
        settings=settings,
        repository=KnowledgeRepository(CORPUS_PATH),
        retriever=HybridRetriever(clock=lambda: FIXED_NOW),
    )
    with SignedTestClient(app) as test_client:
        yield test_client
