# ADR 0004: Evidence-gated live public catalog

- **Status:** Accepted
- **Date:** 2026-07-22
- **Deciders:** UMN Gopher Assistant maintainers
- **Decision scope:** Public academic-session and campus-event integrations

## Context

The first useful public catalog needs academic session dates for all five
campuses and public events for Twin Cities and Duluth. The University publishes
a Sessions API and event-calendar feed builders, but public reachability alone
does not establish a right to mirror, translate, index, or redistribute their
content. The Sessions service is also too large and slow when queried without a
term filter, while the event feeds are paginated and can change between page
requests.

The UI must therefore distinguish a live view from a cached catalog, expose
partial coverage, and remain useful when a source is unavailable. Operational
health evidence must not become a hidden content archive.

## Decision

Register these integrations as `LIVE_ONLY` with `NO_CONTENT_CACHE`:

- UMN Sessions for Twin Cities, Duluth, Crookston, Morris, and Rochester;
- Twin Cities Events Calendar JSON; and
- Duluth Events Calendar JSON.

Rochester uses the documented `UMNTC` academic institution mapping. The
project does not invent an institution code for Rochester. Crookston and
Rochester event pages remain deep links, and the Morris event connector remains
disabled pending a separate approval record.

Each enabled live source must have all of the following:

- an accountable owner and runtime kill-switch key;
- an HTTPS page showing the reviewed access mechanism;
- a review timestamp and explicit expiry no more than 366 days later;
- a field allowlist, parser version, campus scope, and data classification; and
- a human-readable official fallback URL.

The access evidence records why a transient request is enabled. It is not an
open-content license or proof of an institutional partnership. The registry
continues to report `UNVERIFIED` official status and makes no `OPEN_REUSE`
claim.

### Request boundary

The integration worker applies a fixed target allowlist before invoking the
network transport. It permits HTTPS only, exact origins and paths, canonical
bounded query values, no credentials, no fragments, and no redirects. It also
enforces a deadline, streamed response-size limit, per-source concurrency and
queue limits, request coalescing, rate protection, and a circuit breaker.
The initial fail-safe budget is two running and thirty-two queued distinct
operations per upstream endpoint (so all five campus views of
`sessions.umn.edu` share one budget); queued work expires after two seconds, before the web
proxy's fifteen-second deadline. No more than thirty upstream starts are
allowed in a rolling minute. Three consecutive failures open that source for sixty seconds. Each
upstream response is limited to 2 MiB and twelve seconds; these bounds are
protective defaults, not a promised publisher quota, and may only be changed
after an operational and terms review.

Sessions requests must contain one to three explicitly reviewed term IDs. An
unfiltered request for the complete historical Sessions collection is
forbidden. Date ranges outside the reviewed routing table fail closed with a
human-readable official fallback instead of a guessed term code or partial
success.

Event requests use upstream pagination. A public API response fetches only the
minimum bounded number of upstream pages required for that response. The
HMAC-authenticated opaque cursor binds the campus, date range, upstream page,
offset, cumulative accepted traversal bytes, and observed page digest. It does
not claim a durable cross-request snapshot. Coverage
metadata states the source totals, fetched pages, policy limits, and whether
the live view was truncated.

The 8 MiB event traversal budget limits pages accepted into a cursor chain,
not bytes placed on the wire: the first independently 2 MiB-capped page that
crosses the remaining budget is observed and discarded, and no successor
cursor is issued. This distinction avoids claiming a transport-level aggregate
cap that cannot be known before a live response is streamed.

### Provenance and retention

Every upstream response body gets its own SHA-256 observation. A multi-page
response returns multiple observations and binds each item to the observation
that produced it. A hash of hashes must never be labelled as a raw-response
hash.

Raw bodies and normalized records exist only for the active request and are
discarded afterward. The service may retain bounded operational observations:
source ID, campus, outcome, HTTP status, byte length, raw digest, parser
version, timing, record counts, and failure code. It must not retain source
text, event descriptions, session records, or derived search/AI artifacts.

`Cache-Control: no-store` applies at both API and web proxy boundaries. ETags
are response validators, not permission to retain upstream content. The PWA
service worker never intercepts `/api/` or `/v1/` catalog requests.

### User-visible behavior

The web application shows observed time, source, freshness, live-view coverage,
and an unverified/independent label. A timeout, expired review, disabled switch,
schema change, unsupported campus feed, or exhausted circuit returns an RFC
9457 problem and the reviewed human fallback. It never substitutes authored
weather, class, event, or freshness claims.

## Consequences

- Live catalog latency depends on the publisher and is measured separately
  from database-backed API latency objectives.
- No offline event or session catalog is promised under `LIVE_ONLY`.
- Historical or far-future session ranges can remain unavailable until their
  term mappings are reviewed.
- Pagination can return `410 Gone` when the observed live page changes between
  cursor requests.
- Search, translation, summarization, embeddings, and AI use require separate
  rights because they create derived copies.
- Operators must renew the source review before expiry or the connector stops
  automatically.

## Alternatives considered

### Cache normalized public records for speed

- **Rejected:** No reviewed redistribution or derived-data permission is
  bundled. Technical convenience cannot upgrade `LIVE_ONLY` to reusable data.

### Fetch the complete Sessions collection

- **Rejected:** It is unnecessarily large, slow, and broader than the user
  request. Bounded term filters provide a smaller, auditable data path.

### Aggregate multi-page hashes into one raw hash

- **Rejected:** The result would not be the SHA-256 of any source response and
  would make provenance misleading.

### Treat a live multi-page feed as an immutable snapshot

- **Rejected:** The publisher provides no snapshot token. Cursor and coverage
  semantics must describe the observed live pages honestly.
