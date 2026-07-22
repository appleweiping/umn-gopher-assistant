import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  DULUTH_LIVEWHALE_SOURCE,
  LiveWhaleEventsAdapter,
  ObservedIntegrationError,
  SafeJsonFetcher,
  SourceCircuitOpenError,
  SourceRequestCoordinator,
  StaticSourceLicenseGate,
  TC_LIVEWHALE_SOURCE,
  UmnSessionsAdapter,
  UMN_SESSIONS_SOURCES,
  type IntegrationFetch,
} from "../../src/integrations/index.js";
import { liveWhaleFixture, sessionFixture } from "./fixtures.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

function enabledGate(sourceId: string) {
  return new StaticSourceLicenseGate([
    {
      sourceId,
      enabled: true,
      licenseStatus: "LIVE_ONLY",
      reviewedAt: "2026-07-22T00:00:00.000Z",
    },
  ]);
}

describe("source adapter license boundary", () => {
  it("makes zero network calls when the Sessions license decision is disabled", () => {
    const transport = vi.fn<IntegrationFetch>(async () => jsonResponse(sessionFixture()));
    const adapter = new UmnSessionsAdapter({
      campusId: "tc",
      fetcher: new SafeJsonFetcher({ fetch: transport }),
      licenseGate: new StaticSourceLicenseGate([
        {
          sourceId: UMN_SESSIONS_SOURCES.tc.id,
          enabled: false,
          licenseStatus: "LIVE_ONLY",
          reviewedAt: "2026-07-22T00:00:00.000Z",
        },
      ]),
      coordinator: new SourceRequestCoordinator(),
    });

    expect(() => adapter.fetch({ termIds: ["1269"] })).toThrow(/disabled/u);
    expect(transport).not.toHaveBeenCalled();
  });

  it("makes zero network calls when an enabled decision has no real review timestamp", () => {
    const transport = vi.fn(async () => jsonResponse(sessionFixture()));
    const adapter = new UmnSessionsAdapter({
      campusId: "tc",
      fetcher: new SafeJsonFetcher({ fetch: transport }),
      licenseGate: new StaticSourceLicenseGate([
        {
          sourceId: UMN_SESSIONS_SOURCES.tc.id,
          enabled: true,
          licenseStatus: "LIVE_ONLY",
          reviewedAt: "unreviewed",
        },
      ]),
      coordinator: new SourceRequestCoordinator(),
    });
    expect(() => adapter.fetch({ termIds: ["1269"] })).toThrow(/review timestamp/u);
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(["DEEPLINK_ONLY", "APPROVAL_REQUIRED", "PROHIBITED"] as const)(
    "makes zero network calls for %s sources",
    (licenseStatus) => {
      const transport = vi.fn(async () => jsonResponse(liveWhaleFixture()));
      const adapter = new LiveWhaleEventsAdapter({
        campusId: "tc",
        fetcher: new SafeJsonFetcher({ fetch: transport }),
        licenseGate: new StaticSourceLicenseGate([
          {
            sourceId: TC_LIVEWHALE_SOURCE.id,
            enabled: true,
            licenseStatus,
            reviewedAt: "2026-07-22T00:00:00.000Z",
          },
        ]),
        coordinator: new SourceRequestCoordinator(),
      });
      expect(() => adapter.fetch()).toThrow();
      expect(transport).not.toHaveBeenCalled();
    },
  );
});

describe("LIVE_ONLY source adapters", () => {
  it("returns normalized Sessions records and only a hash observation for raw content", async () => {
    const transport = vi.fn<IntegrationFetch>(async () => jsonResponse(sessionFixture()));
    const adapter = new UmnSessionsAdapter({
      campusId: "tc",
      fetcher: new SafeJsonFetcher({ fetch: transport }),
      licenseGate: enabledGate(UMN_SESSIONS_SOURCES.tc.id),
      coordinator: new SourceRequestCoordinator(),
    });
    const result = await adapter.fetch({ termIds: ["1273", "1269"] });
    expect(result.records).toHaveLength(1);
    expect(result.observation).toMatchObject({
      algorithm: "SHA-256",
      rawContentPersisted: false,
    });
    expect(result).not.toHaveProperty("rawBody");
    expect(result).not.toHaveProperty("json");
    expect(adapter.source.licenseStatus).toBe("LIVE_ONLY");
    const firstCall = transport.mock.calls[0];
    if (firstCall === undefined) throw new Error("Expected a bounded Sessions request");
    expect(firstCall[0].toString()).toBe(
      "https://sessions.umn.edu/sessions.json?q=institution_id=UMNTC,term_id=1269|1273",
    );
  });

  it("rejects empty, oversized, duplicate, or out-of-filter term windows without unbounded fallback", async () => {
    const transport = vi.fn(async () => jsonResponse(sessionFixture()));
    const adapter = new UmnSessionsAdapter({
      campusId: "tc",
      fetcher: new SafeJsonFetcher({ fetch: transport }),
      licenseGate: enabledGate(UMN_SESSIONS_SOURCES.tc.id),
      coordinator: new SourceRequestCoordinator(),
    });

    expect(() => adapter.fetch({ termIds: [] })).toThrow(/1 through 3/u);
    expect(() => adapter.fetch({ termIds: ["1261", "1265", "1269", "1273"] })).toThrow(/1 through 3/u);
    expect(() => adapter.fetch({ termIds: ["1269", "1269"] })).toThrow(/unique/u);
    expect(transport).not.toHaveBeenCalled();

    await expect(adapter.fetch({ termIds: ["1265"] })).rejects.toThrow(/outside the requested filter/u);
  });

  it("carries only completed transport integrity metadata when Sessions normalization fails", async () => {
    const malformed = sessionFixture();
    const firstSession = malformed.sessions[0];
    if (firstSession === undefined) throw new TypeError("Expected a Sessions fixture record");
    firstSession.institution.institution_id = "UMNDL";
    const raw = JSON.stringify(malformed);
    const adapter = new UmnSessionsAdapter({
      campusId: "tc",
      fetcher: new SafeJsonFetcher({
        fetch: async () => jsonResponse(malformed),
        now: () => new Date("2026-07-22T12:34:56.000Z"),
      }),
      licenseGate: enabledGate(UMN_SESSIONS_SOURCES.tc.id),
      coordinator: new SourceRequestCoordinator(),
    });

    const error = await adapter.fetch({ termIds: ["1269"] }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ObservedIntegrationError);
    expect(error).toMatchObject({
      code: "UPSTREAM_SCHEMA_DRIFT",
      observation: {
        byteLength: Buffer.byteLength(raw),
        fetchedAt: "2026-07-22T12:34:56.000Z",
        httpStatus: 200,
        rawContentPersisted: false,
        sha256: createHash("sha256").update(raw).digest("hex"),
      },
    });
    expect(error).not.toHaveProperty("rawBody");
    expect(error).not.toHaveProperty("json");
  });

  it.each([
    ["tc", TC_LIVEWHALE_SOURCE.id, "https://events.tc.umn.edu"],
    ["duluth", DULUTH_LIVEWHALE_SOURCE.id, "https://calendar.d.umn.edu"],
  ] as const)("loads a safe %s LiveWhale occurrence", async (campusId, sourceId, origin) => {
    const transport = vi.fn(async () => jsonResponse(liveWhaleFixture(origin)));
    const adapter = new LiveWhaleEventsAdapter({
      campusId,
      fetcher: new SafeJsonFetcher({ fetch: transport }),
      licenseGate: enabledGate(sourceId),
      coordinator: new SourceRequestCoordinator(),
    });
    const result = await adapter.fetch();
    expect(result.records[0]).toMatchObject({ campusId, upstreamId: "19113" });
    expect(result.pagination).toMatchObject({
      page: 1,
      sourceTotalPages: 1,
      sourceHasNextPage: false,
      nextPage: null,
      truncatedByPolicy: false,
    });
    expect(result.observation.rawContentPersisted).toBe(false);
    expect(result).not.toHaveProperty("rawBody");
  });

  it("carries only completed transport integrity metadata when LiveWhale normalization fails", async () => {
    const malformed = liveWhaleFixture();
    malformed.meta.page = 2;
    const raw = JSON.stringify(malformed);
    const adapter = new LiveWhaleEventsAdapter({
      campusId: "tc",
      fetcher: new SafeJsonFetcher({
        fetch: async () => jsonResponse(malformed),
        now: () => new Date("2026-07-22T13:45:00.000Z"),
      }),
      licenseGate: enabledGate(TC_LIVEWHALE_SOURCE.id),
      coordinator: new SourceRequestCoordinator(),
    });

    const error = await adapter.fetch().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ObservedIntegrationError);
    expect(error).toMatchObject({
      code: "UPSTREAM_SCHEMA_DRIFT",
      observation: {
        byteLength: Buffer.byteLength(raw),
        fetchedAt: "2026-07-22T13:45:00.000Z",
        httpStatus: 200,
        rawContentPersisted: false,
        sha256: createHash("sha256").update(raw).digest("hex"),
      },
    });
    expect(error).not.toHaveProperty("rawBody");
    expect(error).not.toHaveProperty("json");
  });

  it("shares an in-flight request without duplicating network calls", async () => {
    let resolveResponse!: (response: Response) => void;
    const transport = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    const adapter = new UmnSessionsAdapter({
      campusId: "tc",
      fetcher: new SafeJsonFetcher({ fetch: transport }),
      licenseGate: enabledGate(UMN_SESSIONS_SOURCES.tc.id),
      coordinator: new SourceRequestCoordinator(),
    });
    const first = adapter.fetch({ termIds: ["1269"] });
    const second = adapter.fetch({ termIds: ["1269"] });
    expect(first).toBe(second);
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    resolveResponse(jsonResponse(sessionFixture()));
    await expect(first).resolves.toMatchObject({ records: [{ campusId: "tc" }] });
  });

  it("opens the source circuit after three 5xx failures and suppresses the fourth network call", async () => {
    const transport = vi.fn(async () => new Response(null, { status: 503 }));
    const adapter = new LiveWhaleEventsAdapter({
      campusId: "tc",
      fetcher: new SafeJsonFetcher({ fetch: transport }),
      licenseGate: enabledGate(TC_LIVEWHALE_SOURCE.id),
      coordinator: new SourceRequestCoordinator(),
    });
    for (const page of [1, 2, 3]) {
      await expect(adapter.fetch({ page })).rejects.toMatchObject({ code: "UPSTREAM_SERVER_ERROR" });
    }
    expect(() => adapter.fetch({ page: 4 })).toThrow(SourceCircuitOpenError);
    expect(transport).toHaveBeenCalledTimes(3);
  });
});
