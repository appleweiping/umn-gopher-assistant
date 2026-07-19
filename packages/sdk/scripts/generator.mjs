import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import openapiTS, { astToString } from "openapi-typescript";
import { format, resolveConfig } from "prettier";
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

export function normalizeContractSource(source) {
  if (typeof source !== "string") throw new TypeError("OpenAPI contract source must be a string");
  return source.replace(/\r\n?/gu, "\n");
}

export function contractSourceSha256(source) {
  return createHash("sha256").update(normalizeContractSource(source), "utf8").digest("hex");
}

function resolveLocalReference(document, reference, context) {
  if (!reference.startsWith("#/")) {
    throw new Error(`${context} uses unsupported non-local reference: ${reference}`);
  }

  let current = document;
  for (const encodedSegment of reference.slice(2).split("/")) {
    const segment = encodedSegment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!current || typeof current !== "object" || !Object.hasOwn(current, segment)) {
      throw new Error(`${context} has unresolved reference: ${reference}`);
    }
    current = current[segment];
  }
  return current;
}

function resolveParameter(document, parameter, context, seen = new Set()) {
  if (!parameter || typeof parameter !== "object") {
    throw new Error(`${context} contains an invalid parameter`);
  }
  if (!("$ref" in parameter)) return parameter;
  if (seen.has(parameter.$ref)) {
    throw new Error(`${context} contains a circular parameter reference: ${parameter.$ref}`);
  }
  const nextSeen = new Set(seen).add(parameter.$ref);
  return resolveParameter(
    document,
    resolveLocalReference(document, parameter.$ref, context),
    context,
    nextSeen,
  );
}

function mergedParameters(document, pathItem, operation, operationId) {
  const parameters = new Map();
  for (const candidate of [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]) {
    const parameter = resolveParameter(document, candidate, operationId);
    if (typeof parameter.name !== "string" || typeof parameter.in !== "string") {
      throw new Error(`${operationId} contains a parameter without name or location`);
    }
    parameters.set(`${parameter.in}\u0000${parameter.name}`, parameter);
  }
  return [...parameters.values()];
}

const annotationSchemaKeys = new Set([
  "$comment",
  "default",
  "deprecated",
  "description",
  "example",
  "examples",
  "readOnly",
  "title",
  "writeOnly",
]);

function assertSupportedSchemaKeys(schema, allowedKeys, context) {
  for (const key of Object.keys(schema)) {
    if (!allowedKeys.has(key) && !annotationSchemaKeys.has(key)) {
      throw new Error(`${context} uses unsupported JSON Schema keyword: ${key}`);
    }
  }
}

function resolvedSchema(document, schema, context, seen = new Set()) {
  if (typeof schema === "boolean" || !schema?.$ref) return schema;
  const siblingKeys = Object.keys(schema).filter((key) => key !== "$ref" && !annotationSchemaKeys.has(key));
  if (siblingKeys.length > 0) {
    throw new Error(`${context} uses unsupported validation siblings beside $ref`);
  }
  if (seen.has(schema.$ref)) {
    throw new Error(`${context} contains a circular schema reference: ${schema.$ref}`);
  }
  return resolvedSchema(
    document,
    resolveLocalReference(document, schema.$ref, context),
    context,
    new Set(seen).add(schema.$ref),
  );
}

function mergePropertySchema(left, right) {
  if (left === undefined || left === true) return right;
  if (right === true) return left;
  if (left === false || right === false) return false;
  const leftIsUnconstrainedArray =
    left?.type === "array" &&
    left.items === true &&
    Object.keys(left).every((key) => ["type", "items"].includes(key));
  const rightIsUnconstrainedArray =
    right?.type === "array" &&
    right.items === true &&
    Object.keys(right).every((key) => ["type", "items"].includes(key));
  if (leftIsUnconstrainedArray && right?.type === "array") return right;
  if (rightIsUnconstrainedArray && left?.type === "array") return left;
  return { allOf: [left, right] };
}

function collectObjectComposition(document, schema, context) {
  const properties = new Map();
  const required = new Set();
  const conditions = [];

  function collect(candidate, candidateContext) {
    const resolved = resolvedSchema(document, candidate, candidateContext);
    if (resolved === true) return;
    if (resolved === false || !resolved || typeof resolved !== "object") {
      throw new Error(`${candidateContext} cannot be composed as an object schema`);
    }

    if (resolved.if !== undefined || resolved.then !== undefined || resolved.else !== undefined) {
      assertSupportedSchemaKeys(resolved, new Set(["if", "then", "else"]), candidateContext);
      if (resolved.if === undefined || resolved.then === undefined || resolved.else !== undefined) {
        throw new Error(`${candidateContext} must use a supported if/then conditional without else`);
      }
      conditions.push({ ifSchema: resolved.if, thenSchema: resolved.then, context: candidateContext });
      return;
    }

    assertSupportedSchemaKeys(
      resolved,
      new Set(["type", "properties", "required", "additionalProperties", "allOf"]),
      candidateContext,
    );
    if (resolved.type !== undefined && resolved.type !== "object") {
      throw new Error(`${candidateContext} is not an object schema`);
    }
    if (
      resolved.additionalProperties !== undefined &&
      resolved.additionalProperties !== true &&
      resolved.additionalProperties !== false
    ) {
      throw new Error(`${candidateContext} uses unsupported schema-valued additionalProperties`);
    }

    for (const [name, propertySchema] of Object.entries(resolved.properties ?? {})) {
      properties.set(name, mergePropertySchema(properties.get(name), propertySchema));
    }
    for (const name of resolved.required ?? []) {
      if (typeof name !== "string") throw new Error(`${candidateContext} has a non-string required property`);
      required.add(name);
    }
    for (const [index, fragment] of (resolved.allOf ?? []).entries()) {
      collect(fragment, `${candidateContext}.allOf[${index}]`);
    }
  }

  collect(schema, context);
  for (const name of required) {
    if (!properties.has(name)) {
      throw new Error(`${context} requires undeclared property ${name}, incompatible with strict responses`);
    }
  }
  return { conditions, properties, required };
}

function conditionExpression(document, schema, valueExpression, context) {
  const resolved = resolvedSchema(document, schema, context);
  if (resolved === true) return "true";
  if (resolved === false) return "false";
  if (!resolved || typeof resolved !== "object") throw new Error(`${context} is not a schema`);

  assertSupportedSchemaKeys(
    resolved,
    new Set(["type", "const", "enum", "required", "properties", "allOf", "anyOf", "not"]),
    context,
  );
  const clauses = [];
  if (resolved.type !== undefined) {
    if (resolved.type === "object") {
      clauses.push(`(${valueExpression} !== null && typeof ${valueExpression} === "object")`);
    } else if (resolved.type === "string" || resolved.type === "number" || resolved.type === "boolean") {
      clauses.push(`typeof ${valueExpression} === ${JSON.stringify(resolved.type)}`);
    } else if (resolved.type === "null") {
      clauses.push(`${valueExpression} === null`);
    } else {
      throw new Error(`${context} uses unsupported conditional type`);
    }
  }
  if (resolved.const !== undefined) {
    clauses.push(`${valueExpression} === ${JSON.stringify(resolved.const)}`);
  }
  if (resolved.enum !== undefined) {
    clauses.push(`${JSON.stringify(resolved.enum)}.includes(${valueExpression})`);
  }
  for (const name of resolved.required ?? []) {
    clauses.push(`Object.hasOwn(${valueExpression}, ${JSON.stringify(name)})`);
  }
  for (const [name, propertySchema] of Object.entries(resolved.properties ?? {})) {
    const propertyExpression = `${valueExpression}[${JSON.stringify(name)}]`;
    clauses.push(
      `(!Object.hasOwn(${valueExpression}, ${JSON.stringify(name)}) || (${conditionExpression(
        document,
        propertySchema,
        propertyExpression,
        `${context}.properties.${name}`,
      )}))`,
    );
  }
  for (const [index, fragment] of (resolved.allOf ?? []).entries()) {
    clauses.push(
      `(${conditionExpression(document, fragment, valueExpression, `${context}.allOf[${index}]`)})`,
    );
  }
  if (resolved.anyOf !== undefined) {
    clauses.push(
      `(${resolved.anyOf
        .map((fragment, index) =>
          conditionExpression(document, fragment, valueExpression, `${context}.anyOf[${index}]`),
        )
        .join(" || ")})`,
    );
  }
  if (resolved.not !== undefined) {
    clauses.push(`!(${conditionExpression(document, resolved.not, valueExpression, `${context}.not`)})`);
  }
  return clauses.length === 0 ? "true" : clauses.map((clause) => `(${clause})`).join(" && ");
}

function zodSchemaSource(document, schema, context) {
  const resolved = resolvedSchema(document, schema, context);
  if (resolved === true) return "z.unknown()";
  if (resolved === false) return "z.never()";
  if (!resolved || typeof resolved !== "object") throw new Error(`${context} is not a schema`);

  if (resolved.const !== undefined) {
    assertSupportedSchemaKeys(resolved, new Set(["type", "const"]), context);
    return `z.literal(${JSON.stringify(resolved.const)})`;
  }
  if (resolved.enum !== undefined) {
    assertSupportedSchemaKeys(resolved, new Set(["type", "enum"]), context);
    if (!Array.isArray(resolved.enum) || resolved.enum.length === 0) {
      throw new Error(`${context} must declare a non-empty enum`);
    }
    if (resolved.enum.every((value) => typeof value === "string")) {
      return `z.enum(${JSON.stringify(resolved.enum)})`;
    }
    return `z.union([${resolved.enum.map((value) => `z.literal(${JSON.stringify(value)})`).join(", ")}])`;
  }
  if (Array.isArray(resolved.type)) {
    if (resolved.type.length < 2) throw new Error(`${context} has an invalid type array`);
    const shared = Object.fromEntries(Object.entries(resolved).filter(([key]) => key !== "type"));
    return `z.union([${resolved.type
      .map((type) =>
        zodSchemaSource(document, type === "null" ? { type } : { ...shared, type }, `${context}.${type}`),
      )
      .join(", ")}])`;
  }

  if (
    resolved.type === "object" ||
    resolved.properties !== undefined ||
    resolved.required !== undefined ||
    resolved.allOf !== undefined
  ) {
    const composition = collectObjectComposition(document, resolved, context);
    const shape = [...composition.properties.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, propertySchema]) => {
        const source = zodSchemaSource(document, propertySchema, `${context}.properties.${name}`);
        return `${JSON.stringify(name)}: ${composition.required.has(name) ? source : `${source}.optional()`}`;
      })
      .join(",\n");
    let source = `z.object({\n${shape}\n}).strict()`;
    for (const condition of composition.conditions) {
      const ifExpression = conditionExpression(
        document,
        condition.ifSchema,
        "value",
        `${condition.context}.if`,
      );
      const thenExpression = conditionExpression(
        document,
        condition.thenSchema,
        "value",
        `${condition.context}.then`,
      );
      source += `.refine((value) => !(${ifExpression}) || (${thenExpression}), { message: ${JSON.stringify(
        `Conditional constraint from ${condition.context} failed`,
      )} })`;
    }
    return source;
  }

  if (resolved.type === "string") {
    assertSupportedSchemaKeys(
      resolved,
      new Set(["type", "format", "pattern", "minLength", "maxLength"]),
      context,
    );
    let source = "z.string()";
    if (resolved.format === "date-time") source = "z.iso.datetime({ offset: true })";
    else if (resolved.format === "uri") source = "z.url()";
    else if (resolved.format !== undefined)
      throw new Error(`${context} uses unsupported format ${resolved.format}`);
    if (resolved.minLength !== undefined) source += `.min(${JSON.stringify(resolved.minLength)})`;
    if (resolved.maxLength !== undefined) source += `.max(${JSON.stringify(resolved.maxLength)})`;
    if (resolved.pattern !== undefined) source += `.regex(new RegExp(${JSON.stringify(resolved.pattern)}))`;
    return source;
  }

  if (resolved.type === "number" || resolved.type === "integer") {
    assertSupportedSchemaKeys(
      resolved,
      new Set(["type", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"]),
      context,
    );
    let source = resolved.type === "integer" ? "z.number().int()" : "z.number()";
    if (resolved.minimum !== undefined) source += `.min(${JSON.stringify(resolved.minimum)})`;
    if (resolved.maximum !== undefined) source += `.max(${JSON.stringify(resolved.maximum)})`;
    if (resolved.exclusiveMinimum !== undefined)
      source += `.gt(${JSON.stringify(resolved.exclusiveMinimum)})`;
    if (resolved.exclusiveMaximum !== undefined)
      source += `.lt(${JSON.stringify(resolved.exclusiveMaximum)})`;
    if (resolved.multipleOf !== undefined) source += `.multipleOf(${JSON.stringify(resolved.multipleOf)})`;
    return source;
  }

  if (resolved.type === "boolean") {
    assertSupportedSchemaKeys(resolved, new Set(["type"]), context);
    return "z.boolean()";
  }
  if (resolved.type === "null") {
    assertSupportedSchemaKeys(resolved, new Set(["type"]), context);
    return "z.null()";
  }
  if (resolved.type === "array") {
    assertSupportedSchemaKeys(resolved, new Set(["type", "items", "minItems", "maxItems"]), context);
    let source = `z.array(${zodSchemaSource(document, resolved.items ?? true, `${context}.items`)})`;
    if (resolved.minItems !== undefined) source += `.min(${JSON.stringify(resolved.minItems)})`;
    if (resolved.maxItems !== undefined) source += `.max(${JSON.stringify(resolved.maxItems)})`;
    return source;
  }

  throw new Error(`${context} has no supported validation type`);
}

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

      const parameters = mergedParameters(document, pathItem, operation, operation.operationId);

      const idempotencyKeyRequired = parameters.some(
        (parameter) =>
          parameter.in === "header" &&
          parameter.name.toLowerCase() === "idempotency-key" &&
          parameter.required === true,
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
        queryParameterNames: parameters
          .filter((parameter) => parameter.in === "query")
          .map((parameter) => parameter.name)
          .sort((left, right) => left.localeCompare(right)),
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
  readonly queryParameterNames: readonly string[];
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

function resolvedResponse(document, response, context, seen = new Set()) {
  if (!response?.$ref) return response;
  if (seen.has(response.$ref)) throw new Error(`${context} contains a circular response reference`);
  return resolvedResponse(
    document,
    resolveLocalReference(document, response.$ref, context),
    context,
    new Set(seen).add(response.$ref),
  );
}

function validatorSource(document, contractSha256) {
  const operationSchemas = {};

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of httpMethods) {
      const operation = pathItem?.[method];
      if (!operation || operation["x-runtime-status"] !== "implemented") continue;
      const operationId = operation.operationId;
      if (!operationId) throw new Error(`${method.toUpperCase()} ${path} is missing operationId`);
      const statusSchemas = {};

      for (const [status, unresolvedResponse] of Object.entries(operation.responses ?? {})) {
        if (!/^2\d\d$/u.test(status)) continue;
        const response = resolvedResponse(document, unresolvedResponse, `${operationId}.responses.${status}`);
        const jsonContent = response?.content?.["application/json"];
        if (!jsonContent?.schema) {
          throw new Error(`${operationId} ${status} must declare an application/json success schema`);
        }
        for (const [mediaType, media] of Object.entries(response.content ?? {})) {
          if (
            mediaType !== "application/json" &&
            JSON.stringify(media?.schema) !== JSON.stringify(jsonContent.schema)
          ) {
            throw new Error(
              `${operationId} ${status} has media-specific success schemas that need dispatch support`,
            );
          }
        }
        statusSchemas[status] = zodSchemaSource(
          document,
          jsonContent.schema,
          `${operationId}.responses.${status}.application/json`,
        );
      }
      if (Object.keys(statusSchemas).length === 0) {
        throw new Error(`${operationId} must declare a successful response schema`);
      }
      operationSchemas[operationId] = statusSchemas;
    }
  }

  const operationEntries = Object.entries(operationSchemas)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([operationId, statusSchemas]) => {
      const statuses = Object.entries(statusSchemas)
        .sort(([left], [right]) => Number(left) - Number(right))
        .map(([status, source]) => `${JSON.stringify(status)}: ${source}`)
        .join(",\n");
      return `${JSON.stringify(operationId)}: {\n${statuses}\n}`;
    })
    .join(",\n");

  return `${generatedHeader}
import { z } from "zod";

import { operationDefinitions } from "./operations.js";
import type { OperationId } from "./operations.js";

export const successValidatorContractSha256 = ${JSON.stringify(contractSha256)};

type ImplementedOperationId = {
  [Id in OperationId]: (typeof operationDefinitions)[Id]["runtimeStatus"] extends "implemented"
    ? Id
    : never;
}[OperationId];

const implementedSuccessSchemas = {
${operationEntries}
} satisfies Record<ImplementedOperationId, Readonly<Record<number, z.ZodType>>>;

const schemasByOperation: Readonly<
  Partial<Record<OperationId, Readonly<Record<number, z.ZodType>>>>
> = implementedSuccessSchemas;

export type SuccessBodyValidationFailureReason =
  | "invalid-success-body"
  | "operation-not-implemented"
  | "unexpected-success-status";

export type SuccessBodyValidationResult =
  | { readonly success: true; readonly data: unknown }
  | { readonly success: false; readonly reason: SuccessBodyValidationFailureReason };

export function validateImplementedSuccessBody(
  operationId: OperationId,
  status: number,
  value: unknown,
): SuccessBodyValidationResult {
  const statusSchemas = schemasByOperation[operationId];
  if (statusSchemas === undefined) {
    return { success: false, reason: "operation-not-implemented" };
  }
  const schema = statusSchemas[status];
  if (schema === undefined) {
    return { success: false, reason: "unexpected-success-status" };
  }
  const result = schema.safeParse(value);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, reason: "invalid-success-body" };
}
`;
}

export async function generateValidatorArtifact(contractSource) {
  const normalizedSource = normalizeContractSource(contractSource);
  const document = parse(normalizedSource);
  const prettierConfig = (await resolveConfig(resolve(repositoryRoot, ".prettierrc.json"))) ?? {};
  return format(validatorSource(document, contractSourceSha256(normalizedSource)), {
    ...prettierConfig,
    parser: "typescript",
  });
}

export async function generateArtifacts() {
  const contractSource = await readFile(contractPath, "utf8");
  const document = parse(normalizeContractSource(contractSource));
  const ast = await openapiTS(pathToFileURL(contractPath), {
    alphabetize: true,
    immutable: true,
  });
  const validators = await generateValidatorArtifact(contractSource);

  return new Map([
    [resolve(generatedDirectory, "schema.ts"), `${generatedHeader}\n${astToString(ast)}`],
    [resolve(generatedDirectory, "operations.ts"), operationSource(document)],
    [resolve(generatedDirectory, "validators.ts"), validators],
  ]);
}
