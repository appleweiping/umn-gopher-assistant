import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { sources } from "@umn-gopher-assistant/config";
import {
  AcademicSessionSchema,
  PublicEventSchema,
  SourceObservationSchema,
  type CampusId,
  type SourceDescriptor,
  type SourceObservation,
} from "@umn-gopher-assistant/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AppModule } from "../src/app.module.js";
import { reviewedTermIdsForRange } from "../src/catalog/academic-term-routing.js";
import { CATALOG_CLOCK } from "../src/catalog/catalog-range.js";
import {
  ConfiguredPublicCatalogGateway,
  PUBLIC_CATALOG_GATEWAY,
  type PublicCatalogGateway,
} from "../src/catalog/public-catalog.gateway.js";
import { createFastifyAdapter } from "../src/http/fastify-adapter.js";
import { SOURCE_OBSERVATION_SINK } from "../src/catalog/source-observation.sink.js";
import {
  IntegrationError,
  ObservedIntegrationError,
  type CampusEventOccurrence,
  type UmnAcademicSession,
} from "../src/integrations/index.js";
import { sessionFixture } from "./integrations/fixtures.js";

const observedAt = "2026-07-22T12:00:00.000Z";

interface EventPageTestBody {
  readonly items: unknown;
  readonly nextCursor: unknown;
  readonly retrievalCoverage: unknown;
}

function requireCursor(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Expected a catalog cursor");
  return value;
}

function descriptor(campusId: CampusId, resourceKind: "ACADEMIC_SESSION" | "PUBLIC_EVENT") {
  const result = sources.find(
    (source) => source.campusIds.includes(campusId) && source.resourceKinds.includes(resourceKind),
  );
  if (result === undefined) throw new TypeError(`Missing test descriptor for ${campusId}:${resourceKind}`);
  return result;
}

function observation(sourceUrl: string, sha256 = "a".repeat(64), byteLength = 512) {
  return {
    algorithm: "SHA-256",
    byteLength,
    contentType: "application/json",
    fetchedAt: observedAt,
    httpStatus: 200,
    rawContentPersisted: false,
    sha256,
    sourceUrl,
  } as const;
}

function session(
  sessionId: string,
  beginDate: string,
  endDate: string,
  name = `Synthetic ${sessionId}`,
): UmnAcademicSession {
  return {
    academicCareerId: "UGRD",
    beginDate,
    campusId: "tc",
    endDate,
    enrollmentOpenDate: "2026-03-01",
    institutionCode: "UMNTC",
    name,
    sessionCode: sessionId.slice(-3),
    sessionId,
    termId: "1269",
  };
}

function event(
  upstreamId: string,
  startAt: string,
  status: CampusEventOccurrence["status"] = "LIVE",
  options: {
    readonly allDay?: boolean;
    readonly localEndDate?: string | null;
    readonly localStartDate?: string;
  } = {},
): CampusEventOccurrence {
  const localStartDate = options.localStartDate ?? startAt.slice(0, 10);
  return {
    allDay: options.allDay ?? false,
    campusId: "tc",
    endAt: new Date(Date.parse(startAt) + 3_600_000).toISOString(),
    localEndDate: options.localEndDate === undefined ? localStartDate : options.localEndDate,
    localStartDate,
    location: "Synthetic room",
    occurrenceId: `synthetic:${upstreamId}:${startAt}`,
    sourceUrl: `https://events.tc.umn.edu/event/${upstreamId}-synthetic`,
    startAt,
    status,
    timeZone: "America/Chicago",
    title: `Synthetic event ${upstreamId}`,
    upstreamId,
  };
}

class SyntheticCatalogGateway implements PublicCatalogGateway {
  eventPageBytes = new Map<number, number>();
  eventPages = new Map<number, readonly CampusEventOccurrence[]>();
  eventSourceTotalPages = 1;
  sessions: readonly UmnAcademicSession[] = [
    session("UMNTC_UGRD_1269_001", "2026-09-08", "2026-12-16"),
    session("UMNTC_UGRD_1269_002", "2026-10-01", "2026-10-15"),
    session("UMNTC_UGRD_1269_003", "2027-01-02", "2027-01-12"),
  ];
  eventsError: Error | undefined;
  eventsCalls = 0;
  sessionsCalls = 0;
  sessionTermRequests: readonly (readonly string[])[] = [];

  source(campusId: CampusId, resourceKind: "ACADEMIC_SESSION" | "PUBLIC_EVENT"): SourceDescriptor {
    return descriptor(campusId, resourceKind);
  }

  async fetchEvents(campusId: CampusId, page: number) {
    this.eventsCalls += 1;
    if (this.eventsError !== undefined) throw this.eventsError;
    const source = this.source(campusId, "PUBLIC_EVENT");
    const records = this.eventPages.get(page) ?? [];
    const sourceTotalRecords = [...this.eventPages.values()].reduce(
      (total, pageRecords) => total + pageRecords.length,
      0,
    );
    const boundedLastPage = Math.min(this.eventSourceTotalPages, 20);
    return {
      records,
      observation: observation(
        source.sourceUrl,
        page.toString(16).padStart(64, "0"),
        this.eventPageBytes.get(page) ?? 512,
      ),
      pagination: {
        nextPage: page < boundedLastPage ? page + 1 : null,
        page,
        pageSize: 50 as const,
        policy: { maxAggregateBytes: 8_388_608, maxPages: 20, maxRecords: 1_000 },
        sourceHasNextPage: page < this.eventSourceTotalPages,
        sourceTotalPages: this.eventSourceTotalPages,
        sourceTotalRecords,
        truncatedByPolicy: this.eventSourceTotalPages > 20 || sourceTotalRecords > 1_000,
      },
    };
  }

  async fetchSessions(campusId: CampusId, termIds: readonly string[]) {
    this.sessionsCalls += 1;
    this.sessionTermRequests = [...this.sessionTermRequests, termIds];
    const source = this.source(campusId, "ACADEMIC_SESSION");
    return { records: this.sessions, observation: observation(source.sourceUrl) };
  }

  reset(): void {
    this.eventsError = undefined;
    this.eventsCalls = 0;
    this.sessionsCalls = 0;
    this.sessionTermRequests = [];
    this.eventSourceTotalPages = 1;
    this.eventPageBytes = new Map();
    this.eventPages = new Map([
      [
        1,
        [
          event("100", "2026-09-08T09:00:00-05:00"),
          event("101", "2026-09-08T11:00:00-05:00", "HIDDEN"),
          event("102", "2026-09-09T09:00:00-05:00", "CANCELLED"),
        ],
      ],
    ]);
    this.sessions = [
      session("UMNTC_UGRD_1269_001", "2026-09-08", "2026-12-16"),
      session("UMNTC_UGRD_1269_002", "2026-10-01", "2026-10-15"),
      session("UMNTC_UGRD_1269_003", "2027-01-02", "2027-01-12"),
    ];
  }
}

describe("public catalog API", () => {
  const gateway = new SyntheticCatalogGateway();
  const observations: SourceObservation[] = [];
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PUBLIC_CATALOG_GATEWAY)
      .useValue(gateway)
      .overrideProvider(CATALOG_CLOCK)
      .useValue(() => new Date("2026-07-22T12:00:00.000Z"))
      .overrideProvider(SOURCE_OBSERVATION_SINK)
      .useValue({ record: (observation: SourceObservation) => observations.push(observation) })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter({}), {
      logger: false,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(() => {
    gateway.reset();
    observations.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns normalized sessions, a source observation, date filtering, and no-store", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/academics/sessions?campusId=tc&from=2026-10-01&to=2026-12-31",
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json();
    const items = AcademicSessionSchema.array().parse(body.items);
    const sourceObservation = SourceObservationSchema.parse(body.sourceObservations[0]);
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.sourceObservationId === sourceObservation.observationId)).toBe(true);
    expect(sourceObservation).toMatchObject({
      appliedCacheDisposition: "DISCARDED_AFTER_RESPONSE",
      campusId: "tc",
      outcome: "SUCCESS",
      rawSha256: "a".repeat(64),
      recordsAccepted: 3,
      sourceId: "umn-sessions-tc",
    });
    expect(gateway.sessionTermRequests).toEqual([["1269"]]);
    expect(body.range).toEqual({ defaulted: false, from: "2026-10-01", to: "2026-12-31" });
    expect(observations).toEqual([sourceObservation]);
  });

  it("returns only public normalized event occurrences in the requested local-date range", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/events?campusId=tc&from=2026-09-08&to=2026-09-08",
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json();
    const items = PublicEventSchema.array().parse(body.items);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      campusId: "tc",
      descriptionText: null,
      status: "SCHEDULED",
      title: "Synthetic event 100",
    });
    expect(JSON.stringify(body)).not.toContain("HIDDEN");
    expect(SourceObservationSchema.parse(body.sourceObservations[0]).recordsAccepted).toBe(3);
    expect(body.retrievalCoverage).toEqual({
      nextUpstreamPage: null,
      pagesFetched: 1,
      recordsFetched: 3,
      sourceTotalPages: 1,
      sourceTotalRecords: 3,
      truncatedByPolicy: false,
    });
  });

  it("uses source-local dates, preserves all-day state, and fetches at most the pages needed", async () => {
    gateway.eventSourceTotalPages = 3;
    gateway.eventPages = new Map([
      [1, [event("200", "2026-09-09T04:30:00.000Z", "LIVE", { allDay: true, localStartDate: "2026-09-08" })]],
      [2, [event("201", "2026-09-08T12:00:00-05:00")]],
      [3, [event("202", "2026-09-08T14:00:00-05:00")]],
    ]);

    const first = await app.inject({
      method: "GET",
      url: "/v1/events?campusId=tc&from=2026-09-08&to=2026-09-08&limit=2",
    });
    expect(first.statusCode, first.body).toBe(200);
    const firstBody = first.json();
    const firstItems = PublicEventSchema.array().parse(firstBody.items);
    expect(firstItems).toHaveLength(2);
    expect(firstItems[0]).toMatchObject({ allDay: true, id: expect.stringContaining(":200:") });
    expect(gateway.eventsCalls).toBe(2);
    expect(firstBody.sourceObservations).toHaveLength(2);
    expect(new Set(firstItems.map((item) => item.sourceObservationId)).size).toBe(2);
    expect(firstBody.retrievalCoverage).toMatchObject({
      nextUpstreamPage: 3,
      pagesFetched: 2,
      recordsFetched: 2,
      sourceTotalPages: 3,
      sourceTotalRecords: 3,
      truncatedByPolicy: false,
    });

    gateway.eventsCalls = 0;
    const second = await app.inject({
      method: "GET",
      url: `/v1/events?campusId=tc&from=2026-09-08&to=2026-09-08&limit=2&cursor=${encodeURIComponent(String(firstBody.nextCursor))}`,
    });
    expect(second.statusCode, second.body).toBe(200);
    expect(PublicEventSchema.array().parse(second.json().items)).toHaveLength(1);
    // The cursor first revalidates page 2, then advances to page 3.
    expect(gateway.eventsCalls).toBe(2);
  });

  it("includes a multi-day event whose local date interval overlaps the requested day", async () => {
    gateway.eventPages = new Map([
      [
        1,
        [
          event("overnight", "2026-09-08T04:00:00.000Z", "LIVE", {
            localEndDate: "2026-09-08",
            localStartDate: "2026-09-07",
          }),
        ],
      ],
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/v1/events?campusId=tc&from=2026-09-08&to=2026-09-08",
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(PublicEventSchema.array().parse(response.json().items)).toHaveLength(1);
  });

  it("deduplicates an exact occurrence across upstream pages while preserving raw cursor offsets", async () => {
    const duplicate = event("overlap", "2026-09-08T09:00:00-05:00");
    gateway.eventSourceTotalPages = 2;
    gateway.eventPages = new Map([
      [1, [duplicate]],
      [
        2,
        [
          duplicate,
          event("second", "2026-09-08T10:00:00-05:00"),
          event("third", "2026-09-08T11:00:00-05:00"),
        ],
      ],
    ]);

    const first = await app.inject({
      method: "GET",
      url: "/v1/events?campusId=tc&from=2026-09-08&to=2026-09-08&limit=2",
    });
    expect(first.statusCode, first.body).toBe(200);
    const firstItems = PublicEventSchema.array().parse(first.json().items);
    expect(firstItems.map((item) => item.id)).toEqual([
      expect.stringContaining(":overlap:"),
      expect.stringContaining(":second:"),
    ]);
    expect(first.json().retrievalCoverage).toMatchObject({ pagesFetched: 2, recordsFetched: 4 });

    const second = await app.inject({
      method: "GET",
      url: `/v1/events?campusId=tc&from=2026-09-08&to=2026-09-08&limit=2&cursor=${encodeURIComponent(requireCursor(first.json().nextCursor))}`,
    });
    expect(second.statusCode, second.body).toBe(200);
    const secondItems = PublicEventSchema.array().parse(second.json().items);
    expect(secondItems.map((item) => item.id)).toEqual([expect.stringContaining(":third:")]);
    expect(new Set([...firstItems, ...secondItems].map((item) => item.id)).size).toBe(3);
  });

  it("fails closed when the same cross-page occurrence ID has conflicting content", async () => {
    const original = event("conflict", "2026-09-08T09:00:00-05:00");
    gateway.eventSourceTotalPages = 2;
    gateway.eventPages = new Map([
      [1, [original]],
      [2, [{ ...original, title: "Conflicting title" }]],
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/v1/events?campusId=tc&from=2026-09-08&to=2026-09-08&limit=100",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      failureCode: "UPSTREAM_SCHEMA_DRIFT",
      title: "Service Unavailable",
    });
    expect(gateway.eventsCalls).toBe(2);
  });

  it("expires an event cursor when its bound upstream page changes", async () => {
    gateway.eventSourceTotalPages = 2;
    gateway.eventPages = new Map([
      [1, [event("300", "2026-09-08T09:00:00-05:00")]],
      [2, [event("301", "2026-09-08T10:00:00-05:00")]],
    ]);
    const first = await app.inject({
      method: "GET",
      url: "/v1/events?campusId=tc&from=2026-09-08&to=2026-09-08&limit=1",
    });
    const cursor = String(first.json().nextCursor);
    gateway.eventPages.set(1, [{ ...event("300", "2026-09-08T09:00:00-05:00"), title: "Changed live page" }]);

    const expired = await app.inject({
      method: "GET",
      url: `/v1/events?campusId=tc&from=2026-09-08&to=2026-09-08&limit=1&cursor=${encodeURIComponent(cursor)}`,
    });
    expect(expired.statusCode).toBe(410);
    expect(expired.json()).toMatchObject({
      detail: "cursor expired because the source page snapshot changed",
      title: "Gone",
    });
    expect(observations).toHaveLength(2);
    expect(observations[1]).toMatchObject({ httpStatus: 200, outcome: "SUCCESS" });
  });

  it("signs cursors so clients cannot rewrite offsets or traversal budgets", async () => {
    gateway.eventPages = new Map([
      [1, [event("signed-1", "2026-09-08T09:00:00-05:00"), event("signed-2", "2026-09-08T10:00:00-05:00")]],
    ]);
    const first = await app.inject({
      method: "GET",
      url: "/v1/events?campusId=tc&from=2026-09-08&to=2026-09-08&limit=1",
    });
    const cursor = requireCursor(first.json().nextCursor);
    const [payload, signature] = cursor.split(".");
    if (payload === undefined || signature === undefined) throw new TypeError("Expected a signed cursor");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const rewrittenPayload = Buffer.from(
      JSON.stringify({ ...decoded, rawBytesBeforePage: 1, upstreamPage: 20 }),
      "utf8",
    ).toString("base64url");
    gateway.eventsCalls = 0;

    const response = await app.inject({
      method: "GET",
      url: `/v1/events?campusId=tc&from=2026-09-08&to=2026-09-08&limit=1&cursor=${encodeURIComponent(`${rewrittenPayload}.${signature}`)}`,
    });

    expect(response.statusCode).toBe(400);
    expect(gateway.eventsCalls).toBe(0);
  });

  it("enforces the signed 8 MiB accepted traversal budget across requests", async () => {
    const twoMiB = 2 * 1_024 * 1_024;
    gateway.eventSourceTotalPages = 5;
    gateway.eventPageBytes = new Map([1, 2, 3, 4, 5].map((page) => [page, twoMiB]));
    gateway.eventPages = new Map(
      [1, 2, 3, 4, 5].map((page) => [
        page,
        [event(`budget-${String(page)}`, `2026-09-08T${String(8 + page).padStart(2, "0")}:00:00-05:00`)],
      ]),
    );

    const returnedIds: string[] = [];
    let cursor: string | undefined;
    let finalBody: EventPageTestBody | undefined;
    for (let request = 0; request < 5; request += 1) {
      const response = await app.inject({
        method: "GET",
        url: `/v1/events?campusId=tc&from=2026-09-08&to=2026-09-08&limit=1${cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`}`,
      });
      expect(response.statusCode, response.body).toBe(200);
      const responseBody: unknown = response.json();
      if (responseBody === null || typeof responseBody !== "object" || Array.isArray(responseBody)) {
        throw new TypeError("Expected an event page response");
      }
      finalBody = responseBody as EventPageTestBody;
      returnedIds.push(
        ...PublicEventSchema.array()
          .parse(finalBody.items)
          .map((item) => item.id),
      );
      if (finalBody.nextCursor === null) break;
      cursor = requireCursor(finalBody.nextCursor);
    }

    expect(returnedIds).toHaveLength(4);
    expect(returnedIds.some((id) => id.includes("budget-5"))).toBe(false);
    if (finalBody === undefined) throw new TypeError("Expected at least one event page");
    expect(finalBody.nextCursor).toBeNull();
    expect(finalBody.retrievalCoverage).toMatchObject({
      nextUpstreamPage: null,
      truncatedByPolicy: true,
    });
  });

  it("exposes source-policy truncation without eagerly fanning out", async () => {
    gateway.eventSourceTotalPages = 22;
    gateway.eventPages = new Map([[1, [event("400", "2026-09-08T09:00:00-05:00")]]]);
    const response = await app.inject({
      method: "GET",
      url: "/v1/events?campusId=tc&from=2026-09-08&to=2026-09-08&limit=1",
    });
    expect(response.statusCode).toBe(200);
    expect(gateway.eventsCalls).toBe(1);
    expect(response.json().retrievalCoverage).toMatchObject({
      nextUpstreamPage: 2,
      pagesFetched: 1,
      sourceTotalPages: 22,
      truncatedByPolicy: true,
    });
  });

  it("continues an unchanged snapshot and expires a cursor when normalized content changes", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/v1/academics/sessions?campusId=tc&limit=1",
    });
    const firstBody = first.json();
    expect(firstBody.nextCursor).toBeTypeOf("string");
    const cursor = requireCursor(firstBody.nextCursor);

    const second = await app.inject({
      method: "GET",
      url: `/v1/academics/sessions?campusId=tc&limit=1&cursor=${encodeURIComponent(cursor)}`,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().items[0].id).toBe("UMNTC_UGRD_1269_002");

    gateway.sessions = [
      session("UMNTC_UGRD_1269_001", "2026-09-08", "2026-12-16", "Changed snapshot"),
      ...gateway.sessions.slice(1),
    ];
    const expired = await app.inject({
      method: "GET",
      url: `/v1/academics/sessions?campusId=tc&limit=1&cursor=${encodeURIComponent(cursor)}`,
    });
    expect(expired.statusCode).toBe(410);
    expect(expired.headers["cache-control"]).toBe("no-store");
    expect(expired.json()).toMatchObject({
      detail: "cursor expired because the source snapshot changed",
      status: 410,
      title: "Gone",
    });
    expect(observations).toHaveLength(3);
    expect(observations[2]).toMatchObject({ httpStatus: 200, outcome: "SUCCESS" });
  });

  it("returns a stable weak ETag after live validation and honors If-None-Match with no-store", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/v1/academics/sessions?campusId=tc&from=2026-10-01&to=2026-12-31",
    });
    const etag = first.headers.etag;
    expect(etag).toMatch(/^W\//u);
    if (typeof etag !== "string") throw new TypeError("Expected catalog ETag");

    const conditional = await app.inject({
      headers: { "if-none-match": etag },
      method: "GET",
      url: "/v1/academics/sessions?campusId=tc&from=2026-10-01&to=2026-12-31",
    });
    expect(conditional.statusCode).toBe(304);
    expect(conditional.headers["cache-control"]).toBe("no-store");
    expect(conditional.headers.etag).toBe(etag);
    expect(gateway.sessionsCalls).toBe(2);
  });

  it.each([
    "/v1/events",
    "/v1/events?campusId=unknown",
    "/v1/events?campusId=tc&limit=0",
    "/v1/events?campusId=tc&limit=01",
    "/v1/events?campusId=tc&from=2026-02-30",
    "/v1/events?campusId=tc&from=2026-10-01",
    "/v1/events?campusId=tc&from=2026-10-02&to=2026-10-01",
    "/v1/events?campusId=tc&from=2026-01-01&to=2026-08-01",
    "/v1/events?campusId=tc&unexpected=true",
    "/v1/events?campusId=tc&campusId=duluth",
  ])("strictly rejects invalid catalog query %s", async (url) => {
    const response = await app.inject({ method: "GET", url });
    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it.each(["not-a-cursor", `a.${"a".repeat(43)}`, `a.${"a".repeat(43)}.extra`, `a=.${"a".repeat(43)}`])(
    "rejects malformed or non-canonical cursor %s before invoking the source adapter",
    async (cursor) => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/academics/sessions?campusId=tc&cursor=${encodeURIComponent(cursor)}`,
      });
      expect(response.statusCode).toBe(400);
      expect(gateway.sessionsCalls).toBe(0);
    },
  );

  it("returns stable RFC 9457 source failure details, an official link, and Retry-After", async () => {
    gateway.eventsError = new IntegrationError("TIMEOUT", "synthetic secret upstream detail", true);
    const response = await app.inject({ method: "GET", url: "/v1/events?campusId=tc" });

    expect(response.statusCode).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["retry-after"]).toBe("60");
    expect(response.json()).toMatchObject({
      failureCode: "TIMEOUT",
      officialUrl: "https://events.tc.umn.edu/feed_builder",
      sourceId: "tc-events-feed",
      status: 503,
      title: "Service Unavailable",
    });
    expect(response.body).not.toContain("synthetic secret upstream detail");
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      failureCode: "TIMEOUT",
      outcome: "TIMEOUT",
      rawByteLength: null,
      rawSha256: null,
    });
  });

  it("records completed response integrity metadata when upstream normalization fails", async () => {
    const source = descriptor("tc", "PUBLIC_EVENT");
    gateway.eventsError = new ObservedIntegrationError(
      new IntegrationError("UPSTREAM_SCHEMA_DRIFT", "synthetic parser detail"),
      observation(source.sourceUrl, "b".repeat(64), 733),
    );

    const response = await app.inject({ method: "GET", url: "/v1/events?campusId=tc" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      failureCode: "UPSTREAM_SCHEMA_DRIFT",
      sourceId: "tc-events-feed",
    });
    expect(response.body).not.toContain("synthetic parser detail");
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      appliedCacheDisposition: "DISCARDED_AFTER_RESPONSE",
      failureCode: "UPSTREAM_SCHEMA_DRIFT",
      httpStatus: 200,
      observedAt,
      outcome: "SCHEMA_MISMATCH",
      rawByteLength: 733,
      rawSha256: "b".repeat(64),
    });
    expect(observations[0]).not.toHaveProperty("rawBody");
  });

  it("uses and discloses a bounded default range and reviewed term filters", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/academics/sessions?campusId=tc",
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().range).toEqual({
      defaulted: true,
      from: "2026-07-22",
      to: "2026-11-19",
    });
    expect(gateway.sessionTermRequests).toEqual([["1265", "1269"]]);
  });

  it("fails closed without source access when the requested term window is not reviewed", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/academics/sessions?campusId=tc&from=2028-06-01&to=2028-06-30",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ failureCode: "TERM_WINDOW_UNAVAILABLE" });
    expect(response.json().officialUrl).toBe("https://asr-custom.umn.edu/sessions_data_service/");
    expect(response.headers["retry-after"]).toBe("86400");
    expect(gateway.sessionsCalls).toBe(0);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      failureCode: "TERM_WINDOW_UNAVAILABLE",
      outcome: "DISABLED",
    });
  });
});

describe("configured source policy boundary", () => {
  it("routes a reviewed December/January window to the two explicit official term IDs", () => {
    expect(reviewedTermIdsForRange("2026-12-15", "2027-01-15")).toEqual(["1269", "1273"]);
  });

  it.each(["crookston", "morris", "rochester"] as const)(
    "performs zero network calls for the %s disabled or deep-link event source",
    (campusId) => {
      const transport = vi.fn(async () => new Response("network must remain unreachable"));
      const gateway = new ConfiguredPublicCatalogGateway({ fetch: transport });

      expect(() => gateway.fetchEvents(campusId, 1)).toThrow();
      expect(transport).not.toHaveBeenCalled();
    },
  );

  it("performs zero network calls when a live source has no current terms review", () => {
    const transport = vi.fn(async () => new Response("network must remain unreachable"));
    const sourceRegistry = sources.map((source) =>
      source.id === "umn-sessions-tc"
        ? { ...source, termsReviewedAt: null, termsReviewExpiresAt: null }
        : source,
    );
    const gateway = new ConfiguredPublicCatalogGateway({
      fetch: transport,
      now: () => new Date("2026-07-22T12:00:00.000Z"),
      sourceRegistry,
    });

    expect(() => gateway.fetchSessions("tc", ["1269"])).toThrow(/review/u);
    expect(transport).not.toHaveBeenCalled();
  });

  it("evaluates an injectable source kill switch on every request and fails closed", async () => {
    let enabled = false;
    const transport = vi.fn(
      async () =>
        new Response(JSON.stringify(sessionFixture()), {
          headers: { "content-type": "application/json" },
        }),
    );
    const sourceRegistry = sources.map((source) =>
      source.id === "umn-sessions-tc" ? { ...source, termsReviewedAt: "2026-07-22T00:00:00.000Z" } : source,
    );
    const gateway = new ConfiguredPublicCatalogGateway({
      fetch: transport,
      now: () => new Date("2026-07-22T12:00:00.000Z"),
      sourceRegistry,
      sourceSwitchResolver: { isEnabled: () => enabled },
    });

    expect(() => gateway.fetchSessions("tc", ["1269"])).toThrow(/kill switch/u);
    expect(transport).not.toHaveBeenCalled();

    enabled = true;
    await expect(gateway.fetchSessions("tc", ["1269"])).resolves.toMatchObject({
      records: [{ campusId: "tc", termId: "1269" }],
    });
    expect(transport).toHaveBeenCalledOnce();

    enabled = false;
    expect(() => gateway.fetchSessions("tc", ["1269"])).toThrow(/kill switch/u);
    expect(transport).toHaveBeenCalledOnce();
  });

  it("rechecks the kill switch after a queued request obtains a network slot", async () => {
    let enabled = true;
    const releases: (() => void)[] = [];
    const transport = vi.fn(
      async () =>
        new Promise<Response>((resolve) => {
          releases.push(() =>
            resolve(
              new Response(JSON.stringify({ sessions: [] }), {
                headers: { "content-type": "application/json" },
              }),
            ),
          );
        }),
    );
    const gateway = new ConfiguredPublicCatalogGateway({
      fetch: transport,
      now: () => new Date("2026-07-22T12:00:00.000Z"),
      sourceSwitchResolver: { isEnabled: () => enabled },
    });

    const first = gateway.fetchSessions("tc", ["1265"]);
    const second = gateway.fetchSessions("tc", ["1269"]);
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    const queued = gateway.fetchSessions("tc", ["1273"]);
    const queuedResult = queued.catch((error: unknown) => error);
    await Promise.resolve();
    expect(transport).toHaveBeenCalledTimes(2);

    enabled = false;
    releases[0]?.();
    expect(String(await queuedResult)).toMatch(/kill switch/u);
    expect(transport).toHaveBeenCalledTimes(2);
    releases[1]?.();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });
});
