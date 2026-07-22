import { describe, expect, it } from "vitest";

import { MCP_TOOL_CATALOG, McpToolService } from "../src/tools.js";

const campus = {
  academicCalendarCampusId: "tc",
  academicInstitutionCode: "UMNTC",
  city: { en: "Minneapolis", "zh-CN": "明尼阿波利斯" },
  id: "tc",
  name: { en: "Twin Cities", "zh-CN": "双城校区" },
  officialStatus: "UNVERIFIED",
  sourceUrl: "https://twin-cities.umn.edu/",
  timeZone: "America/Chicago",
} as const;

const source = {
  attribution: "Synthetic test fixture",
  authorizationEvidenceUrl: null,
  cacheDisposition: {
    derivedArtifacts: "PROHIBITED",
    normalizedRecords: "NEVER_STORE",
    rawResponse: "NEVER_STORE",
    retentionSeconds: null,
  },
  cachePolicy: "METADATA_ONLY",
  campusIds: ["tc"],
  dataClasses: ["PUBLIC_METADATA"],
  dataClassification: "PUBLIC",
  freshnessState: "FRESH",
  id: "test-source",
  killSwitch: {
    defaultState: "ENABLED",
    fallback: "DEEPLINK_ONLY",
    key: "source.test-source.enabled",
  },
  lastCheckedAt: "2026-07-19T00:00:00.000Z",
  licenseEvidenceUrl: null,
  licenseStatus: "DEEPLINK_ONLY",
  name: { en: "Test source", "zh-CN": "测试来源" },
  officialStatus: "UNVERIFIED",
  owner: {
    contactUrl: "https://example.edu/contact",
    teamId: "test-team",
  },
  publisher: "Fixture publisher",
  resourceKinds: ["CAMPUS_DEEPLINK"],
  sourceUrl: "https://example.edu/source",
  termsReviewExpiresAt: null,
  termsReviewedAt: null,
  verificationState: "schematic",
} as const;

const manifest = {
  campusId: "tc",
  etag: '"world-tc-1"',
  generatedAt: "2026-07-19T00:00:00.000Z",
  portals: [],
  revision: 1,
  sourceIds: ["test-source"],
  tiles: [],
  verificationState: "schematic",
  worldVersion: "0.1.0",
} as const;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
}

describe("MCP tool catalog", () => {
  it("contains exactly the three implemented read-only operations", () => {
    expect(MCP_TOOL_CATALOG.map(({ name }) => name)).toEqual([
      "campuses_list",
      "sources_list",
      "world_manifest_get",
    ]);
    expect(MCP_TOOL_CATALOG.map(({ operationId }) => operationId)).toEqual([
      "listCampuses",
      "listSources",
      "getWorldManifest",
    ]);
    for (const entry of MCP_TOOL_CATALOG) {
      expect(entry.annotations).toEqual({
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
        readOnlyHint: true,
      });
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(30);
    }
  });
});

describe("MCP tool service", () => {
  it("returns typed structured output and never sends downstream Authorization", async () => {
    let capturedRequest: Request | undefined;
    const service = new McpToolService({
      apiBaseUrl: new URL("http://127.0.0.1:4000/"),
      fetch: async (input) => {
        capturedRequest = input instanceof Request ? input : new Request(input);
        return jsonResponse([campus], {
          headers: { etag: '"campuses-1"', "x-request-id": "request-1234" },
          status: 200,
        });
      },
      upstreamTimeoutMs: 1_000,
    });

    const result = await service.listCampuses(new AbortController().signal);

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      campuses: [campus],
      etag: '"campuses-1"',
      requestId: "request-1234",
    });
    expect(capturedRequest?.headers.has("authorization")).toBe(false);
    expect(capturedRequest?.credentials).toBe("omit");
    expect(capturedRequest?.redirect).toBe("error");
  });

  it("preserves source pagination and typed campus filters", async () => {
    let requestedUrl = "";
    const service = new McpToolService({
      apiBaseUrl: new URL("http://127.0.0.1:4000/"),
      fetch: async (input) => {
        requestedUrl = (input instanceof Request ? input : new Request(input)).url;
        return jsonResponse({ items: [source], nextCursor: "next-page" }, { status: 200 });
      },
      upstreamTimeoutMs: 1_000,
    });

    const result = await service.listSources(
      { campusId: "tc", cursor: "opaque", limit: 7 },
      new AbortController().signal,
    );

    expect(new URL(requestedUrl).searchParams.toString()).toBe("campusId=tc&cursor=opaque&limit=7");
    expect(result.structuredContent).toEqual({
      etag: null,
      nextCursor: "next-page",
      requestId: null,
      sources: [source],
    });
  });

  it("returns the requested world manifest with a text fallback", async () => {
    const service = new McpToolService({
      apiBaseUrl: new URL("http://127.0.0.1:4000/"),
      fetch: async (input) => {
        expect((input instanceof Request ? input : new Request(input)).url).toBe(
          "http://127.0.0.1:4000/v1/worlds/tc/manifest",
        );
        return jsonResponse(manifest, { headers: { etag: manifest.etag }, status: 200 });
      },
      upstreamTimeoutMs: 1_000,
    });

    const result = await service.getWorldManifest({ campusId: "tc" }, new AbortController().signal);

    expect(result.structuredContent).toEqual({ etag: manifest.etag, manifest, requestId: null });
    expect(result.content[0]).toEqual({
      text: JSON.stringify(result.structuredContent),
      type: "text",
    });
  });

  it("redacts upstream problem detail and thrown secret text", async () => {
    const secret = "Bearer secret-that-must-not-escape";
    const problemService = new McpToolService({
      apiBaseUrl: new URL("http://127.0.0.1:4000/"),
      fetch: async () =>
        new Response(
          JSON.stringify({
            detail: secret,
            instance: "/v1/campuses",
            status: 503,
            title: "Unavailable",
            traceId: "trace-secret",
            type: "about:blank",
          }),
          { headers: { "content-type": "application/problem+json" }, status: 503 },
        ),
      upstreamTimeoutMs: 1_000,
    });
    const thrownService = new McpToolService({
      apiBaseUrl: new URL("http://127.0.0.1:4000/"),
      fetch: async () => {
        throw new Error(secret);
      },
      upstreamTimeoutMs: 1_000,
    });

    const problemResult = await problemService.listCampuses(new AbortController().signal);
    const thrownResult = await thrownService.listCampuses(new AbortController().signal);

    expect(problemResult.isError).toBe(true);
    expect(thrownResult.isError).toBe(true);
    expect(JSON.stringify(problemResult)).not.toContain(secret);
    expect(JSON.stringify(problemResult)).not.toContain("trace-secret");
    expect(JSON.stringify(thrownResult)).not.toContain(secret);
  });

  it("rejects unknown response fields instead of leaking them through structured output", async () => {
    const secret = "private-upstream-field";
    const service = new McpToolService({
      apiBaseUrl: new URL("http://127.0.0.1:4000/"),
      fetch: async () => jsonResponse([{ ...campus, internalSecret: secret }], { status: 200 }),
      upstreamTimeoutMs: 1_000,
    });

    const result = await service.listCampuses(new AbortController().signal);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: "upstream_protocol_error", retryable: true },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("rejects response values that violate HTTPS and date-time contract formats", async () => {
    const invalidSources = [
      { ...source, sourceUrl: "http://example.edu/not-https" },
      { ...source, lastCheckedAt: "not-a-date-time" },
      { ...source, cachePolicy: "CACHE_ALLOWED", licenseStatus: "PROHIBITED" },
    ];

    for (const invalidSource of invalidSources) {
      const service = new McpToolService({
        apiBaseUrl: new URL("http://127.0.0.1:4000/"),
        fetch: async () => jsonResponse({ items: [invalidSource], nextCursor: null }, { status: 200 }),
        upstreamTimeoutMs: 1_000,
      });
      const result = await service.listSources({}, new AbortController().signal);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: "upstream_protocol_error", retryable: true },
      });
    }

    const invalidManifestService = new McpToolService({
      apiBaseUrl: new URL("http://127.0.0.1:4000/"),
      fetch: async () => jsonResponse({ ...manifest, generatedAt: "not-a-date-time" }, { status: 200 }),
      upstreamTimeoutMs: 1_000,
    });
    const result = await invalidManifestService.getWorldManifest(
      { campusId: "tc" },
      new AbortController().signal,
    );
    expect(result.structuredContent).toMatchObject({
      error: { code: "upstream_protocol_error", retryable: true },
    });
  });
});
