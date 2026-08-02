# UMN Gopher Assistant MCP server

This package is the remote, stateless Streamable HTTP MCP boundary for the
independent campus assistant. It is not an official University of Minnesota
service. OAuth is required by default, and the process binds to loopback by
default so a deployment must make its public network boundary explicit.

## Exposed surface

The server exposes these HTTP routes:

| Route                                           | Purpose                                                    |
| ----------------------------------------------- | ---------------------------------------------------------- |
| `POST /mcp`                                     | Stateless Streamable HTTP MCP endpoint                     |
| `GET /healthz`                                  | Process liveness                                           |
| `GET /readyz`                                   | Configuration, tool catalog, and replay-store readiness    |
| `GET /.well-known/oauth-protected-resource/mcp` | Canonical, path-aware RFC 9728 protected-resource metadata |

Only three MCP tools are registered. Each is generated-contract-backed,
`x-runtime-status: implemented`, public, read-only, non-destructive, and
returns both `structuredContent` and a JSON text fallback:

- `campuses_list` → OpenAPI `listCampuses`
- `sources_list` → OpenAPI `listSources`
- `world_manifest_get` → OpenAPI `getWorldManifest`

Events, community, messages, AI, live events, and administrative operations
are deliberately absent while their Core API operations remain contract-only.
There is no generic HTTP execution tool.

An inbound MCP DPoP-bound access token and fresh proof are verified for this
exact MCP resource and are then discarded. Bearer fallback is rejected. The
token is never passed to the Core API. These three public Core API requests use
an SDK client with no access-token provider, and a defensive fetch guard rejects
any downstream `Authorization` header.

## Local OAuth mode

The default development configuration expects the synthetic Keycloak realm and
Core API from the repository Compose stack:

```powershell
pnpm --filter @umn-gopher-assistant/mcp-server dev
```

Defaults:

- MCP resource: `http://127.0.0.1:4100/mcp`
- issuer/authorization server: `http://127.0.0.1:8080/realms/gopher-assistant-dev`
- Core API: `http://127.0.0.1:4000/`
- required access-token scope: `campus:read`
- maximum authorization-spec claim: `2025-03-26`

The realm is synthetic and contains no UMN SAML connection, user, secret, or
production credential. See `docs/identity.md` at the repository root for the
identity release gates.

## Explicit authless test mode

Authless mode is available only for a non-production, explicit loopback test.
All three controls are enforced at startup:

```powershell
$env:NODE_ENV = "test"
$env:MCP_AUTH_MODE = "none"
$env:MCP_ALLOW_AUTHLESS_LOOPBACK_TEST = "true"
$env:MCP_BIND_HOST = "127.0.0.1"
pnpm --filter @umn-gopher-assistant/mcp-server dev
```

It cannot bind to `0.0.0.0`, use a non-loopback canonical resource, or start
with `NODE_ENV=production`.

## Production configuration

Production requires HTTPS for the MCP resource, issuer, authorization server,
JWKS URL, and Core API. Use exact URLs: wildcards, URL credentials, fragments,
and non-loopback HTTP endpoints are rejected.

| Variable                          | Default                         | Meaning                                                           |
| --------------------------------- | ------------------------------- | ----------------------------------------------------------------- |
| `MCP_BIND_HOST`                   | `127.0.0.1`                     | Socket bind address; use a reviewed reverse proxy in production   |
| `MCP_PORT`                        | `4100`                          | Listener port                                                     |
| `MCP_RESOURCE_URL`                | `http://127.0.0.1:4100/mcp`     | Exact canonical MCP resource and JWT audience                     |
| `MCP_EXPECTED_HOST`               | Resource URL authority          | Exact accepted HTTP `Host` authority                              |
| `MCP_ALLOWED_ORIGINS`             | Resource URL origin             | Comma-separated exact browser origins; no wildcard                |
| `MCP_AUTH_MODE`                   | `oauth`                         | `oauth`; `none` is restricted to the loopback test gate           |
| `MCP_OAUTH_ISSUER`                | Local synthetic Keycloak issuer | Exact JWT issuer; required explicitly in production               |
| `MCP_AUTHORIZATION_SERVER`        | Issuer                          | RFC 9728 authorization-server entry                               |
| `MCP_OAUTH_JWKS_URL`              | Keycloak realm JWKS endpoint    | Same-origin JWKS endpoint                                         |
| `MCP_ALLOWED_CLIENT_IDS`          | `gopher-mcp`                    | Exact comma-separated OAuth client allowlist                      |
| `MCP_DPOP_REDIS_URL`              | Passworded loopback Redis       | Dedicated replay/nonce store; production requires `rediss`        |
| `MCP_AUTHORIZATION_SPEC_VERSION`  | `2025-03-26`                    | Claimed authorization-spec revision                               |
| `MCP_RFC8707_REVIEWED`            | `false`                         | Security-review gate for revisions newer than `2025-03-26`        |
| `GOPHER_API_BASE_URL`             | `http://127.0.0.1:4000/`        | Core API base URL                                                 |
| `MCP_MAX_BODY_BYTES`              | `1048576`                       | Bounded MCP JSON request size                                     |
| `MCP_BODY_TIMEOUT_MS`             | `10000`                         | Request-body deadline                                             |
| `MCP_UPSTREAM_TIMEOUT_MS`         | `10000`                         | Per-tool Core API deadline                                        |
| `MCP_GLOBAL_CONCURRENCY`          | `32`                            | In-process MCP request cap (`1`–`256`)                            |
| `MCP_NETWORK_REQUESTS_PER_WINDOW` | `120`                           | Pre-auth requests per resolved client address (`1`–`10000`)       |
| `MCP_SUBJECT_REQUESTS_PER_WINDOW` | `60`                            | Requests per verified stable JWT `sub` (`1`–`10000`)              |
| `MCP_CLIENT_REQUESTS_PER_WINDOW`  | `240`                           | Requests per verified JWT client (`azp`/`client_id`, `1`–`50000`) |
| `MCP_RATE_LIMIT_WINDOW_MS`        | `60000`                         | Fixed-window duration (`1000`–`3600000`)                          |
| `MCP_RATE_LIMIT_MAX_KEYS`         | `10000`                         | Shared in-process identity/address bound (`100`–`100000`)         |
| `MCP_TRUSTED_PROXY_IPS`           | empty                           | Up to 32 comma-separated exact immediate-proxy IP addresses       |

Example behind an HTTPS reverse proxy:

```text
NODE_ENV=production
MCP_BIND_HOST=127.0.0.1
MCP_PORT=4100
MCP_RESOURCE_URL=https://assistant.example.edu/mcp
MCP_EXPECTED_HOST=assistant.example.edu
MCP_ALLOWED_ORIGINS=https://assistant.example.edu
MCP_OAUTH_ISSUER=https://identity.example.edu/realms/gopher
MCP_AUTHORIZATION_SERVER=https://identity.example.edu/realms/gopher
MCP_OAUTH_JWKS_URL=https://identity.example.edu/realms/gopher/protocol/openid-connect/certs
MCP_ALLOWED_CLIENT_IDS=gopher-mcp
MCP_DPOP_REDIS_URL=rediss://:replace-with-secret@redis.internal.example.edu:6379
GOPHER_API_BASE_URL=https://api.assistant.example.edu/
```

The proxy must preserve the original `Host`, terminate TLS, cap headers and
bodies, and avoid rewriting the canonical `/mcp` resource. It must also apply
a shared/distributed rate limiter across replicas and to the inexpensive
health and metadata routes. The built-in per-process limiter is fail-closed
defense in depth; it is not a replacement for the proxy or gateway control.
That distributed pre-auth gate is mandatory because an invalid token has no
trustworthy subject for a subject-keyed limiter.

DPoP nonce and replay state fail closed in a password-authenticated dedicated
Redis deployment. Connection, command, queue, and Lua evaluation waits are
bounded; an unavailable or saturated store returns `503` and never degrades to
Bearer or unchecked proofs. Production requires TLS via `rediss`, memory
headroom and alerts, and `maxmemory-policy noeviction` so live replay keys are
not silently discarded. `/healthz` remains process liveness, while `/readyz`
performs a bounded Redis check and returns `503` so an orchestrator removes an
instance that cannot enforce replay protection.

`X-Forwarded-For` is ignored by default. Add only the exact IP addresses of
reviewed immediate proxies to `MCP_TRUSTED_PROXY_IPS`; never add public client
networks or a wildcard. When the direct peer is trusted, the server walks the
forwarding chain from right to left and selects the first untrusted address.
Malformed, duplicate, or excessively long trusted-proxy chains are rejected.

The configured issuer string is preserved and compared exactly, including a
root trailing slash when present; do not silently rewrite it to a cosmetically
similar issuer identifier.

## Keycloak and RFC 8707 release gate

The repository pins Keycloak 26.7.0 by tag and multi-architecture index digest.
Keycloak's own MCP guide says it supports the authorization specification dated
`2025-03-26`, but still does not implement RFC 8707 Resource Indicators or
recognize the required `resource` parameter. It is therefore only partially
compatible with the `2025-06-18` and `2025-11-25` authorization revisions.

`MCP_AUTHORIZATION_SPEC_VERSION=2025-06-18` or `2025-11-25` makes startup fail
unless `MCP_RFC8707_REVIEWED=true`. That flag is evidence of a completed
security review of an upgraded authorization server or enforcing gateway; it
is not a compatibility switch for Keycloak 26.7.0. Exact issuer, signature,
expiry, not-before time, audience, scope, `cnf.jkt`, and DPoP proof checks still
apply to every protected request.

Keycloak 26.7 includes experimental OAuth Client ID Metadata Document (CIMD)
support, but this Compose realm does not enable the `cimd` feature or install a
CIMD client policy. CIMD does not implement RFC 8707. The local `gopher-mcp`
client additionally requires `dpop_jkt` during authorization and DPoP proof at
the token and refresh endpoints. Generic MCP clients without those DPoP
capabilities are intentionally incompatible; fixed client registration, PKCE,
or experimental CIMD support must not be described as universal MCP-client
interoperability.

## HTTP and error behavior

- `Host` is exact-match validated before routing.
- A supplied `Origin` must match the configured exact allowlist.
- MCP POST requests must accept both `application/json` and
  `text/event-stream`, use JSON, and remain within the configured body bound.
- Stateful session IDs are rejected because this endpoint is intentionally
  stateless. A fresh MCP server/transport pair is cleaned up after each call.
- After minimal `Host` and `Origin` validation, every route—including health,
  readiness, metadata, preflight, and not-found responses—uses the bounded
  client-address window and global concurrency gate. The missing-token path is
  therefore covered before token verification or JSON body parsing.
- After verification, separate fixed windows apply to the stable JWT subject
  and verified client identifier. The shared key table is lazily expired,
  strictly bounded, and rejects new identities when full.
- Global concurrency covers routing, authentication, bounded body reading, MCP
  work, and upstream calls. Limit rejection returns `429`, `Retry-After`, and
  `Connection: close`. An early response to a request that still declares an
  unread body also closes the socket on a short bounded deadline so a slow
  upload cannot retain a process file descriptor.
- Unsupported protocol revisions are rejected before the SDK handler.
- OAuth failures return a redacted `401` with `WWW-Authenticate` containing
  the canonical `resource_metadata` URL and `campus:read` scope.
- Tool failures map to stable public codes. Upstream problem details,
  exception text, tokens, and internal trace identifiers are not returned.
- Successful Core API JSON is revalidated with strict OpenAPI-aligned runtime
  schemas before exposure. Unknown fields, non-HTTPS provenance URLs, and
  invalid date-time values become redacted protocol errors.

## Future writes are not live

`src/write-policy.ts` is an unwired, tested state-machine scaffold for the
project-wide future policy: preview first, explicit confirmation, exact payload
digest, matching idempotency key, expiry, then single consumption. It is not
registered with MCP, cannot call the Core API, and does not make any write tool
available. A future write operation must first exist as an implemented Core API
operation and undergo authorization and security review before registration.

## Verification

```powershell
pnpm --filter @umn-gopher-assistant/mcp-server lint
pnpm --filter @umn-gopher-assistant/mcp-server typecheck
pnpm --filter @umn-gopher-assistant/mcp-server test
pnpm --filter @umn-gopher-assistant/mcp-server build
pnpm test:mcp:oauth
```

Tests use injected fetch functions or local signing keys and make no external
network request. They cover startup gates, JWT issuer/signature/audience/client/
scope/expiry/not-before failures, DPoP proof and nonce boundaries, discovery
and challenges, HTTP boundaries, exact tool catalog, structured output,
downstream credential absence, redacted errors, future write confirmation
policy, and transport cleanup. The opt-in DPoP integration test uses the local
Compose Redis to prove nonce issuance, acceptance, and replay rejection.

With the compiled API/MCP packages and local Compose Redis running, execute
`pnpm smoke:mcp:oauth` from the repository root. It starts an ephemeral
loopback issuer/JWKS fixture and the real API/MCP processes, then proves exact
MCP-vs-API audience separation, Bearer and wrong-key rejection, a nonce retry,
proof replay rejection, and the real five-campus tool output against Redis. It
closes all three listeners and never prints credentials or tokens.

Run `pnpm smoke:identity:device` separately with the documented local
administrator environment variables to exercise the checked-in `gopher-web`,
`gopher-cli`, and `gopher-mcp` public clients against live Keycloak. That
headless smoke proves authorization-code/device token and refresh DPoP binding;
the strict resource smoke above deliberately uses a local signing fixture so it
does not create confidential service-account clients that bypass the public
client policy.
