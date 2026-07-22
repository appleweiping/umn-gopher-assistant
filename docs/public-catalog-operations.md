# Public catalog operations

This runbook covers the public academic-session and event catalog. It is an
operator guide for the implemented live connectors, not an authorization record
and not a substitute for [ADR 0004](adr/0004-live-only-public-catalog.md).

## Service boundary

UMN Gopher Assistant is an independent, unofficial project. A successful live
request does not imply University sponsorship, endorsement, data ownership, or
permission to republish the result.

| Resource      | Campus coverage                                   | Runtime state                                                                   | Retention                                                                                  |
| ------------- | ------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| UMN Sessions  | Twin Cities, Duluth, Crookston, Morris, Rochester | `LIVE_ONLY`; enabled while the reviewed evidence and kill switch remain current | `NO_CONTENT_CACHE`; response bodies and normalized records are discarded after the request |
| Public events | Twin Cities and Duluth                            | `LIVE_ONLY`; enabled while the reviewed evidence and kill switch remain current | `NO_CONTENT_CACHE`; response bodies and normalized records are discarded after the request |
| Public events | Morris                                            | `APPROVAL_REQUIRED`; connector and network access are disabled                  | No access; show the official calendar link                                                 |
| Public events | Crookston and Rochester                           | `DEEPLINK_ONLY`; no feed adapter                                                | No access; show the official event-page link                                               |

Rochester academic requests intentionally use the Twin Cities Sessions
institution code, `UMNTC`. Rochester is still a distinct product campus ID;
the project does not invent a separate academic institution code.

The [Morris official calendar](https://events.morris.umn.edu/calendar) publicly
offers a “Subscribe to Displayed Results” flow, including RSS. That user-facing
subscription option is not evidence that this project may transform or
redistribute the feed. The candidate JSON endpoint returned HTTP 403 from the
development environment during the 2026-07-22 review. This is an operational
observation, not a license conclusion: the Morris source remains
`APPROVAL_REQUIRED`, its switch defaults to disabled, and no Morris event
adapter is registered.

## Run API and web locally

Use Node.js 24 and the repository-pinned pnpm 10 release. From the repository
root:

```powershell
node --version
corepack enable
corepack install --global pnpm@10.34.5
pnpm --version
pnpm install --frozen-lockfile
pnpm verify:node-policy
```

Expected major versions are Node `24` and pnpm `10`. Start the API in one
PowerShell terminal:

```powershell
$env:PORT = "4000"
pnpm --filter @umn-gopher-assistant/api dev
```

Start the web application in a second terminal:

```powershell
$env:GOPHER_API_BASE_URL = "http://127.0.0.1:4000"
pnpm --filter @umn-gopher-assistant/web dev
```

Open `http://localhost:3000`. Development may omit
`GOPHER_API_BASE_URL`; its fail-safe loopback default is
`http://127.0.0.1:4000`. Setting it explicitly makes the API boundary visible
and avoids accidentally testing against a different process.

`GOPHER_API_BASE_URL` must be an origin only: no credentials, path, query, or
fragment. Development permits plain HTTP only for a loopback origin. Production
requires an HTTPS origin and fails startup/configuration rather than selecting a
remote default.

The public catalog routes are:

- `GET /v1/academics/sessions`
- `GET /v1/events`
- `GET /api/catalog/sessions` and `GET /api/catalog/events` through the web
  server's bounded same-origin proxy

Both resources require `campusId`. Optional `from` and `to` values must be
provided together as real `YYYY-MM-DD` dates and span no more than 183 days.
`limit` is 1 through 100. A continuation request must send the returned opaque
`cursor` with the same resource, campus, and date range.

Sessions routing is deliberately reviewed rather than inferred. The current
table covers `2026-06-01` through `2028-04-30` and selects no more than three
explicit term IDs per request. A range outside that table returns
`TERM_WINDOW_UNAVAILABLE` with the official Sessions documentation link instead
of guessing a term or returning misleading partial coverage.

## Production configuration

### Cursor HMAC key

Every production API process must receive `API_CATALOG_CURSOR_HMAC_KEY` from the
deployment secret manager. It must be the canonical, unpadded base64url encoding
of 32 through 64 random bytes. Generate a new 32-byte value without printing any
other environment material:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Do not commit, reuse between environments, or place the generated value in a
shell history on a shared host. All replicas behind one catalog endpoint must
use the same value. Rotation invalidates every outstanding cursor by design;
clients must restart pagination.

Local development may omit this variable and uses a clearly development-only
key. Production fails closed if it is missing or is not a canonical 32–64 byte
base64url value.

### Runtime source switches

A registry kill-switch key `source.<source-id>.enabled` becomes an environment
name by replacing punctuation with underscores, uppercasing it, and prefixing
`API_`. Only the exact values `ENABLED` and `DISABLED` are accepted. Any other
configured value disables network access.

| Source               | Environment name                            | Registry default |
| -------------------- | ------------------------------------------- | ---------------- |
| Twin Cities Sessions | `API_SOURCE_UMN_SESSIONS_TC_ENABLED`        | `ENABLED`        |
| Duluth Sessions      | `API_SOURCE_UMN_SESSIONS_DULUTH_ENABLED`    | `ENABLED`        |
| Crookston Sessions   | `API_SOURCE_UMN_SESSIONS_CROOKSTON_ENABLED` | `ENABLED`        |
| Morris Sessions      | `API_SOURCE_UMN_SESSIONS_MORRIS_ENABLED`    | `ENABLED`        |
| Rochester Sessions   | `API_SOURCE_UMN_SESSIONS_ROCHESTER_ENABLED` | `ENABLED`        |
| Twin Cities events   | `API_SOURCE_TC_EVENTS_FEED_ENABLED`         | `ENABLED`        |
| Duluth events        | `API_SOURCE_DULUTH_EVENTS_FEED_ENABLED`     | `ENABLED`        |
| Morris events        | `API_SOURCE_MORRIS_EVENTS_FEED_ENABLED`     | `DISABLED`       |

Setting a switch to `ENABLED` cannot override a missing/expired review,
`APPROVAL_REQUIRED`, `DEEPLINK_ONLY`, `PROHIBITED`, or a missing adapter. In
particular, enabling the Morris variable does not enable a Morris connector.
The process checks its environment-backed switch for each request; whether a
deployment environment change reaches an existing process without a restart is
an orchestrator-specific concern and must be tested in that environment.

The current enabled live-source reviews were recorded on 2026-07-22 and expire
at `2027-07-22T00:00:00.000Z`. Expiry disables the connector automatically.
Renewal requires a reviewed registry change with a current evidence URL,
reviewer, purpose, schema/access check, new review timestamp, and explicit
expiry no more than 366 days later, followed by normal review and deployment.
An environment variable must never be used to extend a terms review.

Production also requires the explicit OIDC and CORS settings described in the
[identity boundary](identity.md). Do not use local Keycloak values or the
development cursor key in a shared deployment.

The connector bulkhead, rolling request budget, and circuit breaker in this
milestone are process-local and grouped by physical upstream endpoint. Until a
distributed Redis-backed budget is deployed, run only one connector-capable API
replica or enforce the same aggregate limits at the egress proxy; scaling API
replicas must not multiply the publisher-facing request budget.

## Low-frequency live smoke

After building the API, run the repository smoke once from PowerShell. It makes
one catalog request for Sessions and one for each enabled event source; do not
put it in a polling loop. An event API response may fetch up to three upstream
pages, while a Sessions response makes one bounded, term-filtered upstream
request. The script prints only counts and coverage metadata, never the source
payload.

```powershell
pnpm build
$env:RUN_LIVE_CATALOG_SMOKE = "1"
pnpm smoke:catalog:live
```

Override `CATALOG_SMOKE_FROM` and `CATALOG_SMOKE_TO` only with a reviewed range
from `academic-term-routing.ts`. The script fails closed unless the explicit
one-off acknowledgement is present.

A successful response must have `Cache-Control: no-store`, an ETag, a matching
range, coverage metadata, and one successful source observation for every
upstream page represented. Each item points to the observation that produced
it. Do not print or archive the complete payload merely to prove availability.

Two reviewed defensive normalizations reflect current live publisher behavior:

- a Session whose optional enrollment-open date follows its own end date keeps
  the Session but exposes that contradictory optional field as `null`;
- event detail links accept clean HTTPS links on UMN-owned domains. Duluth also
  accepts only the exact `https://duluthumn.campusgroups.com/rsvp?id=<digits>`
  shape currently emitted by its official calendar. That exception is a
  user-visible deep link, not permission for the service to fetch CampusGroups,
  and it is not enabled for another campus.

To verify a disabled path without contacting its candidate feed, request Morris
events once:

```powershell
try {
  Invoke-WebRequest -Uri "$catalogBase/v1/events?campusId=morris&from=2026-08-01&to=2026-12-01&limit=3"
} catch {
  $problem = $_.ErrorDetails.Message | ConvertFrom-Json
  [pscustomobject]@{
    Status = [int]$_.Exception.Response.StatusCode
    FailureCode = $problem.failureCode
    SourceId = $problem.sourceId
    OfficialUrl = $problem.officialUrl
  }
}
```

The expected result is HTTP 503 with `SOURCE_DISABLED` and the official Morris
calendar URL. Crookston and Rochester event requests fail the same way and
return their reviewed official deep links; the normal web UI presents those
links directly instead of probing an unsupported feed.

## Pagination and the 8 MiB policy budget

Catalog cursors are HMAC-authenticated query continuations, not database
snapshot handles. Live publisher content can change between requests. A cursor
binds the campus, date range, upstream page/offset, accepted traversal bytes,
and observed digests; changing its query or bytes is rejected. If the bound
live page changes, the API may return `410 Gone`, and the client must restart
from the first page.

The event traversal ceiling is 8 MiB of pages **accepted into one cursor
chain**. It is not an aggregate network-transfer guarantee. Each response is
independently capped at 2 MiB before parsing. The first valid page that would
take the accepted chain over 8 MiB has necessarily already crossed the network;
the service observes it, discards its records, marks coverage as truncated, and
issues no successor cursor. Operators must not describe this as “at most 8 MiB
downloaded.”

An ETag is only a response validator. The service must obtain and validate the
current live result before it can determine a 304 response, so conditional GET
is not a free polling mechanism and does not authorize caching. Clients and
proxies must honor `no-store`.

## Failure and fallback behavior

Connector failures return RFC 9457 `application/problem+json` with a `traceId`,
`failureCode`, `sourceId`, and reviewed `officialUrl`. Catalog availability
errors also send `Retry-After` and `Cache-Control: no-store`. Common cases are:

- `SOURCE_DISABLED`: switch off, expired/missing review, unsupported license
  state, or no approved adapter;
- `TERM_WINDOW_UNAVAILABLE`: requested Sessions dates are outside the reviewed
  routing table;
- `TIMEOUT`, `RESPONSE_TOO_LARGE`, or `UPSTREAM_SCHEMA_DRIFT`: the upstream
  response could not be accepted safely;
- `CIRCUIT_OPEN`, `LOCAL_RATE_LIMITED`, `LOCAL_QUEUE_SATURATED`, or
  `LOCAL_QUEUE_TIMEOUT`: local protection deliberately refused or expired
  another upstream operation.

The product shows the official link and an unavailable/partial state. It does
not silently substitute a demo event, invented freshness timestamp, stale
content copy, or a different campus. Operational observations may retain only
bounded metadata such as status, duration, byte count, digest, parser version,
record counts, and failure code; they must not retain source content.

During an incident:

1. Disable the exact source switch and verify a request returns
   `SOURCE_DISABLED` plus the correct `officialUrl`.
2. Preserve trace IDs and bounded operational metadata, not raw source bodies.
3. Check the evidence URL, review expiry, publisher status, response media type,
   schema, and redirect behavior.
4. Re-enable only after the policy owner and operator agree the reviewed access
   assumptions still hold; then run one low-frequency request.
