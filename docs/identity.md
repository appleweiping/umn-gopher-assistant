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

| Client       | Local purpose              | Flow and controls                                                               |
| ------------ | -------------------------- | ------------------------------------------------------------------------------- |
| `gopher-web` | Browser application        | Public client, authorization code, mandatory PKCE S256, loopback redirects only |
| `gopher-cli` | Command-line login         | Public client, RFC 8628 device authorization, password grant disabled           |
| `gopher-mcp` | Local MCP authorization UI | Public client, authorization code with PKCE S256, local callback URLs           |
| `gopher-api` | Core API resource server   | Bearer-only client; it cannot start a login or mint a service-account token     |

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
paths. Browser offline access remains disabled until refresh-token rotation,
revocation, storage, and XSS controls are designed and reviewed; the CLI may
request offline access for an operating-system keychain-backed session.

The realm exposes the API scopes as named Keycloak client scopes:
`campus:*`, `personal:*`, `community:*`, `messages:*`, `world:*`, and
`admin:*`. Read and write scopes stay separate so a client can request only the
capability needed for one operation. Defining a scope does not grant it to a
client: the current web and MCP clients receive only `campus:read`, while the
CLI additionally permits `offline_access` for keychain-backed refresh. No
current public client may request a write or administrator scope. Realm roles (`visitor`,
`campus-verified`, `moderator`, `admin`, and `security-reviewer`) express local
test personas. They use a project-owned realm-role mapper without Keycloak's
audience-resolve mapper, keeping each token bound to one exact resource;
production role-to-scope policy belongs to reviewed server-side
authorization configuration. The `anonymous` role is vocabulary for product
policy and is never assigned to a token.

## Runtime verification

The Core API development defaults target the synthetic loopback realm:
`http://127.0.0.1:8080/realms/gopher-assistant-dev` with audience
`gopher-api`, a five-minute maximum token lifetime, and the three synthetic
public client IDs. Production startup fails unless `API_OIDC_ISSUER`,
`API_OIDC_AUDIENCE`, `API_OIDC_JWKS_URL`,
`API_OIDC_ALLOWED_CLIENT_IDS`, and `API_CORS_ALLOWED_ORIGINS` are explicit.
OIDC and CORS production endpoints must use HTTPS, `*` is never a valid CORS
origin, and the JWKS endpoint must share the issuer origin.
`API_OIDC_MAX_TOKEN_LIFETIME_SECONDS` defaults to 300 and cannot exceed 600.
The verifier uses bounded JWKS fetch timeouts, caching, and cooldown and accepts
no signing algorithm other than RS256. The synthetic Keycloak clients explicitly
enable `access.token.header.type.rfc9068`; Keycloak otherwise emits `typ=JWT`
and such a token is deliberately rejected. API unit and injected HTTP tests use an
in-process local JWK set and make no network request. Bearer authentication
failures carry an RFC 6750 `WWW-Authenticate` challenge and an
`X-Request-Id`; successful and other problem responses also carry the request
ID for correlation.

Every identity-provider client that can mint a `gopher-api` token must emit the
RFC 9068 `at+jwt` access-token header type. In Keycloak this is the per-client
**Use "at+jwt" as access token header type** advanced setting; Keycloak's
default `JWT` value is intentionally rejected by the API. A realm export and
token-level smoke test must prove this setting before an identity integration
is considered usable.

`iat`, `exp`, and `jti` validation limits the usefulness of old or malformed
tokens, but a `jti` is not a replay-prevention mechanism by itself. Ordinary
read access tokens intentionally remain reusable during their short lifetime;
making every token process-local and one-time would break normal OAuth clients
and would fail across replicas. Before consequential write routes launch, they
must combine durable idempotency semantics with a reviewed sender-constrained
token design such as complete DPoP proof validation (including method, URI,
nonce/replay storage, key binding, and proxy normalization). Until that exists,
the residual risk is stated plainly: a stolen Bearer token can be replayed until
it expires or is revoked.

After the Compose Keycloak service is healthy, run `pnpm smoke:identity`. The
default check reads the live discovery document and starts RFC 8628 device
authorization for `gopher-cli`; it validates the response shape but deliberately
does not print the sensitive device or user codes. Supplying both
`KEYCLOAK_ADMIN` and `KEYCLOAK_ADMIN_PASSWORD` enables the Admin API assertions
for client types, disabled password and service-account grants, default audience
scope separation, and the exact MCP custom-audience mapper. Supplying only one
administrator variable fails closed. No token value is written to stdout.

`pnpm smoke:identity:device` is the explicit, opt-in token-level escalation
check. It requires both administrator variables, creates one synthetic user
with a complete profile and a random non-temporary password, and drives the
real `gopher-cli` RFC 8628 login in a headless browser. The request includes
`admin:write`, but the issued access token must retain `campus:read`, omit
`admin:write`, contain the exact `gopher-api` audience, and omit the exact
`http://127.0.0.1:4100/mcp` MCP audience. It obtains `jwks_uri` from discovery,
verifies the RS256 signature, and requires the exact issuer and `gopher-cli`
authorized client before trusting those claims.

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

## MCP protocol limitation

The Compose stack pins Keycloak 26.5.5. According to the
[Keycloak MCP authorization guide](https://www.keycloak.org/securing-apps/mcp-authz-server),
that release does not implement RFC 8707 Resource Indicators. It fully supports
the MCP authorization specification dated 2025-03-26, but only partially
supports the 2025-06-18 and 2025-11-25 revisions. The local fixed-audience
mapper reduces accidental token confusion; it is not a substitute for RFC 8707.

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
