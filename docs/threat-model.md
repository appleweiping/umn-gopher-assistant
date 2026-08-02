# Threat Model

## Document status

This is the foundation threat model for UMN Gopher Assistant. It records launch
gates and required controls; it is not a certification or a claim that every
planned control is already deployed.

The project is independent and unofficial. It has no implicit trust relationship with University of Minnesota
systems. All current institutional-source official status is **UNVERIFIED**, connectors are disabled unless
explicitly approved, world geometry is **schematic**, and safety-critical routing is disabled.

Review this model before enabling a connector, authentication flow, persistent
community feature, AI provider, media workflow, or verified map or route.

## System in scope

- Next.js web application.
- NestJS/Fastify HTTP API.
- Shared schemas, campus/source configuration, and persistence package.
- PostgreSQL, PostGIS, and pgvector.
- Keycloak, Redis, NATS JetStream, Meilisearch, MinIO, LiveKit, and OpenBao when
  enabled in a deployment.
- External source adapters and model providers when separately approved.
- OpenAPI and AsyncAPI consumers.
- Browser, operator, contributor, and community-content workflows.

The initial API uses in-memory repositories for health, campus metadata, source
metadata, and schematic world manifests. Broader contract surfaces are included
because future implementation must not bypass this review.

## Security objectives

1. Do not imply University endorsement or official status.
2. Prevent unauthorized access to accounts, personal data, precise location,
   community content, recordings, and administrative functions.
3. Keep institutional and third-party credentials out of clients, logs,
   fixtures, repositories, and model prompts.
4. Preserve source, campus, license, freshness, and verification metadata.
5. Prevent untrusted source or community content from controlling the
   application or AI behavior.
6. Prevent schematic or stale data from becoming safety-critical guidance.
7. Maintain integrity and availability without treating search, cache, or event
   delivery as an authoritative data store.
8. Make privileged changes attributable and reversible.

## Assets

| Asset                                   | Why it matters                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| User identity and sessions              | Account takeover can expose private activity and impersonate users                     |
| Connector credentials                   | A leak can compromise University or vendor systems outside this project                |
| Personal and location data              | Misuse can create privacy, stalking, discrimination, and physical-safety harm          |
| Source and license metadata             | Losing provenance can cause misinformation and unauthorized redistribution             |
| Verification and official-status labels | Tampering can turn unofficial content into apparently authoritative guidance           |
| Map, route, and world data              | Incorrect geometry can cause accessibility or physical-safety harm                     |
| Community posts and reports             | Abuse can harass users, spread false information, or conceal malicious links           |
| Objects and media                       | Uploads and recordings can contain malware, copyrighted material, or sensitive content |
| API and event contracts                 | Incompatible or malicious payloads can corrupt downstream consumers                    |
| Audit records and kill switches         | Operators need trustworthy evidence and rapid containment                              |
| Availability                            | Users may wrongly rely on an incomplete or stale campus answer                         |

## Actors

- Anonymous visitor.
- Authenticated user.
- Community contributor or moderator.
- Project maintainer or deployment operator.
- Approved source publisher or connector service.
- Model, identity, media, storage, or search provider.
- Opportunistic attacker.
- Malicious or compromised account.
- Abusive insider with legitimate operator access.
- Supply-chain attacker controlling a dependency, image, action, or fixture.
- Content attacker placing prompt injection or malformed data in a source.

University affiliation must not be inferred from a username, email-shaped
string, source domain, or user claim.

## Trust boundaries

1. **Browser to web/API.** Browser state, headers, route parameters, uploads,
   and rendered content are untrusted.
2. **API to identity provider.** Tokens require issuer, audience, signature,
   time, and authorization validation.
3. **API to data and infrastructure.** Database, cache, search, object, event,
   and secret services require separate identities and network policy.
4. **Application to external sources.** Remote content, redirects, schemas,
   licenses, and availability can change without notice.
5. **Application to AI providers.** Prompts and retrieved records can disclose
   data; output is untrusted and non-authoritative.
6. **Transactional store to event consumers.** Delivery is asynchronous and may
   be duplicated, delayed, reordered, or replayed.
7. **Media participants to LiveKit/object storage.** Consent, room
   authorization, recording, and file handling cross privacy boundaries.
8. **Development to deployment.** Local default credentials and mock data must
   never cross into a production environment.
9. **Schematic to verified content.** Promotion requires evidence and human
   review, not a data-copy operation.

## Threats and required controls

### Identity, authentication, and authorization

| Threat                                              | Risk | Required controls                                                                                                                                                                                                                        |
| --------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forged, replayed, or confused-deputy token          | High | Validate access-token type, issuer, audience, signature, expiry, issued/not-before times, token ID, approved client, and strict lifetime; use sender-constrained tokens and durable replay/idempotency controls for consequential writes |
| Authorization based only on campus or UI state      | High | Enforce object- and action-level authorization in the API; a campus ID is routing context, not a role                                                                                                                                    |
| Privilege escalation through mutable profile claims | High | Map privileges from an operator-controlled policy; do not trust display names or self-asserted affiliation                                                                                                                               |
| Session theft or cross-site request forgery         | High | HttpOnly, Secure, SameSite cookies where used; CSRF defense for state changes; origin checks and session rotation                                                                                                                        |
| Overpowered service account                         | High | Separate least-privilege identities per component and connector; rotate, audit, and revoke                                                                                                                                               |

Keycloak in local Compose is a development identity service. It is not evidence
of University single sign-on approval.

Protected API routes reject Bearer fallback. They require a short-lived
`typ=at+jwt` access token whose `cnf.jkt` is bound to a fresh RFC 9449 DPoP
proof. The resource server validates the exact issuer, audience, approved
client, signature, lifetime, subject, token ID and scopes, then validates an
ES256 proof over the public JWK, canonical target URI, HTTP method, access-token
hash, issued time, proof ID and server nonce. A Redis Lua decision stores the
nonce and proof replay claim in the same per-subject cluster slot, applies a
subject-wide proof quota even when the client rotates keys, and fails closed if
Redis is unavailable. This sender constraint reduces bearer-token replay; it
does not make XSS, endpoint compromise, malicious software, or theft of both a
token and its private key harmless.

The browser BFF keeps its DPoP private key and refresh token in a sealed,
server-side session and serializes refresh rotation with a Redis lease and
compare-and-set. DPoP constrains the BFF-to-API hop; it does not convert the
browser session cookie into proof of possession or eliminate cookie theft and
CSRF controls. CLI credentials and the DPoP key remain in the operating-system
keychain. The public API process limits cryptographically valid proofs by
subject, but invalid-token and cross-subject volumetric abuse still require the
documented shared ingress rate limiter before production exposure.

Consequential personal-vault mutations additionally use signed commands,
strict optimistic parents, durable idempotency and encrypted read-back. Those
controls prevent accidental replay and stale overwrite, but they are not a
global transparency log and cannot prove that a malicious storage service has
not shown two clients different internally consistent histories.

Compose binds every published development port to `127.0.0.1`. Overriding
`COMPOSE_BIND_ADDRESS` to a non-loopback address is an explicit remote-exposure
opt-in and requires replacement credentials, a host firewall, and a reviewed
network boundary. Repository default credentials must never be reachable from a
shared or untrusted network.

### Secrets and connector abuse

| Threat                                                        | Risk           | Required controls                                                                                             |
| ------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------- |
| Credential committed to Git, fixture, image, or client bundle | Critical       | Secret scanning, code review, server-side use only, immediate rotation on exposure                            |
| Missing approval silently falls back to a shared credential   | Critical       | Fail closed; connector remains disabled without both approval evidence and a runtime secret                   |
| Server-side request forgery through source URL or redirect    | High           | Allowlisted schemes and hosts, DNS/IP checks, redirect limits, egress controls, response-size and time limits |
| Connector drains quota or harms source availability           | Medium to high | Rate and concurrency limits, conditional requests, backoff, circuit breaker, publisher requirements           |
| Unexpected response exfiltrates or poisons data               | High           | Versioned schema validation, content-type checks, field minimization, quarantine on drift                     |

OpenBao is the intended runtime secret store, but using it does not replace
least privilege, rotation, egress policy, or connector authorization.

### Source integrity, licensing, and provenance

| Threat                                                 | Risk                          | Required controls                                                                                             |
| ------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Public URL treated as a reuse license                  | High                          | Source registry and explicit license state; deep-link rather than copy when rights are unclear                |
| Attribution or campus scope lost during transformation | High                          | Immutable source ID on derived records; projection and API tests                                              |
| Stale information presented as current                 | High for safety-relevant data | Checked timestamp, freshness state, bounded cache, visible warning, official-source fallback                  |
| Verification label forged or over-broad                | High                          | Reviewer evidence, scope and version binding, audit log, restricted promotion permission                      |
| University styling implies endorsement                 | Medium to high                | Independent/unofficial notice, no unlicensed logos or trade dress, official status separate from verification |
| Derived translation or summary changes meaning         | Medium to high                | Retain source link, label derived text, review high-impact content, never translate into increased certainty  |

The full acceptance and incident rules are in the
[data source policy](data-source-policy.md).

### AI and retrieval

| Threat                                                                     | Risk                        | Required controls                                                                                                                                                                                                             |
| -------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt injection in a webpage, document, post, or metadata                 | High                        | Treat retrieved text as quoted data; separate instructions; allowlist tools; require authorization outside the model                                                                                                          |
| Retrieval crosses user or campus authorization boundary                    | High                        | Filter before retrieval, preserve access labels in indexes and embeddings, re-check before output                                                                                                                             |
| Model invents an official fact, route, deadline, or emergency instruction  | Critical in safety contexts | Grounding and citation, uncertainty, high-risk refusal, official-source handoff, no automated verification promotion                                                                                                          |
| Sensitive content sent to a model provider                                 | High                        | Data classification, minimization, approved provider and purpose, retention controls, secrets and protected data exclusion                                                                                                    |
| Tool call causes an unauthorized write                                     | High                        | Explicit action scope, server-side authorization, idempotency, preview/confirmation for consequential actions, audit trail                                                                                                    |
| Poisoned embeddings persist after source deletion                          | Medium to high              | Source-to-derivative index, deletion propagation, rebuildable indexes, retention testing                                                                                                                                      |
| Anonymous query bypasses or exhausts shared abuse controls                 | High                        | Signed HttpOnly BFF session, trusted-edge privacy-network assertion, session/network-bound internal proof, domain-separated socket-IP fallback, atomic client/network/global Redis limits, fail closed on Redis error         |
| Cookie reset creates unlimited anonymous identities                        | High                        | Clearing the cookie changes the client identity only; a trusted opaque network identity continues charging the network bucket, and the global bucket remains; explicitly document residual multi-network/botnet risk          |
| Browser forges an ingress or internal AI identity header                   | High                        | Edge strips/overwrites ingress headers, BFF replaces internal headers, independent per-purpose production keys, constant-time MAC checks, trace/session/network/expiry binding, production fails closed without ingress proof |
| A valid BFF proof is captured and replayed                                 | Medium                      | Thirty-second expiry and trace/session/network binding; the current proof is not one-time, so exact same-trace replay remains valid but is charged to the same three quota identities                                         |
| API and retrieval service disagree on accepted query or evidence semantics | High                        | Shared negative fixtures, NFC/plain-text rules, neutral handling of private 4xx drift, generated SDK semantic validation                                                                                                      |
| Citation points across a document or campus boundary                       | High                        | Composite database FK, loader consistency checks, filter-before-rank, cross-campus contract tests                                                                                                                             |

Model output is never a verification artifact and must not be treated as a
trusted instruction by another subsystem without validation.

The implemented initial AI mode does not call a model. It retrieves only
project-authored Apache-2.0 summaries, requires evidence for every paragraph,
and keeps the browser vault outside the service boundary. Production refuses a
file-corpus fallback and refuses to serve when the latest ingestion failed.

The privacy-network token is an opaque abuse-control grouping, not a raw IP,
account, device fingerprint, affiliation claim, or household assertion. It can
group unrelated users behind a shared network and cannot stop distributed
attackers using many networks. Development's session-derived network identity
is deliberately degraded and does not satisfy the production launch gate.

### Maps, routes, and physical safety

| Threat                                                                               | Risk     | Required controls                                                                                                |
| ------------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------- |
| Schematic geometry presented as an official or precise map                           | High     | Persistent schematic label, visual distinction, provenance, no official trade dress                              |
| Route ignores stairs, closures, construction, weather, or accessible entrance status | Critical | Feature disabled until the relevant data and freshness process are verified for the intended mobility profile    |
| Emergency question receives generated navigation or stale alert                      | Critical | Direct users to current official/emergency services; do not replace alerts, dispatch, or evacuation instructions |
| Sensitive facility detail enables harm                                               | High     | Exclude non-public rooms and infrastructure; safety review before indoor detail is published                     |
| Precise location enables stalking                                                    | High     | Opt-in, coarse/default minimization, short retention, access control, no public live-location index              |

No route can move from schematic to verified solely because it renders
successfully or matches another unverified map.

### Community content and moderation

| Threat                                         | Risk           | Required controls                                                                                    |
| ---------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| Harassment, hate, threats, or impersonation    | High           | Reporting, moderation queue, rate limits, evidence-preserving access controls, graduated enforcement |
| False official announcement                    | High           | Strong source labels, reserved official-status claims, anti-impersonation review                     |
| Malicious link, HTML, Markdown, or file        | High           | Safe rendering, URL policy, sanitization, malware scan, content-disposition controls                 |
| Mass posting, scraping, or voting manipulation | Medium to high | Per-identity/device limits, anomaly detection, pagination and export controls                        |
| Moderator abuses access to private reports     | High           | Least privilege, audit logs, separation of duties, retention limits                                  |

Community features are contract-only until identity, moderation, reporting,
retention, and operator ownership are implemented.

### Objects, media, and LiveKit

| Threat                               | Risk           | Required controls                                                                                          |
| ------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------- |
| Malware or polyglot upload           | High           | Size limits, type verification by content, malware scan, quarantine, random object names                   |
| Unlicensed or non-consensual content | High           | Contributor rights attestation, takedown path, consent and privacy controls                                |
| Unauthorized room join or recording  | Critical       | Short-lived scoped room tokens, server-side grants, visible recording state, explicit consent, audit trail |
| Object bucket exposed publicly       | High           | Private by default, scoped signed URLs, no directory listing, separate public publishing workflow          |
| Metadata leaks identity or location  | Medium to high | Strip unnecessary metadata and review before publishing                                                    |

LiveKit and MinIO being present in local infrastructure does not mean media or
recording features are enabled.

### Database, cache, search, and eventing

| Threat                                                  | Risk           | Required controls                                                                                  |
| ------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------- |
| Injection into SQL, geospatial, vector, or search query | High           | Parameterized APIs, schema validation, bounded query complexity, safe filter construction          |
| Cache leaks data across users or campuses               | High           | Authorization-aware keys, no caching of secrets, conservative private-response policy              |
| Search or vector index bypasses row authorization       | High           | Propagate access labels, filter before ranking, test delete and permission changes                 |
| Duplicate or reordered event repeats an action          | High           | Stable event ID, idempotent consumer, aggregate version, transactional outbox                      |
| Poisoned event or incompatible version                  | High           | Authenticated transport, schema validation, versioned subjects, reject/quarantine invalid messages |
| Backup retains deleted or prohibited data               | Medium to high | Retention schedule, encrypted backups, documented restore-time deletion handling                   |

PostgreSQL is authoritative only for domains migrated to persistent adapters.
Redis, Meilisearch, pgvector indexes, object projections, and NATS streams are
derived or transport state unless a later decision explicitly says otherwise.

### Web and API abuse

| Threat                                                                     | Risk           | Required controls                                                                                    |
| -------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| Cross-site scripting from source or community content                      | High           | Context-safe escaping, sanitization for allowed markup, restrictive content security policy          |
| Cross-origin or request-smuggling confusion                                | High           | Explicit CORS allowlist, trusted proxy configuration, normalized headers, patched Fastify/HTTP stack |
| Resource exhaustion through pagination, uploads, AI, or geospatial queries | High           | Authentication where appropriate, quotas, bounded inputs, timeouts, cancellation, backpressure       |
| Mass assignment or undocumented fields                                     | High           | Boundary schemas that strip or reject unknown fields; explicit command models                        |
| Inconsistent retries create duplicate writes                               | Medium to high | Idempotency keys and durable result semantics for retryable operations                               |
| Error leaks internal data                                                  | Medium         | Problem-details responses with stable codes; secrets and stack traces kept out of public responses   |

### Supply chain and operations

| Threat                                                  | Risk           | Required controls                                                                                            |
| ------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------ |
| Compromised package, container, or build action         | High           | Pinned toolchain, lockfile review, provenance where available, minimal images, dependency and image scanning |
| Malicious contributor changes source labels or gates    | High           | Protected review, focused diffs, verification tests, ownership rules for policy-sensitive files              |
| Local default credential reaches an exposed environment | Critical       | Environment validation, network binding restrictions, unique non-default deployment secrets                  |
| Insufficient logs prevent investigation                 | Medium to high | Structured security events and correlation IDs without raw secrets or excessive personal data                |
| Logs themselves leak private data                       | High           | Field allowlist, redaction, short retention, restricted access, no request-body logging by default           |
| Kill switch fails during incident                       | High           | Regular test, independent operator path, clear connector and feature flags                                   |

## Abuse cases

The design must explicitly test at least these scenarios:

1. A source page includes instructions telling the model to ignore policy and
   reveal connector secrets.
2. A user changes the campus ID to access another user's object.
3. A malicious source URL redirects to a link-local metadata endpoint.
4. A duplicate community-report event is delivered after a consumer restart.
5. A source license changes from reusable to prohibited after summaries and
   embeddings have been generated.
6. A schematic building route is described by the model as wheelchair
   accessible.
7. A fake account posts an announcement that imitates University emergency
   communications.
8. An uploaded image is executable content with a misleading extension.
9. A media-room token is replayed after recording begins.
10. An operator restores a backup containing records that were deleted for
    privacy or licensing reasons.

## Privacy and retention

Collect the minimum data for a documented user task. Precise location,
accessibility needs, identity claims, private messages, recordings, and model
prompts require separate necessity and retention reviews.

Required practices:

- define purpose and retention before collection;
- use synthetic data in development and tests;
- separate public, authenticated, moderator, and operator access;
- offer correction and deletion where the project controls the record;
- propagate deletion to caches, search, vectors, objects, and scheduled jobs;
- avoid raw payloads in logs, traces, and analytics;
- do not use user or restricted source content for model training by default.

## Security launch gates

The following cannot launch based on foundation code alone:

- University SSO or protected institutional connector;
- student, employee, library-account, or directory-data ingestion;
- precise live location;
- accessible, indoor, emergency, or evacuation route guidance;
- emergency-alert interpretation presented as authoritative;
- persistent community publishing or moderation;
- live media recording;
- AI actions that write or send on behalf of a user;
- public storage of campus-derived assets.

Each needs an owner, data-flow review, abuse tests, authorization evidence,
retention policy, incident procedure, and demonstrated kill switch.

## Residual risk and user communication

Even with the controls above, sources can be wrong, licenses can change,
translations can alter nuance, models can hallucinate, and campus conditions can
change faster than a cache. The product must communicate uncertainty and link
to current official resources. It must never market itself as an emergency,
medical, law-enforcement, accessibility-certification, or University-operated
service.

## Review cadence

Review this document:

- before any gated feature is enabled;
- after a material architecture, identity, data, provider, or deployment change;
- after a security, privacy, licensing, moderation, or safety incident;
- when a source or connector changes terms or authentication;
- before a release that changes trust labels or user-visible claims.

Report vulnerabilities using [SECURITY.md](../SECURITY.md). Do not put secrets,
personal data, or exploit details in a public issue.
