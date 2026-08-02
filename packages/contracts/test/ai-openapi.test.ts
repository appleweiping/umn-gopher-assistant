import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

interface Schema {
  additionalProperties?: boolean;
  const?: boolean | string;
  enum?: string[];
  items?: Schema;
  maxItems?: number;
  maxLength?: number;
  maximum?: number;
  minItems?: number;
  minLength?: number;
  minimum?: number;
  pattern?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  type?: string;
  "x-uga-semantic-validator"?: string;
  $ref?: string;
}

interface OpenApiDocument {
  components: { schemas: Record<string, Schema> };
  paths: {
    "/v1/ai/query": {
      post: {
        description: string;
        operationId: string;
        responses: Record<
          string,
          {
            $ref?: string;
            content?: { "application/json": { schema: Schema } };
            headers?: Record<string, unknown>;
          }
        >;
        security: unknown[];
        "x-runtime-status": string;
        "x-uga-response-request-bindings": string[];
        requestBody: { content: { "application/json": { schema: Schema } } };
      };
    };
  };
}

const openapi = parse(
  readFileSync(resolve(import.meta.dirname, "../../../openapi/openapi.yaml"), "utf8"),
) as OpenApiDocument;

describe("AI OpenAPI contract", () => {
  const operation = openapi.paths["/v1/ai/query"].post;

  it("publishes the no-key query operation as an anonymous implemented surface", () => {
    expect(operation).toMatchObject({
      operationId: "queryCampusAssistant",
      security: [],
      "x-runtime-status": "implemented",
      "x-uga-response-request-bindings": ["campusId", "locale"],
    });
    expect(operation.requestBody.content["application/json"].schema.$ref).toBe(
      "#/components/schemas/AiQueryRequest",
    );
    expect(operation.responses["200"]?.content?.["application/json"].schema.$ref).toBe(
      "#/components/schemas/AiQueryResponse",
    );
    expect(Object.keys(operation.responses).sort()).toEqual([
      "200",
      "400",
      "413",
      "415",
      "429",
      "500",
      "503",
    ]);
    expect(Object.keys(operation.responses["200"]?.headers ?? {}).sort()).toEqual([
      "Cache-Control",
      "RateLimit-Limit",
      "RateLimit-Remaining",
      "RateLimit-Reset",
      "X-Request-Id",
    ]);
    expect(operation.responses["415"]?.$ref).toBe("#/components/responses/UnsupportedMediaType");
    expect(operation.responses["429"]?.$ref).toBe("#/components/responses/AiTooManyRequests");
    expect(operation.responses["503"]?.$ref).toBe("#/components/responses/AiUnavailable");
    expect(operation.description).toContain("project-authored campus summaries");
    expect(operation.description).not.toContain("reviewed campus knowledge");
  });

  it("declares closed request, response, citation, paragraph, and retrieval objects", () => {
    for (const name of [
      "AiQueryRequest",
      "AiQueryResponse",
      "AiCitation",
      "AiSummaryLicense",
      "AiSummarySource",
      "AiVerificationLink",
      "AiAnswerParagraph",
      "AiRetrieval",
    ]) {
      expect(openapi.components.schemas[name]).toMatchObject({
        additionalProperties: false,
        type: "object",
      });
    }

    expect(openapi.components.schemas["AiQueryRequest"]?.required).toEqual(["campusId", "locale", "query"]);
    expect(openapi.components.schemas["AiQueryRequest"]?.properties?.["query"]).toMatchObject({
      maxLength: 500,
      minLength: 2,
      type: "string",
    });
    expect(openapi.components.schemas["AiQueryResponse"]?.required).toEqual([
      "state",
      "queryId",
      "campusId",
      "locale",
      "paragraphs",
      "citations",
      "retrieval",
    ]);
    expect(openapi.components.schemas["AiQueryResponse"]?.["x-uga-semantic-validator"]).toBe(
      "ai-query-response-v2",
    );
    expect(openapi.components.schemas["AiQueryState"]?.enum).toEqual([
      "answered",
      "stale",
      "conflict",
      "no-results",
    ]);
    expect(openapi.components.schemas["AiCitationCategory"]?.enum).toEqual([
      "library",
      "student-services",
      "safety",
      "transportation",
      "dining",
    ]);
    expect(openapi.components.schemas["AiCitation"]?.required).toEqual([
      "id",
      "documentId",
      "campusId",
      "category",
      "title",
      "excerpt",
      "contentSha256",
      "updatedAt",
      "summaryFreshnessState",
      "summaryVerificationState",
      "summarySource",
      "verificationLink",
    ]);
    expect(openapi.components.schemas["AiSummaryLicense"]?.required).toEqual([
      "status",
      "spdxId",
      "evidenceUrl",
    ]);
    expect(openapi.components.schemas["AiSummaryLicense"]?.properties).toMatchObject({
      evidenceUrl: { const: "https://www.apache.org/licenses/LICENSE-2.0" },
      spdxId: { const: "Apache-2.0" },
      status: { const: "OPEN_REUSE" },
    });
    expect(openapi.components.schemas["AiSummarySource"]?.required).toEqual([
      "kind",
      "sourceId",
      "sourceUrl",
      "corpusSha256",
      "license",
    ]);
    expect(openapi.components.schemas["AiSummarySource"]?.properties).toMatchObject({
      corpusSha256: { pattern: "^[a-f0-9]{64}$", type: "string" },
      kind: { const: "project-authored-summary" },
      sourceUrl: {
        pattern:
          "^[Hh][Tt][Tt][Pp][Ss]://[Gg][Ii][Tt][Hh][Uu][Bb]\\.[Cc][Oo][Mm](?::443)?/appleweiping/umn-gopher-assistant/blob/main/apps/ai-knowledge/ai_knowledge/data/corpus\\.json$",
      },
    });
    expect(openapi.components.schemas["AiVerificationLink"]?.required).toEqual([
      "kind",
      "sourceId",
      "sourceUrl",
      "licenseStatus",
      "sourceUse",
      "contentRetrieved",
    ]);
    expect(openapi.components.schemas["AiVerificationLink"]?.properties).toMatchObject({
      contentRetrieved: { const: false, type: "boolean" },
      kind: { const: "official-verification-link" },
      licenseStatus: { const: "DEEPLINK_ONLY" },
      sourceUse: { const: "verification-link-only" },
    });
    expect(openapi.components.schemas["AiCitation"]?.properties?.["summaryVerificationState"]).toMatchObject({
      const: "schematic",
      type: "string",
    });
    expect(openapi.components.schemas["AiCitation"]?.properties?.["summaryFreshnessState"]).toMatchObject({
      enum: ["FRESH", "STALE", "EXPIRED"],
      type: "string",
    });
    expect(openapi.components.schemas["AiAnswerParagraph"]?.properties?.["citationIds"]).toMatchObject({
      maxItems: 64,
      minItems: 1,
      type: "array",
    });
    expect(openapi.components.schemas["AiAnswerParagraph"]?.properties?.["text"]).toMatchObject({
      maxLength: 4_000,
      minLength: 1,
      "x-uga-semantic-validator": "ai-evidence-text-v1",
    });
    expect(openapi.components.schemas["AiCitation"]?.properties?.["excerpt"]).toMatchObject({
      maxLength: 4_000,
      minLength: 1,
      "x-uga-semantic-validator": "ai-evidence-text-v1",
    });
    expect(openapi.components.schemas["AiRetrieval"]?.properties).toMatchObject({
      documentsConsidered: { maximum: 1_000_000, minimum: 0, type: "integer" },
      mode: { const: "no-key-hybrid", type: "string" },
    });
  });
});
