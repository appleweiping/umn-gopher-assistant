# ADR 0005: Evidence-first campus AI with a no-key retrieval baseline

- Status: accepted
- Date: 2026-07-23

## Context

A campus assistant can cause real harm when it presents stale, cross-campus, or invented guidance as fact. The first public AI surface must also work without a model-provider key and must not gain access to the encrypted personal vault. Linking to an official page establishes a verification path; it does not grant permission to copy that page into a corpus.

The platform already separates source license, freshness, verification, campus, and official-status metadata. The AI boundary must preserve those properties through storage, retrieval, API validation, generated clients, and presentation.

## Decision

The initial implemented AI mode is deterministic `no-key-hybrid` retrieval over project-authored Apache-2.0 bilingual summaries. It is not generative AI.

- Every non-empty paragraph cites one or more records returned in the same response.
- A citation is limited to the requested campus and an allowlisted credential-free `https://*.umn.edu` verification URL.
- `answered` uses only fresh evidence. Stale, conflicting, unknown-freshness, retired, and empty states cannot silently become an ordinary answer.
- Conflict requires at least two referenced records with different source IDs and content hashes.
- Queries are bounded NFC plain text. HTML, encoded HTML, control, format, and surrogate characters are rejected at both public and private boundaries.
- The browser uses a same-origin BFF. It does not forward cookies, bearer tokens, personal-vault data, or arbitrary upstream URLs. Production binds the BFF session to a trusted-edge HMAC assertion carrying an opaque privacy-network token.
- The API applies a streaming 8 KiB request limit, domain-separated HMAC pseudonyms, and an atomic Redis client/network/global limiter. Clearing the browser cookie does not reset the production network bucket. Redis failure fails closed.
- Core authenticates each private retrieval request with a body-bound HMAC containing a fresh 128-bit nonce; retrieval rejects same-process signature or nonce reuse within the 60-second clock window.
- The isolated Python service does not fetch official links, invoke a model, or log query text.
- Production requires PostgreSQL 17 and the PostgreSQL backend. The reviewed JSON backend is an explicit development/test mode only.
- Corpus synchronization is transactional and serialized. Deleted records cascade physically; retired records are excluded before ranking; failed revisions make reads unavailable instead of silently serving an older revision.
- pgvector storage is present for a future reviewed embedding pipeline, but embeddings are nullable and the current service neither writes nor queries vectors. The UI and telemetry must not claim vector search.

The OpenAPI response schema carries `x-uga-semantic-validator: ai-query-response-v1`. The SDK generator recognizes this reviewed extension and emits the same cross-field trust checks instead of validating only JSON shape.

BYOK and local-model controls remain visibly disabled until provider isolation, explicit consent, secret storage, egress policy, model-output validation, and privacy tests are implemented. Cloud models do not receive private-vault plaintext by default.

## Consequences

The first AI mode remains useful during provider outages and can be reproduced in CI without external inference. Its answers are intentionally narrower than a general chatbot and primarily direct users to the appropriate official service.

Operators must curate and release the bilingual corpus, run synchronization before serving a new revision, monitor ingestion state, and keep Redis and PostgreSQL available. A bad or failed release is visible as unavailability rather than stale success.

Adding embeddings or generation requires a new ADR and measured retrieval-quality, prompt-injection, privacy, deletion-propagation, licensing, and provider-failure evidence. Merely populating the vector column is not sufficient.

## Rejected alternatives

- A generic chat UI over a hosted model: no maintained evidence boundary and requires a provider secret.
- Scraping official pages into a corpus because they are public: public access is not reuse permission.
- Sending personal schedule or task plaintext to the service: violates the vault trust boundary.
- Serving the previous PostgreSQL revision after a failed import: conceals a deletion or retirement failure.
- Treating pgvector installation as evidence of semantic retrieval: storage capability does not establish a reviewed embedding pipeline.
