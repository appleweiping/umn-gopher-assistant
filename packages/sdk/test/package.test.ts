import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(packageRoot, "../..");

describe("SDK package contents", () => {
  it("ships the repository Apache license and independent-project notice", () => {
    for (const file of ["LICENSE", "NOTICE"]) {
      expect(readFileSync(resolve(packageRoot, file), "utf8")).toBe(
        readFileSync(resolve(repositoryRoot, file), "utf8"),
      );
    }
  });

  it("includes licensing material in the explicit package file list", () => {
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      files?: string[];
    };

    expect(manifest.files).toEqual(expect.arrayContaining(["dist", "LICENSE", "NOTICE"]));
    expect(manifest.dependencies?.["zod"]).toBe("catalog:");
  });
});
