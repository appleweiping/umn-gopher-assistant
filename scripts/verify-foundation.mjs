#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function extractUniqueYamlBlock(text, key, label) {
  const lines = text.split(/\r?\n/u);
  const keyPattern = new RegExp(`^(\\s*)${escapeRegularExpression(key)}:\\s*(?:#.*)?$`, "u");
  const matches = lines.flatMap((line, index) => {
    const match = keyPattern.exec(line);
    return match === null ? [] : [{ index, indentation: match[1].length }];
  });
  assert.equal(matches.length, 1, `${label} must contain exactly one ${key} block`);

  const [{ index: startIndex, indentation }] = matches;
  let endIndex = startIndex + 1;
  while (endIndex < lines.length) {
    const line = lines[endIndex];
    if (line.trim() === "") {
      endIndex += 1;
      continue;
    }
    const lineIndentation = /^\s*/u.exec(line)?.[0].length ?? 0;
    if (lineIndentation <= indentation) {
      break;
    }
    endIndex += 1;
  }

  return lines.slice(startIndex + 1, endIndex).join("\n");
}

function extractYamlInlineEnum(text, label) {
  const enumPattern = /^\s*enum:\s*\[([^\]]*)\]\s*(?:#.*)?$/u;
  const matches = text.split(/\r?\n/u).flatMap((line) => {
    const match = enumPattern.exec(line);
    return match === null ? [] : [match[1]];
  });
  assert.equal(matches.length, 1, `${label} must contain exactly one inline enum`);
  return matches[0].split(",").map((value) => value.trim().replace(/^(["'])(.*)\1$/u, "$2"));
}

function extractQuotedValues(text, quotePattern) {
  return [...text.matchAll(quotePattern)].map((match) => match[2]);
}

const requiredFiles = [
  ".npmrc",
  "package.json",
  "pnpm-workspace.yaml",
  "turbo.json",
  "tsconfig.base.json",
  "apps/api/package.json",
  "apps/api/src/main.ts",
  "apps/api/src/http/entity-tag.ts",
  "apps/api/src/http/pagination.ts",
  "apps/ai-knowledge/Dockerfile",
  "apps/ai-knowledge/requirements.txt",
  "apps/edge-gateway/Dockerfile",
  "apps/edge-gateway/package.json",
  "apps/edge-gateway/README.md",
  "apps/edge-gateway/src/proxy.ts",
  "apps/web/package.json",
  "apps/web/app/page.tsx",
  "packages/contracts/package.json",
  "packages/contracts/src/index.ts",
  "packages/config/package.json",
  "packages/config/data/campuses.json",
  "packages/config/data/sources.json",
  "packages/db/src/schema.ts",
  "packages/db/src/database-url.ts",
  "packages/db/migrations/0000_foundation.sql",
  "packages/db/migrations/meta/0000_snapshot.json",
  "packages/testing/package.json",
  "openapi/openapi.yaml",
  "asyncapi/asyncapi.yaml",
  "infra/compose/docker-compose.yml",
  "infra/compose/.env.example",
  "infra/compose/postgres/Dockerfile",
  "infra/compose/keycloak/realm-export.json",
  ".github/workflows/ci.yml",
  ".github/workflows/security.yml",
  ".github/workflows/release-containers.yml",
  ".github/dependabot.yml",
  ".gitleaksignore",
  "docs/architecture.md",
  "docs/data-source-policy.md",
  "docs/security-supply-chain.md",
  "docs/threat-model.md",
  "docs/adr/0001-selective-service-architecture.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "NOTICE",
  "scripts/smoke-foundation-db.mjs",
];

const read = async (path) => readFile(resolve(root, path), "utf8");
const readJson = async (path) => JSON.parse(await read(path));

for (const file of requiredFiles) {
  await assert.doesNotReject(read(file), `required foundation file is missing: ${file}`);
}

const packageJson = await readJson("package.json");
assert.match(packageJson.packageManager, /^pnpm@10\./, "pnpm 10 must be pinned");
assert.equal(packageJson.engines.node, ">=24 <25", "the supported Node 24 line must be bounded");
assert.equal(packageJson.devDependencies.turbo.startsWith("^"), false, "Turborepo must be pinned exactly");

const workflowTexts = await Promise.all(
  [
    ".github/workflows/ci.yml",
    ".github/workflows/security.yml",
    ".github/workflows/release-containers.yml",
  ].map(read),
);
for (const workflowText of workflowTexts) {
  const actionReferences = [...workflowText.matchAll(/^\s*uses:\s*[^@\s]+@([^\s#]+)/gmu)].map(
    (match) => match[1],
  );
  assert.ok(actionReferences.length > 0, "each workflow must declare at least one pinned action");
  for (const reference of actionReferences) {
    assert.match(reference, /^[a-f0-9]{40}$/u, `GitHub Action must use a full immutable SHA: ${reference}`);
  }
}

const securityWorkflow = workflowTexts[1];
for (const invariant of [
  "github/codeql-action/init@",
  "github/codeql-action/analyze@",
  "gitleaks/gitleaks:v8.29.0@sha256:",
  "aquasecurity/trivy:0.72.0@sha256:",
  "anchore/syft:v1.44.0@sha256:",
  "cyclonedx-json",
  "edge-gateway.tar",
  "edge-gateway.cdx.json",
  "--skip-files /workspace/apps/edge-gateway/Dockerfile.dockerignore",
  "--exclude './security-artifacts/**'",
  "0 commits scanned",
]) {
  assert.ok(securityWorkflow.includes(invariant), `security workflow invariant missing: ${invariant}`);
}

const releaseWorkflow = workflowTexts[2];
for (const invariant of [
  "id-token: write",
  "EDGE_IMAGE:",
  "steps.edge.outputs.digest",
  "cosign sign --yes",
  "cosign attest --yes --type cyclonedx",
  "provenance: mode=max",
]) {
  assert.ok(releaseWorkflow.includes(invariant), `release workflow invariant missing: ${invariant}`);
}

for (const jsonFile of [
  "package.json",
  "apps/api/package.json",
  "apps/edge-gateway/package.json",
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
const expectedInstitutions = new Map([
  ["tc", "UMNTC"],
  ["duluth", "UMNDL"],
  ["crookston", "UMNCR"],
  ["morris", "UMNMO"],
  ["rochester", "UMNTC"],
]);
for (const campus of campuses) {
  assert.equal(
    campus.academicInstitutionCode,
    expectedInstitutions.get(campus.id),
    `${campus.id} has an incorrect academic institution code`,
  );
}

const allowedLicenses = new Set([
  "OPEN_REUSE",
  "LIVE_ONLY",
  "DEEPLINK_ONLY",
  "APPROVAL_REQUIRED",
  "PROHIBITED",
]);
const sources = await readJson("packages/config/data/sources.json");
const verificationStates = ["schematic", "surveyed", "campus-reviewed", "verified", "retired"];
const allowedVerificationStates = new Set(verificationStates);
assert.ok(sources.length >= 5, "at least one provenance-bearing source per campus is required");
for (const source of sources) {
  assert.ok(
    source.id && source.name?.en && source.name?.["zh-CN"],
    "sources need stable IDs and bilingual names",
  );
  assert.ok(source.sourceUrl?.startsWith("https://"), `${source.id} needs an HTTPS source URL`);
  assert.ok(allowedLicenses.has(source.licenseStatus), `${source.id} has an invalid license status`);
  assert.ok(source.attribution, `${source.id} needs attribution`);
  assert.ok(
    allowedVerificationStates.has(source.verificationState),
    `${source.id} has an invalid verification state`,
  );
  assert.notEqual(
    source.officialStatus,
    "PARTNERSHIP_VERIFIED",
    `${source.id} must not claim an unverified institutional partnership`,
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
  "/v1/academics/courses:",
  "/v1/messages:",
  "/v1/live-events/{eventId}/join:",
  "/v1/moderation/cases:",
  "/v1/admin/sources/{sourceId}:",
  "application/problem+json",
  "Idempotency-Key",
  "If-None-Match",
  "nextCursor",
  "AcademicInstitutionCode",
  "academicInstitutionCode",
]) {
  assert.ok(openapi.includes(invariant), `OpenAPI invariant missing: ${invariant}`);
}
for (const scope of [
  "campus:read",
  "campus:write",
  "personal:read",
  "personal:write",
  "community:read",
  "community:write",
  "messages:read",
  "messages:write",
  "world:read",
  "world:write",
  "admin:read",
  "admin:write",
]) {
  assert.ok(openapi.includes(`${scope}:`), `OpenAPI OAuth scope missing: ${scope}`);
}

const contractCommon = await read("packages/contracts/src/common.ts");
const contractVerificationBlock = contractCommon.match(
  /VerificationStateSchema\s*=\s*z\.enum\((\[[\s\S]*?\])\)/u,
)?.[1];
assert.ok(contractVerificationBlock, "contracts VerificationState schema is missing");
assert.deepEqual(
  [...contractVerificationBlock.matchAll(/"([^"]+)"/gu)].map((match) => match[1]),
  verificationStates,
  "contracts VerificationState must use the exact lifecycle",
);

const openApiSchemas = extractUniqueYamlBlock(
  extractUniqueYamlBlock(openapi, "components", "OpenAPI"),
  "schemas",
  "OpenAPI components",
);
const openApiVerificationState = extractUniqueYamlBlock(
  openApiSchemas,
  "VerificationState",
  "OpenAPI schemas",
);
assert.deepEqual(
  extractYamlInlineEnum(openApiVerificationState, "OpenAPI VerificationState"),
  verificationStates,
  "OpenAPI VerificationState must use the exact lifecycle",
);

const sourceDescriptorContract = extractUniqueYamlBlock(
  openApiSchemas,
  "SourceDescriptor",
  "OpenAPI schemas",
);
assert.match(
  sourceDescriptorContract,
  /allOf:[\s\S]*?if:[\s\S]*?required:\s*\[licenseStatus\][\s\S]*?licenseStatus:\s*\{\s*const:\s*PROHIBITED\s*\}[\s\S]*?then:[\s\S]*?cachePolicy:\s*\{\s*const:\s*NO_ACCESS\s*\}/u,
  "OpenAPI SourceDescriptor must require PROHIBITED sources to use NO_ACCESS",
);
const adminSourcePolicyContract = extractUniqueYamlBlock(
  openApiSchemas,
  "AdminSourcePolicyUpdate",
  "OpenAPI schemas",
);
assert.match(
  adminSourcePolicyContract,
  /allOf:[\s\S]*?if:[\s\S]*?licenseStatus:\s*\{\s*const:\s*PROHIBITED\s*\}[\s\S]*?then:[\s\S]*?required:\s*\[cachePolicy\][\s\S]*?cachePolicy:\s*\{\s*const:\s*NO_ACCESS\s*\}/u,
  "OpenAPI admin policy must atomically pair PROHIBITED with NO_ACCESS",
);

const asyncapi = await read("asyncapi/asyncapi.yaml");
const asyncApiMessages = extractUniqueYamlBlock(
  extractUniqueYamlBlock(asyncapi, "components", "AsyncAPI"),
  "messages",
  "AsyncAPI components",
);
const worldAssetPublished = extractUniqueYamlBlock(
  asyncApiMessages,
  "WorldAssetPublished",
  "AsyncAPI messages",
);
const asyncApiVerificationState = extractUniqueYamlBlock(
  worldAssetPublished,
  "verificationState",
  "AsyncAPI WorldAssetPublished",
);
assert.deepEqual(
  extractYamlInlineEnum(asyncApiVerificationState, "AsyncAPI VerificationState"),
  verificationStates,
  "AsyncAPI VerificationState must use the exact lifecycle",
);

const drizzleSchema = await read("packages/db/src/schema.ts");
const drizzleVerificationMatches = [
  ...drizzleSchema.matchAll(
    /export\s+const\s+verificationStateEnum\s*=\s*pgEnum\(\s*(["'])verification_state\1\s*,\s*\[([\s\S]*?)\]\s*\);/gu,
  ),
];
assert.equal(
  drizzleVerificationMatches.length,
  1,
  "Drizzle schema must contain exactly one verification_state enum",
);
assert.deepEqual(
  extractQuotedValues(drizzleVerificationMatches[0][2], /(["'])(.*?)\1/gu),
  verificationStates,
  "Drizzle schema VerificationState must use the exact lifecycle",
);

const databaseMigration = await read("packages/db/migrations/0000_foundation.sql");
const migrationVerificationMatches = [
  ...databaseMigration.matchAll(/CREATE\s+TYPE\s+verification_state\s+AS\s+ENUM\s*\(([\s\S]*?)\)\s*;/giu),
];
assert.equal(
  migrationVerificationMatches.length,
  1,
  "database migration must contain exactly one verification_state enum",
);
assert.deepEqual(
  extractQuotedValues(migrationVerificationMatches[0][1], /(')((?:''|[^'])*)\1/gu).map((value) =>
    value.replace(/''/gu, "'"),
  ),
  verificationStates,
  "database migration VerificationState must use the exact lifecycle",
);

const campusContract = await read("packages/contracts/src/campus.ts");
for (const invariant of [
  "AcademicInstitutionCodeSchema",
  "CAMPUS_ACADEMIC_INSTITUTION_MAP",
  "resolveAcademicInstitution",
  'rochester: "UMNTC"',
]) {
  assert.ok(campusContract.includes(invariant), `academic institution invariant missing: ${invariant}`);
}

const campusesController = await read("apps/api/src/campuses/campuses.controller.ts");
for (const invariant of ["if-none-match", "ETag", "304"]) {
  assert.ok(campusesController.includes(invariant), `campuses conditional response missing: ${invariant}`);
}
const sourcesController = await read("apps/api/src/sources/sources.controller.ts");
const sourcesPageImplementation = `${sourcesController}\n${await read("apps/api/src/http/pagination.ts")}`;
for (const invariant of [
  '@Query("cursor")',
  '@Query("limit")',
  "nextCursor",
  "if-none-match",
  "ETag",
  "304",
]) {
  assert.ok(sourcesPageImplementation.includes(invariant), `sources page invariant missing: ${invariant}`);
}

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
  "ai-knowledge",
  "ai-knowledge-sync",
  "postgres-permissions",
  "postgres",
  "postgres-migrate",
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
const publishedPorts = [...compose.matchAll(/^\s+- "([^"\n]*:\d[^"\n]*)"$/gmu)].map((match) => match[1]);
assert.ok(publishedPorts.length > 0, "compose must publish local development ports");
assert.ok(
  publishedPorts.every((mapping) => mapping.startsWith("${COMPOSE_BIND_ADDRESS:-127.0.0.1}:")),
  "compose published ports must default to loopback",
);
for (const invariant of [
  "context: ./postgres",
  "./postgres/migrate.sh:/migrations/migrate.sh:ro",
  "../../packages/db/migrations/0000_foundation.sql:/migrations/0000_foundation.sql:ro",
  'test "$$(cat /proc/1/comm)" = postgres',
  "condition: service_completed_successfully",
  "chown -R 70:70 /var/lib/postgresql/data",
  "network_mode: none",
  "${POSTGRES_PORT:-5432}:5432",
]) {
  assert.ok(compose.includes(invariant), `compose database invariant missing: ${invariant}`);
}

const migrationRunner = await read("infra/compose/postgres/migrate.sh");
for (const invariant of [
  "platform_schema_migrations",
  "platform_schema_migrations_immutable",
  "sha256sum",
  "--single-transaction",
  "Applied migration checksum does not match the repository",
]) {
  assert.ok(migrationRunner.includes(invariant), `migration runner invariant missing: ${invariant}`);
}

const postgresDockerfile = await read("infra/compose/postgres/Dockerfile");
for (const invariant of [
  "docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e",
  "postgis/postgis:17-3.5-alpine@sha256:bcab61c139a9644dcf0bb00b0cff8ab84e36b3b6f74983cf229ddb4ea0c22897",
  "PGVECTOR_VERSION=0.8.2",
  "69f4019389af05dc1c9548deb8628e62878e6e207c03907f2b8af2016472cdaa",
  "SU_EXEC_VERSION=0.3-r0",
  "BUILD_BASE_VERSION=0.5-r4",
  "CLANG_VERSION=21.1.8-r3",
  "LLVM_VERSION=21.1.8-r1",
  "cp /sbin/su-exec /usr/local/bin/gosu",
  "gosu postgres id -u | grep -Fx '70'",
  "FROM scratch AS final",
  "COPY --from=runtime / /",
  'ENTRYPOINT ["docker-entrypoint.sh"]',
  'VOLUME ["/var/lib/postgresql/data"]',
  "USER 70:70",
]) {
  assert.ok(postgresDockerfile.includes(invariant), `Postgres image invariant missing: ${invariant}`);
}

const aiKnowledgeDockerfile = await read("apps/ai-knowledge/Dockerfile");
for (const invariant of [
  "python:3.13.11-slim-bookworm@sha256:20080e807bfc404f8450b185cf0fc95d553462673598549613735f70a5b4d5d0",
  "LIBCAP2_VERSION=1:2.66-4+deb12u3+b1",
  "LIBGNUTLS30_VERSION=3.7.9-2+deb12u7",
  "LIBSSL3_VERSION=3.0.20-1~deb12u2",
  "OPENSSL_VERSION=3.0.20-1~deb12u2",
  "--no-install-recommends",
  "--no-deps --require-hashes --requirement requirements.txt",
]) {
  assert.ok(aiKnowledgeDockerfile.includes(invariant), `AI image invariant missing: ${invariant}`);
}

const edgeGatewayDockerfile = await read("apps/edge-gateway/Dockerfile");
for (const invariant of [
  "node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57",
  "COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./",
  "pnpm install --frozen-lockfile --ignore-scripts",
  "GPGV_VERSION=2.2.40-1.1+deb12u2",
  "LIBCAP2_VERSION=1:2.66-4+deb12u3+b1",
  "LIBGNUTLS30_VERSION=3.7.9-2+deb12u7",
  "LIBPAM_VERSION=1.5.2-6+deb12u2",
  "rm -rf /opt/yarn-v1.22.22 /usr/local/lib/node_modules",
  "! command -v npm",
  "USER 10001:10001",
  'CMD ["node", "dist/main.js"]',
]) {
  assert.ok(edgeGatewayDockerfile.includes(invariant), `edge gateway image invariant missing: ${invariant}`);
}
const edgeGatewayProxy = await read("apps/edge-gateway/src/proxy.ts");
for (const invariant of [
  "request.socket.remoteAddress",
  "applyAllowedResponseHeaders",
  "x-gopher-ingress-ai-",
  "x-gopher-internal-ai-",
  "x-forwarded-",
  'target.target === "/readyz"',
]) {
  assert.ok(edgeGatewayProxy.includes(invariant), `edge gateway trust invariant missing: ${invariant}`);
}

const databaseUrlContract = await read("packages/db/src/database-url.ts");
const environmentExample = await read("infra/compose/.env.example");
const databaseSmoke = await read("scripts/smoke-foundation-db.mjs");
const localDatabaseUrl = "postgres://gopher:local-postgres-password-only@127.0.0.1:5432/gopher";
assert.ok(databaseUrlContract.includes(localDatabaseUrl), "database module local URL must match Compose");
assert.ok(environmentExample.includes(localDatabaseUrl), "example DATABASE_URL must match Compose");
assert.ok(databaseSmoke.includes('POSTGRES_PORT: "0"'), "database smoke must use an ephemeral host port");

const drizzleSchemaText = await read("packages/db/src/schema.ts");
const databaseMigrationText = await read("packages/db/migrations/0000_foundation.sql");
for (const invariant of [
  "campuses_academic_mapping_check",
  "campuses_source_url_https_check",
  "sources_campus_ids_nonempty_check",
  "prohibited_source_access_check",
  "source_snapshots_content_hash_check",
  "source_snapshots_embedding_hnsw_idx",
  "outbox_events_attempts_check",
  "outbox_events_unpublished_idx",
  "world_manifests_revision_check",
  "audit_events_outcome_check",
  "geometry(Point,4326)",
  "sources_external_id_uidx",
]) {
  assert.ok(drizzleSchemaText.includes(invariant), `Drizzle schema invariant missing: ${invariant}`);
  assert.ok(databaseMigrationText.includes(invariant), `database migration invariant missing: ${invariant}`);
}

const databaseSnapshot = JSON.parse(await read("packages/db/migrations/meta/0000_snapshot.json"));
assert.equal(
  databaseSnapshot.tables?.["public.campuses"]?.columns?.centroid?.type,
  "geometry(Point,4326)",
  "Drizzle baseline must retain Point SRID 4326",
);
for (const [tableName, indexName] of [
  ["public.sources", "sources_external_id_uidx"],
  ["public.source_snapshots", "source_snapshots_source_hash_uidx"],
  ["public.world_manifests", "world_manifests_campus_version_revision_uidx"],
]) {
  assert.equal(
    databaseSnapshot.tables?.[tableName]?.indexes?.[indexName]?.isUnique,
    true,
    `Drizzle baseline unique index missing: ${indexName}`,
  );
}
for (const [tableName, foreignKeyName, onDelete] of [
  ["public.source_snapshots", "source_snapshots_source_id_sources_id_fk", "cascade"],
  ["public.world_manifests", "world_manifests_campus_id_campuses_id_fk", "restrict"],
]) {
  assert.equal(
    databaseSnapshot.tables?.[tableName]?.foreignKeys?.[foreignKeyName]?.onDelete,
    onDelete,
    `Drizzle baseline foreign key missing: ${foreignKeyName}`,
  );
  assert.ok(
    databaseMigrationText.includes(`CONSTRAINT ${foreignKeyName} FOREIGN KEY`),
    `database migration foreign key missing: ${foreignKeyName}`,
  );
}

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
