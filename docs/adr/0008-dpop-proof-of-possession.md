# ADR 0008: End-to-end DPoP proof of possession

- **Status:** Accepted
- **Date:** 2026-07-22
- **Deciders:** UMN Gopher Assistant maintainers
- **Decision scope:** Web, CLI, SDK, Core API, MCP, and OAuth token boundaries

## Context

An access token copied from a browser session, command line, log, or compromised
client must not be sufficient to call a protected campus API. The Web BFF, CLI,
SDK, Core API, and MCP resource also need one consistent policy for proof
replay, nonce challenges, client separation, Redis failure, and concurrency.

## Decision

Protected resources accept only RFC 9449 DPoP-bound access tokens. Bearer is not
a compatibility fallback. Access tokens use the `at+jwt` profile and the
synthetic realm's reviewed RS256 signing policy. Each token must have an exact
issuer and single exact audience, a bounded lifetime, a well-formed bounded
`sub` and `jti`, an approved and unambiguous `azp`/`client_id`, and canonical
`cnf.jkt`. The Core API approves `gopher-web` and `gopher-cli`; the distinct MCP
audience approves `gopher-mcp`. Production allowlists are explicit.

Proofs use ES256 with an embedded public P-256 JWK. Safe non-key selectors such
as `kid` may be ignored, while private JWK material, remote key selectors,
`crit`, and unencoded-payload controls are rejected. Each proof binds the exact
HTTP method, deployment-configured canonical URL, and access-token hash.
Proof `jti` accepts well-formed Unicode but rejects controls and values over 256
UTF-8 bytes. Nonces accept the complete bounded RFC NQCHAR syntax.

Authorization-server and resource-server nonces are separate state. Clients
perform at most one retry, always with a new proof and `jti`. The SDK's
resource nonce cache is isolated by origin and key thumbprint, bounded by LRU,
and expires entries. Web stores the authorization-server nonce inside the
sealed session and the non-secret resource-server nonce in a separate,
same-slot Redis key. The CLI keychain stores the authorization-server nonce;
its short-lived raw API process does not persist a resource nonce.

The API replay store uses one Redis Cluster hash slot per opaque subject digest.
Its Lua transaction counts every syntactically and cryptographically valid
proof attempt—including replays—toward a subject window before claiming the
`jkt`/`jti` replay key. Nonce and proof state fail closed. Redis connections,
queues, commands, and script evaluation are bounded. Redis credentials are
mandatory, production uses TLS, and the dedicated deployment must use
`maxmemory-policy noeviction`, memory alerts, and capacity headroom so security
keys are never silently evicted.

Tokens that cannot be verified have no trustworthy subject, so a subject-keyed
Redis script cannot safely enforce their global rate. A distributed
gateway/ingress limit by network and total request rate is therefore a release
gate for the Core API and MCP resource. MCP's bounded in-process pre-auth gate
remains fail-closed defense in depth, not a multi-replica substitute. The Core
API has body limits and a post-verification subject proof quota, but no
equivalent invalid-token/global pre-auth limiter; production ingress is a hard
release gate for that boundary.

The Web Redis key layout is version 2 so pre-fencing sessions are intentionally
logged out. Refresh uses a same-slot lock plus compare-and-set session writes
and deletes; a slow failure cannot delete a newer session, and logout cannot be
undone by an in-flight refresh.

CLI login persistence, rotating refresh, and logout use one OS-owned loopback
socket mutex per user namespace and profile. Waiters re-read the keychain only
inside the critical section. The kernel releases the listener after exit or
crash. A rare hash-port collision conservatively serializes or fails the
operation after a bounded wait; it cannot permit concurrent refresh.

MCP discards its inbound token after authentication and never forwards it to
the Core API. Its public Core API calls carry no downstream credential.

## Consequences

- Clients without DPoP, ES256 P-256 proof support, and nonce retry support are
  intentionally incompatible with protected operations.
- Version-1 Web sessions and CLI keychain records require a fresh login.
- Replay-store or gateway failure denies protected requests instead of
  weakening proof-of-possession.
- Operators must capacity-plan and monitor the dedicated Redis and distributed
  ingress controls before a multi-replica production release.

## Verification

Unit and integration suites cover Bearer rejection, exact audience and approved
client boundaries, Unicode/control/size claims, key binding, remote header
rejection, nonce retry, replay, Redis Cluster key slots, concurrent refresh,
logout races, cache expiry/eviction, and fail-closed Redis behavior. Opt-in
tests execute the replay Lua scripts against the Compose Redis, and identity
smoke tests exercise live token and refresh DPoP against the synthetic realm.
