# Public source registry

`data/sources.json` is the fail-closed public catalog registry. A technically
reachable endpoint is not treated as reusable content.

Current registrations:

| Catalog                 | Campus scope         | License state       | Cache policy       | Default   |
| ----------------------- | -------------------- | ------------------- | ------------------ | --------- |
| UMN Sessions JSON       | All five campuses    | `LIVE_ONLY`         | `NO_CONTENT_CACHE` | Enabled   |
| Twin Cities events      | Twin Cities          | `LIVE_ONLY`         | `NO_CONTENT_CACHE` | Enabled   |
| Duluth events           | Duluth               | `LIVE_ONLY`         | `NO_CONTENT_CACHE` | Enabled   |
| Morris events candidate | Morris               | `APPROVAL_REQUIRED` | `NO_ACCESS`        | Disabled  |
| Other event pages       | Crookston, Rochester | `DEEPLINK_ONLY`     | `NO_CONTENT_CACHE` | Link only |
| Campus home pages       | All five campuses    | `DEEPLINK_ONLY`     | `NO_CONTENT_CACHE` | Link only |

The seven enabled `LIVE_ONLY` entries have an explicit, time-bounded review:

| Source family                          | Reviewed live-access purpose                                                                                          | Review evidence                                                                          | Accountable owner                                                                              | Reviewed at | Review expires |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------- | -------------- |
| UMN Sessions JSON (five campus routes) | Transiently normalize public session dates for calendar views; no durable content cache or derived artifacts          | [Sessions data-service documentation](https://asr-custom.umn.edu/sessions_data_service/) | [`catalog-integrations`](https://github.com/appleweiping/umn-gopher-assistant/security/policy) | 2026-07-22  | 2027-07-22     |
| Twin Cities events                     | Transiently normalize public event listings for the requested response; no durable content cache or derived artifacts | [Twin Cities feed builder](https://events.tc.umn.edu/feed_builder)                       | [`catalog-integrations`](https://github.com/appleweiping/umn-gopher-assistant/security/policy) | 2026-07-22  | 2027-07-22     |
| Duluth events                          | Transiently normalize public event listings for the requested response; no durable content cache or derived artifacts | [Duluth feed builder](https://calendar.d.umn.edu/feed_builder)                           | [`catalog-integrations`](https://github.com/appleweiping/umn-gopher-assistant/security/policy) | 2026-07-22  | 2027-07-22     |

These links are evidence for the bounded interface review, not evidence of a
University partnership or permission to mirror or redistribute content. A
`LIVE_ONLY` adapter must be disabled or re-reviewed after its recorded expiry.
The review does not expand the purpose encoded by `resourceKinds`,
`cachePolicy`, and `cacheDisposition`.

Rochester intentionally queries the Sessions service with institution
`UMNTC`; no `UMNRO` source is invented. All initial entries have freshness
`UNKNOWN`, `lastCheckedAt: null`, and official status `UNVERIFIED`. There are no
`OPEN_REUSE` claims because no reviewed reuse evidence is bundled.

`NO_CONTENT_CACHE` adapters may hold the response and normalized records only
long enough to serve the live request. They must discard both afterward and
must not build search indexes, summaries, translations, embeddings, or other
derived artifacts from that content. Morris event access remains entirely
disabled until approval evidence and a new policy review are recorded; adding
live-access review timestamps cannot enable an `APPROVAL_REQUIRED` or
`PROHIBITED` entry, and the contract rejects those timestamps on either state.
Historical denial evidence belongs in the audit log, not in this enablement
lifecycle.
