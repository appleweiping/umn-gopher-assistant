from __future__ import annotations

import hashlib
import hmac
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
_MAX_PROJECTION_BYTES = 16 * 1024 * 1024

PROJECTION_METADATA_SQL = r"""
WITH source_projection AS (
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_array(
          external_id, campus_ids::text[], role::text, source_url,
          license_status::text, license_evidence_url, enabled,
          to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        ) ORDER BY external_id
      ),
      '[]'::jsonb
    ) AS rows,
    count(*)::integer AS row_count
  FROM knowledge_sources
), document_projection AS (
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_array(
          id::text, external_id, summary_source_id, verification_source_id,
          campus_id::text, category::text, title_en, title_zh_cn, body_en, body_zh_cn,
          keywords_en, keywords_zh_cn, content_hash, fresh_for_days,
          freshness_state::text, verification_state::text, conflict_group,
          conflict_variant, enabled,
          to_char(reviewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          CASE WHEN retired_at IS NULL THEN NULL ELSE
            to_char(retired_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
          to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        ) ORDER BY external_id, id
      ),
      '[]'::jsonb
    ) AS rows,
    count(*)::integer AS row_count
  FROM knowledge_documents
), chunk_projection AS (
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_array(
          id::text, document_id::text, locale::text, ordinal, content, content_hash,
          token_count, search_vector::text, embedding::text,
          to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        ) ORDER BY document_id, locale, ordinal, id
      ),
      '[]'::jsonb
    ) AS rows,
    count(*)::integer AS row_count
  FROM knowledge_chunks
), citation_projection AS (
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_array(
          id::text, citation_key, document_id::text, chunk_id::text, excerpt, content_hash,
          to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        ) ORDER BY citation_key, id
      ),
      '[]'::jsonb
    ) AS rows,
    count(*)::integer AS row_count
  FROM knowledge_citations
)
SELECT
  jsonb_build_object(
    'schemaVersion', 1,
    'sources', source_projection.rows,
    'documents', document_projection.rows,
    'chunks', chunk_projection.rows,
    'citations', citation_projection.rows
  )::text AS projection_payload,
  source_projection.row_count AS projection_sources,
  document_projection.row_count AS projection_documents,
  chunk_projection.row_count AS projection_chunks,
  citation_projection.row_count AS projection_citations
FROM source_projection, document_projection, chunk_projection, citation_projection
"""


class ProjectionIntegrityError(RuntimeError):
    """The committed projection cannot be proven to match its ingestion revision."""


@dataclass(frozen=True, slots=True)
class ProjectionMetadata:
    sha256: str
    sources: int
    documents: int
    chunks: int
    citations: int

    @classmethod
    def from_ingestion(cls, row: Mapping[str, Any]) -> ProjectionMetadata:
        sha256 = row.get("projection_sha256")
        counts = [
            row.get("projection_sources"),
            row.get("projection_documents"),
            row.get("projection_chunks"),
            row.get("projection_citations"),
        ]
        if not isinstance(sha256, str) or _SHA256_RE.fullmatch(sha256) is None:
            raise ProjectionIntegrityError("knowledge ingestion projection metadata is invalid")
        if any(
            not isinstance(value, int) or isinstance(value, bool) or value < 0 for value in counts
        ):
            raise ProjectionIntegrityError("knowledge ingestion projection metadata is invalid")
        return cls(sha256, *counts)  # type: ignore[arg-type]


def calculate_projection_metadata(connection: Any) -> ProjectionMetadata:
    row = connection.execute(PROJECTION_METADATA_SQL).fetchone()
    if row is None:
        raise ProjectionIntegrityError("knowledge projection metadata is unavailable")
    payload = row.get("projection_payload")
    counts = [
        row.get("projection_sources"),
        row.get("projection_documents"),
        row.get("projection_chunks"),
        row.get("projection_citations"),
    ]
    if not isinstance(payload, str) or not payload:
        raise ProjectionIntegrityError("knowledge projection payload is invalid")
    encoded = payload.encode("utf-8")
    if len(encoded) > _MAX_PROJECTION_BYTES:
        raise ProjectionIntegrityError("knowledge projection payload is invalid")
    if any(not isinstance(value, int) or isinstance(value, bool) or value < 0 for value in counts):
        raise ProjectionIntegrityError("knowledge projection counts are invalid")
    return ProjectionMetadata(hashlib.sha256(encoded).hexdigest(), *counts)  # type: ignore[arg-type]


def verify_projection_metadata(connection: Any, ingestion: Mapping[str, Any]) -> ProjectionMetadata:
    expected = ProjectionMetadata.from_ingestion(ingestion)
    actual = calculate_projection_metadata(connection)
    if (
        not hmac.compare_digest(actual.sha256, expected.sha256)
        or actual.sources != expected.sources
        or actual.documents != expected.documents
        or actual.chunks != expected.chunks
        or actual.citations != expected.citations
    ):
        raise ProjectionIntegrityError("knowledge projection does not match its ingestion revision")
    return actual
