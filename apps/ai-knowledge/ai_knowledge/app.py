from __future__ import annotations

import json
import re
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Protocol

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import Settings
from .corpus import CorpusIntegrityError, CorpusSnapshot, KnowledgeRepository
from .database import PostgreSQLKnowledgeRepository
from .models import HealthResponse, QueryRequest, QueryResponse
from .retrieval import HybridRetriever
from .service_auth import (
    SERVICE_AUTH_NONCE_HEADER,
    SERVICE_AUTH_SIGNATURE_HEADER,
    SERVICE_AUTH_TIMESTAMP_HEADER,
    ServiceRequestAuthenticator,
)

_TRACE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")


class SnapshotRepository(Protocol):
    def snapshot(self) -> CorpusSnapshot: ...


def _safe_trace_id(value: str | None) -> str:
    if value and _TRACE_ID_RE.fullmatch(value):
        return value
    return str(uuid.uuid4())


def _reject_duplicate_request_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _problem(
    status: int,
    title: str,
    detail: str,
    *,
    trace_id: str | None = None,
    errors: list[dict[str, Any]] | None = None,
) -> JSONResponse:
    body: dict[str, Any] = {
        "type": "about:blank",
        "title": title,
        "status": status,
        "detail": detail,
        "traceId": _safe_trace_id(trace_id),
    }
    if errors:
        body["errors"] = errors
    return JSONResponse(body, status_code=status, media_type="application/problem+json")


class QueryBodyGuardMiddleware:
    """Require JSON and cap streamed request bodies before Pydantic parses them."""

    def __init__(
        self,
        app: ASGIApp,
        *,
        authenticator: ServiceRequestAuthenticator,
        max_request_bytes: int,
    ) -> None:
        self._app = app
        self._authenticator = authenticator
        self._max_request_bytes = max_request_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or scope.get("method") != "POST"
            or scope.get("path") != "/v1/query"
        ):
            await self._app(scope, receive, send)
            return

        header_values: dict[bytes, list[bytes]] = {}
        for key, value in scope.get("headers", []):
            header_values.setdefault(key.lower(), []).append(value)
        guarded_headers = {
            b"content-type",
            b"content-length",
            b"x-request-id",
            SERVICE_AUTH_TIMESTAMP_HEADER.encode("ascii"),
            SERVICE_AUTH_SIGNATURE_HEADER.encode("ascii"),
            SERVICE_AUTH_NONCE_HEADER.encode("ascii"),
        }
        if any(len(header_values.get(name, ())) > 1 for name in guarded_headers):
            response = _problem(
                400,
                "Bad Request",
                "Duplicate security-sensitive request headers are not allowed",
            )
            await response(scope, receive, send)
            return
        headers = {key: values[0] for key, values in header_values.items()}
        raw_content_type = headers.get(b"content-type", b"").decode("latin-1")
        content_type_parts = [part.strip().casefold() for part in raw_content_type.split(";")]
        content_type = content_type_parts[0]
        parameters = {part for part in content_type_parts[1:] if part}
        trace_id = _safe_trace_id(headers.get(b"x-request-id", b"").decode("latin-1"))
        if content_type != "application/json" or any(
            parameter not in {"charset=utf-8", 'charset="utf-8"'} for parameter in parameters
        ):
            response = _problem(
                415,
                "Unsupported Media Type",
                "Content-Type must be application/json",
                trace_id=trace_id,
            )
            await response(scope, receive, send)
            return

        declared_length = headers.get(b"content-length")
        expected_length: int | None = None
        if declared_length is not None:
            declared_text = declared_length.decode("latin-1")
            if re.fullmatch(r"(?:0|[1-9][0-9]*)", declared_text) is None:
                response = _problem(
                    400, "Bad Request", "Content-Length is invalid", trace_id=trace_id
                )
                await response(scope, receive, send)
                return
            if len(declared_text) > 10 or int(declared_text) > self._max_request_bytes:
                response = _problem(
                    413,
                    "Content Too Large",
                    "Request body exceeds the configured limit",
                    trace_id=trace_id,
                )
                await response(scope, receive, send)
                return
            expected_length = int(declared_text)

        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            body.extend(chunk)
            if len(body) > self._max_request_bytes:
                response = _problem(
                    413,
                    "Content Too Large",
                    "Request body exceeds the configured limit",
                    trace_id=trace_id,
                )
                await response(scope, receive, send)
                return
            if not message.get("more_body", False):
                break

        delivered = False

        raw_body = bytes(body)
        if expected_length is not None and expected_length != len(raw_body):
            response = _problem(
                400,
                "Bad Request",
                "Content-Length does not match the request body",
                trace_id=trace_id,
            )
            await response(scope, receive, send)
            return
        raw_trace_id = headers.get(b"x-request-id", b"").decode("latin-1")
        if not self._authenticator.verify_once(
            method="POST",
            path="/v1/query",
            body=raw_body,
            trace_id=raw_trace_id,
            timestamp=headers.get(SERVICE_AUTH_TIMESTAMP_HEADER.encode("ascii"), b"").decode(
                "latin-1"
            ),
            nonce=headers.get(SERVICE_AUTH_NONCE_HEADER.encode("ascii"), b"").decode("latin-1"),
            signature=headers.get(SERVICE_AUTH_SIGNATURE_HEADER.encode("ascii"), b"").decode(
                "latin-1"
            ),
        ):
            response = _problem(
                401,
                "Unauthorized",
                "Private service authentication failed",
                trace_id=trace_id,
            )
            await response(scope, receive, send)
            return

        try:
            decoded_body = raw_body.decode("utf-8", errors="strict")
            json.loads(decoded_body, object_pairs_hook=_reject_duplicate_request_keys)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
            response = _problem(
                400, "Bad Request", "Request body must be unique-key UTF-8 JSON", trace_id=trace_id
            )
            await response(scope, receive, send)
            return

        async def replay_body() -> Message:
            nonlocal delivered
            if delivered:
                return {"type": "http.request", "body": b"", "more_body": False}
            delivered = True
            return {"type": "http.request", "body": raw_body, "more_body": False}

        await self._app(scope, replay_body, send)


def create_app(
    *,
    settings: Settings | None = None,
    repository: SnapshotRepository | None = None,
    retriever: HybridRetriever | None = None,
) -> FastAPI:
    resolved_settings = settings or Settings.from_environment()
    if repository is not None:
        resolved_repository = repository
    elif resolved_settings.backend == "postgres":
        assert resolved_settings.database_url is not None
        resolved_repository = PostgreSQLKnowledgeRepository(
            resolved_settings.database_url,
            connect_timeout_seconds=resolved_settings.database_connect_timeout_seconds,
            pool_min_size=resolved_settings.database_pool_min_size,
            pool_max_size=resolved_settings.database_pool_max_size,
            pool_wait_seconds=resolved_settings.database_pool_wait_seconds,
            snapshot_cache_ttl_seconds=resolved_settings.snapshot_cache_ttl_seconds,
            revision_check_interval_seconds=resolved_settings.revision_check_interval_seconds,
        )
    else:
        resolved_repository = KnowledgeRepository(resolved_settings.corpus_path)
    resolved_retriever = retriever or HybridRetriever(top_k=resolved_settings.top_k)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            close = getattr(resolved_repository, "close", None)
            if callable(close):
                close()

    app = FastAPI(
        title="UMN Gopher Assistant Knowledge Retrieval",
        version="0.1.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.add_middleware(
        QueryBodyGuardMiddleware,
        authenticator=ServiceRequestAuthenticator(
            resolved_settings.service_hmac_key,
            max_skew_seconds=resolved_settings.service_auth_max_skew_seconds,
        ),
        max_request_bytes=resolved_settings.max_request_bytes,
    )

    @app.exception_handler(RequestValidationError)
    async def request_validation_handler(
        request: Request, error: RequestValidationError
    ) -> JSONResponse:
        safe_errors = [
            {
                "location": [str(item) for item in entry.get("loc", ())],
                "message": entry.get("msg", "Invalid request"),
                "code": entry.get("type", "validation_error"),
            }
            for entry in error.errors()
        ]
        return _problem(
            422,
            "Validation Failed",
            "The request body does not match the query contract",
            trace_id=request.headers.get("x-request-id"),
            errors=safe_errors,
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(
        request: Request, error: StarletteHTTPException
    ) -> JSONResponse:
        title_by_status = {
            400: "Bad Request",
            404: "Not Found",
            405: "Method Not Allowed",
        }
        return _problem(
            error.status_code,
            title_by_status.get(error.status_code, "Request Failed"),
            "The request could not be processed",
            trace_id=request.headers.get("x-request-id"),
        )

    @app.exception_handler(CorpusIntegrityError)
    async def corpus_integrity_handler(
        request: Request, _error: CorpusIntegrityError
    ) -> JSONResponse:
        return _problem(
            503,
            "Knowledge Corpus Unavailable",
            "The knowledge corpus could not be verified",
            trace_id=request.headers.get("x-request-id"),
        )

    @app.get("/healthz", response_model=HealthResponse)
    def health() -> HealthResponse | JSONResponse:
        if not resolved_settings.is_enabled():
            disabled = HealthResponse(
                status="disabled", enabled=False, documents=0, corpusSha256=None
            )
            return JSONResponse(
                disabled.model_dump(mode="json", by_alias=True),
                status_code=503,
            )
        try:
            snapshot = resolved_repository.snapshot()
        except CorpusIntegrityError:
            return _problem(
                503, "Knowledge Corpus Unavailable", "The knowledge corpus could not be verified"
            )
        return HealthResponse(
            status="ok",
            enabled=True,
            documents=len(snapshot.documents),
            corpusSha256=snapshot.corpus_sha256,
        )

    @app.post("/v1/query", response_model=QueryResponse)
    def query(request: QueryRequest) -> QueryResponse | JSONResponse:
        if not resolved_settings.is_enabled():
            return _problem(
                503, "Knowledge Retrieval Disabled", "The operator kill switch is active"
            )
        snapshot = resolved_repository.snapshot()
        return resolved_retriever.query(request, snapshot)

    return app


app = create_app()
