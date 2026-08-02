from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any, Literal, Self

from pydantic import Field, StringConstraints, ValidationError, field_validator, model_validator

from .corpus import CorpusIntegrityError, CorpusSnapshot, KnowledgeRepository
from .models import (
    CampusId,
    Category,
    Locale,
    QueryRequest,
    QueryResponse,
    SafeIdentifier,
    Sha256,
    StrictModel,
)
from .retrieval import HybridRetriever

MAX_EVALUATION_DATASET_BYTES = 512 * 1_024
_DATA_DIRECTORY = Path(__file__).resolve().parent / "data"
DEFAULT_DATASET_PATH = _DATA_DIRECTORY / "retrieval-eval-v1.json"
DEFAULT_CORPUS_PATH = _DATA_DIRECTORY / "corpus.json"
_DATASET_ID = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{2,63}$")]
_CASE_ID = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{4,127}$")]
_SEMVER_RE = re.compile(r"^[1-9][0-9]*\.[0-9]+\.[0-9]+$")
_ASCII_LETTER_RE = re.compile(r"[A-Za-z]")
_CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")

Disposition = Literal["answer", "abstain"]
CaseTag = Literal[
    "ambiguous",
    "hard-negative",
    "paraphrase",
    "reproduced-false-positive",
    "unsupported",
]


class EvaluationDatasetError(RuntimeError):
    """The versioned evaluation fixture cannot be trusted or applied."""


class EvaluationThresholds(StrictModel):
    # This retriever and fixture are deterministic. Allowing error budgets here would let a
    # single known regression disappear inside an aggregate, so every case is release-blocking.
    answer_precision: float = Field(alias="answerPrecision", ge=1.0, le=1.0)
    supported_recall: float = Field(alias="supportedRecall", ge=1.0, le=1.0)
    top_1_category_accuracy: float = Field(alias="top1CategoryAccuracy", ge=1.0, le=1.0)
    abstention_recall: float = Field(alias="abstentionRecall", ge=1.0, le=1.0)
    mean_reciprocal_rank: float = Field(alias="meanReciprocalRank", ge=1.0, le=1.0)
    max_campus_leakage_rate: float = Field(alias="maxCampusLeakageRate", ge=0.0, le=0.0)
    evidence_integrity_rate: float = Field(alias="evidenceIntegrityRate", ge=1.0, le=1.0)


class EvaluationCase(StrictModel):
    id: _CASE_ID
    campus_id: CampusId = Field(alias="campusId")
    locale: Locale
    query: Annotated[str, StringConstraints(min_length=2, max_length=500)]
    expected_disposition: Disposition = Field(alias="expectedDisposition")
    expected_category: Category | None = Field(alias="expectedCategory")
    relevant_document_ids: list[SafeIdentifier] = Field(alias="relevantDocumentIds", max_length=8)
    tags: list[CaseTag] = Field(min_length=1, max_length=5)

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, values: list[CaseTag]) -> list[CaseTag]:
        if len(values) != len(set(values)):
            raise ValueError("evaluation case tags must be unique")
        return values

    @model_validator(mode="after")
    def validate_expectation(self) -> Self:
        # Reuse the production boundary validation instead of maintaining a weaker copy.
        QueryRequest(campusId=self.campus_id, locale=self.locale, query=self.query)
        if self.locale == "en" and _ASCII_LETTER_RE.search(self.query) is None:
            raise ValueError("English evaluation cases must contain an ASCII letter")
        if self.locale == "zh-CN" and _CJK_RE.search(self.query) is None:
            raise ValueError("Chinese evaluation cases must contain a CJK character")
        if self.expected_disposition == "answer":
            if self.expected_category is None or not self.relevant_document_ids:
                raise ValueError("answer cases require a category and relevant document ids")
            if "paraphrase" not in self.tags:
                raise ValueError("supported evaluation cases must be tagged as paraphrases")
        else:
            if self.expected_category is not None or self.relevant_document_ids:
                raise ValueError("abstention cases cannot declare relevant evidence")
            if "paraphrase" in self.tags:
                raise ValueError("abstention cases cannot be tagged as paraphrases")
        if {"hard-negative", "reproduced-false-positive"} & set(
            self.tags
        ) and self.expected_disposition != "abstain":
            raise ValueError("safety-critical negative cases must require abstention")
        return self


class EvaluationDataset(StrictModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    dataset_id: _DATASET_ID = Field(alias="datasetId")
    dataset_version: str = Field(alias="datasetVersion", min_length=5, max_length=32)
    corpus_sha256: Sha256 = Field(alias="corpusSha256")
    evaluation_time: datetime = Field(alias="evaluationTime")
    thresholds: EvaluationThresholds
    cases: list[EvaluationCase] = Field(min_length=150, max_length=1_000)

    @field_validator("dataset_version")
    @classmethod
    def validate_dataset_version(cls, value: str) -> str:
        if _SEMVER_RE.fullmatch(value) is None:
            raise ValueError("datasetVersion must be a stable semantic version")
        return value

    @field_validator("evaluation_time", mode="before")
    @classmethod
    def validate_evaluation_time(cls, value: datetime | str) -> datetime:
        if isinstance(value, str):
            try:
                value = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError as error:
                raise ValueError("evaluationTime must use ISO 8601") from error
        if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("evaluationTime must contain an offset")
        return value

    @model_validator(mode="after")
    def validate_coverage(self) -> Self:
        case_ids = [case.id for case in self.cases]
        if len(case_ids) != len(set(case_ids)):
            raise ValueError("evaluation case ids must be unique")
        query_keys = [
            (
                case.campus_id,
                case.locale,
                unicodedata.normalize("NFKC", case.query).casefold(),
            )
            for case in self.cases
        ]
        if len(query_keys) != len(set(query_keys)):
            raise ValueError("evaluation queries must be unique within campus and locale")

        campuses: tuple[CampusId, ...] = (
            "tc",
            "duluth",
            "crookston",
            "morris",
            "rochester",
        )
        locales: tuple[Locale, ...] = ("en", "zh-CN")
        categories: tuple[Category, ...] = (
            "library",
            "student-services",
            "safety",
            "transportation",
            "dining",
        )
        required_supported_grid = {
            (campus, locale, category)
            for campus in campuses
            for locale in locales
            for category in categories
        }
        supported_grid_counts = Counter(
            (case.campus_id, case.locale, case.expected_category)
            for case in self.cases
            if case.expected_disposition == "answer"
        )
        if any(supported_grid_counts[cell] < 2 for cell in required_supported_grid):
            raise ValueError(
                "dataset requires two answer paraphrases per campus/locale/category cell"
            )

        required_abstention_grid = {(campus, locale) for campus in campuses for locale in locales}
        abstention_grid_counts = Counter(
            (case.campus_id, case.locale)
            for case in self.cases
            if case.expected_disposition == "abstain"
        )
        if any(abstention_grid_counts[cell] < 5 for cell in required_abstention_grid):
            raise ValueError("dataset requires five abstention cases per campus and locale")

        required_tags: set[CaseTag] = {
            "ambiguous",
            "hard-negative",
            "paraphrase",
            "reproduced-false-positive",
            "unsupported",
        }
        actual_tags = {tag for case in self.cases for tag in case.tags}
        if not required_tags <= actual_tags:
            raise ValueError("dataset lacks one or more required retrieval-risk tags")
        return self


@dataclass(frozen=True, slots=True)
class CaseOutcome:
    case_id: str
    campus_id: CampusId
    locale: Locale
    expected_disposition: Disposition
    response_state: str
    returned_categories: tuple[str, ...]
    returned_document_ids: tuple[str, ...]
    answered: bool
    precise_answer: bool
    supported_hit: bool
    top_1_category_hit: bool
    reciprocal_rank: float
    campus_leakage_count: int
    citation_count: int
    evidence_integrity: bool
    safety_critical: bool
    failure_codes: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class EvaluationMetrics:
    answer_precision: float
    supported_recall: float
    top_1_category_accuracy: float
    abstention_recall: float
    mean_reciprocal_rank: float
    campus_leakage_rate: float
    evidence_integrity_rate: float

    def as_dict(self) -> dict[str, float]:
        return {
            "answerPrecision": self.answer_precision,
            "supportedRecall": self.supported_recall,
            "top1CategoryAccuracy": self.top_1_category_accuracy,
            "abstentionRecall": self.abstention_recall,
            "meanReciprocalRank": self.mean_reciprocal_rank,
            "campusLeakageRate": self.campus_leakage_rate,
            "evidenceIntegrityRate": self.evidence_integrity_rate,
        }


@dataclass(frozen=True, slots=True)
class EvaluationReport:
    dataset_id: str
    dataset_version: str
    dataset_sha256: str
    corpus_sha256: str
    case_count: int
    metrics: EvaluationMetrics
    segments: dict[str, dict[str, EvaluationMetrics]]
    failed_thresholds: tuple[str, ...]
    outcomes: tuple[CaseOutcome, ...]

    @property
    def critical_failures(self) -> tuple[CaseOutcome, ...]:
        return tuple(
            outcome for outcome in self.outcomes if outcome.safety_critical and outcome.answered
        )

    @property
    def passed(self) -> bool:
        return not self.failed_thresholds and not self.critical_failures

    def as_dict(self) -> dict[str, Any]:
        # Deliberately exclude query text. Evaluation output is safe for CI telemetry.
        failures = [
            {
                "caseId": outcome.case_id,
                "responseState": outcome.response_state,
                "returnedCategories": list(outcome.returned_categories),
                "returnedDocumentIds": list(outcome.returned_document_ids),
                "failureCodes": list(outcome.failure_codes),
            }
            for outcome in self.outcomes
            if outcome.failure_codes
        ]
        return {
            "schemaVersion": 1,
            "datasetId": self.dataset_id,
            "datasetVersion": self.dataset_version,
            "datasetSha256": self.dataset_sha256,
            "corpusSha256": self.corpus_sha256,
            "caseCount": self.case_count,
            "passed": self.passed,
            "metrics": self.metrics.as_dict(),
            "segments": {
                dimension: {
                    segment: metrics.as_dict()
                    for segment, metrics in sorted(segment_metrics.items())
                }
                for dimension, segment_metrics in sorted(self.segments.items())
            },
            "failedThresholds": list(self.failed_thresholds),
            "criticalSafetyFailures": {
                "count": len(self.critical_failures),
                "caseIds": [outcome.case_id for outcome in self.critical_failures],
            },
            "failures": failures,
        }


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def load_evaluation_dataset(path: Path) -> tuple[EvaluationDataset, str]:
    resolved_path = path.resolve()
    try:
        stat = resolved_path.stat()
    except OSError as error:
        raise EvaluationDatasetError("evaluation dataset is unavailable") from error
    if not resolved_path.is_file():
        raise EvaluationDatasetError("evaluation dataset path is not a regular file")
    if stat.st_size > MAX_EVALUATION_DATASET_BYTES:
        raise EvaluationDatasetError("evaluation dataset exceeds the size limit")
    try:
        raw = resolved_path.read_bytes()
    except OSError as error:
        raise EvaluationDatasetError("evaluation dataset cannot be read") from error
    if len(raw) > MAX_EVALUATION_DATASET_BYTES:
        raise EvaluationDatasetError("evaluation dataset exceeds the size limit")
    try:
        decoded = json.loads(
            raw.decode("utf-8", errors="strict"), object_pairs_hook=_reject_duplicate_keys
        )
        dataset = EvaluationDataset.model_validate(decoded)
    except (
        UnicodeDecodeError,
        json.JSONDecodeError,
        ValueError,
        TypeError,
        RecursionError,
        ValidationError,
    ) as error:
        # Do not interpolate parser errors: Pydantic includes raw input values in them.
        raise EvaluationDatasetError("evaluation dataset validation failed") from error
    return dataset, hashlib.sha256(raw).hexdigest()


def _validate_dataset_against_corpus(dataset: EvaluationDataset, snapshot: CorpusSnapshot) -> None:
    if dataset.corpus_sha256 != snapshot.corpus_sha256:
        raise EvaluationDatasetError("evaluation dataset targets a different corpus revision")
    documents = {document.id: document for document in snapshot.documents}
    if len(documents) != len(snapshot.documents):
        raise EvaluationDatasetError("corpus document ids are not unique")
    for case in dataset.cases:
        for document_id in case.relevant_document_ids:
            document = documents.get(document_id)
            if (
                document is None
                or document.campus_id != case.campus_id
                or document.category != case.expected_category
            ):
                raise EvaluationDatasetError(
                    f"evaluation expectation is incompatible with the corpus: {case.id}"
                )


def _response_evidence_integrity(
    response: QueryResponse,
    *,
    case: EvaluationCase,
    snapshot: CorpusSnapshot,
    evaluation_time: datetime,
) -> tuple[bool, int]:
    leakage_count = sum(citation.campus_id != case.campus_id for citation in response.citations)
    if response.campus_id != case.campus_id or response.locale != case.locale:
        return False, leakage_count
    if response.state == "no-results":
        return not response.paragraphs and not response.citations, leakage_count

    documents = {
        document.id: document
        for document in snapshot.documents
        if document.campus_id == case.campus_id
    }
    citation_documents: dict[str, Any] = {}
    for citation in response.citations:
        document = documents.get(citation.document_id)
        if document is None:
            return False, leakage_count
        summary_source = snapshot.source(document.summary_source_id)
        verification_source = snapshot.source(document.verification_source_id)
        if (
            citation.campus_id != document.campus_id
            or citation.category != document.category
            or citation.title != document.title
            or citation.content_sha256 != document.content_sha256
            or citation.updated_at != document.updated_at
            or citation.summary_freshness_state
            != HybridRetriever._freshness(document, evaluation_time)
            or citation.summary_verification_state != document.verification_state.value
            or citation.excerpt != document.content.for_locale(case.locale)[:500]
            or citation.summary_source.kind != "project-authored-summary"
            or citation.summary_source.source_id != summary_source.id
            or str(citation.summary_source.source_url) != summary_source.source_url
            or citation.summary_source.corpus_sha256 != snapshot.corpus_sha256
            or citation.summary_source.license.status != "OPEN_REUSE"
            or citation.summary_source.license.spdx_id != document.summary_license
            or str(citation.summary_source.license.evidence_url)
            != summary_source.license_evidence_url
            or citation.verification_link.kind != "official-verification-link"
            or citation.verification_link.source_id != verification_source.id
            or str(citation.verification_link.source_url) != verification_source.source_url
            or citation.verification_link.license_status != "DEEPLINK_ONLY"
            or citation.verification_link.source_use != document.source_use
            or citation.verification_link.content_retrieved is not False
        ):
            return False, leakage_count
        citation_documents[citation.id] = document

    if not citation_documents or not response.paragraphs:
        return False, leakage_count
    referenced_ids: set[str] = set()
    for paragraph in response.paragraphs:
        referenced_ids.update(paragraph.citation_ids)
        supporting_documents = [
            citation_documents.get(citation_id) for citation_id in paragraph.citation_ids
        ]
        if any(document is None for document in supporting_documents):
            return False, leakage_count
        if not any(
            document is not None and paragraph.text == document.content.for_locale(case.locale)
            for document in supporting_documents
        ):
            return False, leakage_count
    return referenced_ids == set(citation_documents), leakage_count


def _evaluate_case(
    case: EvaluationCase,
    *,
    snapshot: CorpusSnapshot,
    retriever: HybridRetriever,
    evaluation_time: datetime,
) -> CaseOutcome:
    response = retriever.query(
        QueryRequest(campusId=case.campus_id, locale=case.locale, query=case.query),
        snapshot,
    )
    answered = response.state != "no-results"
    returned_document_ids = tuple(citation.document_id for citation in response.citations)
    returned_categories = tuple(citation.category for citation in response.citations)
    relevant_document_ids = set(case.relevant_document_ids)
    relevant_ranks = [
        rank
        for rank, document_id in enumerate(returned_document_ids, start=1)
        if document_id in relevant_document_ids
    ]
    supported_hit = bool(relevant_ranks) if case.expected_disposition == "answer" else False
    reciprocal_rank = 1.0 / relevant_ranks[0] if relevant_ranks else 0.0
    top_1_category_hit = bool(
        case.expected_disposition == "answer"
        and returned_categories
        and returned_categories[0] == case.expected_category
    )
    precise_answer = bool(
        case.expected_disposition == "answer"
        and answered
        and returned_document_ids
        and set(returned_document_ids) <= relevant_document_ids
    )
    evidence_integrity, leakage_count = _response_evidence_integrity(
        response,
        case=case,
        snapshot=snapshot,
        evaluation_time=evaluation_time,
    )

    failure_codes: list[str] = []
    if case.expected_disposition == "answer":
        if not supported_hit:
            failure_codes.append("supported-miss")
        if not top_1_category_hit:
            failure_codes.append("top1-category-miss")
        if answered and not precise_answer:
            failure_codes.append("imprecise-answer")
    elif answered:
        failure_codes.append("expected-abstention")
    if leakage_count:
        failure_codes.append("campus-leakage")
    if not evidence_integrity:
        failure_codes.append("evidence-integrity")

    return CaseOutcome(
        case_id=case.id,
        campus_id=case.campus_id,
        locale=case.locale,
        expected_disposition=case.expected_disposition,
        response_state=response.state,
        returned_categories=returned_categories,
        returned_document_ids=returned_document_ids,
        answered=answered,
        precise_answer=precise_answer,
        supported_hit=supported_hit,
        top_1_category_hit=top_1_category_hit,
        reciprocal_rank=reciprocal_rank,
        campus_leakage_count=leakage_count,
        citation_count=len(response.citations),
        evidence_integrity=evidence_integrity,
        safety_critical=bool({"hard-negative", "reproduced-false-positive"} & set(case.tags)),
        failure_codes=tuple(failure_codes),
    )


def _ratio(numerator: int | float, denominator: int) -> float:
    return float(numerator / denominator) if denominator else 1.0


def calculate_metrics(outcomes: Sequence[CaseOutcome]) -> EvaluationMetrics:
    supported = [outcome for outcome in outcomes if outcome.expected_disposition == "answer"]
    unsupported = [outcome for outcome in outcomes if outcome.expected_disposition == "abstain"]
    answered = [outcome for outcome in outcomes if outcome.answered]
    citation_count = sum(outcome.citation_count for outcome in outcomes)
    return EvaluationMetrics(
        answer_precision=_ratio(sum(outcome.precise_answer for outcome in answered), len(answered)),
        supported_recall=_ratio(
            sum(outcome.supported_hit for outcome in supported), len(supported)
        ),
        top_1_category_accuracy=_ratio(
            sum(outcome.top_1_category_hit for outcome in supported), len(supported)
        ),
        abstention_recall=_ratio(
            sum(not outcome.answered for outcome in unsupported), len(unsupported)
        ),
        mean_reciprocal_rank=_ratio(
            sum(outcome.reciprocal_rank for outcome in supported), len(supported)
        ),
        campus_leakage_rate=_ratio(
            sum(outcome.campus_leakage_count for outcome in outcomes), citation_count
        )
        if citation_count
        else 0.0,
        evidence_integrity_rate=_ratio(
            sum(outcome.evidence_integrity for outcome in outcomes), len(outcomes)
        ),
    )


def calculate_segments(
    outcomes: Sequence[CaseOutcome],
) -> dict[str, dict[str, EvaluationMetrics]]:
    campus_groups: dict[str, list[CaseOutcome]] = {}
    locale_groups: dict[str, list[CaseOutcome]] = {}
    for outcome in outcomes:
        campus_groups.setdefault(outcome.campus_id, []).append(outcome)
        locale_groups.setdefault(outcome.locale, []).append(outcome)
    return {
        "campus": {
            campus: calculate_metrics(segment_outcomes)
            for campus, segment_outcomes in campus_groups.items()
        },
        "locale": {
            locale: calculate_metrics(segment_outcomes)
            for locale, segment_outcomes in locale_groups.items()
        },
    }


def _failed_thresholds(
    metrics: EvaluationMetrics, thresholds: EvaluationThresholds
) -> tuple[str, ...]:
    checks = (
        ("answerPrecision", metrics.answer_precision >= thresholds.answer_precision),
        ("supportedRecall", metrics.supported_recall >= thresholds.supported_recall),
        (
            "top1CategoryAccuracy",
            metrics.top_1_category_accuracy >= thresholds.top_1_category_accuracy,
        ),
        (
            "abstentionRecall",
            metrics.abstention_recall >= thresholds.abstention_recall,
        ),
        (
            "meanReciprocalRank",
            metrics.mean_reciprocal_rank >= thresholds.mean_reciprocal_rank,
        ),
        (
            "campusLeakageRate",
            metrics.campus_leakage_rate <= thresholds.max_campus_leakage_rate,
        ),
        (
            "evidenceIntegrityRate",
            metrics.evidence_integrity_rate >= thresholds.evidence_integrity_rate,
        ),
    )
    return tuple(name for name, passed in checks if not passed)


def evaluate(
    dataset: EvaluationDataset,
    *,
    dataset_sha256: str,
    snapshot: CorpusSnapshot,
) -> EvaluationReport:
    _validate_dataset_against_corpus(dataset, snapshot)
    retriever = HybridRetriever(clock=lambda: dataset.evaluation_time)
    outcomes = tuple(
        _evaluate_case(
            case,
            snapshot=snapshot,
            retriever=retriever,
            evaluation_time=dataset.evaluation_time,
        )
        for case in dataset.cases
    )
    metrics = calculate_metrics(outcomes)
    segments = calculate_segments(outcomes)
    failed_thresholds = list(_failed_thresholds(metrics, dataset.thresholds))
    for dimension, segment_metrics in segments.items():
        for segment, metrics_for_segment in segment_metrics.items():
            failed_thresholds.extend(
                f"{dimension}.{segment}.{metric}"
                for metric in _failed_thresholds(metrics_for_segment, dataset.thresholds)
            )
    return EvaluationReport(
        dataset_id=dataset.dataset_id,
        dataset_version=dataset.dataset_version,
        dataset_sha256=dataset_sha256,
        corpus_sha256=snapshot.corpus_sha256,
        case_count=len(dataset.cases),
        metrics=metrics,
        segments=segments,
        failed_thresholds=tuple(failed_thresholds),
        outcomes=outcomes,
    )


def run_evaluation(*, dataset_path: Path, corpus_path: Path) -> EvaluationReport:
    dataset, dataset_sha256 = load_evaluation_dataset(dataset_path)
    try:
        snapshot = KnowledgeRepository(corpus_path).snapshot()
    except CorpusIntegrityError as error:
        raise EvaluationDatasetError("evaluation corpus validation failed") from error
    return evaluate(dataset, dataset_sha256=dataset_sha256, snapshot=snapshot)


def _format_text_report(report: EvaluationReport) -> str:
    status = "PASS" if report.passed else "FAIL"
    lines = [
        f"{status} retrieval quality {report.dataset_id}@{report.dataset_version}",
        f"cases={report.case_count} datasetSha256={report.dataset_sha256}",
        f"corpusSha256={report.corpus_sha256}",
    ]
    lines.extend(f"{name}={value:.6f}" for name, value in report.metrics.as_dict().items())
    for dimension, segment_metrics in sorted(report.segments.items()):
        for segment, metrics in sorted(segment_metrics.items()):
            rendered = " ".join(f"{name}={value:.6f}" for name, value in metrics.as_dict().items())
            lines.append(f"segment={dimension}.{segment} {rendered}")
    if report.failed_thresholds:
        lines.append(f"failedThresholds={','.join(report.failed_thresholds)}")
    if report.critical_failures:
        lines.append(
            "criticalSafetyFailures="
            f"{len(report.critical_failures)} "
            f"caseIds={','.join(outcome.case_id for outcome in report.critical_failures)}"
        )
    for outcome in report.outcomes:
        if outcome.failure_codes:
            categories = ",".join(outcome.returned_categories) or "none"
            lines.append(
                f"case={outcome.case_id} state={outcome.response_state} "
                f"categories={categories} failures={','.join(outcome.failure_codes)}"
            )
    return "\n".join(lines)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run the versioned deterministic campus retrieval quality gate."
    )
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET_PATH)
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS_PATH)
    parser.add_argument(
        "--output", choices=("text", "json"), default="text", help="redacted report format"
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        report = run_evaluation(dataset_path=args.dataset, corpus_path=args.corpus)
    except EvaluationDatasetError as error:
        print(f"retrieval quality configuration error: {error}", file=sys.stderr)
        return 2
    if args.output == "json":
        print(json.dumps(report.as_dict(), ensure_ascii=False, sort_keys=True))
    else:
        print(_format_text_report(report))
    return 0 if report.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
