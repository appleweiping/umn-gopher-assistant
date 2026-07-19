# Identity and authorization boundary

## Status

`infra/compose/keycloak/realm-export.json` is a local-development realm made
only from synthetic configuration. It contains no users, institutional identity
provider, client secret, password-grant client, or service account. Importing
the realm does not establish a University of Minnesota identity integration.

Public API operations do not require a token. Every protected OpenAPI operation
declares its minimum OAuth scope; there is no global fallback policy. The API
must still validate issuer, signature, expiry, not-before time, audience, scope,
role, and object-level authorization. A scope alone is never campus affiliation
or permission to access another user's data.

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
test personas; production role-to-scope policy belongs to reviewed server-side
authorization configuration. The `anonymous` role is vocabulary for product
policy and is never assigned to a token.

## Runtime verification

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
