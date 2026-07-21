import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build as bundle } from "esbuild";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerEntry = resolve(appRoot, "workers/personal-vault.worker.ts");
const workerOutput = resolve(appRoot, "public/__uga-vault/personal-vault.worker.mjs");

await rm(dirname(workerOutput), { force: true, recursive: true });
await mkdir(dirname(workerOutput), { recursive: true });
await bundle({
  bundle: true,
  entryPoints: [workerEntry],
  format: "esm",
  legalComments: "none",
  minify: true,
  outfile: workerOutput,
  platform: "browser",
  target: "es2024",
});
