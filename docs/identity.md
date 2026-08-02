# Identity and authorization boundary

## Status

`infra/compose/keycloak/realm-export.json` is a local-development realm made
only from synthetic configuration. It contains no users, institutional identity
provider, client secret, password-grant client, or service account. Importing
the realm does not establish a University of Minnesota identity integration.

Public API handlers are explicitly marked with `@Public()`. A global Guard
requires every other handler to declare either `@Authenticated()` or at least
one `@RequireScopes()` value. An unmarked handler fails closed; `@Public()` in
combination with either protected marker is a configuration error rather than a
public override. Class and method scopes are merged with AND semantics. The API
verifies an RS256 signature, exact `at+jwt` type, exact issuer, one exact
audience, expiry, not-before and issued-at times, a token ID, a maximum declared
lifetime, non-empty subject, approved `azp`/`client_id`, and a bounded scope
claim before attaching a frozen `{ clientId, subject, scopes }` principal.
Identity-shaped request headers are ignored; the server does not claim to
remove arbitrary inbound headers. Role and object-level authorization remain
mandatory at the owning resource module; a scope alone is never campus
affiliation or permission to access another user's data.

## Local clients

| Client       | Local purpose              | Flow and controls                                                                                |
| ------------ | -------------------------- | ------------------------------------------------------------------------------------------------ |
| `gopher-web` | Browser application        | Public client, authorization code, PKCE S256, required `dpop_jkt`, DPoP tokens, exact redirects  |
| `gopher-cli` | Command-line login         | Public client, RFC 8628 device authorization, DPoP tokens, password grant disabled               |
| `gopher-mcp` | Local MCP authorization UI | Public client, authorization code, PKCE S256, required `dpop_jkt`, DPoP tokens, exact callback   |
| `gopher-api` | Core API resource server   | Keycloak bearer-only registration; the application still requires DPoP and cannot initiate login |

The API and MCP resource audiences are deliberately separate. Web and CLI
tokens receive the fixed local `gopher-api` audience. The MCP client receives
only `http://127.0.0.1:4100/mcp`. A deployment must replace that development
value with its exact canonical HTTPS MCP resource URL and reject tokens for any
other resource. An MCP server must not pass its inbound access token through to
the Core API; token exchange or a separately authorized downstream token is
required.

The test realm uses exact redirect boundaries: the web client returns only to
`/auth/callback` on port 3000, while the MCP client returns only to
`http://127.0.0.1:4100/oauth/callback`. Neither client accepts wildcard callback
paths. The realm sets `revokeRefreshToken=true` and `refreshTokenMaxReuse=0`;
every successful refresh rotates the token and replaying the old value fails.
The CLI alone may request `offline_access` for an operating-system
keychain-backed session. The Web BFF keeps its DPoP private key and refresh
token inside the encrypted server-side session record rather than browser
storage.

The `Gopher public OIDC DPoP binding` client policy applies Keycloak's
`dpop-bind-enforcer` to every public OIDC client. Its strict authorization-code
setting requires `dpop_jkt` before login and verifies the code against the token
endpoint proof. Per-client `dpop.bound.access.tokens=true` separately prevents
a token request without a proof. The `gopher-api` Keycloak entry is a resource
client and never issues tokens, so this token-issuance attribute is deliberately
absent there.

The realm exposes the API scopes as named Keycloak client scopes:
`campus:*`, `personal:*`, `community:*`, `messages:*`, `world:*`, and
`admin:*`. Read and write scopes stay separate so a client can request only the
capability needed for one operation. Defining a scope does not grant it to a
client: the web client may explicitly request `personal:read` and
`personal:write` for the encrypted personal vault, while those scopes are not
granted by default. The MCP client receives only `campus:read`, and the CLI
additionally permits `offline_access` for keychain-backed refresh. No public
client may request an administrator scope. A personal scope is only a coarse
API capability: account resolution, PostgreSQL RLS, optimistic concurrency,
and client-held device or recovery signatures enforce ownership at the resource
boundary. Realm roles (`visitor`,
`campus-verified`, `moderator`, `admin`, and `security-reviewer`) express local
test personas. They use a project-owned realm-role mapper without Keycloak's
audience-resolve mapper, keeping each token bound to one exact resource;
production role-to-scope policy belongs to reviewed server-side
authorization configuration. The `anonymous` role is vocabulary for product
policy and is never assigned to a token.

Because this file is a full realm import, each client lists only scopes defined
inside the export. It intentionally does not reference Keycloak installation
defaults such as `profile`, `email`, `acr`, `basic`, or `web-origins`; those
references are not portable into a newly created realm and Keycloak otherwise
logs a warning and silently drops them. The live Admin API smoke compares the
entire actual default/optional binding set, not merely a required subset.

## Runtime verification

The Core API development defaults target the synthetic loopback realm:
`http://127.0.0.1:8080/realms/gopher-assistant-dev` with audience
`gopher-api`, a five-minute maximum token lifetime, and the two synthetic
public client IDs that may call it (`gopher-web` and `gopher-cli`). The
separate `gopher-mcp` client is deliberately excluded even if a realm mapper is
misconfigured. Production startup fails unless `API_OIDC_ISSUER`,
`API_OIDC_AUDIENCE`, `API_OIDC_JWKS_URL`,
`API_OIDC_ALLOWED_CLIENT_IDS`, and `API_CORS_ALLOWED_ORIGINS` are explicit.
OIDC and CORS production endpoints must use HTTPS, `*` is never a valid CORS
origin, and the JWKS endpoint must share the issuer origin.
`API_OIDC_MAX_TOKEN_LIFETIME_SECONDS` defaults to 300 and cannot exceed 600.
The verifier uses bounded JWKS fetch timeouts, caching, and cooldown and accepts
no signing algorithm other than RS256. The synthetic Keycloak clients explicitly
enable `access.token.header.type.rfc9068`; Keycloak otherwise emits `typ=JWT`
and such a token is deliberately rejected. API unit and injected HTTP tests use an
in-process local JWK set and make no network request. Protected API routes reject
Bearer fallback and require `Authorization: DPoP`, an ES256 proof with a public
P-256 JWK, exact method and configured canonical public URI, current `iat`, a
fresh `jti`, access-token `ath`, and a matching `cnf.jkt`. Nonce and replay state
is shared in Redis and fails closed when unavailable. DPoP failures carry the
appropriate `WWW-Authenticate`, optional `DPoP-Nonce`, and `X-Request-Id`;
successful and other problem responses also carry the request ID for
correlation.

Every identity-provider client that can mint a `gopher-api` token must emit the
RFC 9068 `at+jwt` access-token header type. In Keycloak this is the per-client
**Use "at+jwt" as access token header type** advanced setting; Keycloak's
default `JWT` value is intentionally rejected by the API. A realm export and
token-level smoke test must prove this setting before an identity integration
is considered usable.

Access tokens remain usable during their short lifetime, but each HTTP request
must carry a newly signed proof. A Redis-backed atomic nonce/replay decision
prevents the same proof `jti` from being accepted on another replica. A token
without its DPoP private key is insufficient for replay. This does not make
XSS, key compromise, or malicious software harmless; client-held keys,
encrypted session records, narrow scopes, short token lifetimes, refresh
rotation, and durable mutation idempotency remain separate controls.

After the Compose Keycloak service is healthy, run `pnpm smoke:identity`. The
default check reads the live discovery document, requires advertised ES256 DPoP
support, and starts RFC 8628 device authorization for `gopher-cli`; it validates
the response shape but deliberately does not print the sensitive device or user
codes. Supplying both
`KEYCLOAK_ADMIN` and `KEYCLOAK_ADMIN_PASSWORD` enables the Admin API assertions
for the exact 26.7.0 version, zero refresh-token reuse, all three DPoP-bound
public clients, strict `dpop_jkt` policy, disabled password and service-account
grants, exact imported default/optional scope sets, and the MCP custom-audience
mapper. Supplying only one administrator variable fails closed. No token value
is written to stdout. The local bootstrap administrator exchange uses
Keycloak's master-realm `admin-cli` only to read configuration and create/delete
the synthetic test user; it does not enable Direct Access Grants on any product
realm client.

`pnpm smoke:identity:device` is the explicit, opt-in token-level escalation
check. It requires both administrator variables, creates one synthetic user
with a complete profile and random non-temporary password, and drives real Web
PKCE, CLI RFC 8628, and MCP PKCE logins in a headless browser. For all three
clients it proves that a token request without DPoP fails, a correct ES256 proof
returns `token_type=DPoP`, the access token is `typ=at+jwt` with the expected
`cnf.jkt`, a wrong-key refresh fails, a same-key refresh succeeds and rotates,
and replay of the old refresh token fails. Web and CLI receive only
`gopher-api`; MCP receives only `http://127.0.0.1:4100/mcp`. The CLI request
also asks for unlinked `admin:write`, which must be absent. Access-token
signatures, issuer, authorized client, lifetime, ID, subject, scope, and exact
audience are verified against the discovered JWKS before success is reported.

Browser and temporary-user cleanup run independently with time bounds. User
cleanup retries with fresh administrator authentication and audits that an
exact-username lookup is empty before reporting success, including when the
creation response was ambiguous. No administrator credential, synthetic
username or password, device code, user code, or token is printed or inherited
by Chrome. If Playwright Chromium is not installed, the script automatically
uses an installed Google Chrome; set `PLAYWRIGHT_CHROME_EXECUTABLE` only when
Chrome is in a nonstandard location. `IDENTITY_BASE_URL` accepts HTTPS, or HTTP
only on an explicit loopback host, and rejects credentials, queries, and
fragments.

### Isolated Keycloak 26.7 smoke

The reviewed image is pinned by both tag and multi-architecture index digest:
`quay.io/keycloak/keycloak:26.7.0@sha256:0f198be292568439d700cdbfb893e69a6009bb43a94a06a945b1d3d506c76b13`.
The following pattern uses an H2-backed, `--rm` container, separate loopback
ports, no named volume, and generated test-only administrator credentials. It
does not stop, mount, inspect, or delete the Compose PostgreSQL/Keycloak volume.

```powershell
$kcSmokeName = "uga-kc-267-smoke-$PID"
$kcSmokeAdmin = "smoke-admin"
$kcSmokePassword = [guid]::NewGuid().ToString("N")
$kcRealm = (Resolve-Path "infra/compose/keycloak/realm-export.json").Path

docker run --rm -d --name $kcSmokeName `
  -p 127.0.0.1:18080:8080 -p 127.0.0.1:19000:9000 `
  -e "KC_BOOTSTRAP_ADMIN_USERNAME=$kcSmokeAdmin" `
  -e "KC_BOOTSTRAP_ADMIN_PASSWORD=$kcSmokePassword" `
  -e KC_HEALTH_ENABLED=true -e KC_METRICS_ENABLED=true `
  -v "${kcRealm}:/opt/keycloak/data/import/realm-export.json:ro" `
  quay.io/keycloak/keycloak:26.7.0@sha256:0f198be292568439d700cdbfb893e69a6009bb43a94a06a945b1d3d506c76b13 `
  start-dev --import-realm

try {
  $kcReadyDeadline = (Get-Date).AddMinutes(2)
  do {
    Start-Sleep -Seconds 1
    try {
      $ready = (Invoke-WebRequest -UseBasicParsing `
        http://127.0.0.1:19000/health/ready -TimeoutSec 2).StatusCode -eq 200
    } catch {
      $ready = $false
    }
    if (-not $ready -and (Get-Date) -ge $kcReadyDeadline) {
      throw "Isolated Keycloak did not become ready within two minutes"
    }
  } until ($ready)

  $env:IDENTITY_BASE_URL = "http://127.0.0.1:18080/"
  $env:KEYCLOAK_ADMIN = $kcSmokeAdmin
  $env:KEYCLOAK_ADMIN_PASSWORD = $kcSmokePassword
  pnpm smoke:identity
  pnpm smoke:identity:device

  $kcImportLog = docker logs $kcSmokeName 2>&1 | Out-String
  if ($kcImportLog -match "Referenced client scope") {
    throw "Realm import silently discarded a configured client scope"
  }
} finally {
  Remove-Item Env:IDENTITY_BASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:KEYCLOAK_ADMIN -ErrorAction SilentlyContinue
  Remove-Item Env:KEYCLOAK_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  docker stop $kcSmokeName 2>$null | Out-Null
}
```

Keycloak skips startup realm import when that realm already exists. Compose
therefore runs the versioned `keycloak-reconcile` one-shot after Keycloak is
healthy. It uses the Admin API to create or update the two personal scopes,
converge their exact client links, require DPoP-bound tokens on the exported
public clients, install the strict authorization-code DPoP profile and policy,
and write `gopher.assistant.realm-revision` only after verification. It always
checks live state even when the revision marker is current, so drift fails
closed or is repaired; a second clean run performs zero mutations. It does not
print its administrator password or access token.

`pnpm smoke:identity:reconcile-offline` runs the same reconciler against an
in-memory Admin API representing a retained pre-revision realm; the contracts
suite also invokes it. That offline fixture is the authoritative local
upgrade/idempotency test when Docker is unavailable. Docker-enabled CI and
release rehearsal must additionally run Compose through successful
`keycloak-reconcile` completion, invoke
`docker compose --env-file infra/compose/.env.example -f infra/compose/docker-compose.yml run --rm keycloak-reconcile`
a second time, and execute `pnpm smoke:identity` with both administrator
variables so the live Keycloak Admin API verifies the result. Do not treat a
fresh import as retained-state evidence.

Before changing a non-disposable environment, back up its database and rehearse
the Keycloak-supported 26.7 schema upgrade plus this reconciliation on a copy.
Never attach the isolated H2 command above to an existing Compose volume, and
never delete a persistent identity volume merely to make the import look
current.

## MCP protocol limitation

The Compose stack pins Keycloak 26.7.0. According to the
[Keycloak MCP authorization guide](https://www.keycloak.org/securing-apps/mcp-authz-server),
Keycloak still does not implement RFC 8707 Resource Indicators and does not
recognize the MCP-required `resource` parameter. It supports the MCP
authorization specification dated 2025-03-26, but only partially supports the
2025-06-18 and 2025-11-25 revisions. The local fixed-audience mapper reduces
accidental token confusion; it is not a substitute for RFC 8707.

Keycloak 26.7 can use OAuth Client ID Metadata Documents for MCP clients, but
the feature is explicitly experimental and requires `--features=cimd` plus a
reviewed client profile and policy. This realm does not enable CIMD. CIMD also
does not add RFC 8707 support. Separately, `gopher-mcp` requires `dpop_jkt` and
DPoP-bound token/refresh requests. An otherwise valid generic MCP client that
cannot perform those DPoP steps is intentionally incompatible with this strict
endpoint; no release may describe static PKCE or CIMD support as proof of broad
client interoperability.

Before a production MCP deployment claims compatibility with a newer MCP
authorization revision, one of these controls must pass security review:

1. upgrade to an authorization server release that implements the required
   Resource Indicators behavior; or
2. place a reviewed authorization gateway in front of Keycloak that validates
   the exact resource binding, audience, issuer, scope, and token lifetime.

The decision and interoperability evidence must be recorded with the release.

## UMN SAML enablement gate

No UMN SAML identity provider, metadata, adapter, or enablement setting exists
in this repository. That absence is the current fail-closed gate: a production
deployment must not add or enable a SAML path until all of the following
artifacts have been accepted:

- written approval for the exact application, environments, entity ID, and
  requested attributes through the
  [UMN Shibboleth service process](https://it.umn.edu/services-technologies/shibboleth);
- exchanged and validated metadata, signing/encryption certificates, rollover
  procedure, allowed ACS/logout URLs, and a non-production test environment;
- a minimal attribute-release and identifier-mapping specification that avoids
  exposing real names in the public product;
- privacy, security, accessibility, incident-response, deprovisioning, and
  account-recovery review owners;
- issuer/audience/replay/clock-skew tests plus negative tests for unapproved
  affiliation, cross-campus access, privilege elevation, and logout; and
- documented branding scope. SSO approval does not grant permission to use
  University marks, protected data, or student-system connectors.

If any artifact expires or the metadata changes unexpectedly, the SAML path
must fail closed while public, anonymous features remain available.
