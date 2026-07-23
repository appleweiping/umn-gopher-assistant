# Security and supply-chain evidence

The repository treats a green unit-test run as necessary but not sufficient for
a release. All third-party GitHub Actions and security-tool container images are
referenced by immutable commit or manifest digest. Dependabot proposes reviewed
updates; moving a pin is a security-sensitive code change.

Python dependency roots live in `requirements.in` and `requirements-dev.in`.
Their compiled lock files pin every transitive version and accepted artifact
hash; both CI and the production image install with `--require-hashes`. Update
them from `apps/ai-knowledge` with:

```bash
uv pip compile --default-index https://pypi.org/simple --python-version 3.13.11 \
  --universal --generate-hashes --output-file requirements.txt requirements.in
uv pip compile --default-index https://pypi.org/simple --python-version 3.13.11 \
  --universal --generate-hashes --output-file requirements-dev.txt requirements-dev.in
```

The knowledge-service base image is digest-pinned. Security-maintenance builds
also install explicit Debian package versions for the small set of base-layer
libraries with upstream fixes that have not yet reached that immutable Python
image digest. If Debian advances those packages, the build fails closed until a
reviewed pull request moves the version pins and attaches a clean image scan.

The edge gateway follows the same fail-closed pattern for its digest-pinned
Node.js base. Its final stage overlays the explicitly pinned Debian security
updates required by the blocking scan and removes npm, Corepack, and Yarn; the
runtime needs only the Node executable and compiled gateway JavaScript. Build
tooling remains confined to the discarded builder stage.

The PostgreSQL image uses a digest-pinned PostGIS Alpine base and builds
pgvector in a discarded, version-pinned compiler stage. Its runtime stage
overlays the base image's Go-built privilege-drop helper with Alpine's pinned
`su-exec` C implementation at the same compatible command path; the final
image contains neither the vulnerable lower-layer executable nor a compiler.
PostgreSQL itself defaults to UID/GID 70. Compose runs a network-isolated,
read-only one-shot permissions service as root solely to normalize the named
data volume (including volumes created by the previous Debian UID) before the
database starts; the long-running database process is never root.

## Pull request and main-branch gates

`.github/workflows/security.yml` runs these independent controls:

- CodeQL extended analysis for JavaScript/TypeScript and Python;
- a redacted Gitleaks scan across all reachable Git history;
- Trivy repository, secret, configuration, and image scans that fail on fixable
  high or critical findings;
- CycloneDX JSON SBOM generation for the repository and all three currently
  publishable images; and
- retained SBOM workflow artifacts tied to the exact commit SHA.

Unfixed operating-system findings are omitted from the blocking Trivy result
because there is no deployable remediation. They must still be reviewed during
release approval using the full registry vulnerability report; an accepted risk
needs an owner, expiration date, and upstream advisory link. A fixable high or
critical finding cannot be waived by changing the workflow flags.

## Tagged container release

`.github/workflows/release-containers.yml` accepts only an existing canonical
`vMAJOR.MINOR.PATCH` tag with no numeric leading zero, and the tagged commit
must be reachable from `origin/main`. Before any job receives package-write or
OIDC authority, the workflow repeats the Node and Python verification, the
retained-volume database upgrade/authority smoke, dependency audits, full-history
secret scan, image builds, and vulnerability scans.

The privileged job first pushes uniquely named staging references. It scans the
exact resulting digests, signs those digests with GitHub's short-lived OIDC
identity, generates and attaches CycloneDX attestations, and verifies both the
signature and attestation identities. Only then does it promote the already
verified digests to the formal SemVer tags. A failure before promotion can leave
an explicitly non-release staging reference, but cannot leave an unproved
SemVer image.

The GitHub `release` environment is a required operational control: configure
required reviewers and prevent self-review before enabling this workflow. Tag
protection must restrict `v*` creation or updates to the release maintainers,
and `main` must require the CI and security checks. The workflow's ancestry and
digest gates complement those repository controls; they do not replace them.

A tag push runs with the exact canonical tag workflow identity. A manual
`workflow_dispatch` is accepted only when the workflow itself is invoked from
`refs/heads/main`; its input still names an existing canonical tag whose commit
must be on `origin/main`. The verification identity below intentionally permits
only those two reviewed workflow refs.

No long-lived signing key or registry password is stored in the repository.
The workflow deliberately does not claim to publish Web, Core API, realtime,
or media containers until production Dockerfiles for those boundaries exist.

## Verification

Operators verify a released digest, not a mutable tag:

```bash
cosign verify \
  --certificate-identity-regexp '^https://github.com/appleweiping/umn-gopher-assistant/\.github/workflows/release-containers\.yml@refs/(heads/main|tags/v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*))$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/appleweiping/umn-gopher-assistant-ai-knowledge@sha256:<digest>
```

Use `cosign verify-attestation --type cyclonedx` with the same identity and
issuer constraints to retrieve and validate its SBOM attestation. Deployment
manifests must promote the verified digest, never a tag alone.
