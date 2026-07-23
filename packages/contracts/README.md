# Public catalog contracts

This package owns the strict, runtime-validated contracts shared by public
catalog adapters and their consumers.

- `AcademicSession` is a normalized UMN session record. Campus and academic
  institution are separate fields, and Rochester must use `UMNTC`.
- `PublicEvent` contains bounded plain text, HTTPS links, an IANA time zone,
  and explicit provenance. Adapters must not pass source HTML through this
  contract.
- `SourceObservation` is operational evidence for one adapter attempt. It
  records parser version, response digest, counts, freshness, policy, and the
  cache action actually taken. It never contains the response body.
- `SourceDescriptor` separates license, reviewed live-access purpose, evidence,
  cache policy, concrete cache disposition, data classification, accountable
  owner, review expiry, and kill switch. Purpose is bounded by
  `resourceKinds`, `cachePolicy`, and `cacheDisposition` rather than inferred
  from endpoint reachability.

Schemas are strict: undeclared fields fail validation. `APPROVAL_REQUIRED` and
`PROHIBITED` sources must be disabled with `NO_ACCESS`; `OPEN_REUSE` requires a
reviewed license-evidence URL; `FRESH` requires check evidence. `LIVE_ONLY`
requires an HTTPS authorization-evidence URL plus paired review and expiry
timestamps, with expiry later than review and no more than 366 days away. The
contract rejects those timestamps entirely for `APPROVAL_REQUIRED` and
`PROHIBITED`; historical denial evidence belongs in a separate audit record.
Review evidence does not imply an official partnership. Tests use only
synthetic records.

AI knowledge governance uses two non-interchangeable resource kinds.
`AI_KNOWLEDGE_SUMMARY` is an isolated `OPEN_REUSE`/`CACHE_ALLOWED` project
artifact; `AI_VERIFICATION_LINK` is a single-campus `DEEPLINK_ONLY` source with
no reuse-license evidence. The contract rejects descriptors that combine or
swap those roles.
