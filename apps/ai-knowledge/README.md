# AI Knowledge Retrieval Service

This service is the no-key, evidence-first retrieval boundary for UMN Gopher Assistant. It does not call a language model, fetch linked pages, read the encrypted personal vault, or ingest content from the current `LIVE_ONLY` and `DEEPLINK_ONLY` campus adapters. Its answer paragraphs are extracted from project-owned Apache-2.0 bilingual summaries and every paragraph cites the exact project-authored record used.

## Trust boundary

- `POST /v1/query` accepts only `campusId`, `locale`, and a 2–500 character query. Pydantic models reject unknown fields, HTML, encoded HTML, control/format characters, invalid Unicode, and unsupported campus or locale values.
- `POST /v1/query` is private and requires a fresh Core-service HMAC over the exact canonical value `POST\n/v1/query\n<bodySha256>\n<traceId>\n<timestamp>\n<nonce>`. The nonce is a fresh unpredictable 128-bit canonical base64url value for every attempt. Missing, malformed, stale, replayed, nonce-reused, or body-mismatched requests return one generic HTTP 401. `GET /healthz` remains unauthenticated for orchestration.
- Retrieval filters by campus **before** scoring. A candidate must first clear an absolute, explainable evidence gate using topical title/category/keyword anchors, supporting body terms, and query coverage. BM25-style lexical and deterministic character n-gram scores rank only accepted candidates; weak incidental overlap returns `no-results`.
- The corpus loader rejects invalid UTF-8, duplicate JSON keys, oversized files, non-UMN or non-HTTPS verification links, malformed timestamps, duplicate identifiers, and any per-record content hash mismatch. Every document must resolve both a project-summary descriptor and a separate official-verification descriptor.
- The PostgreSQL loader uses a repeatable-read, read-only transaction and validates the two governed source joins plus each citation's chunk, document, locale, and campus association before exposing the snapshot. A missing, disabled, wrong-role, wrong-license, cross-campus, or URL-mismatched source invalidates the entire revision.
- Citations expose the governed project summary and official verification link as separate objects. Official links are verification entrances only: the linked pages are neither fetched nor embedded, and `contentRetrieved` is always `false`. `summaryVerificationState: schematic` makes clear that current project-authored summaries have not been approved by a campus.
- `enabled: false`, `verificationState: retired`, or a non-null `deletedAt` removes a record on the next valid file reload. An invalid changed corpus fails closed instead of serving the prior snapshot.
- A failed database synchronization becomes the latest ingestion revision, so database-backed reads fail closed instead of silently serving the older revision.
- `AI_KNOWLEDGE_ENABLED=false` is a runtime kill switch. Unknown switch values also fail closed.
- The service does not log request query text, SQL, `DATABASE_URL`, or driver exceptions.

## Storage backends

`AI_KNOWLEDGE_BACKEND` accepts `postgres` or `file`.

- Production (`NODE_ENV=production`) always requires the PostgreSQL backend, `AI_KNOWLEDGE_SERVICE_HMAC_KEY`, and a `DATABASE_URL` with `sslmode=require`, `verify-ca`, or `verify-full`. Startup configuration fails if any is missing; there is no JSON fallback.
- Development and test may explicitly set `AI_KNOWLEDGE_BACKEND=file`. `AI_KNOWLEDGE_CORPUS_PATH` selects a reviewed JSON artifact.
- PostgreSQL 17 with the `vector` extension and the current knowledge migration is required for the persistent backend. The migration seeds canonical campus identities; the importer still verifies all five before writing.
- Production reads use a bounded Psycopg connection pool. A lightweight latest-ingestion probe is cached for 1 second by default; the fully validated snapshot is reused for at most 30 seconds and is immediately rebuilt when the observed revision changes. Every full load recomputes a bounded digest and row counts over the complete source/document/chunk/citation projection, so deletion or tampering fails closed no later than the snapshot TTL. Concurrent cold reads share one loader, and a failed latest revision clears the cached snapshot.

Pool and cache bounds are configurable with `AI_KNOWLEDGE_DATABASE_POOL_MIN_SIZE`, `AI_KNOWLEDGE_DATABASE_POOL_MAX_SIZE`, `AI_KNOWLEDGE_DATABASE_POOL_WAIT_SECONDS`, `AI_KNOWLEDGE_SNAPSHOT_CACHE_TTL_SECONDS`, and `AI_KNOWLEDGE_REVISION_CHECK_INTERVAL_SECONDS`. Invalid, unbounded, or internally inconsistent values fail startup configuration.

`knowledge_sources` stores one project-authored summary identity and 25 independent official verification-link identities. Each row has an `enabled` kill switch, campus scope, role, URL, license state, and license evidence. `knowledge_documents` keeps separate foreign keys to the summary and verification sources; it never assigns Apache-2.0 to an official UMN page.

The schema includes nullable `vector(384)` storage for a future, separately reviewed embedding pipeline. This service writes `NULL` embeddings, does not execute an HNSW/vector query, and reports `retrieval.mode: no-key-hybrid`. Its production retrieval remains the same deterministic in-process lexical/character-ngram hybrid used by the file backend. The presence of pgvector is a storage capability, not a claim that vector search is enabled.

## Local development

Python 3.13 is the production baseline; Python 3.14 is accepted for local verification.

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install --require-hashes -r requirements-dev.txt
pytest
AI_KNOWLEDGE_BACKEND=file NODE_ENV=development python -m uvicorn ai_knowledge.app:app --host 127.0.0.1 --port 8081
```

On PowerShell, activate with `.venv\Scripts\Activate.ps1`.

```powershell
$env:NODE_ENV = "development"
$env:AI_KNOWLEDGE_BACKEND = "file"
python -m uvicorn ai_knowledge.app:app --host 127.0.0.1 --port 8081
```

Local Core and retrieval processes use the same fixed development-only HMAC key. Exercise queries through the Core API; do not expose the retrieval port as a browser-facing endpoint. Shared environments must inject one independently generated canonical base64url key (32–64 bytes) as `API_AI_KNOWLEDGE_HMAC_KEY` in Core and `AI_KNOWLEDGE_SERVICE_HMAC_KEY` here.

## Endpoints

- `GET /healthz` verifies the selected corpus revision and reports its SHA-256 without exposing paths, content, or connection details. It returns HTTP 503 when retrieval is disabled or the current revision cannot be verified.
- `POST /v1/query` returns `answered`, `stale`, `conflict`, or `no-results`. `stale` is derived only from project-summary timestamps. Each citation binds `documentId`, `summarySource`, and `verificationLink` without attributing summary text or freshness to the linked page. `conflict` is emitted only when selected records explicitly share a conflict group with different variants.

The timestamp acceptance window is 60 seconds. An instance rejects either a previously seen valid signature or a previously seen valid nonce during that window, but replay state is intentionally process-local: a captured request can still be replayed against a different replica or after restart until it expires. The endpoint is read-only, production transport is TLS, and Core applies distributed rate limiting; deployments requiring global nonce semantics must add a shared replay store before widening this boundary.

Validation and operational failures use `application/problem+json`. Request bodies are capped at 8 KiB before validation. No query text is logged by this service.

## Corpus governance

[`ai_knowledge/data/corpus.json`](./ai_knowledge/data/corpus.json) is packaged with the service and contains at least one original bilingual record for each combination of five campuses and the categories `library`, `student-services`, `safety`, `transportation`, and `dining`. The summaries intentionally avoid volatile operational claims and direct users to official UMN pages for current details.

The release artifact contains a bounded `sourceRegistry`. `uga-ai-summary-corpus-v1` is the only `OPEN_REUSE` source and identifies this repository's original summary artifact. The 25 `official-*` identities are `DEEPLINK_ONLY`, have no license-evidence field, and are never ingested. [`packages/config/data/sources.json`](../../packages/config/data/sources.json) is the platform registry of record; tests require its AI subset to match the packaged registry exactly.

To change a record:

1. Edit only the project-authored title, summary, keywords, or lifecycle metadata.
2. Verify the official `https://*.umn.edu` link without copying its body, and keep its `DEEPLINK_ONLY` source descriptor distinct from the `OPEN_REUSE` summary descriptor.
3. Recalculate `contentSha256` over the documented canonical JSON fields: `id`, `campusId`, `category`, `title`, and `content`, with recursively sorted keys, compact separators, and UTF-8 encoding.
4. Run the full test suite. A changed document with an old hash is intentionally unavailable.

The repository Apache-2.0 license applies to the original summaries. A link does not grant reuse rights to the linked page, and no such rights are asserted here.

## Retrieval quality release gate

[`ai_knowledge/data/retrieval-eval-v1.json`](./ai_knowledge/data/retrieval-eval-v1.json)
is a versioned, corpus-hash-bound evaluation set. Its schema requires at least
150 unique cases, two supported paraphrases in every campus/locale/category
cell, and five abstention cases in every campus/locale segment. The shipped v1
set contains supported, unsupported, ambiguous, hard-negative, and reproduced
false-positive cases in English and Simplified Chinese.

Run the deterministic gate from this directory:

```bash
python -m ai_knowledge.evaluation
```

The gate measures answer precision, supported-query recall, top-1 category
accuracy, mean reciprocal rank, abstention recall, campus leakage, and complete
evidence-graph integrity globally and for every campus and locale. The v1
thresholds require perfect results and zero leakage. Answering any critical
hard-negative or reproduced false-positive case is also an independent failure,
even if aggregate thresholds are changed later.

Output contains only dataset/corpus hashes, aggregate metrics, and failing case
identifiers/categories; raw query text is never emitted. A corpus change must
update and re-review the evaluation dataset's corpus hash and expectations. A
retrieval change must pass this gate before corpus synchronization or release.
`pnpm evaluate:ai`, `pnpm verify:python`, and CI run the same command.

## PostgreSQL synchronization

Apply the platform migrations first, then run the idempotent importer with the same production database configuration used by the service:

```bash
NODE_ENV=production \
AI_KNOWLEDGE_BACKEND=postgres \
AI_KNOWLEDGE_SERVICE_HMAC_KEY='<canonical-base64url-secret>' \
DATABASE_URL='postgresql://...?sslmode=verify-full' \
python -m ai_knowledge.sync
```

The command never accepts a database URL on the command line, avoiding process-list disclosure. It validates the full release artifact before connecting, verifies PostgreSQL 17, pgvector, source-governance columns, nullable embedding storage, and all canonical campuses, then acquires a transaction-scoped advisory lock. A prevalidation failure records a content-hashed failed ingestion with zero trusted documents; because the loader requires the latest ingestion to be successful, already-running services stop serving the older snapshot after the bounded revision-check interval. It atomically upserts the 26 governed sources before their documents and removes source identities no longer present after dependent documents are updated. Document UUIDs and unchanged chunk/citation rows remain stable across identical runs. Content changes clear any old embedding; citations are replaced with delete-and-insert because the database makes evidence projections immutable. Missing or `deletedAt` documents are physically deleted with cascading evidence cleanup. Disabled or retired documents remain as non-retrievable retirement records.

The command prints only the corpus hash, counts, and `vectorSearchEnabled: false`. Errors are deliberately generic and never echo SQL, query text, or credentials.

The real-database smoke test is opt-in and expects a disposable, already-migrated
PostgreSQL 17 database. The caller owns that database's lifecycle:

```bash
AI_KNOWLEDGE_INTEGRATION_DATABASE_URL='postgresql://...' \
python -m pytest tests/test_postgres_integration.py --no-cov
```

## Container

The Docker image uses Python 3.13, installs only pinned runtime dependencies, and runs as numeric UID/GID `10001`.

```bash
docker build -t umn-gopher-ai-knowledge .
docker run --rm -p 127.0.0.1:8081:8081 umn-gopher-ai-knowledge
```

For the explicit development file backend, mount a reviewed corpus read-only and set `AI_KNOWLEDGE_CORPUS_PATH`. Production containers must receive `DATABASE_URL` through the platform secret mechanism and use `AI_KNOWLEDGE_BACKEND=postgres`; do not mount private vault data or provider keys into this container.
