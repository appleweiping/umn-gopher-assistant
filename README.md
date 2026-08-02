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
The current API implementation includes health, campus/source metadata,
schematic world manifests, an evidence-gated public catalog, and a public
evidence-first campus knowledge query. Academic
sessions for all five campuses and public events for Twin Cities and Duluth are
retrieved live with no content cache; unsupported event campuses fall back to
official links. The no-key AI mode retrieves project-authored bilingual summaries,
cites every paragraph, and never reads the personal vault or calls a model provider.
OpenAPI and AsyncAPI also describe intended contract surfaces, so a documented
operation or event is not proof that its backing connector or workflow is enabled.

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
base with checksum-pinned pgvector source. A dedicated one-shot migration
service applies every ordered SQL migration transactionally, records a
checksum ledger, and upgrades existing foundation-only volumes before dependent
services start. Its privilege convergence transaction first revokes existing
runtime function access, then grants only the reviewed personal-API function
allowlist under bounded statement and lock timeouts.

    docker compose --env-file infra/compose/.env.example -f infra/compose/docker-compose.yml up --build --wait

Keycloak startup import creates a missing local realm but cannot update a realm
already retained in PostgreSQL. The `keycloak-reconcile` one-shot therefore
runs after Keycloak is healthy and idempotently converges the versioned DPoP
policy, DPoP-bound public-client attributes, and exact `personal:read` /
`personal:write` links. A reconciliation failure makes Compose startup fail
closed; neither administrator credentials nor access tokens are printed.

`pnpm smoke:db` creates an isolated temporary Compose project, reproduces a
foundation-only legacy volume, runs the migration service, verifies preserved
data, PostGIS, pgvector, the migration ledger, the knowledge tables, and both
HNSW indexes, then removes its volumes. It requires an available Docker engine
and is intended for CI or a local runtime with Docker enabled.

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

For explicit token-level DPoP and negative-escalation checks, export the same
two administrator variables and run `pnpm smoke:identity:device`. It creates
and deletes one synthetic complete-profile user, drives the real Web and MCP
authorization-code flows plus the CLI device flow headlessly, and verifies
proof-bound token and refresh requests for all three public clients. It also
proves that requested `admin:write` does not enter the tokens and that API and
MCP audiences remain exact and separate. Signatures, issuers, authorized-client
claims, token types, and `cnf.jkt` are checked against the discovery JWKS.
Sensitive values are never printed or inherited by the browser process, and
exact-username cleanup is audited.

After building the API and MCP server and starting local Compose Redis,
`pnpm smoke:mcp:oauth` starts both runtimes plus an ephemeral loopback
issuer/JWKS fixture. It issues a DPoP-bound `at+jwt` solely for the strict
resource test and proves API/MCP audience isolation, the nonce
challenge/retry, proof replay rejection, and rejection of missing credentials,
Bearer fallback, and a proof signed by the wrong key. A valid MCP proof can
call the three read-only tools and retrieve the exact five-campus data. The API,
MCP, and issuer listeners are audited as closed; the fixture creates no
Keycloak client or persistent credential and never prints a token or key.

After `pnpm build`, `pnpm smoke:api` starts the compiled API on an ephemeral
loopback port and verifies health, all five campus records, source filtering,
schematic world labeling, ETags, and the fail-closed disabled-campus event
fallback. Live Sessions and event feeds have a separate deliberately
low-frequency smoke procedure so the ordinary build never polls UMN systems.
This specifically checks that workspace package runtime exports work after
compilation; typechecking alone is not accepted as runtime evidence.

Setting `COMPOSE_BIND_ADDRESS=0.0.0.0` is an explicit remote-exposure opt-in.
Do not do so with repository default credentials or without a host firewall and
a reviewed network boundary.

The development command starts workspace development tasks. Consult package
scripts and the API contracts before assuming a planned endpoint is backed by a
runtime implementation.

### Live public catalog

Run the API and web app together to use live public Sessions data for all five
campuses and live Twin Cities/Duluth event feeds. Set
`GOPHER_API_BASE_URL=http://127.0.0.1:4000` for the local web development
process; production requires an explicit HTTPS origin. Responses are
`LIVE_ONLY`, carry source observations and coverage, and use
`Cache-Control: no-store`. Rochester academic data uses the reviewed `UMNTC`
mapping. Morris events remain approval-required and disabled, while Crookston
and Rochester events remain official deep links.

See the [public catalog operations runbook](docs/public-catalog-operations.md)
for copyable startup and low-frequency smoke commands, cursor-key deployment,
source switches, review expiry, pagination semantics, and incident fallback.

### Evidence-first campus AI

The Ask page now uses the implemented `POST /v1/ai/query` surface through a
same-origin, credential-free BFF. The initial mode is deterministic retrieval,
not a general chatbot: it returns `answered`, `stale`, `conflict`, or
`no-results`, retains campus and evidence metadata, and links only to governed
official UMN verification entrances. BYOK and local-model inputs remain visibly
disabled until their provider, secret, privacy, and output-validation boundaries
are implemented and tested.

Development can run the reviewed file corpus explicitly. Production requires
PostgreSQL 17, a successful transactional corpus synchronization, Redis-backed
distributed abuse control, and no file fallback. pgvector storage is present,
but the current implementation truthfully reports that vector search is off.
Weak lexical overlap now fails closed: a candidate needs absolute topical
evidence and sufficient query coverage before it can become an answer. A
corpus-bound, versioned bilingual release gate exercises at least 150 supported,
unsupported, ambiguous, and hard-negative cases across every campus and locale;
it is required by both local verification and CI.
See the [campus knowledge operations runbook](docs/ai-knowledge-operations.md)
and [ADR 0005](docs/adr/0005-evidence-first-campus-ai.md).

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

Every OpenAPI operation has an `x-runtime-status`. Health, campus metadata,
source metadata, schematic world manifests, academic sessions, and public
events, and the no-key campus assistant are currently implemented; the other
public contract surfaces remain `contract-only`.

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

### End-to-end encrypted personal task vault

The Plan page offers an offline-first encrypted task vault. It works entirely
locally without an account; after sign-in, a user can explicitly enable
account-bound ciphertext synchronization. The API stores only strict encrypted
snapshots, public authorization descriptors, signed commits, and bounded
replay/idempotency records. It never receives task plaintext, a vault root key,
a recovery code, or a device private key.

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
- While the vault is marked **Local only**, clearing site data or losing the
  local ciphertext makes its tasks unrecoverable. Cross-device recovery becomes
  possible only after account-bound synchronization has completed and the
  current recovery code has been saved offline.
- Remote recovery verifies the recovery-derived public authorization key before
  downloading encrypted state, registers a replacement device through a signed
  pairing transition, then blocks ordinary reads/writes until it rotates the
  root key and recovery credential, revokes old devices, and independently
  reads back the exact committed head. The replacement recovery code is shown
  once and is never sent to the server.
- Sync, pairing, and rotation commands are durably staged before transmission.
  They replay exactly while their proof is current; after expiry, a fresh
  signed read must prove either the exact applied successor or the exact
  unchanged parent before an atomic proof-only renewal. Conflicting, forked,
  stale, rolled-back, malformed, or incorrectly signed server state fails
  closed instead of overwriting local data.
- Store every current recovery code offline. Do not upload, screenshot-share,
  or send it to another person. The service cannot recover a lost code or
  decrypt a vault on the user's behalf.
- Browsers without Worker, IndexedDB, WebCrypto, or non-extractable `CryptoKey`
  persistence are shown an unavailable/read-only state; existing legacy data is
  retained without a plaintext fallback.
- The encrypted vault requires Safari/iOS 26 or newer. Older Apple WebKit
  releases are disabled because WebKit bug 288682 can partially commit an
  IndexedDB transaction when a Worker is terminated; the rest of the public
  field guide remains available and legacy plaintext is retained untouched.

The vault is intentionally isolated from the AI page, API, logs, Service
Worker, and response caches. The Service Worker never caches a normal `/plan`
response and never accepts vault messages. It may cache only an internally
marked, credentials-omitted anonymous Plan shell plus the project-owned Vault
Worker bootstrap and its SHA-256 content-addressed artifact. The artifact is
verified before publication; task plaintext, recovery codes, ciphertext,
keyrings, and trusted-device records remain outside Cache Storage.

Run the web app alone from the repository root with:

    pnpm --filter @umn-gopher-assistant/web dev

The service worker is registered only by a production build. It precaches the
offline shell and project-owned icons, then caches same-origin Next.js static
assets as they are used. It does not intercept cross-origin requests or paths
under `/api/` and `/v1/`. To exercise the production PWA locally:

    pnpm --filter @umn-gopher-assistant/web build
    pnpm --filter @umn-gopher-assistant/web start

The PWA preserves a bilingual, project-authored offline status shell and the
anonymous Plan vault shell. It deliberately does not cache runtime navigation
HTML—even for a page that is public today—so a later authenticated or
personalized response cannot be replayed on a shared browser. External official
sources, live schedules, safety alerts, registration, and campus systems are not
made available offline.

## Web tests

Component and domain tests run in Vitest:

    pnpm --filter @umn-gopher-assistant/web test

Playwright covers English-to-Chinese switching, all five persisted campus
choices, the Today-to-Explore-to-Plan journey, local vault setup/migration,
recovery, background lock, offline writes, production Worker/CSP behavior,
mobile and keyboard navigation, the production offline fallback, manifest and
service-worker policy, and automated WCAG A/AA checks. The Vault suite runs on
desktop Firefox/WebKit and Pixel 5/iPhone 13 profiles as well as Chromium.
The same serial five-project Vault matrix—including an iPhone 13 layout on the
supported iOS/WebKit 26 path—is a required GitHub Actions job;
failures retain the browser trace, screenshot, video, and HTML report as a
short-lived CI artifact.
Install the pinned browser binaries once, then run:

    pnpm --filter @umn-gopher-assistant/web exec playwright install chromium firefox webkit
    pnpm --filter @umn-gopher-assistant/web test:e2e

The Playwright configuration builds and serves the production app when
`PLAYWRIGHT_BASE_URL` is not set. Set that variable to test an already running
instance. Failed runs retain a trace, screenshot, and video under the ignored
`apps/web/test-results` directory; the HTML report is written to the ignored
`apps/web/playwright-report` directory. Tests rely on browser events and web
assertions rather than fixed sleeps.

The full offline-vault reload test intentionally stops and restores the local
Next.js process, so it is enabled only in its serial managed-server gate. CI
runs this command (PowerShell users can set the variable with
`$env:PLAYWRIGHT_MANAGED_OFFLINE='1'` first):

    PLAYWRIGHT_MANAGED_OFFLINE=1 pnpm --filter @umn-gopher-assistant/web test:e2e e2e/vault.spec.ts --workers=1

The launcher binds its stop/start control endpoint to loopback, authenticates
each request with a per-run random token, and automatically restores the app
after a bounded offline lease if a test worker crashes. Ordinary parallel E2E
runs leave this destructive-origin test skipped.

### Current web limitations

- Weather, routes, personal class schedules, community posts, and moderation
  items are authored demonstrations unless a provenance link says otherwise.
  Public Sessions and TC/Duluth events are live-only views; assistant answers
  come from the project-authored corpus. Citations separate the summary source
  from the link-only official page supplied for verification. Both retain provenance and
  are unavailable offline.
- Official links leave the app and require a network connection. Their content,
  availability, accessibility, and licensing remain the source owner's
  responsibility.
- The schematic map is paired with a text list and is not an official map,
  accessible-route guarantee, emergency route, or live navigation system.
- The personal task vault is not an institutional record or an escrowed backup.
  Local-only vaults cannot be recovered after site data is lost. Synced vaults
  still require the current recovery code and authenticated account boundary;
  the service cannot decrypt or reset them. The protocol detects rollback only
  against a trusted local anchor and does not yet provide global fork
  transparency against a malicious storage service.
- Installability and offline behavior require a supported browser and a secure
  context (localhost is accepted for development).

## Repository map

| Path               | Purpose                                                   |
| ------------------ | --------------------------------------------------------- |
| apps/web           | Next.js web client                                        |
| apps/api           | NestJS/Fastify API                                        |
| apps/cli           | RFC 8628 command-line client and guarded read commands    |
| apps/mcp-server    | OAuth-protected remote Streamable HTTP MCP server         |
| apps/ai-knowledge  | Isolated deterministic campus knowledge retrieval service |
| packages/contracts | Shared schemas and public contract types                  |
| packages/crypto    | Browser-friendly E2EE primitives and local key envelopes  |
| packages/config    | Campus and source registries with provenance              |
| packages/db        | Database schema, migrations, and persistence adapters     |
| packages/testing   | Shared test configuration and utilities                   |
| packages/sdk       | OpenAPI-generated TypeScript SDK and native fetch client  |
| openapi            | HTTP API contract                                         |
| asyncapi           | Event contract                                            |
| infra/compose      | Local-only supporting infrastructure                      |
| docs               | Architecture, source policy, threat model, and decisions  |

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

- [HDUHelp product study and UMN adaptation principles](docs/research/hduhelp-product-study.md)
- [Architecture](docs/architecture.md)
- [Data source policy](docs/data-source-policy.md)
- [Public catalog operations](docs/public-catalog-operations.md)
- [Campus knowledge operations](docs/ai-knowledge-operations.md)
- [Personal-vault operations and ephemeral retention](docs/personal-vault-operations.md)
- [Account identity HMAC continuity and rotation](docs/account-hmac-operations.md)
- [API health and production-readiness gate](docs/health.md)
- [Threat model](docs/threat-model.md)
- [Security and supply-chain evidence](docs/security-supply-chain.md)
- [Identity and authorization boundary](docs/identity.md)
- [Selective service architecture decision](docs/adr/0001-selective-service-architecture.md)
- [Evidence-first campus AI decision](docs/adr/0005-evidence-first-campus-ai.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)

## License and notices

Project-authored source code and documentation are licensed under the Apache
License 2.0 unless a file says otherwise. That license does not grant rights to
University trademarks, third-party data, external services, or third-party
assets. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
