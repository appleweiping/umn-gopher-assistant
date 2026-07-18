# Contributing

Thank you for improving UMN Gopher Assistant. Contributions are welcome when
they preserve the project's independent, unofficial status and its source,
privacy, licensing, and safety boundaries.

By participating, follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report
security vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in a
public issue.

## Before you begin

This is not a University of Minnesota-operated repository. Do not represent
yourself as acting for the University, promise access to University systems, or
use University marks in a way that suggests endorsement.

Do not submit:

- real passwords, API keys, cookies, tokens, certificates, session exports, or
  institutional credentials;
- student records, private directory data, precise personal location, private
  messages, recordings, or other protected information;
- scraped University content or third-party datasets without compatible rights;
- University logos, Goldy Gopher artwork, proprietary maps, photographs,
  building models, textures, or other unlicensed assets;
- a connector that enables itself without recorded authorization;
- route or emergency behavior presented as verified when it is schematic or
  unreviewed.

Use synthetic fixtures and project-authored placeholder assets.

## Development setup

The repository pins:

- Node.js 24.11.1;
- pnpm 10, with the exact version in the packageManager field;
- the exact Turborepo version in package.json.

From the repository root:

    corepack enable
    pnpm install
    pnpm verify

Useful workspace commands:

    pnpm dev
    pnpm build
    pnpm lint
    pnpm typecheck
    pnpm test
    pnpm format:check
    pnpm verify:foundation

Run **pnpm format** only when you intend to apply formatting changes. Keep
format-only changes out of unrelated pull requests.

The services under infra/compose are for local development. Review the example
environment file before starting them. Local default identities and passwords
must never be exposed to a shared or production network and must never be
reused for a deployment.

## Working agreement

1. Create a focused feature branch.
2. Confirm the current issue or change has a clear user outcome.
3. Update the relevant schema or machine-readable contract before changing a
   public boundary.
4. Implement through domain ports and infrastructure adapters.
5. Add tests for success, validation, authorization, and failure behavior.
6. Update user-facing and architecture documentation.
7. Run **pnpm verify** from the repository root.
8. Review the final diff for secrets, personal data, generated output, and
   unrelated changes.

Keep commits reviewable. Explain why a change is needed, its trust boundary, and
how it was verified.

## Architecture rules

The foundation follows the
[selective service architecture decision](docs/adr/0001-selective-service-architecture.md).

- The API is a schema-first NestJS/Fastify modular monolith.
- Domain modules depend on ports, not vendor SDKs.
- Shared packages contain stable contracts, configuration, database support, or
  test infrastructure; they are not a general dumping ground.
- OpenAPI describes HTTP compatibility and AsyncAPI describes event
  compatibility.
- Database-backed events use a transactional outbox, and consumers tolerate
  duplicate delivery.
- Redis, Meilisearch, vector indexes, objects, and event streams are not
  authoritative domain stores unless a later decision explicitly makes them
  one.
- A new deployable service needs measured scaling, isolation, availability, or
  ownership evidence plus a versioned contract and runbook.

Do not treat a documented endpoint, event, Compose service, or UI control as
proof that a runtime capability is enabled.

## Public API and event changes

For a public HTTP or event change:

- update the shared runtime schema;
- update OpenAPI or AsyncAPI;
- keep identifiers and errors stable where possible;
- document pagination, idempotency, conditional requests, and retry semantics
  where relevant;
- add positive and negative contract tests;
- describe compatibility and migration impact in the pull request.

Breaking changes require an explicit versioning decision. Do not silently change
the meaning of an existing field, verification label, or event.

## Campus and localization changes

All campus-scoped behavior must name its campus explicitly. Supported campus
identifiers are **tc**, **duluth**, **crookston**, **morris**, and
**rochester**. Rochester's configured academic-calendar mapping to Twin Cities
does not imply that all Rochester data comes from Twin Cities.

When adding visible registry text:

- provide English and Simplified Chinese values using **en** and **zh-CN**;
- keep machine identifiers locale-neutral;
- preserve source links and label translated or summarized text as derived;
- make English fallback visible rather than fabricating missing translation;
- ask for language review when wording affects health, safety, policy,
  accessibility, deadlines, or rights.

Machine translation alone does not verify a claim.

## Data source and connector changes

Read the [data source policy](docs/data-source-policy.md) before adding any
external source.

A source pull request must include:

- a registry entry with source URL, publisher, campus scope, license status,
  attribution, cache policy, freshness, verification, and official status;
- evidence that the proposed collection, transformation, storage, translation,
  and display are allowed;
- a minimal field list, retention rule, and derived-data deletion plan;
- synthetic fixtures and hostile-input tests;
- rate limits, timeouts, schema validation, and failure behavior;
- visible attribution and stale-data behavior;
- owner, kill switch, and approval evidence for a connector.

All connectors remain disabled until both authorization evidence and runtime
secret configuration are present. Missing approval must fail closed.

Do not weaken **DEEPLINK_ONLY**, **NO_CONTENT_CACHE**, **UNVERIFIED**, or
**SCHEMATIC** labels to make a demo appear more complete.

## Maps, routes, and assets

Project-authored primitive geometry may be used for a visibly schematic demo.
Include its author, tool, version, license, and source notes.

Do not:

- trace a restricted map or floor plan;
- reconstruct a building from unlicensed imagery or models;
- publish sensitive interior detail;
- describe schematic geometry as accurate, accessible, official, or live;
- enable safety-critical routing without the separate verification and
  operational review described in the threat model.

Every new binary asset needs a clear origin, copyright holder, license, and
attribution. If those cannot be demonstrated, leave the asset out.

## Security and privacy requirements

- Validate untrusted input at every boundary.
- Authorize protected actions and objects server-side.
- Treat source content, community content, uploads, model output, and connector
  responses as untrusted.
- Never log credentials, full tokens, or unnecessary personal data.
- Do not send secrets or restricted records to a model provider.
- Use least-privilege service identities and the runtime secret store.
- Add abuse tests for any community, media, AI tool, upload, or location
  feature.
- Keep accessibility, emergency, evacuation, and precise-location features
  disabled until their launch gates are satisfied.

Review [the threat model](docs/threat-model.md) for the minimum abuse cases.

## Database changes

- Add an append-only migration; do not edit a migration that others may have
  applied.
- Keep migrations deterministic and reversible where practical.
- Preserve source and authorization metadata.
- Test both an empty database and the supported upgrade path.
- Document destructive or long-running operations and a rollback plan.
- Do not place real data or credentials in seeds.

## Documentation changes

Documentation is part of the contract. Keep implemented, planned, gated, and
schematic behavior visibly distinct. Check relative links and keep commands
aligned with package scripts.

Update:

- README.md for onboarding or project-status changes;
- docs/architecture.md for boundaries or data ownership;
- docs/data-source-policy.md for rights or connector rules;
- docs/threat-model.md for new data, actors, providers, or abuse paths;
- an ADR for a durable architectural decision.

## Pull request checklist

- [ ] The change has a clear, bounded purpose.
- [ ] Public schemas, OpenAPI, and AsyncAPI are synchronized where applicable.
- [ ] Tests cover validation, failure, authorization, and compatibility.
- [ ] **pnpm verify** passes.
- [ ] Campus and **en** / **zh-CN** behavior are covered where applicable.
- [ ] Source provenance, license, cache, freshness, verification, and official
      status are preserved.
- [ ] Connectors and safety-critical features remain gated unless approval is
      included.
- [ ] Fixtures and logs contain no credentials or protected data.
- [ ] No unlicensed data or asset is added.
- [ ] Documentation states what is implemented versus planned or schematic.
- [ ] The diff contains no generated, format-only, or unrelated changes.

## Licensing contributions

Unless a contribution clearly states otherwise and is accepted with compatible
terms, project-authored contributions are submitted under the Apache License
2.0. You must have the right to contribute the material. External data and
assets retain their own licenses and are not relicensed merely by being
referenced from this repository.
