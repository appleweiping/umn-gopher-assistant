import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { AiQueryRequestSchema, AiQueryResponseSchema } from "../src/index.js";

const queryBoundaryFixtures = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "fixtures/ai-query-boundary.json"), "utf8"),
) as {
  readonly invalidRequests: readonly { readonly name: string; readonly value: unknown }[];
  readonly invalidResponses: readonly { readonly name: string; readonly value: unknown }[];
  readonly validRequests: readonly { readonly name: string; readonly value: unknown }[];
  readonly validResponses: readonly { readonly name: string; readonly value: unknown }[];
};

const citation = {
  id: "citation.library-hours",
  documentId: "tc-library-hours",
  campusId: "tc",
  category: "library",
  title: { en: "Library hours", "zh-CN": "图书馆开放时间" },
  contentSha256: "a".repeat(64),
  updatedAt: "2026-07-22T12:00:00.000Z",
  summaryFreshnessState: "FRESH",
  summaryVerificationState: "schematic",
  excerpt: "The synthetic reviewed record lists the current opening hours.",
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
} as const;

const answeredResponse = {
  state: "answered",
  queryId: "123e4567-e89b-42d3-a456-426614174000",
  campusId: "tc",
  locale: "en",
  paragraphs: [
    {
      id: "paragraph.1",
      text: "The reviewed campus record contains library opening hours.",
      citationIds: [citation.id],
    },
  ],
  citations: [citation],
  retrieval: { mode: "no-key-hybrid", documentsConsidered: 5 },
} as const;

describe("AI query request contract", () => {
  it("trims a bounded bilingual public query and rejects undeclared fields", () => {
    expect(AiQueryRequestSchema.parse({ campusId: "tc", locale: "zh-CN", query: "  图书馆？  " })).toEqual({
      campusId: "tc",
      locale: "zh-CN",
      query: "图书馆？",
    });
    expect(
      AiQueryRequestSchema.safeParse({
        campusId: "tc",
        locale: "en",
        query: "Library hours",
        apiKey: "must-not-be-accepted",
      }).success,
    ).toBe(false);
  });

  it("rejects queries outside the trimmed 2 to 500 character boundary", () => {
    expect(AiQueryRequestSchema.safeParse({ campusId: "tc", locale: "en", query: " a " }).success).toBe(
      false,
    );
    expect(
      AiQueryRequestSchema.safeParse({ campusId: "tc", locale: "en", query: "a".repeat(501) }).success,
    ).toBe(false);
  });

  it.each(["<library>", "library\u0000hours", "cafe\u0301", "&#x3c;script&#x3e;"])(
    "rejects unsafe or non-canonical query text: %s",
    (query) => {
      expect(AiQueryRequestSchema.safeParse({ campusId: "tc", locale: "en", query }).success).toBe(false);
    },
  );

  it("stays aligned with the cross-runtime query boundary fixtures", () => {
    for (const fixture of queryBoundaryFixtures.validRequests) {
      expect(AiQueryRequestSchema.safeParse(fixture.value).success, fixture.name).toBe(true);
    }
    for (const fixture of queryBoundaryFixtures.invalidRequests) {
      expect(AiQueryRequestSchema.safeParse(fixture.value).success, fixture.name).toBe(false);
    }
  });
});

describe("AI query response contract", () => {
  it("stays aligned with the cross-runtime response boundary fixtures", () => {
    for (const fixture of queryBoundaryFixtures.validResponses) {
      expect(AiQueryResponseSchema.safeParse(fixture.value).success, fixture.name).toBe(true);
    }
    for (const fixture of queryBoundaryFixtures.invalidResponses) {
      expect(AiQueryResponseSchema.safeParse(fixture.value).success, fixture.name).toBe(false);
    }
  });

  it("accepts an evidence-backed answer and a truly empty no-results response", () => {
    expect(AiQueryResponseSchema.parse(answeredResponse)).toEqual(answeredResponse);
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        state: "no-results",
        paragraphs: [],
        citations: [],
        retrieval: { mode: "no-key-hybrid", documentsConsidered: 0 },
      }).success,
    ).toBe(true);
  });

  it("requires unique paragraph, citation, and per-paragraph reference IDs", () => {
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        paragraphs: [...answeredResponse.paragraphs, answeredResponse.paragraphs[0]],
      }).success,
    ).toBe(false);
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        citations: [
          {
            ...citation,
            summarySource: {
              ...citation.summarySource,
              sourceUrl: "https://github.com/appleweiping/umn-gopher-assistant/blob/main/README.md",
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        citations: [citation, { ...citation, documentId: "tc-library-hours-copy" }],
      }).success,
    ).toBe(false);
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        paragraphs: [{ ...answeredResponse.paragraphs[0], citationIds: [citation.id, citation.id] }],
      }).success,
    ).toBe(false);
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        citations: [
          {
            ...citation,
            verificationLink: {
              ...citation.verificationLink,
              sourceUrl: "https://umn.edu@example.invalid/phishing",
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects dangling evidence references and cross-campus citations", () => {
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        paragraphs: [{ ...answeredResponse.paragraphs[0], citationIds: ["citation.missing"] }],
      }).success,
    ).toBe(false);
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        citations: [{ ...citation, campusId: "duluth" }],
      }).success,
    ).toBe(false);
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        citations: [
          {
            ...citation,
            verificationLink: {
              ...citation.verificationLink,
              sourceUrl: "https://umn.edu/dept/@current",
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires every answer paragraph to cite evidence", () => {
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        paragraphs: [{ ...answeredResponse.paragraphs[0], citationIds: [] }],
      }).success,
    ).toBe(false);
    expect(
      AiQueryResponseSchema.safeParse({ ...answeredResponse, paragraphs: [], citations: [] }).success,
    ).toBe(false);
  });

  it("keeps no-results empty and stale answers limited to old evidence", () => {
    expect(AiQueryResponseSchema.safeParse({ ...answeredResponse, state: "no-results" }).success).toBe(false);
    expect(AiQueryResponseSchema.safeParse({ ...answeredResponse, state: "stale" }).success).toBe(false);
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        state: "stale",
        citations: [{ ...citation, summaryFreshnessState: "EXPIRED" }],
      }).success,
    ).toBe(true);
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        state: "conflict",
        paragraphs: [
          {
            ...answeredResponse.paragraphs[0],
            citationIds: [citation.id, "citation.library-hours-conflicting"],
          },
        ],
        citations: [
          citation,
          {
            ...citation,
            id: "citation.library-hours-conflicting",
            documentId: "tc-library-hours-conflicting",
            contentSha256: "b".repeat(64),
            summarySource: { ...citation.summarySource, corpusSha256: "d".repeat(64) },
            verificationLink: {
              ...citation.verificationLink,
              sourceId: "official-tc-library-hours-conflicting",
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        citations: [{ ...citation, summaryFreshnessState: "EXPIRED" }],
      }).success,
    ).toBe(false);
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        citations: [{ ...citation, summaryFreshnessState: "UNKNOWN" }],
      }).success,
    ).toBe(false);
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        citations: [{ ...citation, summaryVerificationState: "retired" }],
      }).success,
    ).toBe(false);
  });

  it("requires at least two citations for a conflict and keeps retrieval metadata strict", () => {
    expect(AiQueryResponseSchema.safeParse({ ...answeredResponse, state: "conflict" }).success).toBe(false);
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        state: "conflict",
        paragraphs: [
          {
            ...answeredResponse.paragraphs[0],
            citationIds: [citation.id, "citation.library-hours-conflicting"],
          },
        ],
        citations: [
          citation,
          {
            ...citation,
            id: "citation.library-hours-conflicting",
            documentId: "tc-library-hours-conflicting",
            contentSha256: "b".repeat(64),
            verificationLink: {
              ...citation.verificationLink,
              sourceId: "official-tc-library-hours-conflicting",
            },
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        retrieval: { ...answeredResponse.retrieval, providerApiKey: "forbidden" },
      }).success,
    ).toBe(false);
  });

  it("requires every citation to be used and rejects conflicts without independent documents and links", () => {
    const unused = {
      ...citation,
      id: "citation.unused",
      documentId: "tc-library-unused",
      contentSha256: "b".repeat(64),
      verificationLink: {
        ...citation.verificationLink,
        sourceId: "official-tc-library-unused",
      },
    } as const;
    expect(
      AiQueryResponseSchema.safeParse({ ...answeredResponse, citations: [citation, unused] }).success,
    ).toBe(false);
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        state: "conflict",
        paragraphs: [
          {
            ...answeredResponse.paragraphs[0],
            citationIds: [citation.id, "citation.copy"],
          },
        ],
        citations: [
          citation,
          {
            ...citation,
            id: "citation.copy",
            documentId: "tc-library-copy",
            contentSha256: "b".repeat(64),
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        state: "conflict",
        paragraphs: [
          {
            ...answeredResponse.paragraphs[0],
            citationIds: [citation.id, "citation.copy"],
          },
        ],
        citations: [
          citation,
          {
            ...citation,
            id: "citation.copy",
            contentSha256: "b".repeat(64),
            verificationLink: {
              ...citation.verificationLink,
              sourceId: "official-tc-library-copy",
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("keeps authored-summary provenance separate from the non-retrieved official link", () => {
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        citations: [
          {
            ...citation,
            summarySource: {
              ...citation.summarySource,
              sourceUrl:
                "https://github.com:443/appleweiping/umn-gopher-assistant/blob/main/apps/ai-knowledge/ai_knowledge/data/corpus.json",
            },
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        citations: [
          {
            ...citation,
            summarySource: {
              ...citation.summarySource,
              sourceUrl: "https://github.com/example/another-project/blob/main/corpus.json",
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        citations: [
          {
            ...citation,
            summarySource: { ...citation.summarySource, corpusSha256: "not-a-digest" },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        citations: [
          {
            ...citation,
            summarySource: {
              ...citation.summarySource,
              license: { ...citation.summarySource.license, spdxId: "MIT" },
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        citations: [
          {
            ...citation,
            verificationLink: { ...citation.verificationLink, contentRetrieved: true },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        citations: [
          {
            ...citation,
            verificationLink: {
              ...citation.verificationLink,
              sourceId: citation.summarySource.sourceId,
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      AiQueryResponseSchema.safeParse({
        ...answeredResponse,
        citations: [{ ...citation, sourceId: "ambiguous-source", sourceUrl: "https://umn.edu/" }],
      }).success,
    ).toBe(false);
  });

  it.each([
    [
      "paragraph boundary whitespace",
      { paragraphs: [{ ...answeredResponse.paragraphs[0], text: " padded" }] },
    ],
    [
      "paragraph HTML",
      { paragraphs: [{ ...answeredResponse.paragraphs[0], text: "<strong>unsafe</strong>" }] },
    ],
    ["citation format control", { citations: [{ ...citation, excerpt: "unsafe\u202Etext" }] }],
    [
      "citation non-NFC title",
      { citations: [{ ...citation, title: { ...citation.title, en: "cafe\u0301" } }] },
    ],
    ["citation encoded HTML", { citations: [{ ...citation, excerpt: "&#x3c;script&#x3e;" }] }],
  ])("rejects unsafe evidence output: %s", (_label, override) => {
    expect(AiQueryResponseSchema.safeParse({ ...answeredResponse, ...override }).success).toBe(false);
  });
});
