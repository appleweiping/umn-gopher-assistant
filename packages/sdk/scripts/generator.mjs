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

function requiredBodyPropertyPath(document, schema, path, context) {
  let current = schema;
  for (const [index, name] of path.entries()) {
    const composition = collectObjectComposition(
      document,
      current,
      `${context}.${path.slice(0, index).join(".")}`,
    );
    if (!composition.required.has(name)) {
      throw new Error(`${context} does not require idempotency binding field ${path.join(".")}`);
    }
    const property = composition.properties.get(name);
    if (property === undefined) {
      throw new Error(`${context} does not declare idempotency binding field ${path.join(".")}`);
    }
    current = property;
  }
  const resolved = resolvedSchema(document, current, `${context}.${path.join(".")}`);
  if (
    !resolved ||
    typeof resolved !== "object" ||
    resolved.type !== "string" ||
    resolved.pattern !== "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
  ) {
    throw new Error(`${context} idempotency binding field ${path.join(".")} must be a canonical UUID`);
  }
}

function boundedByteExtension(value, name, operationId) {
  if (value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 1 || value > 16 * 1024 * 1024) {
    throw new Error(`${operationId} has invalid ${name}`);
  }
  return value;
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
  "x-uga-trim",
  "x-uga-semantic-validator",
]);

function semanticRefinementSource(name, context) {
  if (name === "ai-query-text-v1") {
    return `.refine((value) => value.normalize("NFC") === value, { message: "Query must use NFC Unicode normalization" })
      .refine((value) => !/[\\p{Cc}\\p{Cf}\\p{Cs}]/u.test(value), { message: "Query cannot contain control or format characters" })
      .refine((value) => !/[<>]|&(?:#(?:[xX][0-9A-Fa-f]+|\\d+)|[A-Za-z][A-Za-z0-9]{1,31});?/u.test(value), { message: "Query cannot contain HTML or encoded HTML" })`;
  }
  if (name === "ai-evidence-text-v1") {
    return `.refine((value) => value === value.trim(), { message: "Evidence text cannot have boundary whitespace" })
      .refine((value) => value.normalize("NFC") === value, { message: "Evidence text must use NFC Unicode normalization" })
      .refine((value) => !/[\\p{Cc}\\p{Cf}\\p{Cs}]/u.test(value), { message: "Evidence text cannot contain control or format characters" })
      .refine((value) => !/[<>]|&(?:#(?:[xX][0-9A-Fa-f]+|\\d+)|[A-Za-z][A-Za-z0-9]{1,31});?/u.test(value), { message: "Evidence text cannot contain HTML or encoded HTML" })`;
  }
  if (name !== "ai-query-response-v2") {
    throw new Error(`${context} uses unsupported semantic validator ${String(name)}`);
  }
  return `.superRefine((value, refinement) => {
    const paragraphIds = value.paragraphs.map((paragraph) => paragraph.id);
    if (new Set(paragraphIds).size !== paragraphIds.length) {
      refinement.addIssue({ code: "custom", message: "paragraph ids must be unique", path: ["paragraphs"] });
    }
    const citationIds = value.citations.map((citation) => citation.id);
    if (new Set(citationIds).size !== citationIds.length) {
      refinement.addIssue({ code: "custom", message: "citation ids must be unique", path: ["citations"] });
    }
    const knownCitationIds = new Set(citationIds);
    const referencedCitationIds = new Set();
    value.paragraphs.forEach((paragraph, paragraphIndex) => {
      const paragraphCitationIds = new Set();
      paragraph.citationIds.forEach((citationId, citationIndex) => {
        if (paragraphCitationIds.has(citationId)) {
          refinement.addIssue({ code: "custom", message: "citationIds must be unique within a paragraph", path: ["paragraphs", paragraphIndex, "citationIds", citationIndex] });
        }
        paragraphCitationIds.add(citationId);
        referencedCitationIds.add(citationId);
        if (!knownCitationIds.has(citationId)) {
          refinement.addIssue({ code: "custom", message: "paragraph citationIds must reference citations in this response", path: ["paragraphs", paragraphIndex, "citationIds", citationIndex] });
        }
      });
    });
    value.citations.forEach((citation, citationIndex) => {
      if (citation.campusId !== value.campusId) {
        refinement.addIssue({ code: "custom", message: "cross-campus citations are not allowed", path: ["citations", citationIndex, "campusId"] });
      }
      if (citation.summarySource.sourceId === citation.verificationLink.sourceId) {
        refinement.addIssue({ code: "custom", message: "summary and official verification sources must be distinct", path: ["citations", citationIndex, "verificationLink", "sourceId"] });
      }
      if (!referencedCitationIds.has(citation.id)) {
        refinement.addIssue({ code: "custom", message: "every citation must support at least one answer paragraph", path: ["citations", citationIndex, "id"] });
      }
    });
    if (new Set(value.citations.map((citation) => citation.summarySource.corpusSha256)).size > 1) {
      refinement.addIssue({ code: "custom", message: "all citations must come from one atomic authored-summary corpus snapshot", path: ["citations"] });
    }
    if (value.state === "no-results") {
      if (value.paragraphs.length !== 0) refinement.addIssue({ code: "custom", message: "no-results responses cannot contain answer paragraphs", path: ["paragraphs"] });
      if (value.citations.length !== 0) refinement.addIssue({ code: "custom", message: "no-results responses cannot contain citations", path: ["citations"] });
      return;
    }
    if (value.paragraphs.length === 0) refinement.addIssue({ code: "custom", message: "non-empty responses require at least one evidence-backed paragraph", path: ["paragraphs"] });
    if (value.citations.length === 0) refinement.addIssue({ code: "custom", message: "non-empty responses require at least one citation", path: ["citations"] });
    if (value.state === "answered") {
      value.citations.forEach((citation, citationIndex) => {
        if (citation.summaryFreshnessState !== "FRESH") refinement.addIssue({ code: "custom", message: "answered responses may cite only FRESH authored summaries", path: ["citations", citationIndex, "summaryFreshnessState"] });
      });
    }
    if (value.state === "stale") {
      value.citations.forEach((citation, citationIndex) => {
        if (citation.summaryFreshnessState !== "STALE" && citation.summaryFreshnessState !== "EXPIRED") refinement.addIssue({ code: "custom", message: "stale responses may cite only STALE or EXPIRED authored summaries", path: ["citations", citationIndex, "summaryFreshnessState"] });
      });
    }
    if (value.state === "conflict") {
      if (value.citations.length < 2) refinement.addIssue({ code: "custom", message: "conflict responses require at least two citations", path: ["citations"] });
      if (new Set(value.citations.map((citation) => citation.documentId)).size < 2) refinement.addIssue({ code: "custom", message: "conflict responses require at least two distinct authored documents", path: ["citations"] });
      if (new Set(value.citations.map((citation) => citation.verificationLink.sourceId)).size < 2) refinement.addIssue({ code: "custom", message: "conflict responses require at least two distinct official verification links", path: ["citations"] });
      if (new Set(value.citations.map((citation) => citation.contentSha256)).size < 2) refinement.addIssue({ code: "custom", message: "conflict responses require genuinely different evidence", path: ["citations"] });
    }
  })`;
}

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
  const isObjectSchema =
    resolved.type === "object" ||
    resolved.properties !== undefined ||
    resolved.required !== undefined ||
    resolved.allOf !== undefined;
  if (resolved["x-uga-trim"] !== undefined && resolved["x-uga-trim"] !== true) {
    throw new Error(`${context} must set x-uga-trim to true when present`);
  }
  if (resolved["x-uga-trim"] === true && resolved.type !== "string") {
    throw new Error(`${context} applies x-uga-trim to a non-string schema`);
  }
  if (resolved["x-uga-semantic-validator"] !== undefined && resolved.type !== "string" && !isObjectSchema) {
    throw new Error(`${context} applies a semantic validator to an unsupported schema kind`);
  }

  if (resolved.oneOf !== undefined || resolved.anyOf !== undefined) {
    assertSupportedSchemaKeys(resolved, new Set(["oneOf", "anyOf"]), context);
    if (resolved.oneOf !== undefined && resolved.anyOf !== undefined) {
      throw new Error(`${context} cannot combine oneOf and anyOf`);
    }
    const variants = resolved.oneOf ?? resolved.anyOf;
    if (!Array.isArray(variants) || variants.length < 2) {
      throw new Error(`${context} must declare at least two union variants`);
    }
    return `z.union([${variants
      .map((variant, index) =>
        zodSchemaSource(
          document,
          variant,
          `${context}.${resolved.oneOf === undefined ? "anyOf" : "oneOf"}[${index}]`,
        ),
      )
      .join(", ")}])`;
  }

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

  if (isObjectSchema) {
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
    if (resolved["x-uga-semantic-validator"] !== undefined) {
      source += semanticRefinementSource(resolved["x-uga-semantic-validator"], context);
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
    if (resolved["x-uga-trim"] === true) source += ".trim()";
    if (resolved.format === "date-time") source = "z.iso.datetime({ offset: true })";
    else if (resolved.format === "uri") source = "z.url()";
    else if (resolved.format !== undefined)
      throw new Error(`${context} uses unsupported format ${resolved.format}`);
    if (resolved.minLength !== undefined) source += `.min(${JSON.stringify(resolved.minLength)})`;
    if (resolved.maxLength !== undefined) source += `.max(${JSON.stringify(resolved.maxLength)})`;
    if (resolved.pattern !== undefined) source += `.regex(new RegExp(${JSON.stringify(resolved.pattern)}))`;
    if (resolved["x-uga-semantic-validator"] !== undefined) {
      source += semanticRefinementSource(resolved["x-uga-semantic-validator"], context);
    }
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
      const ifMatchRequired = parameters.some(
        (parameter) =>
          parameter.in === "header" &&
          parameter.name.toLowerCase() === "if-match" &&
          parameter.required === true,
      );
      const requiredIfNoneMatch = parameters.find(
        (parameter) =>
          parameter.in === "header" &&
          parameter.name.toLowerCase() === "if-none-match" &&
          parameter.required === true,
      );
      const ifNoneMatchRequiredValue =
        requiredIfNoneMatch === undefined
          ? null
          : requiredIfNoneMatch.schema?.const === "*"
            ? "*"
            : (() => {
                throw new Error(`${operation.operationId} requires unsupported dynamic If-None-Match input`);
              })();
      const ifNoneMatchSupported = parameters.some(
        (parameter) => parameter.in === "header" && parameter.name.toLowerCase() === "if-none-match",
      );
      const strongIfNoneMatch = parameters.some(
        (parameter) =>
          parameter.in === "header" &&
          parameter.name.toLowerCase() === "if-none-match" &&
          typeof parameter.schema?.pattern === "string" &&
          parameter.schema.pattern.includes("\\x23"),
      );
      const vaultReadProofRequired = parameters.some(
        (parameter) =>
          parameter.in === "header" &&
          parameter.name.toLowerCase() === "x-vault-read-proof" &&
          parameter.required === true,
      );
      const idempotencyKeyBoundTo = operation["x-uga-idempotency-key-bound-to"] ?? null;
      if (
        idempotencyKeyBoundTo !== null &&
        (typeof idempotencyKeyBoundTo !== "string" ||
          !/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/u.test(idempotencyKeyBoundTo))
      ) {
        throw new Error(`${operation.operationId} has an invalid idempotency-key binding`);
      }
      if (idempotencyKeyBoundTo !== null) {
        if (!idempotencyKeyRequired) {
          throw new Error(`${operation.operationId} binds a non-required Idempotency-Key`);
        }
        const requestSchema = operation.requestBody?.content?.["application/json"]?.schema;
        if (requestSchema === undefined) {
          throw new Error(`${operation.operationId} binds idempotency without a JSON request body`);
        }
        requiredBodyPropertyPath(
          document,
          requestSchema,
          idempotencyKeyBoundTo.split("."),
          `${operation.operationId}.requestBody.application/json`,
        );
      }
      const maxRequestBodyBytes = boundedByteExtension(
        operation["x-uga-max-request-body-bytes"],
        "x-uga-max-request-body-bytes",
        operation.operationId,
      );
      const maxSuccessResponseBodyBytes = boundedByteExtension(
        operation["x-uga-max-success-response-body-bytes"],
        "x-uga-max-success-response-body-bytes",
        operation.operationId,
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
      const responseRequestBindings = operation["x-uga-response-request-bindings"] ?? [];
      if (
        !Array.isArray(responseRequestBindings) ||
        responseRequestBindings.some(
          (name) => typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9]*$/u.test(name),
        ) ||
        new Set(responseRequestBindings).size !== responseRequestBindings.length
      ) {
        throw new Error(`${operation.operationId} has invalid x-uga-response-request-bindings`);
      }
      if (responseRequestBindings.length > 0) {
        const requestSchema = operation.requestBody?.content?.["application/json"]?.schema;
        if (requestSchema === undefined) {
          throw new Error(`${operation.operationId} binds response fields without a JSON request body`);
        }
        const requestShape = collectObjectComposition(
          document,
          requestSchema,
          `${operation.operationId}.requestBody.application/json`,
        );
        for (const name of responseRequestBindings) {
          if (!requestShape.required.has(name)) {
            throw new Error(`${operation.operationId} binds non-required request field ${name}`);
          }
        }
        for (const [status, unresolved] of Object.entries(operation.responses ?? {})) {
          if (!/^2\d\d$/u.test(status)) continue;
          const response = resolvedResponse(
            document,
            unresolved,
            `${operation.operationId}.responses.${status}`,
          );
          const responseSchema = response?.content?.["application/json"]?.schema;
          if (responseSchema === undefined) {
            throw new Error(`${operation.operationId} binds fields on a non-JSON ${status} response`);
          }
          const responseShape = collectObjectComposition(
            document,
            responseSchema,
            `${operation.operationId}.responses.${status}.application/json`,
          );
          for (const name of responseRequestBindings) {
            if (!responseShape.required.has(name)) {
              throw new Error(`${operation.operationId} binds non-required ${status} response field ${name}`);
            }
          }
        }
      }

      const responses = operation.responses ?? {};
      const successStatuses = Object.keys(responses)
        .filter((status) => /^2\d\d$/u.test(status))
        .map(Number)
        .sort((left, right) => left - right);
      if (successStatuses.length === 0) {
        throw new Error(`${operation.operationId} must declare a successful response`);
      }
      const errorStatuses = Object.keys(responses)
        .filter((status) => /^[45]\d\d$/u.test(status))
        .map(Number)
        .sort((left, right) => left - right);
      const successMediaTypes = [
        ...new Set(
          successStatuses.flatMap((status) =>
            Object.keys(
              resolvedResponse(
                document,
                responses[String(status)],
                `${operation.operationId}.responses.${String(status)}`,
              )?.content ?? {},
            ),
          ),
        ),
      ].sort();

      definitions[operation.operationId] = {
        errorStatuses,
        idempotencyKeyRequired,
        idempotencyKeyBoundTo,
        ifMatchRequired,
        ifNoneMatchRequiredValue,
        ifNoneMatchSupported,
        maxRequestBodyBytes,
        maxSuccessResponseBodyBytes,
        method: method.toUpperCase(),
        path,
        public: security.length === 0,
        queryParameterNames: parameters
          .filter((parameter) => parameter.in === "query")
          .map((parameter) => parameter.name)
          .sort((left, right) => left.localeCompare(right)),
        requiredScopes,
        responseRequestBindings,
        runtimeStatus,
        successMediaTypes,
        successStatuses,
        strongIfNoneMatch,
        supportsNotModified: Object.hasOwn(responses, "304"),
        vaultReadProofRequired,
      };
    }
  }

  const sorted = Object.fromEntries(
    Object.entries(definitions).sort(([left], [right]) => left.localeCompare(right)),
  );

  return `${generatedHeader}
import type { operations } from "./schema.js";

export interface OperationDefinition {
  readonly errorStatuses: readonly number[];
  readonly idempotencyKeyRequired: boolean;
  readonly idempotencyKeyBoundTo: string | null;
  readonly ifMatchRequired: boolean;
  readonly ifNoneMatchRequiredValue: "*" | null;
  readonly ifNoneMatchSupported: boolean;
  readonly maxRequestBodyBytes: number | null;
  readonly maxSuccessResponseBodyBytes: number | null;
  readonly method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  readonly path: string;
  readonly public: boolean;
  readonly queryParameterNames: readonly string[];
  readonly requiredScopes: readonly string[];
  readonly responseRequestBindings: readonly string[];
  readonly runtimeStatus: "contract-only" | "implemented";
  readonly successMediaTypes: readonly string[];
  readonly successStatuses: readonly number[];
  readonly strongIfNoneMatch: boolean;
  readonly supportsNotModified: boolean;
  readonly vaultReadProofRequired: boolean;
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
  const requestBodySchemas = {};

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of httpMethods) {
      const operation = pathItem?.[method];
      if (!operation || operation["x-runtime-status"] !== "implemented") continue;
      const operationId = operation.operationId;
      if (!operationId) throw new Error(`${method.toUpperCase()} ${path} is missing operationId`);
      const statusSchemas = {};
      const jsonRequestBody = operation.requestBody?.content?.["application/json"];
      if (jsonRequestBody?.schema !== undefined) {
        requestBodySchemas[operationId] = zodSchemaSource(
          document,
          jsonRequestBody.schema,
          `${operationId}.requestBody.application/json`,
        );
      }

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
  const requestBodyEntries = Object.entries(requestBodySchemas)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([operationId, source]) => `${JSON.stringify(operationId)}: ${source}`)
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

const implementedRequestBodySchemas = {
${requestBodyEntries}
} satisfies Partial<Record<ImplementedOperationId, z.ZodType>>;

const schemasByOperation: Readonly<
  Partial<Record<OperationId, Readonly<Record<number, z.ZodType>>>>
> = implementedSuccessSchemas;

const requestBodySchemasByOperation: Readonly<Partial<Record<OperationId, z.ZodType>>> =
  implementedRequestBodySchemas;

export type RequestBodyValidationResult =
  | { readonly success: true; readonly data: unknown }
  | { readonly success: false; readonly reason: "invalid-request-body" | "request-body-not-declared" };

export function validateImplementedRequestBody(
  operationId: OperationId,
  value: unknown,
): RequestBodyValidationResult {
  const schema = requestBodySchemasByOperation[operationId];
  if (schema === undefined) {
    return { success: false, reason: "request-body-not-declared" };
  }
  const result = schema.safeParse(value);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, reason: "invalid-request-body" };
}

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
