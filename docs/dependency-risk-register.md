# Dependency risk register

This register records known dependency advisories that cannot yet be removed
without replacing or patching an upstream tool. An entry is not a blanket
waiver: it has a narrow exposure statement, compensating controls, an owner,
and a review deadline. Production dependency findings remain release gates.

## Open entries

### DEP-2026-001 — esbuild development server CORS advisory

| Field                 | Decision                                                                                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Advisory              | `GHSA-67mh-4wv8-2f99`                                                                                                                                                                                                        |
| Severity              | Moderate                                                                                                                                                                                                                     |
| Affected path         | `@umn-gopher-assistant/db > drizzle-kit > @esbuild-kit/esm-loader > @esbuild-kit/core-utils > esbuild@0.18.20`                                                                                                               |
| Detected              | 2026-07-20 with `pnpm audit --json` against the official npm registry                                                                                                                                                        |
| Production exposure   | None. `pnpm audit --prod --json` reports zero findings and `drizzle-kit` is a private workspace development dependency.                                                                                                      |
| Reachable feature     | The advisory concerns esbuild's optional HTTP development server. This project invokes Drizzle Kit only for schema checks, migration generation, and migrations; it must not invoke or expose an esbuild development server. |
| Compensating controls | Database tooling runs only from a trusted local or CI environment, binds no esbuild server port, is excluded from runtime images, and remains behind the Node 24/frozen-lockfile verification gate.                          |
| Resolution trigger    | Upgrade or replace the Drizzle Kit dependency chain when it accepts `esbuild >=0.25.0`, or apply a reviewed compatible override with migration and rollback tests.                                                           |
| Owner                 | Platform maintainers                                                                                                                                                                                                         |
| Next review           | 2026-08-20, and on every lockfile change before that date                                                                                                                                                                    |
| Release effect        | Does not block local platform development; blocks any artifact that accidentally contains Drizzle Kit or the affected esbuild version.                                                                                       |

Evidence for a review must include both the complete audit and the production-
only audit. If the affected package becomes production-reachable, starts a
listener, rises to high/critical severity, or the controls cannot be verified,
this exception expires immediately and the release is blocked.
