import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build as bundle } from "esbuild";

import {
  hashedWorkerFilename,
  serviceWorkerSource,
  sha256Hex,
  workerBootstrapSource,
} from "./vault-worker-artifact.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerEntry = resolve(appRoot, "workers/personal-vault.worker.ts");
const workerOutput = resolve(appRoot, "public/__uga-vault/personal-vault.worker.mjs");
const serviceWorkerTemplate = resolve(appRoot, "scripts/sw.template.js");
const serviceWorkerOutput = resolve(appRoot, "public/sw.js");

await rm(dirname(workerOutput), { force: true, recursive: true });
await mkdir(dirname(workerOutput), { recursive: true });
const result = await bundle({
  bundle: true,
  entryPoints: [workerEntry],
  format: "esm",
  legalComments: "none",
  minify: true,
  outfile: workerOutput,
  platform: "browser",
  target: "es2024",
  write: false,
});

const bundledWorker = result.outputFiles?.[0];
if (bundledWorker === undefined || result.outputFiles?.length !== 1) {
  throw new Error("Expected esbuild to produce exactly one vault Worker artifact.");
}

const digest = sha256Hex(bundledWorker.contents);
const hashedFilename = hashedWorkerFilename(digest);
await writeFile(resolve(dirname(workerOutput), hashedFilename), bundledWorker.contents);
await writeFile(workerOutput, workerBootstrapSource(hashedFilename), "utf8");
await writeFile(
  serviceWorkerOutput,
  serviceWorkerSource(await readFile(serviceWorkerTemplate, "utf8"), digest),
  "utf8",
);
