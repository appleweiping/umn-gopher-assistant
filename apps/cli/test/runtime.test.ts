import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { assertSupportedNodeRuntime } from "../src/runtime.js";

describe("CLI Node.js runtime gate", () => {
  it.each(["24.0.0", "24.11.1", "24.99.0"])("accepts Node.js %s", (version) => {
    expect(() => assertSupportedNodeRuntime(version)).not.toThrow();
  });

  it.each(["22.22.0", "23.11.1", "24.99.0-pre.1", "25.0.0", "not-a-version"])(
    "rejects unsupported Node.js version %s",
    (version) => {
      expect(() => assertSupportedNodeRuntime(version)).toThrow("uga requires Node.js >=24 <25");
    },
  );

  it("rejects an unsupported runtime before the CLI dependency graph is evaluated", async () => {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const temporaryRoot = await mkdtemp(join(tmpdir(), "uga-runtime-gate-"));
    try {
      await Promise.all([
        copyFile(resolve(packageRoot, "dist/bin.js"), join(temporaryRoot, "bin.js")),
        copyFile(resolve(packageRoot, "dist/runtime.js"), join(temporaryRoot, "runtime.js")),
        writeFile(
          join(temporaryRoot, "unsupported-runtime.mjs"),
          'Object.defineProperty(process.versions, "node", { configurable: true, value: "22.21.1" });\n',
          "utf8",
        ),
      ]);

      // cli.js is intentionally absent. A static or premature CLI import would
      // therefore fail with ERR_MODULE_NOT_FOUND instead of the policy error.
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          pathToFileURL(join(temporaryRoot, "unsupported-runtime.mjs")).href,
          join(temporaryRoot, "bin.js"),
        ],
        {
          cwd: temporaryRoot,
          encoding: "utf8",
          env: { PATH: process.env["PATH"] ?? "" },
          timeout: 10_000,
          windowsHide: true,
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(3);
      expect(result.stderr).toContain("uga requires Node.js >=24 <25; detected 22.21.1");
      expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });
});
