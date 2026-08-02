# Campus knowledge operations

This runbook operates the implemented public, no-key campus retrieval path. It is independent and unofficial, contains only project-authored summaries, and must not be used as emergency, registration, payment, accessibility, or safety-critical authority.

## Runtime modes

| Environment      | Backend    | Required settings                                                         | Intended use                        |
| ---------------- | ---------- | ------------------------------------------------------------------------- | ----------------------------------- |
| development/test | `file`     | reviewed `AI_KNOWLEDGE_CORPUS_PATH`                                       | deterministic local development     |
| development/test | `postgres` | `DATABASE_URL`                                                            | persistence and integration testing |
| production       | `postgres` | production mode, service HMAC key, and TLS-enforced secret `DATABASE_URL` | supported production mode           |

Production configuration fails at startup if it would fall back to the file backend, if `AI_KNOWLEDGE_SERVICE_HMAC_KEY` is absent or malformed, or if PostgreSQL `sslmode` is absent/`disable`/`allow`/`prefer`. Use `require`, `verify-ca`, or preferably `verify-full`. Do not put a database URL on a command line, in Git, or in a support transcript. Local Compose is explicitly `NODE_ENV=development` with the PostgreSQL backend; it does not impersonate production to bypass TLS policy.

## Retrieval quality gate

Every corpus or retrieval release must pass the corpus-bound bilingual quality
gate before synchronization:

```powershell
Push-Location apps/ai-knowledge
python -m ai_knowledge.evaluation
Pop-Location
```

The versioned dataset contains at least 150 cases and enforces coverage across
all five campuses, both locales, and all five implemented categories. It reports
answer precision, supported recall, top-1 category accuracy, mean reciprocal
rank, abstention recall, campus leakage, and evidence integrity globally and by
campus/locale. Shipped thresholds require perfect results, zero leakage, and
zero answered hard-negative or reproduced false-positive cases. Reports expose
case identifiers but never raw query text.

The dataset records the exact corpus SHA-256. Treat a mismatch as a required
joint review, not a value to update mechanically: confirm every affected
expectation, expand the cases for new user language and failure modes, then
review the new dataset version. CI and `pnpm verify:python` enforce the same
gate. Supported-case relevance is keyed by authored `documentId`, never by the
official verification-link source ID; the gate checks the two source roles
independently.

## Release a corpus revision

1. Review every changed summary, bilingual title and keyword set, official verification link, campus, lifecycle field, and content SHA-256.
2. Confirm the artifact remains `provenance: project-authored-summaries`, `summaryContentLicense: Apache-2.0`, and `sourcePolicy: official-links-are-verification-only`. Active records must remain `schematic`; campus-review or verification labels require a future governed review-evidence model and must fail this release path.
3. Compare `sourceRegistry` with the AI subset of `packages/config/data/sources.json`: the project summary must be enabled `OPEN_REUSE`; every UMN link must be a separately enabled `DEEPLINK_ONLY` descriptor with no reuse-license evidence.
4. Run the retrieval quality gate above and require a passing global and segmented report with zero critical-safety failures.
5. Apply database migrations and verify PostgreSQL 17 plus pgvector.
6. Run the transactional importer:

   ```powershell
   $env:NODE_ENV = "production"
   $env:AI_KNOWLEDGE_BACKEND = "postgres"
   $env:AI_KNOWLEDGE_SERVICE_HMAC_KEY = "<canonical-base64url-secret>"
   $env:DATABASE_URL = "<secret PostgreSQL URL with sslmode=verify-full>"
   python -m ai_knowledge.sync
   ```

7. Accept only the bounded JSON summary containing the corpus hash, seen/indexed/retired counts, and `vectorSearchEnabled: false`.
8. Check `/healthz`; then query one English and one Chinese record for every campus. Verify the visible campus, authored `documentId`, project `summarySource`, summary freshness and review state, link-only official `verificationLink`, and paragraph citation. Reject any response that attributes the excerpt or content hash to the official page.

The importer validates the entire artifact before connecting, acquires a transaction-scoped advisory lock, and preserves unchanged document, chunk, and citation identities. A changed citation is deleted and inserted because the database rejects citation updates. A missing or deleted document is physically removed with cascading evidence deletion.

## Health and failure behavior

`GET /healthz` validates the selected snapshot. A database-backed service returns unavailable when:

- PostgreSQL is unreachable or not version 17;
- pgvector or required columns are missing;
- no successful ingestion exists;
- the latest ingestion failed;
- a summary or verification source is missing, disabled, assigned the wrong role/license, or outside its campus scope;
- active documents, chunks, citations, campus associations, hashes, or lifecycle fields disagree; or
- the operator kill switch is disabled or invalid.

Unavailable and disabled health checks return HTTP 503. The database reader uses a bounded connection pool, a cheap 1-second ingestion-row probe, and a 30-second full-snapshot TTL by default. Full loads recompute SHA-256 plus counts over every source, document, chunk, and citation row; row deletion or tampering therefore invalidates a new repository immediately and a warm cache within 30 seconds. A changed or failed latest ingestion invalidates the cache sooner; concurrent reloads are single-flight. Tune only within the validated bounds via `AI_KNOWLEDGE_DATABASE_POOL_MIN_SIZE`, `AI_KNOWLEDGE_DATABASE_POOL_MAX_SIZE`, `AI_KNOWLEDGE_DATABASE_POOL_WAIT_SECONDS`, `AI_KNOWLEDGE_SNAPSHOT_CACHE_TTL_SECONDS`, and `AI_KNOWLEDGE_REVISION_CHECK_INTERVAL_SECONDS`.

Core signs every private query with `API_AI_KNOWLEDGE_HMAC_KEY`; retrieval verifies the same bytes from `AI_KNOWLEDGE_SERVICE_HMAC_KEY` using constant-time comparison. The exact canonical value is `POST\n/v1/query\n<bodySha256>\n<traceId>\n<timestamp>\n<nonce>`. Core generates a fresh unpredictable 128-bit canonical base64url nonce for every attempt. Retrieval rejects a previously seen valid signature or nonce within that process, and rejects timestamps older/newer than 60 seconds. Replay memory is not shared across replicas and is lost on restart, so TLS plus the short window and Core distributed rate limiter remain part of this read-only boundary; do not represent it as a globally durable nonce system.

If artifact prevalidation fails, the importer does not trust a document count or mutate knowledge content. It records a failed ingestion with zero documents and a SHA-256 audit key (or a fixed non-sensitive sentinel hash when the artifact cannot safely be read). Never delete that failed run to make the previous release appear current; fix or roll back the artifact and synchronize a new successful revision.

The service does not return the connection string, SQL, driver exception, corpus path, or query text. It also never claims to have retrieved a link-only official page. Preserve the public `traceId`, a timestamp, deployment revision, stable operational event codes, and infrastructure metrics when escalating an incident.

## Rollback

Corpus rollback is a new reviewed release, not a database restore or manual row edit:

1. Restore the prior reviewed `corpus.json` from Git history on a new branch.
2. Re-run all corpus, retrieval, contract, security, and database integration tests.
3. Synchronize it as a new ingestion revision.
4. Verify `/healthz` and bilingual campus samples.

Never update `knowledge_citations` directly; an immutable trigger rejects it. Do not mark a failed ingestion as succeeded by hand. Database restore is reserved for disaster recovery and must replay all later deletion and retirement obligations before traffic resumes.

## Kill switch and containment

Set `AI_KNOWLEDGE_ENABLED=false` and restart/roll the service to stop queries while retaining evidence for investigation. Invalid values also fail closed. Use the kill switch for suspected corpus poisoning, deletion-propagation failure, cross-campus evidence, incorrect freshness, or unsafe official links.

Redis failure at the API causes AI queries to fail closed because distributed anonymous abuse control is mandatory. `API_TRUSTED_PROXY_CIDRS` must list only actual ingress networks; the removed `TRUST_PROXY=true` shortcut is rejected at startup.

### Anonymous Web client buckets

The Web BFF assigns an opaque 128-bit anonymous session in a versioned, expiring cookie. The cookie is `HttpOnly`, `SameSite=Strict`, scoped to `Path=/api/ai`, and `Secure` in production. Missing, expired, malformed, duplicated, or incorrectly signed cookies are replaced on both successful and problem responses. The browser-provided `Cookie`, authorization, forwarding, ingress-assertion, and internal-proof headers are never copied to Core.

The production trusted edge strips and overwrites the three `X-Gopher-Ingress-AI-*` headers. It injects a short-lived HMAC assertion containing only an opaque 256-bit privacy-network token, never a raw IP address. The BFF accepts an assertion for at most 60 seconds and otherwise returns HTTP 503 in production. The token is expected to remain stable across cookie resets within the edge's bounded privacy policy; it is an abuse-control grouping, not an account, device fingerprint, or proof that users share a household. Development and test may use the explicit degraded session-derived network identity. In that mode clearing the cookie resets both identities, so it must not be used as evidence that production Sybil resistance works.

For each Core API call, the BFF replaces all internal AI headers and signs the session ID, privacy-network ID, request `traceId`, and a 30-second expiry. Core verifies the proof with a constant-time MAC comparison. A valid proof selects separate stable client and network buckets. A missing, expired, malformed, trace-mismatched, or incorrectly signed proof falls back to separately domain-separated client and network pseudonyms of the socket IP; arbitrary `X-Forwarded-For` remains untrusted. The proof has no one-time store: an exact proof replayed with the same trace and before expiry still verifies and is charged to the same quota identities. Reusing it with another trace fails verification; do not claim that all proof replay falls back.

One atomic Redis script enforces client, network, and global fixed-window buckets (defaults 12, 120, and 600). It checks them in that order, so a request already over its client limit does not consume network/global capacity, and one over its network limit does not consume global capacity. Clearing a production browser cookie changes only the client bucket while the trusted edge token continues to charge the same network bucket. Redis failure fails closed.

Generate and secret-inject four independent values; never print them or reuse another service key:

- `GOPHER_AI_SESSION_COOKIE_HMAC_KEY`: Web BFF only;
- `GOPHER_AI_INGRESS_ASSERTION_HMAC_KEY`: the same shared value in the trusted edge and Web BFF;
- `INTERNAL_AI_BFF_PROOF_HMAC_KEY`: the same shared value in Web BFF and Core API; and
- `API_AI_RATE_LIMIT_HMAC_KEY`: Core-only, domain-separated pseudonymization of client and network buckets.

Each value is canonical base64url encoding of 32 through 64 random bytes. Production fails closed when a required value is missing, weak, or malformed. Components that load multiple keys also reject local key reuse; deployment policy and secret-manager controls must keep all four purposes independent across components. Rotating the cookie key intentionally replaces existing anonymous cookies. Rotate the ingress key on edge and Web, and the BFF proof key on Web and Core, as coordinated deployments. An ingress/Web mismatch returns HTTP 503; a Web/Core mismatch falls back to the socket-IP identities and reduces fairness until corrected.

## Verification commands

From the repository root:

```powershell
python -m pip install --require-hashes --requirement apps/ai-knowledge/requirements-dev.txt
python -m ruff check apps/ai-knowledge
python -m ruff format --check apps/ai-knowledge
Push-Location apps/ai-knowledge
python -m ai_knowledge.evaluation
python -m pytest
Pop-Location
pnpm --filter @umn-gopher-assistant/contracts test
pnpm --filter @umn-gopher-assistant/sdk check:generated
pnpm --filter @umn-gopher-assistant/api test
pnpm --filter @umn-gopher-assistant/web test
pnpm smoke:db
```

The Compose-backed integration smoke additionally proves idempotent synchronization, database loading, cross-document citation rejection, citation immutability, generated search vectors, nullable embeddings, and physical cascade deletion.
