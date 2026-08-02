from __future__ import annotations

import asyncio
import json
import time
from datetime import UTC, datetime
from pathlib import Path

import pytest
from conftest import (
    CORPUS_PATH,
    TEST_SERVICE_HMAC_KEY,
    SignedTestClient,
    signed_query_headers,
)
from fastapi.testclient import TestClient

from ai_knowledge.app import QueryBodyGuardMiddleware, create_app
from ai_knowledge.config import Settings
from ai_knowledge.corpus import KnowledgeRepository
from ai_knowledge.retrieval import HybridRetriever
from ai_knowledge.service_auth import ServiceRequestAuthenticator

VALID_QUERY = {"campusId": "tc", "locale": "en", "query": "library research help"}


def test_health_reports_verified_local_corpus(client: TestClient) -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json().keys() == {"status", "enabled", "documents", "corpusSha256"}
    assert response.json()["status"] == "ok"
    assert response.json()["enabled"] is True
    assert response.json()["documents"] == 25
    assert len(response.json()["corpusSha256"]) == 64


def test_query_response_matches_strict_public_shape(client: TestClient) -> None:
    response = client.post("/v1/query", json=VALID_QUERY)
    assert response.status_code == 200
    body = response.json()
    assert body.keys() == {
        "queryId",
        "campusId",
        "locale",
        "state",
        "paragraphs",
        "citations",
        "retrieval",
    }
    assert body["retrieval"] == {"mode": "no-key-hybrid", "documentsConsidered": 5}
    assert body["citations"][0].keys() == {
        "id",
        "documentId",
        "campusId",
        "category",
        "title",
        "contentSha256",
        "updatedAt",
        "summaryFreshnessState",
        "summaryVerificationState",
        "summarySource",
        "verificationLink",
        "excerpt",
    }
    citation = body["citations"][0]
    assert citation["summarySource"].keys() == {
        "kind",
        "sourceId",
        "sourceUrl",
        "corpusSha256",
        "license",
    }
    assert citation["summarySource"]["license"].keys() == {
        "status",
        "spdxId",
        "evidenceUrl",
    }
    assert citation["verificationLink"] == {
        "kind": "official-verification-link",
        "sourceId": "official-tc-library",
        "sourceUrl": "https://www.lib.umn.edu/",
        "licenseStatus": "DEEPLINK_ONLY",
        "sourceUse": "verification-link-only",
        "contentRetrieved": False,
    }
    assert set(body["paragraphs"][0]["citationIds"]) <= {
        citation["id"] for citation in body["citations"]
    }


def test_private_query_requires_fresh_body_bound_authentication() -> None:
    app = create_app(
        settings=Settings(corpus_path=CORPUS_PATH),
        repository=KnowledgeRepository(CORPUS_PATH),
    )
    body = json.dumps(VALID_QUERY, separators=(",", ":")).encode("utf-8")
    now = int(time.time())
    with TestClient(app) as unsigned_client:
        unsigned = unsigned_client.post(
            "/v1/query", content=body, headers={"content-type": "application/json"}
        )
        assert unsigned.status_code == 401
        assert unsigned.json()["detail"] == "Private service authentication failed"

        stale_headers = signed_query_headers(body, timestamp=now - 61, trace_id="trace-stale-0001")
        stale = unsigned_client.post(
            "/v1/query",
            content=body,
            headers={"content-type": "application/json", **stale_headers},
        )
        assert stale.status_code == 401

        valid_headers = signed_query_headers(
            body,
            timestamp=now,
            trace_id="trace-replay-0001",
            nonce="AAAAAAAAAAAAAAAAAAAAAA",
        )
        first = unsigned_client.post(
            "/v1/query",
            content=body,
            headers={"content-type": "application/json", **valid_headers},
        )
        assert first.status_code == 200
        distinct_nonce = unsigned_client.post(
            "/v1/query",
            content=body,
            headers={
                "content-type": "application/json",
                **signed_query_headers(
                    body,
                    timestamp=now,
                    trace_id="trace-replay-0001",
                    nonce="AQEBAQEBAQEBAQEBAQEBAQ",
                ),
            },
        )
        assert distinct_nonce.status_code == 200
        replay = unsigned_client.post(
            "/v1/query",
            content=body,
            headers={"content-type": "application/json", **valid_headers},
        )
        assert replay.status_code == 401

        invalid_nonce = unsigned_client.post(
            "/v1/query",
            content=body,
            headers={
                "content-type": "application/json",
                **signed_query_headers(body, nonce="not-canonical"),
            },
        )
        assert invalid_nonce.status_code == 401

        tampered = unsigned_client.post(
            "/v1/query",
            content=body + b" ",
            headers={"content-type": "application/json", **signed_query_headers(body)},
        )
        assert tampered.status_code == 401
        assert unsigned_client.get("/healthz").status_code == 200


def test_private_auth_accepts_the_public_128_character_trace_boundary() -> None:
    app = create_app(
        settings=Settings(corpus_path=CORPUS_PATH),
        repository=KnowledgeRepository(CORPUS_PATH),
    )
    body = json.dumps(VALID_QUERY, separators=(",", ":")).encode("utf-8")
    with TestClient(app) as raw_client:
        valid_trace = "t" * 128
        accepted = raw_client.post(
            "/v1/query",
            content=body,
            headers={
                "content-type": "application/json",
                **signed_query_headers(body, trace_id=valid_trace),
            },
        )
        assert accepted.status_code == 200

        oversized_trace = "t" * 129
        rejected = raw_client.post(
            "/v1/query",
            content=body,
            headers={
                "content-type": "application/json",
                **signed_query_headers(body, trace_id=oversized_trace),
            },
        )
        assert rejected.status_code == 401
        assert rejected.json()["traceId"] != oversized_trace


@pytest.mark.parametrize(
    "payload",
    [
        {**VALID_QUERY, "extra": True},
        {**VALID_QUERY, "campusId": "not-a-campus"},
        {**VALID_QUERY, "locale": "fr"},
        {**VALID_QUERY, "query": "x"},
        {**VALID_QUERY, "query": "x" * 501},
        {**VALID_QUERY, "query": 42},
        {**VALID_QUERY, "query": "<script>alert(1)</script>"},
        {**VALID_QUERY, "query": "&lt;script&gt;"},
        {**VALID_QUERY, "query": "library &notanentity"},
        {**VALID_QUERY, "query": "library\u0000research"},
        {**VALID_QUERY, "query": "library\u200bresearch"},
        {**VALID_QUERY, "query": "Cafe\u0301 library"},
    ],
)
def test_invalid_or_unsafe_queries_are_rejected(
    client: TestClient, payload: dict[str, object]
) -> None:
    response = client.post("/v1/query", json=payload)
    assert response.status_code == 422
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert body["status"] == 422
    assert body["title"] == "Validation Failed"
    assert "traceId" in body
    assert "errors" in body


def test_invalid_utf8_is_rejected_without_echoing_bytes(client: TestClient) -> None:
    response = client.post(
        "/v1/query",
        content=b'{"campusId":"tc","locale":"en","query":"\xff\xfe"}',
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 400
    assert response.headers["content-type"].startswith("application/problem+json")
    assert "\\xff" not in response.text


def test_duplicate_request_keys_are_rejected(client: TestClient) -> None:
    response = client.post(
        "/v1/query",
        content=b'{"campusId":"tc","campusId":"morris","locale":"en","query":"library"}',
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Request body must be unique-key UTF-8 JSON"


def test_non_json_content_type_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/v1/query", content=json.dumps(VALID_QUERY), headers={"content-type": "text/plain"}
    )
    assert response.status_code == 415
    assert response.json()["status"] == 415


def test_non_utf8_declared_charset_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/v1/query",
        content=json.dumps(VALID_QUERY),
        headers={"content-type": "application/json; charset=iso-8859-1"},
    )
    assert response.status_code == 415


def test_streamed_or_declared_large_body_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/v1/query",
        content=b"{" + (b" " * 9_000) + b"}",
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json()["status"] == 413


def test_operator_kill_switch_is_dynamic_and_fails_closed(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AI_KNOWLEDGE_ENABLED", "false")
    disabled = client.post("/v1/query", json=VALID_QUERY)
    assert disabled.status_code == 503
    assert disabled.json()["title"] == "Knowledge Retrieval Disabled"
    health = client.get("/healthz")
    assert health.status_code == 503
    assert health.json() == {
        "status": "disabled",
        "enabled": False,
        "documents": 0,
        "corpusSha256": None,
    }

    monkeypatch.setenv("AI_KNOWLEDGE_ENABLED", "unexpected-value")
    assert client.post("/v1/query", json=VALID_QUERY).status_code == 503

    monkeypatch.setenv("AI_KNOWLEDGE_ENABLED", "true")
    assert client.post("/v1/query", json=VALID_QUERY).status_code == 200


def test_invalid_corpus_makes_health_and_query_unavailable(tmp_path: Path) -> None:
    path = tmp_path / "corpus.json"
    path.write_text("{}", encoding="utf-8")
    settings = Settings(corpus_path=path)
    app = create_app(settings=settings, repository=KnowledgeRepository(path))
    with SignedTestClient(app, raise_server_exceptions=False) as client:
        health = client.get("/healthz")
        assert health.status_code == 503
        assert health.headers["content-type"].startswith("application/problem+json")
        query = client.post("/v1/query", json=VALID_QUERY)
        assert query.status_code == 503
        assert query.json()["title"] == "Knowledge Corpus Unavailable"


def test_service_retrieval_does_not_open_network_sockets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import socket

    settings = Settings(corpus_path=CORPUS_PATH)
    repository = KnowledgeRepository(CORPUS_PATH)
    retriever = HybridRetriever(clock=lambda: datetime(2026, 7, 23, tzinfo=UTC))
    app = create_app(settings=settings, repository=repository, retriever=retriever)
    with SignedTestClient(app) as client:
        monkeypatch.setattr(
            socket,
            "create_connection",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(
                AssertionError("network access attempted")
            ),
        )
        response = client.post("/v1/query", json=VALID_QUERY)
        assert response.status_code == 200
        assert response.json()["state"] == "answered"


def test_unknown_route_and_wrong_method_use_sanitized_http_errors(client: TestClient) -> None:
    missing = client.get("/missing")
    assert missing.status_code == 404
    assert missing.json()["title"] == "Not Found"
    wrong_method = client.get("/v1/query")
    assert wrong_method.status_code == 405
    assert wrong_method.json()["title"] == "Method Not Allowed"


def test_body_guard_handles_invalid_lengths_disconnects_stream_limits_and_replay() -> None:
    async def invoke(
        headers: list[tuple[bytes, bytes]],
        messages: list[dict[str, object]],
        *,
        max_request_bytes: int = 32,
        receive_twice: bool = False,
    ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
        received: list[dict[str, object]] = []

        async def downstream(_scope: object, receive: object, _send: object) -> None:
            receive_message = receive  # type: ignore[assignment]
            received.append(await receive_message())
            if receive_twice:
                received.append(await receive_message())

        queue = list(messages)

        async def receive() -> dict[str, object]:
            return queue.pop(0)

        sent: list[dict[str, object]] = []

        async def send(message: dict[str, object]) -> None:
            sent.append(message)

        middleware = QueryBodyGuardMiddleware(  # type: ignore[arg-type]
            downstream,
            authenticator=ServiceRequestAuthenticator(TEST_SERVICE_HMAC_KEY, max_skew_seconds=60),
            max_request_bytes=max_request_bytes,
        )
        await middleware(
            {
                "type": "http",
                "method": "POST",
                "path": "/v1/query",
                "headers": headers,
            },
            receive,  # type: ignore[arg-type]
            send,  # type: ignore[arg-type]
        )
        return sent, received

    for invalid_length in (b"invalid", b"-1", b"01", b"+1", b""):
        sent, _ = asyncio.run(
            invoke(
                [
                    (b"content-type", b"application/json"),
                    (b"content-length", invalid_length),
                ],
                [],
            )
        )
        assert any(message.get("status") == 400 for message in sent)

    for duplicated_name in (
        b"content-type",
        b"content-length",
        b"x-request-id",
        b"x-ai-service-timestamp",
        b"x-ai-service-signature",
        b"x-ai-service-nonce",
    ):
        sent, _ = asyncio.run(
            invoke(
                [
                    (b"content-type", b"application/json"),
                    (duplicated_name, b"first"),
                    (duplicated_name, b"second"),
                ],
                [],
            )
        )
        assert any(message.get("status") == 400 for message in sent)

    sent, received = asyncio.run(
        invoke(
            [(b"content-type", b"application/json")],
            [{"type": "http.disconnect"}],
        )
    )
    assert sent == [] and received == []

    sent, _ = asyncio.run(
        invoke(
            [(b"content-type", b"application/json")],
            [{"type": "http.request", "body": b"{" + b" " * 40, "more_body": True}],
        )
    )
    assert any(message.get("status") == 413 for message in sent)

    payload = json.dumps(VALID_QUERY).encode()
    sent, _ = asyncio.run(
        invoke(
            [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(payload) + 1).encode()),
            ],
            [{"type": "http.request", "body": payload, "more_body": False}],
            max_request_bytes=1_000,
        )
    )
    assert any(message.get("status") == 400 for message in sent)

    signed_headers = signed_query_headers(payload)
    sent, received = asyncio.run(
        invoke(
            [(b"content-type", b"application/json")]
            + [(key.lower().encode(), value.encode()) for key, value in signed_headers.items()],
            [{"type": "http.request", "body": payload, "more_body": False}],
            max_request_bytes=1_000,
            receive_twice=True,
        )
    )
    assert sent == []
    assert received == [
        {"type": "http.request", "body": payload, "more_body": False},
        {"type": "http.request", "body": b"", "more_body": False},
    ]


def test_app_builds_postgres_repository_when_selected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}
    closed = False

    class StubRepository:
        def snapshot(self):
            return KnowledgeRepository(CORPUS_PATH).snapshot()

        def close(self) -> None:
            nonlocal closed
            closed = True

    def repository_factory(database_url: str, **kwargs: object) -> StubRepository:
        captured.update(database_url=database_url, **kwargs)
        return StubRepository()

    monkeypatch.setattr("ai_knowledge.app.PostgreSQLKnowledgeRepository", repository_factory)
    settings = Settings(
        corpus_path=CORPUS_PATH,
        environment="test",
        backend="postgres",
        database_url="postgresql://gopher:secret@postgres/gopher",
    )
    with TestClient(create_app(settings=settings)) as postgres_client:
        assert postgres_client.get("/healthz").status_code == 200
    assert captured["connect_timeout_seconds"] == 5
    assert captured["pool_min_size"] == 1
    assert captured["pool_max_size"] == 10
    assert captured["pool_wait_seconds"] == 3
    assert captured["snapshot_cache_ttl_seconds"] == 30
    assert captured["revision_check_interval_seconds"] == 1
    assert closed
