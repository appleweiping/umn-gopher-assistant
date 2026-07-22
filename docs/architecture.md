# Architecture

## Status and scope

This document describes the initial platform architecture. It distinguishes
implemented foundation behavior from contract-only or gated capabilities.

UMN Gopher Assistant is an independent, unofficial project. It has no
University of Minnesota production access or authorization by default. All
institutional connectors are deny-by-default, all current official-status
fields are **UNVERIFIED**, and the initial 3D content is **schematic**.

## Design goals

- Support Twin Cities, Duluth, Crookston, Morris, and Rochester without
  collapsing campus-specific rules into one implicit default.
- Treat English and Simplified Chinese as first-class presentation locales.
- Carry source provenance, rights, freshness, and verification metadata with
  derived records.
- Publish machine-readable HTTP and event contracts before coupling clients to
  implementations.
- Keep the core easy to run and change as a modular monolith.
- Extract a service only after isolation has a concrete security, scaling,
  availability, or ownership benefit.
- Keep secrets, privileged University systems, and unlicensed assets outside
  the repository.

## Non-goals for the foundation

- Claiming University endorsement or official-source status.
- Mirroring University websites or protected student, employee, library, or
  account data.
- Providing production navigation, accessible-route guarantees, emergency
  alerts, evacuation guidance, or dispatch.
- Treating an OpenAPI path, AsyncAPI channel, Compose service, or UI placeholder
  as evidence that the capability is operational.
- Reconstructing campus buildings from copyrighted maps, imagery, or 3D assets
  without a compatible license.

## System context

The intended request and data flow is:

    Browser
      |
      v
    Next.js web application
      |
      v
    NestJS/Fastify API ---- OpenAPI 3.1 contract
      |
      +---- domain modules and ports
      |       |
      |       +---- current in-memory adapters
      |       +---- future PostgreSQL/search/object adapters
      |
      +---- transactional outbox ---- NATS JetStream
                                           |
                                           v
                                  future isolated workers

    Approved public sources ---- gated connector adapters
                                      |
                                      v
                              provenance and validation

The web client does not call University systems directly. Connector-specific
authentication, rate limits, licensing rules, and transformations belong behind
server-side ports. A client receives normalized contracts and visible source
attribution.

## Repository boundaries

| Boundary               | Responsibility                                                   | Foundation status                                                          |
| ---------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| apps/web               | Next.js 16.2 presentation layer and bilingual user experience    | Scaffolded; must display trust labels and source links                     |
| apps/api               | NestJS 11 API using Fastify; composition root for domain modules | Health, campuses, sources, and world manifests use in-memory repositories  |
| packages/contracts     | Zod schemas, identifiers, shared DTOs, and error shapes          | Contract authority shared by clients and servers                           |
| packages/config        | Five-campus registry and source registry                         | Seed records are surveyed, provenance-bearing, and officially UNVERIFIED   |
| packages/db            | PostgreSQL schema, migrations, and repository adapters           | Foundation schema; adapters are not the default source of initial API data |
| packages/testing       | Reusable Vitest configuration and test helpers                   | Workspace support                                                          |
| openapi/openapi.yaml   | HTTP contract and compatibility boundary                         | OpenAPI 3.1; includes planned surfaces beyond the initial runtime          |
| asyncapi/asyncapi.yaml | Versioned event envelope and channel contract                    | Design contract; a channel is not proof of a running producer              |
| infra/compose          | Local development dependencies                                   | Development topology, not a production deployment prescription             |

The contracts package owns cross-boundary shapes. Domain code should depend on
ports and schemas, not vendor SDKs or infrastructure clients. Adapters translate
between an external representation and a domain representation at the edge.

## Runtime building blocks

| Component            | Intended responsibility                                  | Important boundary                                                                      |
| -------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| PostgreSQL           | Transactional application data                           | System of record only after persistence adapters replace initial in-memory repositories |
| PostGIS              | Geospatial primitives and spatial queries                | Geometry is not automatically verified route data                                       |
| pgvector             | Embedding storage and similarity search                  | Retrieval results retain provenance and authorization scope                             |
| Keycloak             | Local identity and future standards-based authentication | It does not authorize access to University accounts without an approved integration     |
| Redis                | Bounded cache, rate limiting, and ephemeral coordination | Never the sole store for durable or safety-critical state                               |
| NATS JetStream       | Durable asynchronous event delivery                      | Consumers must tolerate duplicates and schema versions                                  |
| Transactional outbox | Atomic handoff from database changes to events           | Publishers retry; handlers remain idempotent                                            |
| Meilisearch          | Derived full-text search index                           | Results must be rebuildable from authorized source records                              |
| MinIO                | Local S3-compatible object storage                       | Objects require license, ownership, malware, and privacy checks                         |
| LiveKit              | Real-time media transport                                | Recording and room access require explicit consent and authorization                    |
| OpenBao              | Runtime secret storage                                   | No production secret or institutional credential belongs in source control              |

These dependencies are selectively used. Running them in local Compose does not
turn the modular monolith into a microservice system and does not enable a
connector.

## API and event contracts

The API is schema-first:

1. Shared schemas define identifiers, localization, provenance, errors, and
   transport payloads.
2. OpenAPI 3.1 documents HTTP operations, pagination, conditional requests,
   idempotency requirements, and problem details.
3. AsyncAPI documents versioned event names and payloads.
4. Controllers validate at the boundary and call domain ports.
5. Adapters implement those ports for in-memory, database, or approved external
   systems.

The implemented read surface remains intentionally smaller than the full
contract:

- health;
- campus metadata;
- source metadata;
- a campus world manifest;
- reviewed UMN Sessions metadata for all five campus selections; and
- reviewed public event feeds for Twin Cities and Duluth, with explicit
  official-link fallback elsewhere.

Community, messaging, live media, AI, and broader write operations in the
contracts remain compatibility targets. A consumer must not depend on them
until runtime availability is explicitly documented and tested.

## Campus and localization model

Campus identity is explicit on campus-scoped data. The supported identifiers
are **tc**, **duluth**, **crookston**, **morris**, and **rochester**. Rochester
currently maps academic-calendar behavior to Twin Cities only where the
configuration says so; that mapping is not a general rule for other domains. Academic institution identity is
modeled independently: Rochester and Twin Cities map to **UMNTC**, Duluth to **UMNDL**, Crookston to **UMNCR**,
and Morris to **UMNMO**. An institution code is not interchangeable with a campus ID or calendar routing rule.

User-visible registry values carry both **en** and **zh-CN** strings. Machine
identifiers, timestamps, coordinates, units, and source URLs are locale-neutral.
Fallback to English must be visible and must not fabricate a translation. A
translation is derived content and retains a link to its source.

## Provenance and trust model

Each external source record includes, at minimum:

- a stable source identifier and applicable campus identifiers;
- bilingual display names;
- publisher and HTTPS source URL;
- licensing status and attribution;
- cache policy;
- freshness and verification states;
- last-check evidence when available;
- official-status evidence.

The initial campus home pages are registered as **DEEPLINK_ONLY** with
**NO_CONTENT_CACHE**. Their public availability permits linking, not wholesale
copying. See [Data source policy](data-source-policy.md).

Three independent labels must remain distinct:

- **Schematic** describes approximate project-authored representations, such as
  a placeholder world manifest.
- **Verified** describes review of a particular fact or artifact against
  documented evidence.
- **Official** would describe an authorized institutional relationship.

Verification never creates official status. A verified community-authored
geometry can still be unofficial. Conversely, an official page may still be too
stale or restrictively licensed for a proposed use.

## Connector lifecycle

All connectors start disabled. Enabling one requires:

1. a named owner and bounded purpose;
2. a source-registry entry and data-flow inventory;
3. documented license, terms, robots, and authorization review;
4. an authentication design with least privilege and secret rotation;
5. privacy, retention, deletion, caching, and attribution rules;
6. schema validation, rate limits, timeouts, and circuit breakers;
7. fixtures and tests that contain no real credentials or protected records;
8. an operational kill switch and incident owner;
9. approval evidence linked from deployment configuration, not implied by code.

The application fails closed when an approval artifact, secret, or verification
record is missing. A mock adapter can support development but must be visibly
marked as mock or schematic.

## Data change and event flow

For a future persistent write:

1. The API validates the command and authorization.
2. Domain state and an outbox record are written in one PostgreSQL transaction.
3. A publisher sends the versioned event to NATS JetStream.
4. A consumer processes the event idempotently.
5. Search, cache, or object projections update as derived state.
6. Failures retry with bounded backoff and observable dead-letter handling.

Consumers use event IDs and aggregate versions to handle at-least-once
delivery. Search and cache indexes are never treated as authoritative records.

## Selective service extraction

The default deployment unit is the modular API. A module is considered for
extraction only when evidence shows that an independent boundary is safer or
more operable. Examples include:

- media workloads needing independent network and resource isolation;
- connector workers with different credentials and failure modes;
- high-volume indexing or ingestion with separate scaling characteristics;
- a security boundary that materially reduces blast radius;
- a stable ownership boundary with an explicit service-level objective.

Extraction requires a versioned contract, isolated data ownership, idempotent
messaging, dashboards, runbooks, and a rollback plan. Shared database tables and
distributed transactions are not acceptable substitutes for a real boundary.
See [ADR 0001](adr/0001-selective-service-architecture.md).

## Security and privacy invariants

- Authorization is checked server-side at every protected boundary.
- A campus identifier is not an authorization decision.
- Source HTML, documents, connector responses, and model output are untrusted
  input.
- Credentials and tokens are never logged, committed, placed in fixtures, or
  sent to a language model.
- Logs minimize personal data and use request or event identifiers rather than
  raw payloads.
- Retrieval and search preserve the authorization scope of the underlying
  record.
- File and media workflows validate content type, size, malware status, license,
  and consent.
- Community and AI content is never promoted to verified campus information
  without human review and evidence.

The detailed abuse cases and controls are in the [threat model](threat-model.md)
and [security policy](../SECURITY.md).

## Safety-critical launch gates

The following remain disabled until a separate documented safety review:

- accessible, mobility, evacuation, and emergency routing;
- real-time emergency-alert interpretation or replacement;
- indoor positioning or precise individual location sharing;
- automated changes to verified geometry;
- advice that could be mistaken for police, medical, fire, or University
  instructions.

Any enabled route must identify its source, checked time, intended mobility
profile, and known limitations. A schematic route is never silently upgraded to
a verified route. When evidence is missing or stale, the product deep-links to
the current official resource.

## Deployment posture

Local Compose supports development and integration tests. Production deployment
requires separate decisions for network segmentation, managed data services,
backups, key management, audit logging, recovery objectives, regional
availability, privacy notices, and operator ownership. No production readiness
is claimed by this foundation.

All Compose-published ports bind to `127.0.0.1` by default. Changing
`COMPOSE_BIND_ADDRESS` is an explicit exposure decision, not a deployment
default. The local PostgreSQL image uses a digest-pinned PostGIS base and a
checksum-pinned pgvector source; an empty data volume applies the foundation
migration before PostgreSQL becomes healthy. `pnpm smoke:db` exercises that
empty-database path when a Docker engine is available.

## Known foundation limitations

- Initial repositories are in memory and do not provide durable application
  state.
- Contracted community, messaging, AI, media, and write endpoints may not have
  runtime handlers.
- Source freshness is unknown and official status is unverified.
- Connector authorization artifacts are absent by design.
- World geometry is schematic.
- Safety-critical navigation and alert workflows are disabled.
- Local development credentials are not production credentials.

Update this document whenever a boundary, data owner, enabled connector, or
safety posture changes.
