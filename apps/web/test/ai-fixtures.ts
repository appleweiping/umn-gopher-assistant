import type { AiCitation, AiQueryResponse } from "@umn-gopher-assistant/contracts";

export function aiCitation(overrides: Partial<AiCitation> = {}): AiCitation {
  return {
    campusId: "tc",
    category: "library",
    contentSha256: "a".repeat(64),
    excerpt: "Library hours vary by date. Check the official schedule before traveling.",
    freshnessState: "FRESH",
    id: "tc-library-hours",
    sourceId: "tc-library-knowledge",
    sourceUrl: "https://www.lib.umn.edu/services/hours",
    title: { en: "University Libraries hours", "zh-CN": "大学图书馆开放时间" },
    updatedAt: "2026-07-22T12:00:00.000Z",
    verificationState: "campus-reviewed",
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
