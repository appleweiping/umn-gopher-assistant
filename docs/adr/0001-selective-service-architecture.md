# ADR 0001: Schema-first modular monolith with selective service extraction

- **Status:** Accepted
- **Date:** 2026-07-19
- **Decision scope:** Initial platform foundation

## Context

UMN Gopher Assistant is intended to support five campuses, two presentation
languages, public information discovery, schematic digital-campus experiences,
community workflows, live media, and AI-assisted retrieval. Those domains have
different scaling, security, freshness, licensing, and operational properties.

Starting with a service per domain would create distributed transactions,
contract drift, local-development cost, and operational ownership requirements
before the product has measured traffic or stable boundaries. A single
unstructured application, however, would make it easy for connector SDKs,
authorization rules, AI code, community features, and mapping logic to become
tightly coupled.

The project also has unusually important trust boundaries:

- it is independent and unofficial;
- University and vendor connectors require explicit authorization;
- public content can have restrictive reuse terms;
- current official-status records are **UNVERIFIED**;
- 3D worlds begin as **schematic**;
- safety-critical routing must remain disabled until separately verified.

The architecture therefore needs strong internal boundaries without claiming
premature distributed-system maturity.

## Decision

Build the initial platform as a **schema-first modular monolith** and extract
only selected workloads into independently deployed services when evidence
justifies the added operational cost.

### Workspace and applications

- Use a pnpm 10 monorepo orchestrated by Turborepo on Node.js 24.
- Use Next.js 16.2 for the web application.
- Use NestJS 11 with Fastify for the API composition root.
- Keep shared schemas and types in the contracts package.
- Keep five-campus and source registries in the configuration package.
- Keep persistence schema, migrations, and adapters in the database package.
- Keep reusable test configuration and utilities in the testing package.

### Contract authority

- Define HTTP compatibility in OpenAPI 3.1.
- Define asynchronous compatibility in AsyncAPI.
- Validate external and cross-boundary payloads against shared schemas.
- Version public events by name and payload contract.
- Use stable problem details, pagination, conditional requests, and idempotency
  semantics where the contract requires them.

A contract entry is not proof of runtime availability. The initial implemented
API is limited to health, campus metadata, source metadata, and schematic world
manifests backed by in-memory repositories.

### Internal module boundaries

Domain modules expose ports. Infrastructure adapters implement them.

- Controllers and event handlers translate transport input into domain calls.
- Domain modules do not import vendor clients or web framework concerns.
- Connector adapters remain server-side and disabled without approval.
- Campus, locale, source, license, freshness, verification, and official-status
  metadata are explicit in contracts.
- Persistent adapters can replace in-memory adapters without changing the
  public contract.

### Data and messaging

- Use PostgreSQL for transactional application state.
- Use PostGIS for approved geospatial primitives and pgvector for approved
  embedding workloads.
- Write domain changes and outbox records in the same transaction.
- Publish outbox records to NATS JetStream.
- Require idempotent consumers because delivery can be duplicated, delayed, or
  replayed.
- Treat Redis, Meilisearch, vector indexes, and object projections as
  rebuildable derived state unless a later decision explicitly assigns
  authority.

### Selective supporting services

Use focused infrastructure components where their capability is material:

| Component      | Selected role                                                     |
| -------------- | ----------------------------------------------------------------- |
| Keycloak       | Development identity and future standards-based identity boundary |
| Redis          | Bounded caching, rate limiting, and ephemeral coordination        |
| NATS JetStream | Durable asynchronous delivery                                     |
| Meilisearch    | Derived text-search projection                                    |
| MinIO          | Local object-storage boundary                                     |
| LiveKit        | Real-time media boundary                                          |
| OpenBao        | Runtime secret storage                                            |

Their presence in local Compose does not enable the associated product feature
and does not create an official University integration.

## Extraction rule

A module remains inside the API unless the proposal demonstrates at least one
of these needs:

1. **Independent scaling:** measured load or resource shape materially differs.
2. **Security isolation:** separate credentials, network policy, or blast radius
   measurably reduces risk.
3. **Availability isolation:** failures must not consume the core request path.
4. **Data lifecycle:** retention or residency demands independent ownership.
5. **Operational ownership:** a team can own an explicit service-level
   objective and on-call path.
6. **Technology fit:** a specialized runtime provides a clear benefit that
   cannot be achieved reasonably inside the existing boundary.

Before extraction, the proposal must include:

- a versioned API or event contract;
- single ownership of data and migrations;
- no shared-table writes across the boundary;
- idempotency, retry, timeout, and backpressure behavior;
- authorization and secret boundaries;
- dashboards, alerts, runbook, recovery objectives, and cost estimate;
- a migration and rollback plan;
- tests showing that the modular implementation and extracted implementation
  preserve required behavior.

An arbitrary code-size threshold, a desire to use a new framework, or the
existence of a message broker is not sufficient evidence.

## Likely future extraction candidates

These are candidates, not commitments:

- approved source-ingestion workers with narrow credentials and rate limits;
- media or recording orchestration with independent privacy and resource needs;
- compute-heavy indexing, geospatial processing, or asset conversion;
- notification delivery with provider-specific failure handling.

Identity, source authorization, verification promotion, and safety gates remain
policy decisions even if their execution moves to another service.

## Trust and safety constraints

Architecture cannot be used to bypass policy:

- All institutional connectors are deny-by-default.
- Credentials are loaded from an approved runtime secret store and never
  committed, embedded in clients, fixtures, or model prompts.
- No University logo, map, model, image, dataset, or other unlicensed asset is
  bundled.
- Public availability does not imply reuse rights.
- Schematic, verified, and official are independent labels.
- A verified fact does not imply University endorsement.
- Safety-critical route, alert, and precise-location features stay disabled
  until a separate review records current evidence and an accountable owner.

## Consequences

### Positive

- One primary application boundary keeps local development and transactions
  simple.
- Ports and shared schemas preserve replaceable adapters and testability.
- OpenAPI and AsyncAPI reduce client and consumer ambiguity.
- The outbox provides a disciplined path to asynchronous projections and later
  extraction.
- Connector credentials and failures can be isolated without creating a
  service for every domain.
- Trust labels and provenance become structural data rather than UI copy.

### Negative

- Module boundaries rely on review and automated architecture checks rather
  than network separation.
- A poorly isolated module can increase the API process's resource or failure
  blast radius.
- The local infrastructure stack is larger than the initial implemented
  feature set.
- The team must maintain schemas across TypeScript, OpenAPI, AsyncAPI, and
  database boundaries and prevent drift.
- Later extraction requires deliberate migration work; it is not automatic.

### Risks and mitigations

| Risk                                                                    | Mitigation                                                                         |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Distributed-system components are adopted without operational ownership | Keep features gated; require extraction evidence and runbooks                      |
| Contract describes behavior that is not implemented                     | Publish implementation status separately and test only declared runtime capability |
| Shared code becomes a hidden coupling mechanism                         | Limit shared packages to stable contracts, configuration, and test infrastructure  |
| Modules bypass ports and access tables directly                         | Repository interfaces, dependency rules, and focused reviews                       |
| Event-driven writes create inconsistency                                | Transactional outbox, idempotent consumers, reconciliation                         |
| Schematic or unverified content gains authority through reuse           | Preserve trust metadata at every boundary and enforce promotion review             |

## Alternatives considered

### Service per domain from the beginning

Rejected for the foundation. It would require independent deployment,
observability, authorization, data ownership, contract evolution, and incident
response before stable boundaries or measured load exist.

### Unstructured monolith

Rejected. It minimizes initial files but makes vendor adapters, authorization,
AI, persistence, and domain logic difficult to test or extract safely.

### Direct browser integrations

Rejected. They expose credentials, scatter source-policy enforcement, complicate
rate limiting and attribution, and can suggest an authorization relationship
that does not exist.

### Event-only integration between all modules

Rejected. Queries and transactional workflows become unnecessarily indirect,
and eventual consistency is introduced even where an in-process call is the
clearer boundary.

### Serverless function per endpoint

Not selected as the default. It does not itself define data ownership or domain
boundaries and can make local development, connection management, and
cross-endpoint policy consistency harder. Individual stateless workloads may be
reconsidered with evidence.

## Compliance

A change complies with this decision when it:

- updates shared and machine-readable contracts before exposing a boundary;
- places business logic behind a domain port;
- keeps vendor and transport code in adapters;
- preserves campus, locale, provenance, licensing, verification, and official
  status;
- uses the outbox for events tied to a transactional state change;
- leaves an unapproved connector or safety-critical feature disabled;
- avoids introducing a deployment unit without the extraction evidence above.

## Revisit triggers

Revisit this decision when:

- measured traffic or incident data shows the API boundary is insufficient;
- a regulatory, privacy, residency, or authorization requirement changes data
  ownership;
- a team accepts ownership of a proposed service and its operational burden;
- contract duplication or build performance makes the monorepo ineffective;
- the majority of the product no longer shares a transactional core.

A replacement ADR should identify migration and rollback implications and must
retain the independent/unofficial, licensing, provenance, connector-gating, and
safety constraints unless separately superseded with evidence.
