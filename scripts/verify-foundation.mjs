#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  "package.json",
  "pnpm-workspace.yaml",
  "turbo.json",
  "tsconfig.base.json",
  "apps/api/package.json",
  "apps/api/src/main.ts",
  "apps/web/package.json",
  "apps/web/app/page.tsx",
  "packages/contracts/package.json",
  "packages/contracts/src/index.ts",
  "packages/config/package.json",
  "packages/config/data/campuses.json",
  "packages/config/data/sources.json",
  "packages/db/src/schema.ts",
  "packages/db/migrations/0000_foundation.sql",
  "packages/testing/package.json",
  "openapi/openapi.yaml",
  "asyncapi/asyncapi.yaml",
  "infra/compose/docker-compose.yml",
  "infra/compose/.env.example",
  "infra/compose/keycloak/realm-export.json",
  "docs/architecture.md",
  "docs/data-source-policy.md",
  "docs/threat-model.md",
  "docs/adr/0001-selective-service-architecture.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "NOTICE",
];

const read = async (path) => readFile(resolve(root, path), "utf8");
const readJson = async (path) => JSON.parse(await read(path));

for (const file of requiredFiles) {
  await assert.doesNotReject(read(file), `required foundation file is missing: ${file}`);
}

const packageJson = await readJson("package.json");
assert.match(packageJson.packageManager, /^pnpm@10\./, "pnpm 10 must be pinned");
assert.match(packageJson.engines.node, /^24\./, "Node 24 LTS must be pinned");
assert.equal(packageJson.devDependencies.turbo.startsWith("^"), false, "Turborepo must be pinned exactly");

for (const jsonFile of [
  "package.json",
  "apps/api/package.json",
  "apps/web/package.json",
  "packages/contracts/package.json",
  "packages/config/package.json",
  "packages/db/package.json",
  "packages/testing/package.json",
  "packages/config/data/campuses.json",
  "packages/config/data/sources.json",
  "infra/compose/keycloak/realm-export.json",
]) {
  await assert.doesNotReject(readJson(jsonFile), `invalid JSON: ${jsonFile}`);
}

const campuses = await readJson("packages/config/data/campuses.json");
assert.deepEqual(
  campuses.map(({ id }) => id).sort(),
  ["crookston", "duluth", "morris", "rochester", "tc"],
  "exactly five supported campuses must be configured",
);
for (const campus of campuses) {
  assert.ok(campus.name.en && campus.name["zh-CN"], `${campus.id} must have bilingual names`);
  assert.ok(campus.sourceUrl.startsWith("https://"), `${campus.id} must include source provenance`);
  assert.equal(campus.officialStatus, "UNVERIFIED", "the independent app must not fabricate official status");
}
assert.equal(
  campuses.find(({ id }) => id === "rochester").academicCalendarCampusId,
  "tc",
  "Rochester must map to the Twin Cities academic calendar",
);

const allowedLicenses = new Set([
  "OPEN_REUSE",
  "LIVE_ONLY",
  "DEEPLINK_ONLY",
  "APPROVAL_REQUIRED",
  "PROHIBITED",
]);
const sources = await readJson("packages/config/data/sources.json");
assert.ok(sources.length >= 5, "at least one provenance-bearing source per campus is required");
for (const source of sources) {
  assert.ok(
    source.id && source.name?.en && source.name?.["zh-CN"],
    "sources need stable IDs and bilingual names",
  );
  assert.ok(source.sourceUrl?.startsWith("https://"), `${source.id} needs an HTTPS source URL`);
  assert.ok(allowedLicenses.has(source.licenseStatus), `${source.id} has an invalid license status`);
  assert.ok(source.attribution, `${source.id} needs attribution`);
  assert.equal(
    source.officialStatus,
    "UNVERIFIED",
    `${source.id} must not claim official integration status`,
  );
}

const openapi = await read("openapi/openapi.yaml");
for (const invariant of [
  "openapi: 3.1.0",
  "/v1/health:",
  "/v1/campuses:",
  "/v1/sources:",
  "/v1/events:",
  "/v1/places:",
  "/v1/routes:",
  "/v1/worlds/{campusId}/manifest:",
  "/v1/community/posts:",
  "/v1/ai/query:",
  "application/problem+json",
  "Idempotency-Key",
  "If-None-Match",
  "nextCursor",
]) {
  assert.ok(openapi.includes(invariant), `OpenAPI invariant missing: ${invariant}`);
}

const asyncapi = await read("asyncapi/asyncapi.yaml");
for (const eventName of [
  "source.updated.v1",
  "notification.requested.v1",
  "world.asset.published.v1",
  "community.reported.v1",
  "live.recording.started.v1",
]) {
  assert.ok(asyncapi.includes(eventName), `AsyncAPI event missing: ${eventName}`);
}

const compose = await read("infra/compose/docker-compose.yml");
for (const service of [
  "postgres",
  "keycloak",
  "redis",
  "nats",
  "meilisearch",
  "minio",
  "livekit",
  "openbao",
]) {
  assert.match(compose, new RegExp(`\\n  ${service}:`), `compose service missing: ${service}`);
}
assert.ok((compose.match(/healthcheck:/g) ?? []).length >= 8, "every compose service needs a healthcheck");

const trackedText = await Promise.all(requiredFiles.map(read));
const combined = trackedText.join("\n");
for (const forbidden of [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /\b(?:TODO_SECRET|REPLACE_WITH_REAL_SECRET|YOUR_SECRET_HERE)\b/i,
]) {
  assert.doesNotMatch(combined, forbidden, `forbidden credential material matched ${forbidden}`);
}

console.log(
  `Foundation verification passed: ${requiredFiles.length} required files and all invariants validated.`,
);
