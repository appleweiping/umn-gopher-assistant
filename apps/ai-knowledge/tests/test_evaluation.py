from __future__ import annotations

import copy
import json
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from ai_knowledge import evaluation
from ai_knowledge.corpus import CorpusSnapshot, KnowledgeRepository
from ai_knowledge.evaluation import (
    DEFAULT_CORPUS_PATH,
    DEFAULT_DATASET_PATH,
    CaseOutcome,
    EvaluationCase,
    EvaluationDataset,
    EvaluationDatasetError,
    EvaluationMetrics,
    EvaluationReport,
    EvaluationThresholds,
    calculate_metrics,
    calculate_segments,
    evaluate,
    load_evaluation_dataset,
    run_evaluation,
)
from ai_knowledge.retrieval import HybridRetriever


def _raw_dataset() -> dict[str, Any]:
    return json.loads(DEFAULT_DATASET_PATH.read_text(encoding="utf-8"))


def _write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def _outcome(
    case_id: str,
    *,
    campus_id: str = "tc",
    locale: str = "en",
    disposition: str = "answer",
    answered: bool = True,
    precise: bool = True,
    hit: bool = True,
    top_1: bool = True,
    reciprocal_rank: float = 1.0,
    leakage: int = 0,
    citations: int = 1,
    integrity: bool = True,
    safety_critical: bool = False,
    failures: tuple[str, ...] = (),
) -> CaseOutcome:
    return CaseOutcome(
        case_id=case_id,
        campus_id=campus_id,  # type: ignore[arg-type]
        locale=locale,  # type: ignore[arg-type]
        expected_disposition=disposition,  # type: ignore[arg-type]
        response_state="answered" if answered else "no-results",
        returned_categories=("library",) if answered else (),
        returned_document_ids=("tc-library-overview",) if answered else (),
        answered=answered,
        precise_answer=precise,
        supported_hit=hit,
        top_1_category_hit=top_1,
        reciprocal_rank=reciprocal_rank,
        campus_leakage_count=leakage,
        citation_count=citations,
        evidence_integrity=integrity,
        safety_critical=safety_critical,
        failure_codes=failures,
    )


def _report(*, passed: bool, outcome: CaseOutcome | None = None) -> EvaluationReport:
    metrics = EvaluationMetrics(1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 1.0)
    return EvaluationReport(
        dataset_id="campus-retrieval-quality",
        dataset_version="1.0.0",
        dataset_sha256="a" * 64,
        corpus_sha256="b" * 64,
        case_count=1,
        metrics=metrics,
        segments={"campus": {"tc": metrics}, "locale": {"en": metrics}},
        failed_thresholds=() if passed else ("answerPrecision",),
        outcomes=(outcome,) if outcome else (),
    )


def test_shipped_dataset_has_deliberate_versioned_coverage() -> None:
    dataset, digest = load_evaluation_dataset(DEFAULT_DATASET_PATH)

    assert dataset.schema_version == 1
    assert dataset.dataset_version == "1.0.0"
    assert len(digest) == 64
    assert len(dataset.cases) >= 150
    supported = Counter(
        (case.campus_id, case.locale, case.expected_category)
        for case in dataset.cases
        if case.expected_disposition == "answer"
    )
    abstentions = Counter(
        (case.campus_id, case.locale)
        for case in dataset.cases
        if case.expected_disposition == "abstain"
    )
    assert len(supported) == 50
    assert min(supported.values()) >= 2
    assert len(abstentions) == 10
    assert min(abstentions.values()) >= 5
    assert sum(abstentions.values()) >= 50


def test_shipped_retrieval_quality_gate_passes() -> None:
    report = run_evaluation(
        dataset_path=DEFAULT_DATASET_PATH,
        corpus_path=DEFAULT_CORPUS_PATH,
    )

    assert report.passed, report.as_dict()
    assert report.failed_thresholds == ()
    assert set(report.segments["campus"]) == {
        "tc",
        "duluth",
        "crookston",
        "morris",
        "rochester",
    }
    assert set(report.segments["locale"]) == {"en", "zh-CN"}


def test_report_is_deterministic_and_excludes_all_raw_queries() -> None:
    dataset, dataset_digest = load_evaluation_dataset(DEFAULT_DATASET_PATH)
    snapshot = KnowledgeRepository(DEFAULT_CORPUS_PATH).snapshot()

    first = evaluate(dataset, dataset_sha256=dataset_digest, snapshot=snapshot)
    second = evaluate(dataset, dataset_sha256=dataset_digest, snapshot=snapshot)
    rendered = json.dumps(first.as_dict(), ensure_ascii=False, sort_keys=True)

    assert first.as_dict() == second.as_dict()
    assert all(case.query not in rendered for case in dataset.cases)
    assert first.dataset_sha256 == dataset_digest


def test_metrics_have_query_level_semantics_and_safe_empty_denominators() -> None:
    outcomes = (
        _outcome("answer-good", campus_id="tc", locale="en"),
        _outcome(
            "answer-rank-two",
            campus_id="morris",
            locale="zh-CN",
            precise=False,
            top_1=False,
            reciprocal_rank=0.5,
            citations=2,
            leakage=1,
        ),
        _outcome(
            "abstain-good",
            campus_id="tc",
            locale="zh-CN",
            disposition="abstain",
            answered=False,
            precise=False,
            hit=False,
            top_1=False,
            reciprocal_rank=0.0,
            citations=0,
        ),
        _outcome(
            "abstain-bad",
            campus_id="morris",
            locale="en",
            disposition="abstain",
            precise=False,
            hit=False,
            top_1=False,
            reciprocal_rank=0.0,
            integrity=False,
        ),
    )

    metrics = calculate_metrics(outcomes)
    segments = calculate_segments(outcomes)

    assert metrics.answer_precision == pytest.approx(1 / 3)
    assert metrics.supported_recall == 1.0
    assert metrics.top_1_category_accuracy == 0.5
    assert metrics.abstention_recall == 0.5
    assert metrics.mean_reciprocal_rank == 0.75
    assert metrics.campus_leakage_rate == pytest.approx(0.25)
    assert metrics.evidence_integrity_rate == 0.75
    assert set(segments) == {"campus", "locale"}
    assert segments["campus"]["tc"].abstention_recall == 1.0
    assert segments["locale"]["en"].abstention_recall == 0.0

    empty = calculate_metrics(())
    assert empty.answer_precision == 1.0
    assert empty.supported_recall == 1.0
    assert empty.abstention_recall == 1.0
    assert empty.campus_leakage_rate == 0.0
    assert empty.evidence_integrity_rate == 1.0
    assert calculate_segments(()) == {"campus": {}, "locale": {}}


def test_all_threshold_failures_are_named_deterministically() -> None:
    metrics = EvaluationMetrics(0.4, 0.4, 0.4, 0.4, 0.4, 0.2, 0.4)
    thresholds = EvaluationThresholds.model_construct(
        answer_precision=0.5,
        supported_recall=0.5,
        top_1_category_accuracy=0.5,
        abstention_recall=0.5,
        mean_reciprocal_rank=0.5,
        max_campus_leakage_rate=0.1,
        evidence_integrity_rate=0.5,
    )

    assert evaluation._failed_thresholds(metrics, thresholds) == (
        "answerPrecision",
        "supportedRecall",
        "top1CategoryAccuracy",
        "abstentionRecall",
        "meanReciprocalRank",
        "campusLeakageRate",
        "evidenceIntegrityRate",
    )
    assert (
        evaluation._failed_thresholds(
            EvaluationMetrics(1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 1.0), thresholds
        )
        == ()
    )


@pytest.mark.parametrize(
    ("change", "expected_message"),
    [
        ({"datasetVersion": "latest"}, "datasetVersion"),
        ({"evaluationTime": "not-a-date"}, "evaluationTime"),
        ({"evaluationTime": "2026-07-23T00:00:00"}, "evaluationTime"),
    ],
)
def test_dataset_rejects_invalid_version_and_clock(
    change: dict[str, Any], expected_message: str
) -> None:
    raw = _raw_dataset()
    raw.update(change)

    with pytest.raises(ValidationError, match=expected_message):
        EvaluationDataset.model_validate(raw)


def test_threshold_policy_cannot_hide_a_single_deterministic_regression() -> None:
    raw = _raw_dataset()["thresholds"]
    raw["abstentionRecall"] = 0.99
    with pytest.raises(ValidationError):
        EvaluationThresholds.model_validate(raw)

    raw = _raw_dataset()["thresholds"]
    raw["maxCampusLeakageRate"] = 0.01
    with pytest.raises(ValidationError):
        EvaluationThresholds.model_validate(raw)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda case: case.update(expectedCategory=None),
        lambda case: case.update(relevantDocumentIds=[]),
        lambda case: case.update(tags=["unsupported"]),
        lambda case: case.update(locale="en", query="图书馆资料"),
        lambda case: case.update(locale="zh-CN", query="library records"),
        lambda case: case.update(tags=["paraphrase", "paraphrase"]),
        lambda case: case.update(tags=["paraphrase", "hard-negative"]),
        lambda case: case.update(tags=["paraphrase", "reproduced-false-positive"]),
    ],
)
def test_supported_case_schema_rejects_weak_or_inconsistent_labels(mutate: Any) -> None:
    raw = copy.deepcopy(_raw_dataset()["cases"][0])
    mutate(raw)

    with pytest.raises(ValidationError):
        EvaluationCase.model_validate(raw)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda case: case.update(expectedCategory="library"),
        lambda case: case.update(relevantDocumentIds=["tc-library-overview"]),
        lambda case: case.update(tags=["paraphrase"]),
    ],
)
def test_abstention_case_schema_rejects_answer_expectations(mutate: Any) -> None:
    raw = next(
        copy.deepcopy(case)
        for case in _raw_dataset()["cases"]
        if case["expectedDisposition"] == "abstain"
    )
    mutate(raw)

    with pytest.raises(ValidationError):
        EvaluationCase.model_validate(raw)


def test_dataset_schema_rejects_duplicate_ids_and_queries() -> None:
    raw = _raw_dataset()
    raw["cases"][1]["id"] = raw["cases"][0]["id"]
    with pytest.raises(ValidationError, match="ids must be unique"):
        EvaluationDataset.model_validate(raw)

    raw = _raw_dataset()
    raw["cases"][1]["query"] = raw["cases"][0]["query"]
    raw["cases"][1]["campusId"] = raw["cases"][0]["campusId"]
    raw["cases"][1]["locale"] = raw["cases"][0]["locale"]
    with pytest.raises(ValidationError, match="queries must be unique"):
        EvaluationDataset.model_validate(raw)


def test_dataset_schema_prevents_grain_and_risk_tag_regression() -> None:
    raw = _raw_dataset()
    target = ("tc", "en", "dining")
    matching = [
        case
        for case in raw["cases"]
        if (
            case["campusId"],
            case["locale"],
            case["expectedCategory"],
        )
        == target
    ]
    matching[0]["expectedCategory"] = "library"
    matching[0]["relevantDocumentIds"] = ["tc-library-overview"]
    with pytest.raises(ValidationError, match="two answer paraphrases"):
        EvaluationDataset.model_validate(raw)

    raw = _raw_dataset()
    pair_cases = [
        case
        for case in raw["cases"]
        if case["expectedDisposition"] == "abstain"
        and (case["campusId"], case["locale"]) == ("tc", "zh-CN")
    ]
    pair_cases[0]["campusId"] = "duluth"
    with pytest.raises(ValidationError, match="five abstention cases"):
        EvaluationDataset.model_validate(raw)

    raw = _raw_dataset()
    for case in raw["cases"]:
        case["tags"] = [tag for tag in case["tags"] if tag != "ambiguous"] or ["unsupported"]
    with pytest.raises(ValidationError, match="retrieval-risk tags"):
        EvaluationDataset.model_validate(raw)


@pytest.mark.parametrize(
    "contents",
    [
        b"{not-json",
        b'{"schemaVersion":1,"schemaVersion":1}',
        b"\xff\xfe",
    ],
)
def test_loader_fails_closed_without_echoing_dataset_contents(
    tmp_path: Path, contents: bytes
) -> None:
    path = tmp_path / "evaluation.json"
    path.write_bytes(contents)

    with pytest.raises(EvaluationDatasetError) as captured:
        load_evaluation_dataset(path)

    assert str(captured.value) == "evaluation dataset validation failed"
    decoded = contents.decode("utf-8", errors="ignore")
    assert not decoded or decoded not in str(captured.value)


def test_loader_rejects_missing_directory_oversize_and_unreadable_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with pytest.raises(EvaluationDatasetError, match="unavailable"):
        load_evaluation_dataset(tmp_path / "missing.json")
    with pytest.raises(EvaluationDatasetError, match="regular file"):
        load_evaluation_dataset(tmp_path)

    oversize = tmp_path / "oversize.json"
    oversize.write_bytes(b"x" * (evaluation.MAX_EVALUATION_DATASET_BYTES + 1))
    with pytest.raises(EvaluationDatasetError, match="size limit"):
        load_evaluation_dataset(oversize)

    unreadable = tmp_path / "unreadable.json"
    unreadable.write_text("{}", encoding="utf-8")

    def fail_read(_path: Path) -> bytes:
        raise OSError("secret operating system detail")

    monkeypatch.setattr(Path, "read_bytes", fail_read)
    with pytest.raises(EvaluationDatasetError, match="cannot be read"):
        load_evaluation_dataset(unreadable)


def test_schema_loader_redacts_invalid_raw_query(tmp_path: Path) -> None:
    raw = _raw_dataset()
    secret_query = "SECRET-QUERY <script>"
    raw["cases"][0]["query"] = secret_query
    path = tmp_path / "invalid-query.json"
    _write_json(path, raw)

    with pytest.raises(EvaluationDatasetError) as captured:
        load_evaluation_dataset(path)

    assert secret_query not in str(captured.value)


def test_dataset_corpus_coupling_rejects_drift_duplicate_sources_and_bad_expectations() -> None:
    dataset, _ = load_evaluation_dataset(DEFAULT_DATASET_PATH)
    snapshot = KnowledgeRepository(DEFAULT_CORPUS_PATH).snapshot()

    with pytest.raises(EvaluationDatasetError, match="different corpus revision"):
        evaluation._validate_dataset_against_corpus(
            dataset.model_copy(update={"corpus_sha256": "0" * 64}), snapshot
        )

    duplicated = CorpusSnapshot(
        documents=(snapshot.documents[0], snapshot.documents[0]),
        source_registry={
            source_id: snapshot.source(source_id)
            for source_id in (
                snapshot.documents[0].summary_source_id,
                snapshot.documents[0].verification_source_id,
            )
        },
        corpus_sha256=snapshot.corpus_sha256,
    )
    with pytest.raises(EvaluationDatasetError, match="document ids are not unique"):
        evaluation._validate_dataset_against_corpus(dataset, duplicated)

    case = dataset.cases[0].model_copy(update={"relevant_document_ids": ["tc-library-overview"]})
    incompatible = dataset.model_copy(update={"cases": [case, *dataset.cases[1:]]})
    with pytest.raises(EvaluationDatasetError, match=case.id):
        evaluation._validate_dataset_against_corpus(incompatible, snapshot)


def test_evidence_integrity_accepts_exact_evidence_and_empty_abstention() -> None:
    dataset, _ = load_evaluation_dataset(DEFAULT_DATASET_PATH)
    snapshot = KnowledgeRepository(DEFAULT_CORPUS_PATH).snapshot()
    case = next(case for case in dataset.cases if case.id == "answer-tc-en-library")
    response = HybridRetriever(clock=lambda: dataset.evaluation_time).query(
        evaluation.QueryRequest(
            campusId=case.campus_id,
            locale=case.locale,
            query=case.query,
        ),
        snapshot,
    )

    assert evaluation._response_evidence_integrity(
        response, case=case, snapshot=snapshot, evaluation_time=dataset.evaluation_time
    ) == (
        True,
        0,
    )
    empty = response.model_copy(update={"state": "no-results", "paragraphs": [], "citations": []})
    assert evaluation._response_evidence_integrity(
        empty, case=case, snapshot=snapshot, evaluation_time=dataset.evaluation_time
    ) == (True, 0)


@pytest.mark.parametrize(
    ("target", "field", "value"),
    [
        ("citation", "document_id", "missing-document"),
        ("citation", "campus_id", "morris"),
        ("citation", "category", "safety"),
        ("citation", "title", None),
        ("citation", "content_sha256", "0" * 64),
        ("citation", "updated_at", datetime(2020, 1, 1, tzinfo=UTC)),
        ("citation", "summary_freshness_state", "EXPIRED"),
        ("citation", "summary_verification_state", "verified"),
        ("citation", "excerpt", "tampered evidence"),
        ("summary", "source_id", "missing-summary-source"),
        ("summary", "source_url", "https://github.com/appleweiping/wrong/repository"),
        ("summary", "corpus_sha256", "0" * 64),
        ("license", "status", "DEEPLINK_ONLY"),
        ("license", "spdx_id", "MIT"),
        ("license", "evidence_url", "https://www.apache.org/licenses/LICENSE-1.0"),
        ("verification", "source_id", "official-tc-safe-campus"),
        ("verification", "source_url", "https://safe-campus.umn.edu/"),
        ("verification", "license_status", "OPEN_REUSE"),
        ("verification", "source_use", "copied-content"),
        ("verification", "content_retrieved", True),
    ],
)
def test_evidence_integrity_rejects_tampered_citations(
    target: str,
    field: str,
    value: Any,
) -> None:
    dataset, _ = load_evaluation_dataset(DEFAULT_DATASET_PATH)
    snapshot = KnowledgeRepository(DEFAULT_CORPUS_PATH).snapshot()
    case = next(case for case in dataset.cases if case.id == "answer-tc-en-library")
    response = HybridRetriever(clock=lambda: dataset.evaluation_time).query(
        evaluation.QueryRequest(campusId="tc", locale="en", query=case.query), snapshot
    )
    citation = response.citations[0]
    if target == "summary":
        bad_citation = citation.model_copy(
            update={"summary_source": citation.summary_source.model_copy(update={field: value})}
        )
    elif target == "license":
        bad_license = citation.summary_source.license.model_copy(update={field: value})
        bad_summary = citation.summary_source.model_copy(update={"license": bad_license})
        bad_citation = citation.model_copy(update={"summary_source": bad_summary})
    elif target == "verification":
        bad_citation = citation.model_copy(
            update={
                "verification_link": citation.verification_link.model_copy(update={field: value})
            }
        )
    else:
        bad_citation = citation.model_copy(update={field: value})
    tampered = response.model_copy(update={"citations": [bad_citation]})

    integrity, leakage = evaluation._response_evidence_integrity(
        tampered,
        case=case,
        snapshot=snapshot,
        evaluation_time=dataset.evaluation_time,
    )

    assert not integrity
    assert leakage == int(field == "campus_id" and value == "morris")


def test_evidence_integrity_rejects_mismatched_response_and_paragraph_graph() -> None:
    dataset, _ = load_evaluation_dataset(DEFAULT_DATASET_PATH)
    snapshot = KnowledgeRepository(DEFAULT_CORPUS_PATH).snapshot()
    case = next(case for case in dataset.cases if case.id == "answer-tc-en-library")
    response = HybridRetriever(clock=lambda: dataset.evaluation_time).query(
        evaluation.QueryRequest(campusId="tc", locale="en", query=case.query), snapshot
    )

    wrong_campus = response.model_copy(update={"campus_id": "morris"})
    assert not evaluation._response_evidence_integrity(
        wrong_campus,
        case=case,
        snapshot=snapshot,
        evaluation_time=dataset.evaluation_time,
    )[0]
    wrong_locale = response.model_copy(update={"locale": "zh-CN"})
    assert not evaluation._response_evidence_integrity(
        wrong_locale,
        case=case,
        snapshot=snapshot,
        evaluation_time=dataset.evaluation_time,
    )[0]
    no_results_with_evidence = response.model_copy(update={"state": "no-results"})
    assert not evaluation._response_evidence_integrity(
        no_results_with_evidence,
        case=case,
        snapshot=snapshot,
        evaluation_time=dataset.evaluation_time,
    )[0]
    no_citations = response.model_copy(update={"citations": []})
    assert not evaluation._response_evidence_integrity(
        no_citations,
        case=case,
        snapshot=snapshot,
        evaluation_time=dataset.evaluation_time,
    )[0]
    no_paragraphs = response.model_copy(update={"paragraphs": []})
    assert not evaluation._response_evidence_integrity(
        no_paragraphs,
        case=case,
        snapshot=snapshot,
        evaluation_time=dataset.evaluation_time,
    )[0]

    unknown_reference = response.paragraphs[0].model_copy(
        update={"citation_ids": ["citation-unknown"]}
    )
    tampered = response.model_copy(update={"paragraphs": [unknown_reference]})
    assert not evaluation._response_evidence_integrity(
        tampered,
        case=case,
        snapshot=snapshot,
        evaluation_time=dataset.evaluation_time,
    )[0]

    bad_text = response.paragraphs[0].model_copy(update={"text": "not the cited document"})
    tampered = response.model_copy(update={"paragraphs": [bad_text]})
    assert not evaluation._response_evidence_integrity(
        tampered,
        case=case,
        snapshot=snapshot,
        evaluation_time=dataset.evaluation_time,
    )[0]

    unused = response.citations[0].model_copy(update={"id": "citation-unused"})
    tampered = response.model_copy(update={"citations": [*response.citations, unused]})
    assert not evaluation._response_evidence_integrity(
        tampered,
        case=case,
        snapshot=snapshot,
        evaluation_time=dataset.evaluation_time,
    )[0]


def test_case_evaluation_records_relevance_abstention_and_integrity_failures() -> None:
    dataset, _ = load_evaluation_dataset(DEFAULT_DATASET_PATH)
    snapshot = KnowledgeRepository(DEFAULT_CORPUS_PATH).snapshot()
    answer_case = next(case for case in dataset.cases if case.id == "answer-tc-en-library")
    abstain_case = next(
        case
        for case in dataset.cases
        if case.campus_id == "tc" and case.locale == "en" and case.expected_disposition == "abstain"
    )
    response = HybridRetriever(clock=lambda: dataset.evaluation_time).query(
        evaluation.QueryRequest(campusId="tc", locale="en", query=answer_case.query), snapshot
    )

    class StaticRetriever:
        def __init__(self, static_response: Any) -> None:
            self.response = static_response

        def query(self, _request: Any, _snapshot: Any) -> Any:
            return self.response

    no_results = response.model_copy(
        update={"state": "no-results", "paragraphs": [], "citations": []}
    )
    miss = evaluation._evaluate_case(
        answer_case,
        snapshot=snapshot,
        retriever=StaticRetriever(no_results),  # type: ignore[arg-type]
        evaluation_time=dataset.evaluation_time,
    )
    assert miss.failure_codes == ("supported-miss", "top1-category-miss")
    assert miss.reciprocal_rank == 0.0

    wrong_citation = response.citations[0].model_copy(
        update={"document_id": "tc-safety-overview", "category": "safety"}
    )
    wrong_answer = response.model_copy(update={"citations": [wrong_citation]})
    imprecise = evaluation._evaluate_case(
        answer_case,
        snapshot=snapshot,
        retriever=StaticRetriever(wrong_answer),  # type: ignore[arg-type]
        evaluation_time=dataset.evaluation_time,
    )
    assert imprecise.failure_codes == (
        "supported-miss",
        "top1-category-miss",
        "imprecise-answer",
        "evidence-integrity",
    )

    false_positive = evaluation._evaluate_case(
        abstain_case,
        snapshot=snapshot,
        retriever=StaticRetriever(response),  # type: ignore[arg-type]
        evaluation_time=dataset.evaluation_time,
    )
    assert "expected-abstention" in false_positive.failure_codes

    leaked_citation = response.citations[0].model_copy(update={"campus_id": "morris"})
    leaked_response = response.model_copy(update={"citations": [leaked_citation]})
    leaked = evaluation._evaluate_case(
        answer_case,
        snapshot=snapshot,
        retriever=StaticRetriever(leaked_response),  # type: ignore[arg-type]
        evaluation_time=dataset.evaluation_time,
    )
    assert "campus-leakage" in leaked.failure_codes
    assert "evidence-integrity" in leaked.failure_codes


def test_run_evaluation_redacts_invalid_corpus(tmp_path: Path) -> None:
    corpus = tmp_path / "corpus.json"
    corpus.write_text("not-json", encoding="utf-8")

    with pytest.raises(EvaluationDatasetError) as captured:
        run_evaluation(dataset_path=DEFAULT_DATASET_PATH, corpus_path=corpus)

    assert str(captured.value) == "evaluation corpus validation failed"


def test_report_formats_include_segments_and_failure_ids_but_no_queries() -> None:
    failed_outcome = _outcome(
        "safe-case-id",
        disposition="abstain",
        precise=False,
        hit=False,
        top_1=False,
        reciprocal_rank=0.0,
        safety_critical=True,
        failures=("expected-abstention",),
    )
    failed = _report(passed=False, outcome=failed_outcome)
    critical_only = _report(passed=True, outcome=failed_outcome)
    passed = _report(passed=True)

    rendered = evaluation._format_text_report(failed)
    assert rendered.startswith("FAIL retrieval quality")
    assert "segment=campus.tc" in rendered
    assert "failedThresholds=answerPrecision" in rendered
    assert "criticalSafetyFailures=1" in rendered
    assert "case=safe-case-id" in rendered
    assert evaluation._format_text_report(passed).startswith("PASS retrieval quality")
    assert not critical_only.passed
    assert passed.as_dict()["passed"]
    assert failed.as_dict()["criticalSafetyFailures"] == {
        "count": 1,
        "caseIds": ["safe-case-id"],
    }
    assert failed.as_dict()["failures"][0]["caseId"] == "safe-case-id"


def test_cli_supports_redacted_text_json_pass_fail_and_configuration_errors(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(evaluation, "run_evaluation", lambda **_kwargs: _report(passed=True))
    assert evaluation.main([]) == 0
    assert "PASS retrieval quality" in capsys.readouterr().out

    monkeypatch.setattr(evaluation, "run_evaluation", lambda **_kwargs: _report(passed=False))
    assert evaluation.main(["--output", "json"]) == 1
    output = json.loads(capsys.readouterr().out)
    assert output["passed"] is False
    assert "segments" in output

    def fail_configuration(**_kwargs: Any) -> EvaluationReport:
        raise EvaluationDatasetError("evaluation dataset validation failed")

    monkeypatch.setattr(evaluation, "run_evaluation", fail_configuration)
    assert evaluation.main([]) == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err.strip() == (
        "retrieval quality configuration error: evaluation dataset validation failed"
    )
