import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const excludedFixtureSegments = new Set([".git", ".next", ".turbo", "coverage", "dist", "node_modules"]);

async function copyFixture() {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "foundation-verifier-"));
  const fixtureRoot = join(temporaryDirectory, "workspace");
  await cp(projectRoot, fixtureRoot, {
    recursive: true,
    filter(source) {
      const segments = relative(projectRoot, source).split(sep);
      return !segments.some((segment) => excludedFixtureSegments.has(segment));
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
  );
});
