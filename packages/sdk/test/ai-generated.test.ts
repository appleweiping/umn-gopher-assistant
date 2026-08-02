import { describe, expect, it, vi } from "vitest";

import { GopherApiError, GopherClient } from "../src/client.js";
import type { components, operations } from "../src/generated/schema.js";
import { operationDefinitions } from "../src/generated/operations.js";
import {
  validateImplementedRequestBody,
  validateImplementedSuccessBody,
} from "../src/generated/validators.js";

const request = {
  campusId: "tc",
  locale: "en",
  query: "Where is the library?",
} as const satisfies components["schemas"]["AiQueryRequest"];

const response = {
  state: "answered",
  queryId: "123e4567-e89b-42d3-a456-426614174000",
  campusId: "tc",
  locale: "en",
  paragraphs: [
    {
      id: "paragraph.1",
      text: "A reviewed record identifies the library service.",
      citationIds: ["citation.1"],
    },
  ],
  citations: [
    {
      id: "citation.1",
      documentId: "tc-library-hours",
      campusId: "tc",
      category: "library",
      title: { en: "Library hours", "zh-CN": "图书馆开放时间" },
      contentSha256: "a".repeat(64),
      updatedAt: "2026-07-22T12:00:00.000Z",
      summaryFreshnessState: "FRESH",
      summaryVerificationState: "schematic",
      excerpt: "Synthetic evidence excerpt for the SDK contract test.",
      summarySource: {
        kind: "project-authored-summary",
        sourceId: "uga-ai-summary-corpus-v1",
        sourceUrl:
          "https://github.com/appleweiping/umn-gopher-assistant/blob/main/apps/ai-knowledge/ai_knowledge/data/corpus.json",
        corpusSha256: "c".repeat(64),
        license: {
          status: "OPEN_REUSE",
          spdxId: "Apache-2.0",
          evidenceUrl: "https://www.apache.org/licenses/LICENSE-2.0",
        },
      },
      verificationLink: {
        kind: "official-verification-link",
        sourceId: "official-tc-library-hours",
        sourceUrl: "https://www.lib.umn.edu/spaces",
        licenseStatus: "DEEPLINK_ONLY",
        sourceUse: "verification-link-only",
        contentRetrieved: false,
      },
    },
  ],
  retrieval: { mode: "no-key-hybrid", documentsConsidered: 5 },
} as const satisfies components["schemas"]["AiQueryResponse"];

const typedRequestBody: operations["queryCampusAssistant"]["requestBody"]["content"]["application/json"] =
  request;

describe("generated AI SDK contract", () => {
  it("exposes the public implemented operation and generated request/response types", () => {
    expect(typedRequestBody).toEqual(request);
    expect(operationDefinitions.queryCampusAssistant).toMatchObject({
      idempotencyKeyRequired: false,
      method: "POST",
      path: "/v1/ai/query",
      public: true,
      requiredScopes: [],
      responseRequestBindings: ["campusId", "locale"],
      runtimeStatus: "implemented",
    });
  });

  it("validates the strict successful response shape", () => {
    expect(validateImplementedSuccessBody("queryCampusAssistant", 200, response)).toEqual({
      data: response,
      success: true,
    });
    expect(
      validateImplementedSuccessBody("queryCampusAssistant", 200, {
        ...response,
        retrieval: { ...response.retrieval, providerApiKey: "forbidden" },
      }),
    ).toEqual({ reason: "invalid-success-body", success: false });
    expect(
      validateImplementedSuccessBody("queryCampusAssistant", 200, {
        ...response,
        citations: [
          {
            ...response.citations[0],
            verificationLink: {
              ...response.citations[0].verificationLink,
              sourceUrl: "http://example.invalid",
            },
          },
        ],
      }),
    ).toEqual({ reason: "invalid-success-body", success: false });
    expect(
      validateImplementedSuccessBody("queryCampusAssistant", 200, {
        ...response,
        citations: [
          {
            ...response.citations[0],
            summarySource: {
              ...response.citations[0].summarySource,
              corpusSha256: "not-a-digest",
            },
          },
        ],
      }),
    ).toEqual({ reason: "invalid-success-body", success: false });
    expect(
      validateImplementedSuccessBody("queryCampusAssistant", 200, {
        ...response,
        citations: [
          {
            ...response.citations[0],
            verificationLink: {
              ...response.citations[0].verificationLink,
              contentRetrieved: true,
            },
          },
        ],
      }),
    ).toEqual({ reason: "invalid-success-body", success: false });
    expect(
      validateImplementedSuccessBody("queryCampusAssistant", 200, {
        ...response,
        citations: [
          {
            ...response.citations[0],
            verificationLink: {
              ...response.citations[0].verificationLink,
              sourceId: response.citations[0].summarySource.sourceId,
            },
          },
        ],
      }),
    ).toEqual({ reason: "invalid-success-body", success: false });
  });

  it("requires conflicts to use distinct authored documents, verification links, and hashes", () => {
    const conflictingCitation = {
      ...response.citations[0],
      id: "citation.2",
      documentId: "tc-library-hours-conflicting",
      contentSha256: "b".repeat(64),
      verificationLink: {
        ...response.citations[0].verificationLink,
        sourceId: "official-tc-library-hours-conflicting",
      },
    };
    const conflict = {
      ...response,
      state: "conflict",
      paragraphs: [{ ...response.paragraphs[0], citationIds: ["citation.1", "citation.2"] }],
      citations: [response.citations[0], conflictingCitation],
    };
    expect(validateImplementedSuccessBody("queryCampusAssistant", 200, conflict)).toMatchObject({
      success: true,
    });
    expect(
      validateImplementedSuccessBody("queryCampusAssistant", 200, {
        ...conflict,
        citations: [response.citations[0], { ...conflictingCitation, documentId: "tc-library-hours" }],
      }),
    ).toEqual({ reason: "invalid-success-body", success: false });
    expect(
      validateImplementedSuccessBody("queryCampusAssistant", 200, {
        ...conflict,
        citations: [
          response.citations[0],
          { ...conflictingCitation, verificationLink: response.citations[0].verificationLink },
        ],
      }),
    ).toEqual({ reason: "invalid-success-body", success: false });
    expect(
      validateImplementedSuccessBody("queryCampusAssistant", 200, {
        ...conflict,
        citations: [
          response.citations[0],
          {
            ...conflictingCitation,
            summarySource: {
              ...conflictingCitation.summarySource,
              corpusSha256: "d".repeat(64),
            },
          },
        ],
      }),
    ).toEqual({ reason: "invalid-success-body", success: false });
  });

  it("normalizes safe query edges and rejects non-NFC, controls, and encoded HTML", () => {
    expect(
      validateImplementedRequestBody("queryCampusAssistant", { ...request, query: "  library  " }),
    ).toEqual({
      data: { ...request, query: "library" },
      success: true,
    });
    for (const query of ["Cafe\u0301 library", "library\u200bresearch", "&lt;script&gt;"]) {
      expect(validateImplementedRequestBody("queryCampusAssistant", { ...request, query })).toEqual({
        reason: "invalid-request-body",
        success: false,
      });
    }
  });

  it("keeps official URLs case-insensitive but rejects transformed or unsafe evidence text", () => {
    expect(
      validateImplementedSuccessBody("queryCampusAssistant", 200, {
        ...response,
        citations: [
          {
            ...response.citations[0],
            verificationLink: {
              ...response.citations[0].verificationLink,
              sourceUrl: "HTTPS://WWW.LIB.UMN.EDU/",
            },
          },
        ],
      }),
    ).toMatchObject({ success: true });
    expect(
      validateImplementedSuccessBody("queryCampusAssistant", 200, {
        ...response,
        citations: [
          {
            ...response.citations[0],
            summarySource: {
              ...response.citations[0].summarySource,
              sourceUrl:
                "https://github.com:443/appleweiping/umn-gopher-assistant/blob/main/apps/ai-knowledge/ai_knowledge/data/corpus.json",
            },
          },
        ],
      }),
    ).toMatchObject({ success: true });
    expect(
      validateImplementedSuccessBody("queryCampusAssistant", 200, {
        ...response,
        citations: [
          {
            ...response.citations[0],
            summarySource: {
              ...response.citations[0].summarySource,
              sourceUrl: "https://github.com/appleweiping/umn-gopher-assistant/blob/main/README.md",
            },
          },
        ],
      }),
    ).toEqual({ reason: "invalid-success-body", success: false });
    expect(
      validateImplementedSuccessBody("queryCampusAssistant", 200, {
        ...response,
        citations: [
          {
            ...response.citations[0],
            verificationLink: {
              ...response.citations[0].verificationLink,
              sourceUrl: "https://umn.edu/dept/@current",
            },
          },
        ],
      }),
    ).toEqual({ reason: "invalid-success-body", success: false });

    const padded = validateImplementedSuccessBody("queryCampusAssistant", 200, {
      ...response,
      citations: [
        {
          ...response.citations[0],
          excerpt: "  Evidence with safe surrounding whitespace.  ",
          verificationLink: {
            ...response.citations[0].verificationLink,
            sourceUrl: "HTTPS://WWW.LIB.UMN.EDU/",
          },
          title: { en: "  Library hours  ", "zh-CN": "  图书馆开放时间  " },
        },
      ],
      paragraphs: [{ ...response.paragraphs[0], text: "  Evidence-backed answer.  " }],
    });
    expect(padded).toEqual({ reason: "invalid-success-body", success: false });

    for (const text of ["<strong>unsafe</strong>", "unsafe\u202Etext", "cafe\u0301"]) {
      expect(
        validateImplementedSuccessBody("queryCampusAssistant", 200, {
          ...response,
          paragraphs: [{ ...response.paragraphs[0], text }],
        }),
      ).toEqual({ reason: "invalid-success-body", success: false });
    }
  });

  it("binds AI campus and locale to the request and exposes bounded transport metadata", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { ...response, locale: "zh-CN" },
          { headers: { "X-Request-Id": "trace-sdk-mismatch" } },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(response, {
          headers: {
            "RateLimit-Limit": "12",
            "RateLimit-Remaining": "11",
            "RateLimit-Reset": "43",
            "X-Request-Id": "trace-sdk-success",
          },
        }),
      );
    const client = new GopherClient({ baseUrl: "https://assistant.example.test", fetch: fetchMock });

    await expect(client.request("queryCampusAssistant", { body: request })).rejects.toMatchObject({
      code: "response-request-mismatch",
      requestId: "trace-sdk-mismatch",
    });
    await expect(
      client.request("queryCampusAssistant", { body: { ...request, query: "  Where is the library?  " } }),
    ).resolves.toMatchObject({
      data: response,
      rateLimit: { limit: 12, remaining: 11, resetAfterSeconds: 43 },
      requestId: "trace-sdk-success",
      traceId: "trace-sdk-success",
    });
    const secondRequest = fetchMock.mock.calls[1]?.[0];
    expect(secondRequest).toBeInstanceOf(Request);
    await expect((secondRequest as Request).clone().json()).resolves.toMatchObject({
      query: "Where is the library?",
    });
  });

  it("exposes Retry-After and trace metadata on RFC 9457 errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          detail: "Wait before trying again.",
          instance: "/v1/ai/query",
          status: 429,
          title: "Too Many Requests",
          traceId: "trace-sdk-rate-limit",
          type: "about:blank",
        },
        {
          headers: {
            "Content-Type": "application/problem+json",
            "RateLimit-Limit": "12",
            "RateLimit-Remaining": "0",
            "RateLimit-Reset": "11",
            "Retry-After": "37",
            "X-Request-Id": "trace-sdk-rate-limit",
          },
          status: 429,
        },
      ),
    );
    const client = new GopherClient({ baseUrl: "https://assistant.example.test", fetch: fetchMock });
    const error = await client
      .request("queryCampusAssistant", { body: request })
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(GopherApiError);
    expect(error).toMatchObject({
      requestId: "trace-sdk-rate-limit",
      rateLimit: { limit: 12, remaining: 0, resetAfterSeconds: 11 },
      retryAfterSeconds: 37,
      traceId: "trace-sdk-rate-limit",
    });
  });

  it.each([
    {
      ...response,
      citations: [{ ...response.citations[0], campusId: "duluth" }],
    },
    {
      ...response,
      paragraphs: [{ ...response.paragraphs[0], citationIds: ["citation.missing"] }],
    },
    {
      ...response,
      citations: [{ ...response.citations[0], summaryFreshnessState: "EXPIRED" }],
    },
    {
      ...response,
      citations: [{ ...response.citations[0], summaryVerificationState: "retired" }],
    },
    {
      ...response,
      state: "no-results",
    },
  ])("rejects cross-field AI trust violations", (candidate) => {
    expect(validateImplementedSuccessBody("queryCampusAssistant", 200, candidate)).toEqual({
      reason: "invalid-success-body",
      success: false,
    });
  });
});
