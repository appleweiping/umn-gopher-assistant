// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { catalogDateWindow, fetchCatalogPage } from "../lib/catalog/client";

const observationId = "123e4567-e89b-42d3-a456-426614174000";
const signedCursor = `${"a".repeat(24)}.${"b".repeat(43)}`;

function observation(overrides: Record<string, unknown> = {}) {
  return {
    appliedCacheDisposition: "DISCARDED_AFTER_RESPONSE",
    cachePolicy: "NO_CONTENT_CACHE",
    campusId: "tc",
    dataClassification: "PUBLIC",
    durationMs: 125,
    failureCode: null,
    freshnessState: "FRESH",
    httpStatus: 200,
    licenseStatus: "LIVE_ONLY",
    observationId,
    observedAt: "2026-07-22T12:00:00.000Z",
    outcome: "SUCCESS",
    parserVersion: "public-events@1.0.0",
    rawByteLength: 512,
    rawSha256: "a".repeat(64),
    recordsAccepted: 1,
    recordsRejected: 0,
    sourceId: "tc-events-feed",
    ...overrides,
  };
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    allDay: false,
    campusId: "tc",
    canonicalUrl: "https://events.tc.umn.edu/event/100-synthetic",
    categories: ["Synthetic fixture"],
    descriptionText: null,
    endsAt: "2026-09-08T15:00:00.000-05:00",
    id: "event-100",
    language: "en",
    location: { address: null, coordinates: null, name: "Synthetic room", onlineUrl: null },
    observedAt: "2026-07-22T12:00:00.000Z",
    sourceId: "tc-events-feed",
    sourceObservationId: observationId,
    startsAt: "2026-09-08T14:00:00.000-05:00",
    status: "SCHEDULED",
    timeZone: "America/Chicago",
    title: "Synthetic public event",
    ...overrides,
  };
}

function page(overrides: Record<string, unknown> = {}) {
  return {
    items: [event()],
    nextCursor: null,
    range: { defaulted: false, from: "2026-07-22", to: "2026-11-19" },
    retrievalCoverage: {
      nextUpstreamPage: null,
      pagesFetched: 1,
      recordsFetched: 1,
      sourceTotalPages: 1,
      sourceTotalRecords: 1,
      truncatedByPolicy: false,
    },
    sourceObservations: [observation()],
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("public catalog client", () => {
  it("uses a bounded Central-time window, no-store, and shared record schemas", async () => {
    const upstreamFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(page()));
    const controller = new AbortController();
    const result = await fetchCatalogPage("events", "tc", {
      signal: controller.signal,
      window: { from: "2026-07-22", to: "2026-11-19" },
    });

    expect(result.items[0]?.title).toBe("Synthetic public event");
    const [url, init] = upstreamFetch.mock.calls[0] ?? [];
    expect(typeof url).toBe("string");
    expect(url as string).toContain("/api/catalog/events?");
    expect(url as string).toContain("campusId=tc");
    expect(init).toMatchObject({ cache: "no-store", credentials: "omit", redirect: "error" });
    expect(catalogDateWindow(new Date("2026-07-22T04:30:00.000Z"), 120)).toEqual({
      from: "2026-07-21",
      to: "2026-11-18",
    });
    expect(() => catalogDateWindow(new Date(), 184)).toThrow(/183/u);
  });

  it.each([
    page({ items: [event(), event()] }),
    page({ range: { defaulted: false, from: "2026-02-30", to: "2026-11-19" } }),
    page({ sourceObservations: [observation({ campusId: "duluth" })] }),
    page({
      sourceObservations: [
        observation({ outcome: "NOT_MODIFIED", httpStatus: 304, rawByteLength: null, rawSha256: null }),
      ],
    }),
    page({
      retrievalCoverage: {
        nextUpstreamPage: null,
        pagesFetched: 2,
        recordsFetched: 1,
        sourceTotalPages: 2,
        sourceTotalRecords: 1,
        truncatedByPolicy: false,
      },
    }),
    page({
      retrievalCoverage: {
        nextUpstreamPage: null,
        pagesFetched: 1,
        recordsFetched: 1,
        sourceTotalPages: 0,
        sourceTotalRecords: 0,
        truncatedByPolicy: false,
      },
    }),
  ])("fails closed for mismatched records, provenance, or coverage", async (invalidPage) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(invalidPage));
    await expect(
      fetchCatalogPage("events", "tc", { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ failureCode: "CATALOG_CONTRACT_MISMATCH", status: 502 });
  });

  it("surfaces a safe official fallback from a 503 problem", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        {
          detail: "Source unavailable",
          failureCode: "TIMEOUT",
          officialUrl: "https://events.tc.umn.edu/",
          status: 503,
          title: "Service Unavailable",
        },
        { status: 503 },
      ),
    );
    await expect(
      fetchCatalogPage("events", "tc", { signal: new AbortController().signal }),
    ).rejects.toMatchObject({
      failureCode: "TIMEOUT",
      officialUrl: "https://events.tc.umn.edu/",
      status: 503,
    });
  });

  it("parses and forwards a signed continuation cursor without caching it", async () => {
    const upstreamFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => Response.json(page({ nextCursor: signedCursor })));
    const first = await fetchCatalogPage("events", "tc", { signal: new AbortController().signal });
    expect(first.nextCursor).toBe(signedCursor);

    await fetchCatalogPage("events", "tc", {
      cursor: signedCursor,
      signal: new AbortController().signal,
      window: first.range,
    });
    const continuationUrl = upstreamFetch.mock.calls[1]?.[0];
    expect(typeof continuationUrl).toBe("string");
    expect(new URL(continuationUrl as string, "https://assistant.example").searchParams.get("cursor")).toBe(
      signedCursor,
    );
    await expect(
      fetchCatalogPage("events", "tc", {
        cursor: "unsigned",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/cursor/u);
  });
});
