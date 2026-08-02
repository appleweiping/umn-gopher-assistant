from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections.abc import Mapping
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal, Self
from urllib.parse import urlsplit

from pydantic import (
    AnyHttpUrl,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from .url_policy import is_official_umn_url, is_project_summary_url

_HTML_OR_ENTITY_RE = re.compile(r"[<>]|&(?:#(?:[xX][0-9A-Fa-f]+|\d+)|[A-Za-z][A-Za-z0-9]{1,31});?")

CampusId = Literal["tc", "duluth", "crookston", "morris", "rochester"]
Locale = Literal["en", "zh-CN"]
Category = Literal["library", "student-services", "safety", "transportation", "dining"]
SafeIdentifier = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{2,127}$")]
EvidenceIdentifier = Annotated[
    str, StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
]
Sha256 = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)


def _reject_unsafe_text(value: str, *, field_name: str) -> str:
    if value != value.strip():
        raise ValueError(f"{field_name} must not have leading or trailing whitespace")
    if value != unicodedata.normalize("NFC", value):
        raise ValueError(f"{field_name} must use NFC Unicode normalization")
    if any(unicodedata.category(character) in {"Cc", "Cf", "Cs"} for character in value):
        raise ValueError(f"{field_name} must not contain control or format characters")
    if _HTML_OR_ENTITY_RE.search(value) is not None:
        raise ValueError(f"{field_name} must not contain HTML or encoded HTML")
    return value


class QueryRequest(StrictModel):
    campus_id: CampusId = Field(alias="campusId")
    locale: Locale
    query: Annotated[str, StringConstraints(min_length=2, max_length=500)]

    @field_validator("query")
    @classmethod
    def validate_query(cls, value: str) -> str:
        return _reject_unsafe_text(value, field_name="query")


class BilingualText(StrictModel):
    en: Annotated[str, StringConstraints(min_length=1, max_length=2_000)]
    zh_cn: Annotated[str, StringConstraints(min_length=1, max_length=2_000)] = Field(alias="zh-CN")

    @field_validator("en", "zh_cn")
    @classmethod
    def validate_text(cls, value: str) -> str:
        return _reject_unsafe_text(value, field_name="bilingual text")

    def for_locale(self, locale: Locale) -> str:
        return self.en if locale == "en" else self.zh_cn


class BilingualKeywords(StrictModel):
    en: list[Annotated[str, StringConstraints(min_length=1, max_length=80)]] = Field(
        min_length=1, max_length=24
    )
    zh_cn: list[Annotated[str, StringConstraints(min_length=1, max_length=80)]] = Field(
        alias="zh-CN", min_length=1, max_length=24
    )

    @field_validator("en", "zh_cn")
    @classmethod
    def validate_keywords(cls, values: list[str]) -> list[str]:
        if len(set(values)) != len(values):
            raise ValueError("keywords must be unique")
        return [_reject_unsafe_text(value, field_name="keyword") for value in values]

    def for_locale(self, locale: Locale) -> list[str]:
        return self.en if locale == "en" else self.zh_cn


class FreshnessState(StrEnum):
    FRESH = "FRESH"
    STALE = "STALE"
    EXPIRED = "EXPIRED"
    UNKNOWN = "UNKNOWN"


class VerificationState(StrEnum):
    SCHEMATIC = "schematic"
    SURVEYED = "surveyed"
    CAMPUS_REVIEWED = "campus-reviewed"
    VERIFIED = "verified"
    RETIRED = "retired"


class KnowledgeSourceResourceKind(StrEnum):
    SUMMARY = "AI_KNOWLEDGE_SUMMARY"
    VERIFICATION_LINK = "AI_VERIFICATION_LINK"


class LicenseStatus(StrEnum):
    OPEN_REUSE = "OPEN_REUSE"
    DEEPLINK_ONLY = "DEEPLINK_ONLY"


class SourceKillSwitch(StrictModel):
    key: Annotated[str, StringConstraints(pattern=r"^source\.[a-z0-9][a-z0-9.-]{2,127}\.enabled$")]
    default_state: Literal["ENABLED", "DISABLED"] = Field(alias="defaultState")


class KnowledgeSourceDescriptor(StrictModel):
    id: SafeIdentifier
    campus_ids: list[CampusId] = Field(alias="campusIds", min_length=1, max_length=5)
    resource_kinds: list[KnowledgeSourceResourceKind] = Field(
        alias="resourceKinds", min_length=1, max_length=1
    )
    source_url: AnyHttpUrl = Field(alias="sourceUrl")
    license_status: LicenseStatus = Field(alias="licenseStatus")
    license_evidence_url: AnyHttpUrl | None = Field(alias="licenseEvidenceUrl")
    kill_switch: SourceKillSwitch = Field(alias="killSwitch")

    @model_validator(mode="before")
    @classmethod
    def validate_raw_project_source_url(cls, value: object) -> object:
        if not isinstance(value, Mapping):
            return value
        resource_kinds = value.get("resourceKinds", value.get("resource_kinds"))
        if not isinstance(resource_kinds, list) or not any(
            item == KnowledgeSourceResourceKind.SUMMARY
            or item == KnowledgeSourceResourceKind.SUMMARY.value
            for item in resource_kinds
        ):
            return value
        source_url = value.get("sourceUrl", value.get("source_url"))
        if not is_project_summary_url(str(source_url)):
            raise ValueError("project summary sources must identify this repository")
        return value

    @field_validator("resource_kinds", mode="before")
    @classmethod
    def parse_resource_kinds(cls, value: object) -> object:
        if isinstance(value, list):
            return [
                item
                if isinstance(item, KnowledgeSourceResourceKind)
                else KnowledgeSourceResourceKind(item)
                for item in value
            ]
        return value

    @field_validator("license_status", mode="before")
    @classmethod
    def parse_license_status(cls, value: LicenseStatus | str) -> LicenseStatus:
        return value if isinstance(value, LicenseStatus) else LicenseStatus(value)

    @field_validator("source_url", "license_evidence_url")
    @classmethod
    def validate_source_urls(cls, value: AnyHttpUrl | None) -> AnyHttpUrl | None:
        if value is None:
            return None
        parsed = urlsplit(str(value))
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.port not in {None, 443}
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("knowledge source URLs must be credential-free canonical HTTPS URLs")
        return value

    @model_validator(mode="after")
    def validate_governance(self) -> Self:
        if len(set(self.campus_ids)) != len(self.campus_ids):
            raise ValueError("knowledge source campusIds must be unique")
        if self.kill_switch.key != f"source.{self.id}.enabled":
            raise ValueError("knowledge source kill-switch key must match its identity")

        resource_kind = self.resource_kinds[0]
        if resource_kind is KnowledgeSourceResourceKind.SUMMARY:
            if self.license_status is not LicenseStatus.OPEN_REUSE:
                raise ValueError("project summary sources must be OPEN_REUSE")
            if self.license_evidence_url is None:
                raise ValueError("project summary sources require license evidence")
            if not is_project_summary_url(str(self.source_url)):
                raise ValueError("project summary sources must identify this repository")
        else:
            if self.license_status is not LicenseStatus.DEEPLINK_ONLY:
                raise ValueError("official verification sources must be DEEPLINK_ONLY")
            if self.license_evidence_url is not None:
                raise ValueError("official verification links cannot carry a reuse license claim")
            if not is_official_umn_url(str(self.source_url)):
                raise ValueError("official verification links must use an umn.edu host")
        return self

    def is_enabled(self) -> bool:
        return self.kill_switch.default_state == "ENABLED"


def canonical_content_payload(document: KnowledgeDocument) -> bytes:
    payload = {
        "campusId": document.campus_id,
        "category": document.category,
        "content": document.content.model_dump(by_alias=True),
        "id": document.id,
        "title": document.title.model_dump(by_alias=True),
    }
    return json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def document_content_sha256(document: KnowledgeDocument) -> str:
    return hashlib.sha256(canonical_content_payload(document)).hexdigest()


class KnowledgeDocument(StrictModel):
    id: SafeIdentifier
    campus_id: CampusId = Field(alias="campusId")
    category: Category
    summary_source_id: SafeIdentifier = Field(alias="summarySourceId")
    verification_source_id: SafeIdentifier = Field(alias="verificationSourceId")
    verification_url: AnyHttpUrl = Field(alias="verificationUrl")
    source_use: Literal["verification-link-only"] = Field(alias="sourceUse")
    summary_license: Literal["Apache-2.0"] = Field(alias="summaryLicense")
    title: BilingualText
    content: BilingualText
    keywords: BilingualKeywords
    content_sha256: Sha256 = Field(alias="contentSha256")
    updated_at: datetime = Field(alias="updatedAt")
    fresh_for_days: Annotated[int, Field(ge=1, le=3_650)] = Field(alias="freshForDays")
    verification_state: VerificationState = Field(alias="verificationState")
    enabled: bool
    deleted_at: datetime | None = Field(alias="deletedAt")
    conflict_group: SafeIdentifier | None = Field(default=None, alias="conflictGroup")
    conflict_variant: SafeIdentifier | None = Field(default=None, alias="conflictVariant")

    @field_validator("verification_url")
    @classmethod
    def validate_official_source_url(cls, value: AnyHttpUrl) -> AnyHttpUrl:
        if not is_official_umn_url(str(value)):
            raise ValueError("verificationUrl must be a canonical official umn.edu URL")
        return value

    @field_validator("updated_at", "deleted_at", mode="before")
    @classmethod
    def validate_timezone(cls, value: datetime | str | None) -> datetime | None:
        if isinstance(value, str):
            try:
                value = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError as error:
                raise ValueError("timestamps must use ISO 8601") from error
        if value is not None and not isinstance(value, datetime):
            raise ValueError("timestamps must use ISO 8601")
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("timestamps must contain an offset")
        return value

    @field_validator("verification_state", mode="before")
    @classmethod
    def parse_verification_state(cls, value: VerificationState | str) -> VerificationState:
        if isinstance(value, VerificationState):
            return value
        return VerificationState(value)

    @model_validator(mode="after")
    def validate_integrity(self) -> Self:
        if (self.conflict_group is None) != (self.conflict_variant is None):
            raise ValueError("conflictGroup and conflictVariant must be supplied together")
        actual_digest = document_content_sha256(self)
        if actual_digest != self.content_sha256:
            raise ValueError(
                f"contentSha256 mismatch for {self.id}: expected "
                f"{self.content_sha256}, calculated {actual_digest}"
            )
        return self

    def is_publishable(self) -> bool:
        return (
            self.enabled
            and self.deleted_at is None
            and self.verification_state is not VerificationState.RETIRED
        )


class CorpusManifest(StrictModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    summary_content_license: Literal["Apache-2.0"] = Field(alias="summaryContentLicense")
    provenance: Literal["project-authored-summaries"]
    source_policy: Literal["official-links-are-verification-only"] = Field(alias="sourcePolicy")
    enforce_coverage: bool = Field(alias="enforceCoverage")
    enabled: bool
    deleted_at: datetime | None = Field(alias="deletedAt")
    source_registry: list[KnowledgeSourceDescriptor] = Field(
        alias="sourceRegistry", min_length=2, max_length=2_000
    )
    documents: list[KnowledgeDocument] = Field(min_length=1, max_length=2_000)

    @field_validator("deleted_at", mode="before")
    @classmethod
    def validate_deleted_at(cls, value: datetime | str | None) -> datetime | None:
        if isinstance(value, str):
            try:
                value = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError as error:
                raise ValueError("deletedAt must use ISO 8601") from error
        if value is not None and not isinstance(value, datetime):
            raise ValueError("deletedAt must use ISO 8601")
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("deletedAt must contain an offset")
        return value

    @model_validator(mode="after")
    def validate_document_identity_and_coverage(self) -> Self:
        ids = [document.id for document in self.documents]
        if len(ids) != len(set(ids)):
            raise ValueError("document ids must be unique")
        source_ids = [source.id for source in self.source_registry]
        if len(source_ids) != len(set(source_ids)):
            raise ValueError("knowledge source ids must be unique")
        sources = {source.id: source for source in self.source_registry}
        referenced_source_ids: set[str] = set()
        for document in self.documents:
            summary = sources.get(document.summary_source_id)
            verification = sources.get(document.verification_source_id)
            if summary is None or verification is None:
                raise ValueError("every knowledge document source must be registered")
            if not summary.is_enabled() or not verification.is_enabled():
                raise ValueError("knowledge documents cannot reference a disabled source")
            if summary.resource_kinds != [KnowledgeSourceResourceKind.SUMMARY]:
                raise ValueError("summarySourceId must reference an AI_KNOWLEDGE_SUMMARY source")
            if verification.resource_kinds != [KnowledgeSourceResourceKind.VERIFICATION_LINK]:
                raise ValueError(
                    "verificationSourceId must reference an AI_VERIFICATION_LINK source"
                )
            if document.campus_id not in summary.campus_ids or verification.campus_ids != [
                document.campus_id
            ]:
                raise ValueError("knowledge source campus scope does not match its document")
            if str(verification.source_url) != str(document.verification_url):
                raise ValueError("verification source URL does not match its document")
            referenced_source_ids.update(
                {document.summary_source_id, document.verification_source_id}
            )
        if referenced_source_ids != set(source_ids):
            raise ValueError(
                "knowledge source registry must contain exactly the referenced sources"
            )
        if self.enforce_coverage:
            expected = {
                (campus_id, category)
                for campus_id in ("tc", "duluth", "crookston", "morris", "rochester")
                for category in (
                    "library",
                    "student-services",
                    "safety",
                    "transportation",
                    "dining",
                )
            }
            actual = {(document.campus_id, document.category) for document in self.documents}
            missing = sorted(expected - actual)
            if missing:
                raise ValueError(f"corpus is missing required campus/category coverage: {missing}")
        return self

    def is_publishable(self) -> bool:
        return self.enabled and self.deleted_at is None


class AnswerParagraph(StrictModel):
    id: EvidenceIdentifier
    text: Annotated[str, StringConstraints(min_length=1, max_length=4_000)]
    citation_ids: list[EvidenceIdentifier] = Field(alias="citationIds", min_length=1, max_length=64)

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str) -> str:
        return _reject_unsafe_text(value, field_name="answer paragraph")

    @field_validator("citation_ids")
    @classmethod
    def validate_unique_citation_ids(cls, values: list[str]) -> list[str]:
        if len(values) != len(set(values)):
            raise ValueError("citationIds must be unique within a paragraph")
        return values


class CitationLicense(StrictModel):
    status: Literal["OPEN_REUSE"]
    spdx_id: Literal["Apache-2.0"] = Field(alias="spdxId")
    evidence_url: AnyHttpUrl = Field(alias="evidenceUrl")

    @field_validator("evidence_url")
    @classmethod
    def validate_evidence_url(cls, value: AnyHttpUrl) -> AnyHttpUrl:
        if str(value) != "https://www.apache.org/licenses/LICENSE-2.0":
            raise ValueError("license evidence must identify the reviewed Apache-2.0 terms")
        return value


class CitationSummarySource(StrictModel):
    kind: Literal["project-authored-summary"]
    source_id: SafeIdentifier = Field(alias="sourceId")
    source_url: AnyHttpUrl = Field(alias="sourceUrl")
    corpus_sha256: Sha256 = Field(alias="corpusSha256")
    license: CitationLicense

    @field_validator("source_url", mode="before")
    @classmethod
    def validate_project_source_url(cls, value: object) -> object:
        if not is_project_summary_url(str(value)):
            raise ValueError("summary sourceUrl must identify this repository")
        return value


class CitationVerificationLink(StrictModel):
    kind: Literal["official-verification-link"]
    source_id: SafeIdentifier = Field(alias="sourceId")
    source_url: AnyHttpUrl = Field(alias="sourceUrl")
    license_status: Literal["DEEPLINK_ONLY"] = Field(alias="licenseStatus")
    source_use: Literal["verification-link-only"] = Field(alias="sourceUse")
    content_retrieved: Literal[False] = Field(alias="contentRetrieved")

    @field_validator("source_url")
    @classmethod
    def validate_official_source_url(cls, value: AnyHttpUrl) -> AnyHttpUrl:
        if not is_official_umn_url(str(value)):
            raise ValueError("verification sourceUrl must be a canonical official umn.edu URL")
        return value


class Citation(StrictModel):
    id: EvidenceIdentifier
    document_id: SafeIdentifier = Field(alias="documentId")
    campus_id: CampusId = Field(alias="campusId")
    category: Category
    title: BilingualText
    content_sha256: Sha256 = Field(alias="contentSha256")
    updated_at: datetime = Field(alias="updatedAt")
    summary_freshness_state: Literal["FRESH", "STALE", "EXPIRED"] = Field(
        alias="summaryFreshnessState"
    )
    summary_verification_state: Literal["schematic"] = Field(alias="summaryVerificationState")
    summary_source: CitationSummarySource = Field(alias="summarySource")
    verification_link: CitationVerificationLink = Field(alias="verificationLink")
    excerpt: Annotated[str, StringConstraints(min_length=1, max_length=4_000)]

    @field_validator("excerpt")
    @classmethod
    def validate_excerpt(cls, value: str) -> str:
        return _reject_unsafe_text(value, field_name="citation excerpt")

    @field_validator("updated_at", mode="before")
    @classmethod
    def parse_updated_at(cls, value: datetime | str) -> datetime:
        if isinstance(value, str):
            try:
                value = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError as error:
                raise ValueError("updatedAt must use ISO 8601") from error
        if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("updatedAt must contain an offset")
        return value

    @model_validator(mode="after")
    def validate_distinct_source_roles(self) -> Self:
        if self.summary_source.source_id == self.verification_link.source_id:
            raise ValueError("summary and verification source identities must be distinct")
        return self


class RetrievalMetadata(StrictModel):
    mode: Literal["no-key-hybrid"] = "no-key-hybrid"
    documents_considered: Annotated[int, Field(ge=0, le=1_000_000)] = Field(
        alias="documentsConsidered"
    )


class QueryResponse(StrictModel):
    query_id: str = Field(
        alias="queryId",
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    )
    campus_id: CampusId = Field(alias="campusId")
    locale: Locale
    state: Literal["answered", "stale", "conflict", "no-results"]
    paragraphs: list[AnswerParagraph] = Field(max_length=64)
    citations: list[Citation] = Field(max_length=128)
    retrieval: RetrievalMetadata

    @model_validator(mode="after")
    def validate_evidence_graph(self) -> Self:
        paragraph_ids = [paragraph.id for paragraph in self.paragraphs]
        if len(paragraph_ids) != len(set(paragraph_ids)):
            raise ValueError("paragraph ids must be unique")
        citation_ids = [citation.id for citation in self.citations]
        if len(citation_ids) != len(set(citation_ids)):
            raise ValueError("citation ids must be unique")
        if len({citation.summary_source.corpus_sha256 for citation in self.citations}) > 1:
            raise ValueError("citations cannot mix summary corpus revisions")

        known_citation_ids = set(citation_ids)
        referenced_citation_ids = {
            citation_id for paragraph in self.paragraphs for citation_id in paragraph.citation_ids
        }
        if not referenced_citation_ids <= known_citation_ids:
            raise ValueError("paragraph citationIds must resolve within the response")
        if known_citation_ids != referenced_citation_ids:
            raise ValueError("every citation must support an answer paragraph")

        for citation in self.citations:
            if citation.campus_id != self.campus_id:
                raise ValueError("cross-campus citations are not allowed")

        if self.state == "no-results":
            if self.paragraphs or self.citations:
                raise ValueError("no-results responses cannot contain evidence")
            return self
        if not self.paragraphs or not self.citations:
            raise ValueError(f"{self.state} responses require evidence")

        if self.state == "answered" and any(
            citation.summary_freshness_state != FreshnessState.FRESH for citation in self.citations
        ):
            raise ValueError("answered responses may cite only FRESH evidence")
        if self.state == "stale" and any(
            citation.summary_freshness_state not in {FreshnessState.STALE, FreshnessState.EXPIRED}
            for citation in self.citations
        ):
            raise ValueError("stale responses may cite only STALE or EXPIRED evidence")
        if self.state == "conflict":
            if len(self.citations) < 2:
                raise ValueError("conflict responses require at least two citations")
            if len({citation.document_id for citation in self.citations}) < 2:
                raise ValueError("conflict responses require at least two distinct records")
            if len({citation.verification_link.source_id for citation in self.citations}) < 2:
                raise ValueError(
                    "conflict responses require at least two distinct verification links"
                )
            if len({citation.content_sha256 for citation in self.citations}) < 2:
                raise ValueError("conflict responses require genuinely different evidence")
        return self


class HealthResponse(StrictModel):
    status: Literal["ok", "disabled"]
    enabled: bool
    documents: Annotated[int, Field(ge=0)]
    corpus_sha256: Sha256 | None = Field(alias="corpusSha256")
