# UMN Gopher Assistant

An independent, student-built foundation for a bilingual campus assistant and
digital campus platform covering the University of Minnesota campuses at Twin
Cities, Duluth, Crookston, Morris, and Rochester.

> **Independent and unofficial.** This project is not operated, sponsored,
> endorsed, or approved by the University of Minnesota. University names are
> used only to identify the campuses the software is designed to support.
> Institutional connectors, branding, and safety-critical features stay
> disabled until the required authorization, licensing, and verification
> evidence has been reviewed.

## Foundation status

This repository is an engineering foundation, not a production campus service.
The current API implementation is deliberately narrow: health, campus metadata,
source metadata, and schematic world manifests are served from in-memory
repositories behind ports. OpenAPI and AsyncAPI files describe the intended
contract surface; a documented operation or event is not proof that its backing
connector or workflow is enabled.

The platform is designed around:

- English and Simplified Chinese content using the locale keys **en** and
  **zh-CN**;
- provenance-bearing records for all five campuses;
- a NestJS 11 and Fastify API plus a Next.js 16.2 web application;
- shared contracts, configuration, database, and testing packages;
- PostgreSQL with PostGIS and pgvector, with optional supporting services for
  identity, cache, messaging, search, object storage, live media, and secrets;
- a schema-first modular monolith whose modules can be selectively extracted
  into services when measured operational needs justify it.

All current campus and source records have an official status of **UNVERIFIED**.
That flag must not be rewritten, hidden, or interpreted as institutional
approval.

## Trust labels

The platform keeps three different concepts separate:

| Label          | Meaning                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Schematic**  | An internally authored approximation, such as a placeholder 3D world. It is not a survey, official map, accessible-route guarantee, or emergency route. |
| **Unverified** | A source or fact has provenance, but its rights, freshness, or accuracy have not completed the required review.                                         |
| **Verified**   | Evidence for the specific claim, version, and intended use has been reviewed. Verification never implies University endorsement.                        |

At this stage, 3D worlds are schematic and safety-critical route guidance is
disabled. Do not use this software for emergencies, evacuation, accessibility
guarantees, or other decisions where an incorrect answer could cause harm.
Follow current official University and emergency-service guidance instead.

## Quick start

Prerequisites:

- Node.js 24.11.1 (the repository pins the Node 24 line);
- pnpm 10 through Corepack, using the exact packageManager version in
  package.json;
- Docker with Compose only when running the local infrastructure stack.

From the repository root:

    corepack enable
    pnpm install
    pnpm verify
    pnpm dev

The development command starts workspace development tasks. Consult package
scripts and the API contracts before assuming a planned endpoint is backed by a
runtime implementation.

## Repository map

| Path               | Purpose                                                  |
| ------------------ | -------------------------------------------------------- |
| apps/web           | Next.js web client                                       |
| apps/api           | NestJS/Fastify API                                       |
| packages/contracts | Shared schemas and public contract types                 |
| packages/config    | Campus and source registries with provenance             |
| packages/db        | Database schema, migrations, and persistence adapters    |
| packages/testing   | Shared test configuration and utilities                  |
| openapi            | HTTP API contract                                        |
| asyncapi           | Event contract                                           |
| infra/compose      | Local-only supporting infrastructure                     |
| docs               | Architecture, source policy, threat model, and decisions |

## Data and connector policy

Public availability does not grant permission to copy, cache, translate, or
redistribute content. Every source must be registered with a licensing state,
attribution, cache policy, verification state, and source URL before use.
Connector credentials belong in an approved runtime secret store and never in
the repository. See the [data source policy](docs/data-source-policy.md).

No University logo, Goldy Gopher artwork, proprietary map, building model,
photograph, menu, directory dump, or other unlicensed asset is bundled merely
because it is visible on a public website. Deep links remain links; they are not
permission to republish the target.

## Documentation

- [Architecture](docs/architecture.md)
- [Data source policy](docs/data-source-policy.md)
- [Threat model](docs/threat-model.md)
- [Selective service architecture decision](docs/adr/0001-selective-service-architecture.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)

## License and notices

Project-authored source code and documentation are licensed under the Apache
License 2.0 unless a file says otherwise. That license does not grant rights to
University trademarks, third-party data, external services, or third-party
assets. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
