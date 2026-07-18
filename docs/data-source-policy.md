# Data Source and Asset Policy

## Purpose

This policy governs external data, documents, feeds, media, geometry, models,
and service connectors used by UMN Gopher Assistant. It applies to development,
tests, demos, generated content, and production-like deployments.

The project is independent and unofficial. A University of Minnesota domain,
public webpage, or recognizable campus asset is not permission to integrate,
copy, cache, translate, modify, or redistribute it.

## Core rule

**No external content enters a user-visible or model-retrieval path until its
source, rights, intended use, cache behavior, verification state, and
attribution are recorded.**

When evidence is incomplete, the system fails closed. Prefer a clearly
attributed deep link to the current source over an unlicensed or stale copy.

## Required source record

Every source needs a stable registry record with:

| Field                 | Requirement                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| Source ID             | Stable, non-secret identifier                                           |
| Campus IDs            | Explicit set of applicable campuses                                     |
| Display name          | English and Simplified Chinese where shown to users                     |
| Publisher             | Person or organization responsible for the source                       |
| Source URL            | Canonical HTTPS URL or documented non-web origin                        |
| License status        | One of the policy states below                                          |
| Attribution           | Text and link required at the point of use                              |
| Cache policy          | What may be retained, at which granularity, and for how long            |
| Freshness state       | Whether recency is known and how it is checked                          |
| Verification state    | Evidence for correctness of the specific use                            |
| Official status       | Evidence of an authorized institutional relationship                    |
| Last checked          | Timestamp and, for high-risk uses, reviewer or automated check evidence |
| Data classes          | Personal, sensitive, safety-critical, copyrighted, or public metadata   |
| Owner and kill switch | Accountable maintainer and disable procedure                            |

The initial registry entries for campus home pages are **DEEPLINK_ONLY**,
**NO_CONTENT_CACHE**, and **UNVERIFIED**. Do not expand those permissions based
only on technical accessibility.

## Licensing states

| State                 | Allowed behavior                                                                                                    | Prohibited behavior                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **OPEN_REUSE**        | Use within the exact terms of a verified open license, with required attribution, notices, and share-alike handling | Uses outside the license, removal of attribution, or assuming one asset license covers neighboring content |
| **LIVE_ONLY**         | Retrieve from an approved live interface for an approved purpose; retain only the minimum transient data allowed    | Building a mirror, training corpus, archive, or durable derived dataset unless separately permitted        |
| **DEEPLINK_ONLY**     | Store minimal link metadata and send the user to the canonical source                                               | Copying page body, images, files, menus, directory results, or other target content                        |
| **APPROVAL_REQUIRED** | Keep the connector and data path disabled while authorization is reviewed                                           | Testing with real institutional credentials or enabling the path because code exists                       |
| **PROHIBITED**        | Record the denial so the source is not reconsidered accidentally                                                    | Fetching, storing, transforming, embedding, displaying, or redistributing the content                      |

A source may contain items with different licenses. Record rights at the
smallest practical unit. If a page is open but a photograph or embedded map is
not, the asset remains excluded.

## Verification, official status, and schematic content

These are separate axes. The contract uses these verification states:

| State          | Meaning                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------- |
| **SCHEMATIC**  | Project-authored approximation; never a survey, official map, accessible route, or live condition |
| **UNVERIFIED** | Provenance may be known, but the scoped accuracy or reviewer evidence is incomplete               |
| **VERIFIED**   | The particular version, claim, and intended use passed a documented risk-appropriate review       |
| **REJECTED**   | Review found the artifact unsuitable; it must not be served as approved for the same use          |

Official relationship is tracked independently:

| State                    | Meaning                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| **UNVERIFIED**           | No accepted evidence of an authorized institutional relationship                              |
| **PUBLISHER_ASSERTED**   | The publisher asserts a status, but the project has not verified a partnership or integration |
| **PARTNERSHIP_VERIFIED** | Current approval artifacts were reviewed for the exact integration and intended use           |

Verified does not mean official. **PUBLISHER_ASSERTED** does not mean
**PARTNERSHIP_VERIFIED**. Official-looking styling does not make content
verified. A University-operated page can still be stale, restrict reuse, or be
unsuitable for a safety-critical claim.

Freshness is also explicit:

| State       | Meaning                                                                            |
| ----------- | ---------------------------------------------------------------------------------- |
| **FRESH**   | Checked within the source's documented risk-appropriate freshness window           |
| **STALE**   | Outside that window; show a warning and do not use for a safety-critical decision  |
| **EXPIRED** | No longer eligible for current use; retain only for an approved historical purpose |
| **UNKNOWN** | No reliable check time or freshness rule is available                              |

At the foundation stage, current campus and source records remain
**UNVERIFIED**, and world manifests are **SCHEMATIC**.

## Source acceptance workflow

Before registering or enabling a source:

1. **Identify the publisher.** Record the canonical origin and applicable
   campuses.
2. **Define the purpose.** List the user task and exact fields required.
3. **Classify the data.** Identify personal, sensitive, protected, copyrighted,
   location, media, and safety-critical fields.
4. **Review rights.** Record license text, terms, robots guidance, API terms,
   attribution, modification, translation, caching, and redistribution rules.
5. **Review access.** Confirm whether authentication is required and whether
   the project is authorized to use it. Public browser access is not equivalent
   to API permission.
6. **Minimize.** Exclude every field not required for the stated purpose.
7. **Set retention.** Define cache duration, deletion triggers, and derived-data
   cleanup.
8. **Validate.** Add schemas, fixtures with synthetic data, size limits,
   timeouts, rate limits, and hostile-input tests.
9. **Verify output.** Define freshness checks, evidence, user-visible
   attribution, and fallback behavior.
10. **Approve and enable.** Link the recorded authorization to deployment
    configuration and test the kill switch.

Re-review when the publisher, URL, schema, license, terms, authentication,
purpose, or user-visible representation changes.

## Connector policy

Institutional and third-party connectors are deny-by-default.

An approved connector must:

- run server-side behind a domain port;
- use a dedicated least-privilege identity;
- load credentials from the approved runtime secret store, such as OpenBao;
- define token rotation and revocation;
- use bounded timeouts, rate limits, retries, circuit breakers, and response
  size limits;
- validate redirects and destination hosts to reduce SSRF risk;
- validate every response against a versioned schema;
- record source, fetch time, transformations, and applicable campus;
- prevent source content from becoming trusted instructions to an AI system;
- support a rapid disable switch;
- expose enough health information to detect stale or partial results.

Missing credentials or approval must disable the connector, not select a hidden
fallback credential. Real tokens, cookies, session exports, keys, passwords, or
protected response bodies must never be committed or copied into test fixtures.

## Collection and crawling

The project does not bypass access controls, CAPTCHAs, rate limits, paywalls,
robots directives, or technical restrictions. It does not scrape authenticated
University pages, People Search results, student records, library-account data,
or other protected systems without explicit written authorization and a
separate privacy review.

For an allowed public collection:

- use an identifiable client and documented contact mechanism when required;
- respect publisher rate and concurrency limits;
- fetch incrementally with conditional requests where supported;
- stop on unexpected authentication, terms, or schema changes;
- store only fields permitted by the registry record;
- never turn a crawl into a general archive.

## Caching and derived data

| Policy               | Permitted retention                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| **NO_ACCESS**        | Do not retrieve or store source content; required when license status is **PROHIBITED**                     |
| **NO_CONTENT_CACHE** | Retain the registry record, attribution, check outcome, and minimal operational metadata, not response body |
| **METADATA_ONLY**    | Cache only specifically approved metadata fields; no page body, file, image, or other content copy          |
| **CACHE_ALLOWED**    | Cache approved fields under a separately documented time-to-live, retention, and deletion rule              |

Embeddings, summaries, translations, thumbnails, search indexes, and extracted
facts are derived copies. They inherit the source's restrictions and deletion
requirements. Deleting or prohibiting a source requires removal from caches,
indexes, objects, embeddings, training sets, and backups according to the
approved retention schedule.

Do not send restricted source content, personal data, secrets, or connector
responses to a model provider unless the source record and privacy review
explicitly authorize that processing.

## Attribution and user experience

Attribution must be visible where the information is used and include the
publisher, source link, and freshness indicator when available. Do not hide
attribution solely in an about page.

The interface must:

- distinguish source text from project summaries and translations;
- label stale, unknown-freshness, unverified, and schematic content;
- show when English fallback text is being used;
- avoid University trade dress that could imply endorsement;
- offer the canonical source when reuse is limited;
- never describe a connector as official without recorded authorization.

## Campus maps, routes, and 3D assets

No University logo, Goldy Gopher artwork, proprietary map, floor plan, photo,
scan, GIS layer, building model, texture, or video may be bundled without a
compatible license or written permission.

Project-authored primitive geometry may be used for a clearly labeled schematic
demo if it:

- is not traced or reconstructed from a restricted source;
- does not claim survey-grade or indoor accuracy;
- contains no hidden sensitive-space detail;
- includes author, tool, license, version, and source notes;
- cannot be mistaken for a verified accessible or emergency route.

Safety-critical routing remains disabled until geometry, barriers, seasonal
conditions, accessible entrances, construction, time validity, and review
ownership are verified. If those checks are not current, deep-link to official
resources.

## Personal and community data

Do not collect student records, precise location history, identity-provider
tokens, disability information, private messages, or media merely because a
planned schema can represent them.

Community submissions are untrusted and unofficial. Before publication they
need:

- clear contributor rights and a compatible content license;
- moderation and abuse reporting;
- personal-data and sensitive-location review;
- malware and file validation for uploads;
- provenance that does not impersonate an official source;
- correction and deletion mechanisms.

Directory information can still create privacy and safety risk. Respect
suppression, opt-out, and removal signals and never infer sensitive attributes.

## AI and retrieval rules

Retrieved source content is data, not an instruction. The AI layer must:

- keep system and developer instructions separate from retrieved text;
- enforce authorization before retrieval and again before display;
- cite the actual source used;
- state uncertainty and freshness;
- decline to invent missing campus-specific facts;
- never upgrade unverified or schematic content through confident wording;
- route emergency, medical, police, and safety questions to current official
  resources rather than claim operational authority.

Generated text cannot satisfy a verification review.

## Source incidents

Disable a source or connector immediately when:

- rights or authorization are disputed;
- credentials may be exposed;
- protected or excessive data was collected;
- content becomes stale in a safety-relevant way;
- the publisher changes schema, terms, domain, or access controls unexpectedly;
- attribution, campus scoping, or verification labels are missing;
- hostile content can influence model or user behavior.

Preserve minimal audit evidence, follow the [security policy](../SECURITY.md),
notify the responsible maintainer, and remove unauthorized derivatives. Do not
retain problematic content merely to debug it.

## Review checklist

Before merge or release, confirm:

- [ ] Source registry entry exists and uses an allowed licensing state.
- [ ] Authorization and license evidence covers the exact use.
- [ ] Campus and locale scope are explicit.
- [ ] Cache, retention, deletion, and derived-data behavior are documented.
- [ ] Attribution and freshness are visible.
- [ ] Fixtures are synthetic and contain no credentials or protected records.
- [ ] Connector is gated and has a tested kill switch.
- [ ] Schematic, unverified, verified, and official labels are not conflated.
- [ ] No unlicensed asset is bundled.
- [ ] Safety-critical behavior remains disabled unless its separate review is
      current.
