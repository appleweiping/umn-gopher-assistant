import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const excludedFixtureSegments = new Set([
  ".git",
  ".next",
  ".pytest_cache",
  ".ruff_cache",
  ".turbo",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);
const fixtureTestTimeoutMs = 60_000;

function isExcludedFixtureSegment(segment) {
  return excludedFixtureSegments.has(segment) || segment.endsWith(".egg-info");
}

async function copyFixture() {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "foundation-verifier-"));
  const fixtureRoot = join(temporaryDirectory, "workspace");
  await cp(projectRoot, fixtureRoot, {
    recursive: true,
    filter(source) {
      const segments = relative(projectRoot, source).split(sep);
      return !segments.some(isExcludedFixtureSegment);
    },
  });
  return { fixtureRoot, temporaryDirectory };
}

const malformedVerificationEnums = [
  {
    label: "OpenAPI",
    path: "openapi/openapi.yaml",
    original: "enum: [schematic, surveyed, campus-reviewed, verified, retired]",
    replacement:
      "enum: [schematic, surveyed, campus-reviewed, verified, fabricated]\n      description: retired",
  },
  {
    label: "AsyncAPI",
    path: "asyncapi/asyncapi.yaml",
    original: "enum: [schematic, surveyed, campus-reviewed, verified, retired]",
    replacement:
      "enum: [schematic, surveyed, campus-reviewed, verified, fabricated]\n                description: retired",
  },
  {
    label: "Drizzle schema",
    path: "packages/db/src/schema.ts",
    original: '  "retired",\n]);\nexport const officialStatusEnum',
    replacement:
      '  "fabricated",\n]);\nconst verificationStateDescription = "retired";\nexport const officialStatusEnum',
  },
  {
    label: "database migration",
    path: "packages/db/migrations/0000_foundation.sql",
    original:
      "CREATE TYPE verification_state AS ENUM ('schematic', 'surveyed', 'campus-reviewed', 'verified', 'retired');",
    replacement:
      "CREATE TYPE verification_state AS ENUM ('schematic', 'surveyed', 'campus-reviewed', 'verified', 'fabricated');\nCOMMENT ON TYPE verification_state IS 'retired';",
  },
];

describe("foundation VerificationState verification", () => {
  it.each(malformedVerificationEnums)(
    "rejects a malformed $label enum despite displaced text",
    async (fixture) => {
      const { fixtureRoot, temporaryDirectory } = await copyFixture();
      try {
        const targetPath = join(fixtureRoot, fixture.path);
        const originalText = await readFile(targetPath, "utf8");
        expect(originalText).toContain(fixture.original);
        await writeFile(targetPath, originalText.replace(fixture.original, fixture.replacement), "utf8");

        const result = spawnSync(process.execPath, [join(fixtureRoot, "scripts/verify-foundation.mjs")], {
          cwd: fixtureRoot,
          encoding: "utf8",
        });

        expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0);
        expect(`${result.stdout}\n${result.stderr}`).toContain(
          `${fixture.label} VerificationState must use the exact lifecycle`,
        );
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    },
    // Copying a clean source fixture can be slower on Windows or antivirus-scanned filesystems.
    fixtureTestTimeoutMs,
  );
});

describe("privileged release workflow invariants", () => {
  it("scans and proves immutable staging digests before SemVer promotion", async () => {
    const release = await readFile(join(projectRoot, ".github/workflows/release-containers.yml"), "utf8");
    const continuousIntegration = await readFile(join(projectRoot, ".github/workflows/ci.yml"), "utf8");

    expect(release).toContain("environment: release");
    expect(release).toContain("group: release-containers-${{ inputs.version || github.ref_name }}");
    expect(release).toContain("cancel-in-progress: false");
    expect(release).toContain("^v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$");
    expect(release).toContain("RELEASE_WORKFLOW_REF: ${{ github.ref }}");
    expect(release).toContain('"refs/heads/main"');
    expect(release).toContain('"refs/tags/$RELEASE_VERSION"');
    expect(release).toContain("git merge-base --is-ancestor");
    expect(release).toContain("refs/remotes/origin/main");
    expect(release).toContain("SMOKE_DB_REUSE_IMAGE=true pnpm smoke:db");
    expect(continuousIntegration).toContain("run: pnpm smoke:db");
    expect(release).toContain("staging-${{ github.run_id }}-${{ github.run_attempt }}");
    expect(release).not.toContain("tags: ${{ env.AI_IMAGE }}:${{ env.RELEASE_VERSION }}");
    expect(release).not.toContain("tags: ${{ env.EDGE_IMAGE }}:${{ env.RELEASE_VERSION }}");
    expect(release).not.toContain("tags: ${{ env.POSTGRES_IMAGE }}:${{ env.RELEASE_VERSION }}");
    expect(release).toContain(
      "org.opencontainers.image.revision=${{ needs.release-gate.outputs.release_sha }}",
    );
    expect(release).toContain('cosign sign --yes "$EDGE_IMAGE@${{ steps.edge.outputs.digest }}"');
    expect(release).toContain("--predicate release-artifacts/edge-gateway.cdx.json");
    expect(release).toContain("--input /scan/edge-gateway.tar");
    expect(release).toContain('"$EDGE_IMAGE@${{ steps.edge.outputs.digest }}"');
    expect(release).toContain('--tag "$EDGE_IMAGE:$RELEASE_VERSION"');
    expect(release).toContain('test "$edge_promoted" = "${{ steps.edge.outputs.digest }}"');

    const exactDigestScan = release.indexOf("Pull and scan the exact pushed digests");
    const signature = release.indexOf("Sign immutable image digests with GitHub OIDC");
    const attestation = release.indexOf("Generate CycloneDX attestations for published digests");
    const verification = release.indexOf("Verify signatures and CycloneDX attestations before promotion");
    const promotion = release.indexOf("Promote only verified digests to the formal SemVer tags");
    expect(exactDigestScan).toBeGreaterThan(0);
    expect(signature).toBeGreaterThan(exactDigestScan);
    expect(attestation).toBeGreaterThan(signature);
    expect(verification).toBeGreaterThan(attestation);
    expect(promotion).toBeGreaterThan(verification);
  });
});
