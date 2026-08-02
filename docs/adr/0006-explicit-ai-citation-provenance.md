# ADR 0006: Separate authored summaries from official verification links

- Status: accepted
- Date: 2026-08-02

## Context

The knowledge store has always kept two different source roles for each
retrievable record: an Apache-2.0 summary authored by this independent project
and a `DEEPLINK_ONLY` UMN page that a user can open to verify current details.
The first public citation contract flattened those roles. Its `sourceId` and
`sourceUrl` named the UMN page while its title, excerpt, hash, timestamp,
freshness, and review state described the project summary. Structurally strict
validators therefore certified a semantically false attribution.

An official link is not evidence that its page was fetched, that it contains the
returned excerpt, or that UMN authored or reviewed the summary. Preserving that
distinction is a trust-boundary requirement, not presentation metadata.

## Decision

Every non-empty AI citation carries two closed, role-specific provenance
objects:

- `summarySource` identifies the project-authored corpus, the exact
  `corpusSha256` snapshot revision, and its governed `OPEN_REUSE` Apache-2.0
  license evidence.
- `verificationLink` identifies the official UMN page as
  `verification-link-only`, retains `DEEPLINK_ONLY`, and requires
  `contentRetrieved: false`.

The citation separately exposes `documentId`, `contentSha256`, `excerpt`,
`updatedAt`, `summaryFreshnessState`, and `summaryVerificationState`. Those
fields describe only the project-authored record. The former ambiguous
`sourceId`, `sourceUrl`, `freshnessState`, and `verificationState` fields are
removed.

The current link-only contract permits only the `schematic` value for
`summaryVerificationState` on an active record. The repository has no governed campus-review
evidence artifact, so changing a metadata label to `campus-reviewed` or
`verified` must fail closed. A later contract may add those states only together
with reviewer identity, immutable review evidence, method, and timestamp.

The response remains fail-closed across Pydantic, Zod, OpenAPI, the generated
SDK, Core, the Web BFF, and the browser. A source registry is retained in every
file- and PostgreSQL-backed retrieval snapshot, so citation provenance is
resolved from governed source rows rather than reconstructed from constants.
The two backends must produce the same wire semantics.

Conflict responses require distinct authored document IDs, distinct official
verification-link IDs, and distinct authored content hashes. Sharing the one
project corpus source is expected and is not treated as independent authorship.
The evaluation gate ranks relevant authored document IDs and independently
checks exact summary-source and verification-link bindings.

The UI labels current records as project-authored summaries, displays an
independent-project and not-UMN disclosure before answer text, and presents the
UMN URL only as a page to open for verification. Summary age and summary review
state are never labeled as properties of the linked official page. Schematic
records use neutral or warning treatment rather than a verified-success claim.

This is an intentional in-place correction while the repository and API are at
version 0.1.0 and have no supported production consumers. Compatibility aliases
were rejected because they would preserve the precise attribution defect being
removed. A future supported breaking wire change must use an explicit versioned
migration and usage-based deprecation window.

## Consequences

Consumers can determine who authored the returned text, what artifact its hash
binds to, which license applies, and whether the official page was actually
retrieved. The contract cannot represent a link-only UMN page as observed
evidence because observation fields are absent and `contentRetrieved` is a
literal false value.

The current mode still does not verify a summary against live official content.
Adding observed official evidence requires a separately governed ingestion and
observation model with immutable fetch metadata, licensing authorization,
freshness, assessment method, and deletion handling. It must not overload the
link-only object.

## Rejected alternatives

- Keep the flat fields and explain them in documentation: machines and users
  would still receive a mixed-provenance object.
- Add deprecated flat aliases beside the new objects: strict old clients would
  reject the additive fields, while new implementations could keep using the
  misleading aliases.
- Copy or fetch the linked UMN page to justify the old attribution: public
  access does not grant reuse permission, and no reviewed ingestion pipeline
  currently exists.
- Store the summary source URL on every document: the normalized governed
  source registry is the authority and avoids duplicated, divergent metadata.
