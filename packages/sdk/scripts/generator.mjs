import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import openapiTS, { astToString } from "openapi-typescript";
import { parse } from "yaml";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const contractPath = resolve(repositoryRoot, "openapi/openapi.yaml");
const generatedDirectory = resolve(packageRoot, "src/generated");

const generatedHeader = `/**
 * Generated from openapi/openapi.yaml. DO NOT EDIT.
 * Run \`pnpm --filter @umn-gopher-assistant/sdk generate\` after contract changes.
 */
`;

const httpMethods = ["get", "post", "put", "patch", "delete"];

function operationSource(document) {
  const definitions = {};

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of httpMethods) {
      const operation = pathItem?.[method];
      if (!operation) continue;
      if (!operation.operationId) {
        throw new Error(`${method.toUpperCase()} ${path} is missing operationId`);
      }
      if (definitions[operation.operationId]) {
        throw new Error(`Duplicate operationId: ${operation.operationId}`);
      }

      const idempotencyKeyRequired = (operation.parameters ?? []).some(
        (parameter) =>
          parameter?.$ref === "#/components/parameters/IdempotencyKey" ||
          (parameter?.in === "header" && parameter?.name?.toLowerCase() === "idempotency-key"),
      );
      const security = operation.security;
      if (!Array.isArray(security)) {
        throw new Error(`${operation.operationId} must declare security explicitly`);
      }
      const requiredScopes = security.flatMap((requirement) => requirement.oauth2 ?? []);
      const runtimeStatus = operation["x-runtime-status"];
      if (runtimeStatus !== "implemented" && runtimeStatus !== "contract-only") {
        throw new Error(`${operation.operationId} must declare x-runtime-status`);
      }

      const responses = operation.responses ?? {};
      const successStatuses = Object.keys(responses)
        .filter((status) => /^2\d\d$/u.test(status))
        .map(Number)
        .sort((left, right) => left - right);
      if (successStatuses.length === 0) {
        throw new Error(`${operation.operationId} must declare a successful response`);
      }
      const successMediaTypes = [
        ...new Set(
          successStatuses.flatMap((status) => Object.keys(responses[String(status)]?.content ?? {})),
        ),
      ].sort();

      definitions[operation.operationId] = {
        idempotencyKeyRequired,
        method: method.toUpperCase(),
        path,
        public: security.length === 0,
        requiredScopes,
        runtimeStatus,
        successMediaTypes,
        successStatuses,
        supportsNotModified: Object.hasOwn(responses, "304"),
      };
    }
  }

  const sorted = Object.fromEntries(
    Object.entries(definitions).sort(([left], [right]) => left.localeCompare(right)),
  );

  return `${generatedHeader}
import type { operations } from "./schema.js";

export interface OperationDefinition {
  readonly idempotencyKeyRequired: boolean;
  readonly method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  readonly path: string;
  readonly public: boolean;
  readonly requiredScopes: readonly string[];
  readonly runtimeStatus: "contract-only" | "implemented";
  readonly successMediaTypes: readonly string[];
  readonly successStatuses: readonly number[];
  readonly supportsNotModified: boolean;
}

export const operationDefinitions = ${JSON.stringify(sorted, null, 2)} as const satisfies Record<keyof operations, OperationDefinition>;

export type OperationId = keyof typeof operationDefinitions;
`;
}

export async function generateArtifacts() {
  const contractSource = await readFile(contractPath, "utf8");
  const document = parse(contractSource);
  const ast = await openapiTS(pathToFileURL(contractPath), {
    alphabetize: true,
    immutable: true,
  });

  return new Map([
    [resolve(generatedDirectory, "schema.ts"), `${generatedHeader}\n${astToString(ast)}`],
    [resolve(generatedDirectory, "operations.ts"), operationSource(document)],
  ]);
}
