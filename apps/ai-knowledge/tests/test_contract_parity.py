from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from ai_knowledge.models import QueryRequest, QueryResponse

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
BOUNDARY_FIXTURE_PATH = (
    REPOSITORY_ROOT / "packages" / "contracts" / "test" / "fixtures" / "ai-query-boundary.json"
)
BOUNDARIES: dict[str, list[dict[str, Any]]] = json.loads(
    BOUNDARY_FIXTURE_PATH.read_text(encoding="utf-8")
)


@pytest.mark.parametrize(
    "case",
    BOUNDARIES["validRequests"],
    ids=[case["name"] for case in BOUNDARIES["validRequests"]],
)
def test_shared_valid_query_request_boundaries(case: dict[str, Any]) -> None:
    assert QueryRequest.model_validate(case["value"])


@pytest.mark.parametrize(
    "case",
    BOUNDARIES["invalidRequests"],
    ids=[case["name"] for case in BOUNDARIES["invalidRequests"]],
)
def test_shared_invalid_query_request_boundaries(case: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        QueryRequest.model_validate(case["value"])


@pytest.mark.parametrize(
    "case",
    BOUNDARIES["validResponses"],
    ids=[case["name"] for case in BOUNDARIES["validResponses"]],
)
def test_shared_valid_query_response_boundaries(case: dict[str, Any]) -> None:
    assert QueryResponse.model_validate(case["value"])


@pytest.mark.parametrize(
    "case",
    BOUNDARIES["invalidResponses"],
    ids=[case["name"] for case in BOUNDARIES["invalidResponses"]],
)
def test_shared_invalid_query_response_boundaries(case: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        QueryResponse.model_validate(case["value"])
