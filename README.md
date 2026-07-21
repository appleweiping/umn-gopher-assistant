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

- Node.js `>=24 <25` (CI and local evidence use 24.11.1);
- pnpm 10 through Corepack, using the exact packageManager version in
  package.json;
- Docker with Compose only when running the local infrastructure stack.

From the repository root:

    corepack enable
    pnpm install
    pnpm verify
    pnpm dev

The repository sets `engine-strict=true`; installation fails outside the
supported Node 24 line. `pnpm verify:node-policy` checks the root and every
workspace manifest, and the published `uga` binary repeats this check before it
loads configuration or credentials.

Local infrastructure binds published ports to `127.0.0.1` by default. Copy
`infra/compose/.env.example` only for local development, then run Compose from
the repository root. The database image is built from a digest-pinned PostGIS
base with checksum-pinned pgvector source, and the foundation migration runs
only when its data volume is first initialized.

    docker compose --env-file infra/compose/.env.example -f infra/compose/docker-compose.yml up --build --wait

`pnpm smoke:db` creates an isolated temporary Compose project, verifies PostGIS,
pgvector, the migrated tables, and the HNSW index, then removes its volumes. It
requires an available Docker engine and is intended for CI or a local runtime
with Docker enabled.

The default smoke rebuilds the checksum-pinned database recipe. If a registry is
temporarily unavailable and the locally tagged development image was already
built from that recipe, set `SMOKE_DB_REUSE_IMAGE=true` to use `--no-build`;
this recovery mode verifies the required tag exists but does not claim remote
digest provenance. The command fails rather than silently substituting an
absent image.

With Keycloak running, `pnpm smoke:identity` verifies OIDC discovery, mandatory
PKCE S256 support, and a real RFC 8628 device-authorization response without
printing the device or user codes. Set both `KEYCLOAK_ADMIN` and
`KEYCLOAK_ADMIN_PASSWORD` to additionally verify the four imported clients,
password-grant and service-account denial, API/MCP audience separation, and the
exact local MCP audience mapper through the Keycloak Admin API. The script never
prints the administrator or access tokens.

For an explicit token-level negative escalation check, export the same two
administrator variables and run `pnpm smoke:identity:device`. It creates and
then deletes a synthetic complete-profile user, completes the real device login
headlessly, and proves that a requested `admin:write` scope and the MCP audience
do not enter the CLI access token while the exact `gopher-api` audience remains.
The token signature, issuer, and `gopher-cli` authorized-client claim are also
verified against the discovery JWKS. Sensitive values are never printed or
inherited by the browser process, and exact-username cleanup is audited.

After building the API and MCP server, `pnpm smoke:mcp:oauth` starts both on
loopback, creates two synthetic same-realm service clients, and verifies exact
MCP scope and audience handling. It proves that a valid API-audience token, a
master-realm administrator token, and a missing token are all rejected while
the MCP-audience token can call the three read-only tools and obtain the exact
five-campus data. Both clients and both listeners are audited as removed in the
bounded cleanup path. Set `KEYCLOAK_ADMIN` and `KEYCLOAK_ADMIN_PASSWORD`; the
script does not print or pass those credentials to either runtime.

After `pnpm build`, `pnpm smoke:api` starts the compiled API on an ephemeral
loopback port and verifies health, all five campus records, source filtering,
schematic world labeling, ETags, and the fail-closed contract-only event route.
This specifically checks that workspace package runtime exports work after
compilation; typechecking alone is not accepted as runtime evidence.

Setting `COMPOSE_BIND_ADDRESS=0.0.0.0` is an explicit remote-exposure opt-in.
Do not do so with repository default credentials or without a host firewall and
a reviewed network boundary.

The development command starts workspace development tasks. Consult package
scripts and the API contracts before assuming a planned endpoint is backed by a
runtime implementation.

## Identity and developer tools

The imported Keycloak realm is synthetic and local-only. It provides PKCE
browser login, RFC 8628 CLI device authorization, separate API/MCP audiences,
least-privilege scopes, and empty test personas without enabling UMN SAML. See
the [identity boundary and production enablement gate](docs/identity.md).

The `@umn-gopher-assistant/sdk` package derives both its TypeScript types and
runtime operation map from `openapi/openapi.yaml`. Regenerate and verify the
committed artifacts with:

    pnpm generate
    pnpm check:generated

Every OpenAPI operation has an `x-runtime-status`. Only health, campus metadata,
source metadata, and schematic world manifests are currently marked
`implemented`; the other public contract surfaces remain `contract-only`.

The `uga` CLI uses the same implemented operation catalog, RFC 8628 device
authorization, exact exit codes, JSON envelopes, and operating-system keychain
storage with no plaintext token fallback. The remote Streamable HTTP MCP server
verifies the exact MCP audience and currently registers only
`campuses_list`, `sources_list`, and `world_manifest_get`; it never forwards an
inbound MCP token to the Core API.

    pnpm --filter @umn-gopher-assistant/cli build
    node apps/cli/dist/bin.js --json doctor
    pnpm --filter @umn-gopher-assistant/mcp-server dev

See the package READMEs for endpoint and OAuth configuration. No live CLI or
MCP write tool is registered. Future writes must first become implemented API
operations and pass the preview, explicit-confirmation, idempotency, and
authorization gates.

## Web field guide and PWA

The web app is an installable, responsive field guide for all five campuses. It
provides English and Simplified Chinese interfaces for Today, Explore, Plan,
Community, World, Ask, Operations, and Developer routes. Campus, language, and
theme preferences are stored in first-party cookies so the initial server render
matches the browser state. The Plan task board is a separate local encrypted
vault; it never uses the old plaintext task `localStorage` value.

### Local encrypted task vault

The Plan page offers an offline, single-browser task vault. It is deliberately
not an account, sync service, or cross-device backup.

- First use requires an explicit **Create private vault** action. A recovery
  code is shown once and must be acknowledged before the encrypted records are
  written.
- The page requires an explicit unlock for every browser session. It locks on
  demand, after 15 minutes without activity, and immediately when the page is
  hidden or unloaded.
- A module Worker owns live vault/device-key handles and IndexedDB operations.
  The page receives task view models only; it never receives vault-key bytes.
- The X25519 device private key is sealed with an origin-bound,
  non-extractable AES-256-GCM `CryptoKey`; encrypted task payloads and keyring
  records live in IndexedDB. Legacy `uga.tasks` values are only removed after
  strict validation, encrypted write, and exact decrypt/read-back verification.
- If a legacy value is malformed or a migration fails, it remains available for
  explicit export or deletion. The application does not fall back to plaintext
  task storage.
- Clearing site data or losing the local ciphertext makes these tasks
  unrecoverable. The recovery code does not promise recovery on another device.
  Store it offline and do not upload, screenshot-share, or send it to others.
- Browsers without Worker, IndexedDB, WebCrypto, or non-extractable `CryptoKey`
  persistence are shown an unavailable/read-only state; existing legacy data is
  retained without a plaintext fallback.

The vault is intentionally isolated from the AI page, API, logs, Service
Worker, and response caches. The Service Worker neither caches `/plan` nor
accepts vault messages.

Run the web app alone from the repository root with:

    pnpm --filter @umn-gopher-assistant/web dev

The service worker is registered only by a production build. It precaches the
offline shell and project-owned icons, then caches same-origin Next.js static
assets as they are used. It does not intercept cross-origin requests or paths
under `/api/` and `/v1/`. To exercise the production PWA locally:

    pnpm --filter @umn-gopher-assistant/web build
    pnpm --filter @umn-gopher-assistant/web start

The PWA preserves access to project-authored demo material when offline. It does
not make external official sources, live schedules, safety alerts, registration,
or campus systems available offline.

## Web tests

Component and domain tests run in Vitest:

    pnpm --filter @umn-gopher-assistant/web test

Playwright covers English-to-Chinese switching, all five persisted campus
choices, the Today-to-Explore-to-Plan journey, local vault setup/migration,
recovery, background lock, offline writes, production Worker/CSP behavior,
mobile and keyboard navigation, the production offline fallback, manifest and
service-worker policy, and automated WCAG A/AA checks. Install the pinned
Chromium binary once, then run:

    pnpm --filter @umn-gopher-assistant/web exec playwright install chromium
    pnpm --filter @umn-gopher-assistant/web test:e2e

The Playwright configuration builds and serves the production app when
`PLAYWRIGHT_BASE_URL` is not set. Set that variable to test an already running
instance. Failed runs retain a trace, screenshot, and video under the ignored
`apps/web/test-results` directory; the HTML report is written to the ignored
`apps/web/playwright-report` directory. Tests rely on browser events and web
assertions rather than fixed sleeps.

### Current web limitations

- Entries, weather, routes, schedules, community posts, moderation items, and
  assistant answers are authored demonstrations unless a provenance link says
  otherwise.
- Official links leave the app and require a network connection. Their content,
  availability, accessibility, and licensing remain the source owner's
  responsibility.
- The schematic map is paired with a text list and is not an official map,
  accessible-route guarantee, emergency route, or live navigation system.
- The local task vault is single-browser and offline-only; it is not an account,
  synchronization service, backup, or institutional record. Clearing site data
  or losing its ciphertext makes its tasks unrecoverable.
- Installability and offline behavior require a supported browser and a secure
  context (localhost is accepted for development).

## Repository map

| Path               | Purpose                                                  |
| ------------------ | -------------------------------------------------------- |
| apps/web           | Next.js web client                                       |
| apps/api           | NestJS/Fastify API                                       |
| apps/cli           | RFC 8628 command-line client and guarded read commands   |
| apps/mcp-server    | OAuth-protected remote Streamable HTTP MCP server        |
| packages/contracts | Shared schemas and public contract types                 |
| packages/crypto    | Browser-friendly E2EE primitives and local key envelopes |
| packages/config    | Campus and source registries with provenance             |
| packages/db        | Database schema, migrations, and persistence adapters    |
| packages/testing   | Shared test configuration and utilities                  |
| packages/sdk       | OpenAPI-generated TypeScript SDK and native fetch client |
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
- [Identity and authorization boundary](docs/identity.md)
- [Selective service architecture decision](docs/adr/0001-selective-service-architecture.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)

## License and notices

Project-authored source code and documentation are licensed under the Apache
License 2.0 unless a file says otherwise. That license does not grant rights to
University trademarks, third-party data, external services, or third-party
assets. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
