# Security Policy

## Project status

UMN Gopher Assistant is an independent, unofficial, pre-production foundation.
It is not operated, sponsored, endorsed, or monitored by the University of
Minnesota. The project does not provide an emergency, police, medical,
accessibility-certification, or University support channel.

If someone may be in immediate danger, contact the appropriate local emergency
service and follow current official campus instructions. Do not wait for a
response from this project.

## Supported versions

Security fixes are made on the current default development line. No released
version or long-term support window is promised at this foundation stage.
Deployers are responsible for tracking current source, dependencies, container
images, runtime versions, and security advisories.

## Reporting a vulnerability

Please report vulnerabilities privately.

1. Use the repository host's private vulnerability-reporting feature when it is
   enabled.
2. If no private reporting feature is available, open a public issue containing
   only a request for a private maintainer contact.
3. Do not include exploit details, secrets, personal data, access tokens, source
   response bodies, or a vulnerable deployment URL in a public issue.

Include privately, where safe:

- affected commit, version, component, endpoint, or event;
- prerequisites and minimal reproduction steps;
- expected and observed behavior;
- likely impact and affected data classes;
- whether the issue is already being exploited;
- a safe proof of concept using synthetic data;
- suggested mitigation, if known;
- a way to coordinate follow-up.

Do not test against University systems, accounts, people, or networks. Do not
use real institutional credentials or access data beyond what is necessary to
demonstrate an issue in an environment you own or are explicitly authorized to
test.

## Response process

This project is maintained on a best-effort basis and cannot promise a fixed
response or remediation SLA. Maintainers will aim to:

1. acknowledge a usable private report;
2. reproduce and assess scope without exposing sensitive details;
3. disable an affected connector or feature when containment is needed;
4. rotate compromised project-controlled credentials;
5. prepare and verify a fix;
6. coordinate disclosure after affected users or operators can mitigate;
7. record lessons in tests, policy, or the threat model.

Reports may be closed as out of scope when they require unauthorized testing,
depend only on known schematic or explicitly unimplemented behavior, or provide
no security impact. Maintainers should still correct misleading status or
safety language.

## In scope

Security issues in project-authored code or configuration may include:

- authentication or authorization bypass;
- exposure of secrets, tokens, private content, or personal data;
- cross-site scripting, request forgery, injection, request smuggling, or SSRF;
- unsafe upload, object-storage, media-room, or recording behavior;
- retrieval or search crossing an authorization boundary;
- prompt injection that leads to unauthorized disclosure or action;
- connector activation without authorization or least-privilege controls;
- source, licensing, freshness, verification, or official-status tampering;
- event replay or duplicate delivery causing an unauthorized repeated action;
- dependency, build, container, or deployment behavior that creates a concrete
  compromise;
- a schematic or stale route being promoted into safety-critical guidance.

## Out of scope

Unless a project-controlled defect is also demonstrated:

- University of Minnesota websites, accounts, networks, applications, APIs, or
  physical systems;
- third-party services such as identity, model, media, search, storage, or
  infrastructure providers;
- social engineering, phishing, harassment, or denial-of-service testing;
- automated scanning that causes load or violates terms;
- findings that require stolen credentials or access to another person's data;
- missing production hardening in a local-only Compose environment that is
  clearly documented as non-production;
- hypothetical model hallucination without a policy bypass, disclosure,
  unauthorized action, or safety-status failure;
- content or trademark disputes without a security impact.

Report licensing, attribution, privacy, moderation, or trademark concerns
through a private maintainer channel when they contain sensitive information.
They may still require urgent containment even when they are not software
vulnerabilities.

## Safe-harbor intent

The maintainers support good-faith research performed:

- only on systems and data the researcher owns or has explicit permission to
  test;
- with minimal data access and no persistence beyond validation;
- without privacy violations, service disruption, extortion, or public
  disclosure before coordination;
- in compliance with applicable law and third-party terms.

This statement applies only to project-controlled systems and is not permission
to test University of Minnesota or third-party systems. The maintainers cannot
grant authorization on another organization's behalf.

## Secret handling

No real credential belongs in Git history, a client bundle, issue, log, fixture,
container image, screenshot, model prompt, or documentation example.

- Runtime secrets belong in the approved secret store, such as OpenBao.
- Service identities must be unique, least privilege, and independently
  revocable.
- Local development defaults must be replaced before any shared deployment.
- Missing approval or a missing secret must leave a connector disabled.
- Suspected exposure requires revocation and rotation; deleting a committed
  secret is not sufficient.

The repository must not contain University SSO credentials, browser cookies,
session exports, private keys, production tokens, or protected connector
responses.

## Data, AI, and source safety

- Public accessibility does not imply permission to copy or redistribute.
- Every source and derivative must preserve provenance and authorization scope.
- Retrieved documents and community content are untrusted data, not
  instructions.
- Secrets, protected records, and restricted source content must not be sent to
  a model provider without explicit approval.
- Model output cannot verify a source, route, identity, or official relationship.
- Campus and source records remain **UNVERIFIED** until evidence is reviewed.
- Project-authored world geometry remains **SCHEMATIC** until a scoped review
  verifies a particular artifact and use.
- Safety-critical routes, emergency-alert interpretation, and precise-location
  workflows remain disabled until separate safety and operational reviews.

See the [threat model](docs/threat-model.md) and
[data source policy](docs/data-source-policy.md).

## Deployment responsibility

The local Compose topology is for development. Anyone operating a deployment
must separately address TLS, network policy, unique secrets, access reviews,
data retention, backups, recovery, monitoring, alerting, log privacy,
dependency and image updates, incident ownership, and kill-switch testing.

Foundation code, a passing local verification command, or the presence of
OpenAPI/AsyncAPI contracts does not constitute a production security review.
