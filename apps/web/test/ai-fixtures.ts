import type { AiCitation, AiQueryResponse } from "@umn-gopher-assistant/contracts";

export function aiCitation(overrides: Partial<AiCitation> = {}): AiCitation {
  return {
    campusId: "tc",
    category: "library",
    contentSha256: "a".repeat(64),
    documentId: "tc-library-overview",
    excerpt:
      "Use the University Libraries site as a starting point and verify current details on the linked official page.",
    id: "tc-library-hours",
    summaryFreshnessState: "FRESH",
    summarySource: {
      corpusSha256: "c".repeat(64),
      kind: "project-authored-summary",
      license: {
        evidenceUrl: "https://www.apache.org/licenses/LICENSE-2.0",
        spdxId: "Apache-2.0",
        status: "OPEN_REUSE",
      },
      sourceId: "uga-ai-summary-corpus-v1",
      sourceUrl:
        "https://github.com/appleweiping/umn-gopher-assistant/blob/main/apps/ai-knowledge/ai_knowledge/data/corpus.json",
    },
    summaryVerificationState: "schematic",
    title: { en: "Twin Cities library starting point", "zh-CN": "双城校区图书馆入口" },
    updatedAt: "2026-07-22T12:00:00.000Z",
    verificationLink: {
      contentRetrieved: false,
      kind: "official-verification-link",
      licenseStatus: "DEEPLINK_ONLY",
      sourceId: "official-tc-library",
      sourceUrl: "https://www.lib.umn.edu/services/hours",
      sourceUse: "verification-link-only",
    },
    ...overrides,
  };
}

export function aiResponse(overrides: Partial<AiQueryResponse> = {}): AiQueryResponse {
  return {
    campusId: "tc",
    citations: [aiCitation()],
    locale: "en",
    paragraphs: [
      {
        citationIds: ["tc-library-hours"],
        id: "paragraph-1",
        text: "Library hours vary by date; confirm the official schedule before traveling.",
      },
    ],
    queryId: "123e4567-e89b-42d3-a456-426614174000",
    retrieval: { documentsConsidered: 5, mode: "no-key-hybrid" },
    state: "answered",
    ...overrides,
  };
}
