from __future__ import annotations

import math
import re
import unicodedata
import uuid
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from .corpus import CorpusSnapshot
from .models import (
    AnswerParagraph,
    Citation,
    FreshnessState,
    KnowledgeDocument,
    Locale,
    QueryRequest,
    QueryResponse,
    RetrievalMetadata,
)

_LEXEME_RE = re.compile(r"[a-z0-9]+|[\u3400-\u4dbf\u4e00-\u9fff]+", re.IGNORECASE)
_NON_SEARCH_RE = re.compile(r"[^a-z0-9\u3400-\u4dbf\u4e00-\u9fff]+", re.IGNORECASE)
_CJK_RE = re.compile(r"^[\u3400-\u4dbf\u4e00-\u9fff]+$")
_STOP_WORDS = frozenset(
    {
        "a",
        "about",
        "all",
        "an",
        "and",
        "are",
        "at",
        "be",
        "campus",
        "can",
        "could",
        "did",
        "do",
        "does",
        "find",
        "for",
        "from",
        "get",
        "had",
        "has",
        "have",
        "how",
        "i",
        "in",
        "information",
        "ignore",
        "instruction",
        "is",
        "may",
        "me",
        "might",
        "must",
        "my",
        "need",
        "of",
        "official",
        "on",
        "override",
        "page",
        "please",
        "previou",
        "previous",
        "prompt",
        "reveal",
        "secret",
        "service",
        "services",
        "should",
        "system",
        "tell",
        "the",
        "then",
        "to",
        "umn",
        "university",
        "want",
        "was",
        "what",
        "when",
        "where",
        "were",
        "why",
        "will",
        "with",
        "would",
        "you",
        "your",
        "一个",
        "可以",
        "哪里",
        "大学",
        "学校",
        "官方",
        "校园",
        "服务",
        "查询",
        "请问",
        "这个",
    }
)

# Evidence strength is intentionally absolute: a topical title/keyword/category
# match contributes two points and a supporting body-only match contributes one.
# Accepted multi-term evidence must include a topical anchor. Low-coverage
# matches additionally need three topical terms so that one CJK phrase expanded
# into two bigrams cannot dominate a longer, unrelated question.
_TOPIC_MATCH_WEIGHT = 2
_BODY_MATCH_WEIGHT = 1
_MIN_EVIDENCE_STRENGTH = 3
_MIN_QUERY_COVERAGE = 0.25
_HIGH_CONFIDENCE_TOPIC_MATCHES = 3


def _normalize_english_token(token: str) -> str:
    if len(token) > 4 and token.endswith("ies"):
        return f"{token[:-3]}y"
    if len(token) > 4 and token.endswith("ses"):
        return token[:-2]
    if len(token) > 4 and token.endswith("s") and not token.endswith("ss"):
        return token[:-1]
    return token


def search_terms(value: str) -> list[str]:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    terms: list[str] = []
    for match in _LEXEME_RE.finditer(normalized):
        lexeme = match.group(0)
        if _CJK_RE.fullmatch(lexeme):
            candidates = [lexeme]
            candidates.extend(lexeme[index : index + 2] for index in range(max(0, len(lexeme) - 1)))
            if len(lexeme) == 1:
                candidates.append(lexeme)
        else:
            candidates = [_normalize_english_token(lexeme)]
        terms.extend(candidate for candidate in candidates if candidate not in _STOP_WORDS)
    return terms


def character_ngrams(value: str, size: int = 3) -> set[str]:
    normalized = _NON_SEARCH_RE.sub("", unicodedata.normalize("NFKC", value).casefold())
    if not normalized:
        return set()
    if len(normalized) <= size:
        return {normalized}
    return {normalized[index : index + size] for index in range(len(normalized) - size + 1)}


def _dice(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    return (2.0 * len(left & right)) / (len(left) + len(right))


def _document_text(document: KnowledgeDocument, locale: Locale) -> str:
    title = document.title.for_locale(locale)
    content = document.content.for_locale(locale)
    keywords = " ".join(document.keywords.for_locale(locale))
    category = document.category
    return f"{title} {title} {title} {category} {category} {keywords} {keywords} {content}"


def _topic_terms(document: KnowledgeDocument, locale: Locale) -> set[str]:
    return set(
        search_terms(
            " ".join(
                [
                    document.category,
                    document.title.for_locale(locale),
                    *document.keywords.for_locale(locale),
                ]
            )
        )
    )


def _has_sufficient_evidence(
    query_terms: set[str],
    overlap: set[str],
    topic_terms: set[str],
) -> bool:
    topic_overlap = overlap & topic_terms
    if len(query_terms) == 1 and topic_overlap == query_terms:
        return True

    evidence_strength = (
        len(topic_overlap) * _TOPIC_MATCH_WEIGHT + len(overlap - topic_overlap) * _BODY_MATCH_WEIGHT
    )
    query_coverage = len(overlap) / len(query_terms)
    return (
        bool(topic_overlap)
        and evidence_strength >= _MIN_EVIDENCE_STRENGTH
        and (
            query_coverage >= _MIN_QUERY_COVERAGE
            or len(topic_overlap) >= _HIGH_CONFIDENCE_TOPIC_MATCHES
        )
    )


@dataclass(frozen=True, slots=True)
class RankedDocument:
    document: KnowledgeDocument
    score: float


class HybridRetriever:
    def __init__(self, *, top_k: int = 3, clock: Callable[[], datetime] | None = None) -> None:
        self._top_k = top_k
        self._clock = clock or (lambda: datetime.now(UTC))

    def query(self, request: QueryRequest, snapshot: CorpusSnapshot) -> QueryResponse:
        candidates = snapshot.for_campus(request.campus_id)
        ranked = self._rank(request.query, request.locale, candidates)
        selected = ranked[: self._top_k]

        if not selected:
            return self._no_results(request, len(candidates))

        now = self._clock()
        freshness_by_id = {
            entry.document.id: self._freshness(entry.document, now) for entry in selected
        }
        selected = [
            entry
            for entry in selected
            if freshness_by_id[entry.document.id] is not FreshnessState.UNKNOWN
        ]
        if not selected:
            return self._no_results(request, len(candidates))
        if self._contains_conflict([entry.document for entry in selected]):
            state = "conflict"
        else:
            fresh_entries = [
                entry
                for entry in selected
                if freshness_by_id[entry.document.id] is FreshnessState.FRESH
            ]
            if fresh_entries:
                selected = fresh_entries
                state = "answered"
            else:
                stale_entries = [
                    entry
                    for entry in selected
                    if freshness_by_id[entry.document.id]
                    in {FreshnessState.STALE, FreshnessState.EXPIRED}
                ]
                if not stale_entries:
                    return self._no_results(request, len(candidates))
                selected = stale_entries
                state = "stale"

        citations: list[Citation] = []
        paragraphs: list[AnswerParagraph] = []
        for rank, ranked_document in enumerate(selected, start=1):
            document = ranked_document.document
            summary_source = snapshot.source(document.summary_source_id)
            verification_source = snapshot.source(document.verification_source_id)
            citation_id = f"citation-{rank}"
            paragraph_id = f"paragraph-{rank}"
            text = document.content.for_locale(request.locale)
            freshness_state = freshness_by_id[document.id]
            citations.append(
                Citation(
                    id=citation_id,
                    documentId=document.id,
                    campusId=document.campus_id,
                    category=document.category,
                    title=document.title,
                    contentSha256=document.content_sha256,
                    updatedAt=document.updated_at,
                    summaryFreshnessState=freshness_state,
                    summaryVerificationState=document.verification_state.value,
                    summarySource={
                        "kind": "project-authored-summary",
                        "sourceId": summary_source.id,
                        "sourceUrl": summary_source.source_url,
                        "corpusSha256": snapshot.corpus_sha256,
                        "license": {
                            "status": "OPEN_REUSE",
                            "spdxId": document.summary_license,
                            "evidenceUrl": summary_source.license_evidence_url,
                        },
                    },
                    verificationLink={
                        "kind": "official-verification-link",
                        "sourceId": verification_source.id,
                        "sourceUrl": verification_source.source_url,
                        "licenseStatus": "DEEPLINK_ONLY",
                        "sourceUse": document.source_use,
                        "contentRetrieved": False,
                    },
                    excerpt=text[:500],
                )
            )
            paragraphs.append(
                AnswerParagraph(
                    id=paragraph_id,
                    text=text,
                    citationIds=[citation_id],
                )
            )

        return QueryResponse(
            queryId=str(uuid.uuid4()),
            campusId=request.campus_id,
            locale=request.locale,
            state=state,
            paragraphs=paragraphs,
            citations=citations,
            retrieval=RetrievalMetadata(documentsConsidered=len(candidates)),
        )

    @staticmethod
    def _no_results(request: QueryRequest, documents_considered: int) -> QueryResponse:
        return QueryResponse(
            queryId=str(uuid.uuid4()),
            campusId=request.campus_id,
            locale=request.locale,
            state="no-results",
            paragraphs=[],
            citations=[],
            retrieval=RetrievalMetadata(documentsConsidered=documents_considered),
        )

    def _rank(
        self,
        query: str,
        locale: Locale,
        candidates: tuple[KnowledgeDocument, ...],
    ) -> list[RankedDocument]:
        query_terms = search_terms(query)
        if not query_terms or not candidates:
            return []

        query_counter = Counter(query_terms)
        unique_query_terms = set(query_counter)
        document_terms = [search_terms(_document_text(document, locale)) for document in candidates]
        document_counters = [Counter(terms) for terms in document_terms]
        average_length = sum(len(terms) for terms in document_terms) / max(1, len(document_terms))
        document_frequency = Counter(term for terms in document_terms for term in set(terms))
        query_ngrams = character_ngrams(query)
        raw_scores: list[tuple[KnowledgeDocument, float, float, bool]] = []

        for document, terms, frequencies in zip(
            candidates, document_terms, document_counters, strict=True
        ):
            overlap = set(query_counter) & set(frequencies)
            if not overlap:
                continue
            if not _has_sufficient_evidence(
                unique_query_terms,
                overlap,
                _topic_terms(document, locale),
            ):
                continue
            bm25 = 0.0
            document_length = max(1, len(terms))
            for term, query_frequency in query_counter.items():
                term_frequency = frequencies.get(term, 0)
                if term_frequency == 0:
                    continue
                frequency = document_frequency[term]
                inverse_document_frequency = math.log(
                    1.0 + (len(candidates) - frequency + 0.5) / (frequency + 0.5)
                )
                denominator = term_frequency + 1.2 * (
                    1.0 - 0.75 + 0.75 * document_length / max(1.0, average_length)
                )
                bm25 += (
                    inverse_document_frequency
                    * ((term_frequency * 2.2) / denominator)
                    * min(query_frequency, 2)
                )

            searchable_text = _document_text(document, locale)
            ngram_score = _dice(query_ngrams, character_ngrams(searchable_text))
            normalized_query = " ".join(query_terms)
            title_and_keywords = " ".join(
                [document.title.for_locale(locale), *document.keywords.for_locale(locale)]
            )
            exact_match = normalized_query in " ".join(search_terms(title_and_keywords))
            raw_scores.append((document, bm25, ngram_score, exact_match))

        if not raw_scores:
            return []
        max_bm25 = max(score[1] for score in raw_scores) or 1.0
        ranked = [
            RankedDocument(
                document=document,
                score=(0.75 * bm25 / max_bm25) + (0.20 * ngram_score) + (0.05 if exact else 0.0),
            )
            for document, bm25, ngram_score, exact in raw_scores
        ]
        ordered = sorted(ranked, key=lambda item: (-item.score, item.document.id))
        relevance_floor = max(0.12, ordered[0].score * 0.45)
        return [item for item in ordered if item.score >= relevance_floor]

    @staticmethod
    def _freshness(document: KnowledgeDocument, now: datetime) -> FreshnessState:
        updated_at = document.updated_at.astimezone(UTC)
        now_utc = now.astimezone(UTC)
        if updated_at > now_utc + timedelta(minutes=5):
            return FreshnessState.UNKNOWN
        age = now_utc - updated_at
        fresh_window = timedelta(days=document.fresh_for_days)
        if age <= fresh_window:
            return FreshnessState.FRESH
        if age <= fresh_window * 2:
            return FreshnessState.STALE
        return FreshnessState.EXPIRED

    @staticmethod
    def _contains_conflict(documents: list[KnowledgeDocument]) -> bool:
        variants_by_group: dict[str, set[str]] = {}
        for document in documents:
            if document.conflict_group and document.conflict_variant:
                variants_by_group.setdefault(document.conflict_group, set()).add(
                    document.conflict_variant
                )
        return any(len(variants) > 1 for variants in variants_by_group.values())
