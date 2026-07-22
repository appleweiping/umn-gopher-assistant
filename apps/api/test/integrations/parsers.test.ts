import { describe, expect, it } from "vitest";

import {
  parseLiveWhaleEvents,
  parseLiveWhaleEventsPage,
  parseUmnSessions,
  UMN_INSTITUTION_BY_CAMPUS,
  UpstreamSchemaError,
} from "../../src/integrations/index.js";
import { documentedSessionFixture, liveWhaleFixture, sessionFixture } from "./fixtures.js";

type SessionFixture = ReturnType<typeof sessionFixture>;
type LiveWhaleFixture = ReturnType<typeof liveWhaleFixture>;

function sessionAt(fixture: SessionFixture, index: number) {
  const session = fixture.sessions[index];
  if (session === undefined) throw new Error("Synthetic session fixture is missing");
  return session;
}

function eventAt(fixture: LiveWhaleFixture, index: number) {
  const event = fixture.data[index];
  if (event === undefined) throw new Error("Synthetic event fixture is missing");
  return event;
}

describe("UMN Sessions parser", () => {
  it("defines all five campus mappings with Rochester deliberately using UMNTC", () => {
    expect(UMN_INSTITUTION_BY_CAMPUS).toEqual({
      tc: "UMNTC",
      duluth: "UMNDL",
      crookston: "UMNCR",
      morris: "UMNMO",
      rochester: "UMNTC",
    });
    const records = parseUmnSessions(sessionFixture(), "rochester");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ campusId: "rochester", institutionCode: "UMNTC" });
  });

  it("returns only normalized allowlisted fields", () => {
    const fixture = sessionFixture();
    Object.assign(sessionAt(fixture, 0), { unexpected_private_field: "must not pass through" });
    const [record] = parseUmnSessions(fixture, "tc");
    expect(record).toEqual({
      sessionId: "UMNTC_UGRD_1269_001",
      campusId: "tc",
      institutionCode: "UMNTC",
      academicCareerId: "UGRD",
      termId: "1269",
      sessionCode: "001",
      name: "Regular Academic Session",
      beginDate: "2026-09-08",
      endDate: "2026-12-16",
      enrollmentOpenDate: "2026-05-01",
    });
    expect(record).not.toHaveProperty("unexpected_private_field");
  });

  it("accepts the official documented lowercase shape and legacy enrollment spelling", () => {
    expect(parseUmnSessions(documentedSessionFixture(), "tc")).toEqual([
      {
        sessionId: "UMNTC_UGRD_1159_017",
        campusId: "tc",
        institutionCode: "UMNTC",
        academicCareerId: "UGRD",
        termId: "1159",
        sessionCode: "017",
        name: "11 wk Session",
        beginDate: "2015-09-08",
        endDate: "2015-11-23",
        enrollmentOpenDate: "2015-05-01",
      },
    ]);
  });

  it("accepts matching enrollment aliases but rejects conflicting values", () => {
    const fixture = sessionFixture();
    Object.assign(sessionAt(fixture, 0), { enrollement_open_date: "2026-05-01" });
    expect(parseUmnSessions(fixture, "tc")).toHaveLength(1);
    Object.assign(sessionAt(fixture, 0), { enrollement_open_date: "2026-05-02" });
    expect(() => parseUmnSessions(fixture, "tc")).toThrow(/enrollment dates conflict/u);
  });

  it("nulls contradictory optional enrollment metadata without discarding the session", () => {
    const fixture = sessionFixture();
    sessionAt(fixture, 0).enrollment_open_date = "2027-01-01";

    expect(parseUmnSessions(fixture, "tc")).toEqual([
      expect.objectContaining({
        enrollmentOpenDate: null,
        sessionId: "UMNTC_UGRD_1269_001",
      }),
    ]);
  });

  it("rejects records outside the explicit requested term filter", () => {
    expect(parseUmnSessions(sessionFixture(), "tc", ["1269"])).toHaveLength(1);
    expect(() => parseUmnSessions(sessionFixture(), "tc", ["1265"])).toThrow(/outside the requested filter/u);
  });

  it.each([
    ["missing sessions collection", () => ({ session: [] })],
    [
      "field type drift",
      () => {
        const fixture = sessionFixture();
        sessionAt(fixture, 0).academic_career.academic_career_id = 7 as unknown as string;
        return fixture;
      },
    ],
    [
      "wrong institution",
      () => {
        const fixture = sessionFixture();
        sessionAt(fixture, 0).institution.institution_id = "UMNMO";
        return fixture;
      },
    ],
    [
      "impossible date",
      () => {
        const fixture = sessionFixture();
        sessionAt(fixture, 0).begin_date = "2026-02-30";
        return fixture;
      },
    ],
    [
      "reversed dates",
      () => {
        const fixture = sessionFixture();
        sessionAt(fixture, 0).end_date = "2026-01-01";
        return fixture;
      },
    ],
  ])("fails closed on %s", (_label, createFixture) => {
    expect(() => parseUmnSessions(createFixture(), "tc")).toThrow(UpstreamSchemaError);
  });

  it("collapses exact duplicates but rejects conflicting duplicate ids", () => {
    const fixture = sessionFixture();
    fixture.sessions.push(structuredClone(sessionAt(fixture, 0)));
    expect(parseUmnSessions(fixture, "tc")).toHaveLength(1);

    sessionAt(fixture, 1).session_name = "Conflicting name";
    expect(() => parseUmnSessions(fixture, "tc")).toThrow(/conflicting duplicate session/u);
  });
});

describe("LiveWhale parser", () => {
  it("extracts only safe display fields and keys occurrences by upstream id plus start", () => {
    const [event] = parseLiveWhaleEvents(liveWhaleFixture(), "tc");
    expect(event).toEqual({
      occurrenceId: "livewhale:tc:19113:2026-09-08T14:00:00.000Z",
      upstreamId: "19113",
      campusId: "tc",
      title: "Campus research showcase",
      startAt: "2026-09-08T14:00:00.000Z",
      endAt: "2026-09-08T15:30:00.000Z",
      localStartDate: "2026-09-08",
      localEndDate: "2026-09-08",
      timeZone: "America/Chicago",
      allDay: false,
      status: "LIVE",
      location: "Walter Library",
      sourceUrl: "https://events.tc.umn.edu/event/19113-campus-research-showcase",
    });
    expect(event).not.toHaveProperty("summary");
    expect(event).not.toHaveProperty("description");
    expect(event).not.toHaveProperty("gid");
  });

  it("supports Duluth official URLs and canceled status", () => {
    const fixture = liveWhaleFixture("https://calendar.d.umn.edu");
    Object.assign(eventAt(fixture, 0), { is_canceled: 1 });
    const [event] = parseLiveWhaleEvents(fixture, "duluth");
    expect(event).toMatchObject({ campusId: "duluth", status: "CANCELLED" });
  });

  it("preserves a source-local date when the UTC instant crosses midnight", () => {
    const fixture = liveWhaleFixture();
    Object.assign(eventAt(fixture, 0), {
      date_iso: "2026-01-01T23:30:00-06:00",
      date2_iso: "2026-01-02T00:30:00-06:00",
    });
    const [event] = parseLiveWhaleEvents(fixture, "tc");
    expect(event).toMatchObject({
      startAt: "2026-01-02T05:30:00.000Z",
      localStartDate: "2026-01-01",
      localEndDate: "2026-01-02",
      timeZone: "America/Chicago",
    });
  });

  it("validates daylight-saving offsets and preserves all-day semantics", () => {
    const fixture = liveWhaleFixture();
    Object.assign(eventAt(fixture, 0), { is_all_day: 1 });
    expect(parseLiveWhaleEvents(fixture, "tc")[0]).toMatchObject({ allDay: true });

    Object.assign(eventAt(fixture, 0), {
      date_iso: "2026-07-08T09:00:00-06:00",
      date2_iso: "2026-07-08T10:00:00-06:00",
    });
    expect(() => parseLiveWhaleEvents(fixture, "tc")).toThrow(/declared time zone/u);
  });

  it("supports legacy top-level and paginated results shapes", () => {
    const fixture = liveWhaleFixture();
    const event = eventAt(fixture, 0);
    expect(parseLiveWhaleEvents([event], "tc")).toHaveLength(1);
    expect(parseLiveWhaleEvents({ results: [event] }, "tc")).toHaveLength(1);
  });

  it("exposes bounded v2 pagination without presenting page one as a complete feed", () => {
    const fixture = liveWhaleFixture();
    Object.assign(fixture.meta, { total_results: 1_250, total_pages: 25 });
    const first = parseLiveWhaleEventsPage(fixture, "tc", 1);
    expect(first.pagination).toEqual({
      page: 1,
      pageSize: 50,
      sourceTotalPages: 25,
      sourceTotalRecords: 1_250,
      sourceHasNextPage: true,
      nextPage: 2,
      truncatedByPolicy: true,
      policy: { maxPages: 20, maxRecords: 1_000, maxAggregateBytes: 8 * 1_024 * 1_024 },
    });

    Object.assign(fixture.meta, { page: 20 });
    const boundary = parseLiveWhaleEventsPage(fixture, "tc", 20);
    expect(boundary.pagination).toMatchObject({
      sourceHasNextPage: true,
      nextPage: null,
      truncatedByPolicy: true,
    });
  });

  it("fails closed when v2 pagination metadata drifts from the request", () => {
    const fixture = liveWhaleFixture();
    Object.assign(fixture.meta, { page: 2 });
    expect(() => parseLiveWhaleEventsPage(fixture, "tc", 1)).toThrow(/does not match/u);
    Object.assign(fixture.meta, { page: 1, per_page: 100 });
    expect(() => parseLiveWhaleEventsPage(fixture, "tc", 1)).toThrow(/fixed page size/u);
  });

  it("rejects internally inconsistent LiveWhale totals and non-empty zero-total pages", () => {
    const fixture = liveWhaleFixture();
    Object.assign(fixture.meta, { total_results: 1, total_pages: 2 });
    expect(() => parseLiveWhaleEventsPage(fixture, "tc", 1)).toThrow(/internally inconsistent/u);

    Object.assign(fixture.meta, { total_results: 0, total_pages: 0 });
    expect(() => parseLiveWhaleEventsPage(fixture, "tc", 1)).toThrow(/record count exceeds/u);

    fixture.data = [];
    expect(parseLiveWhaleEventsPage(fixture, "tc", 1).records).toEqual([]);
    Object.assign(fixture.meta, { page: 2 });
    expect(() => parseLiveWhaleEventsPage(fixture, "tc", 2)).toThrow(/internally inconsistent/u);
  });

  it.each([
    "javascript:alert(1)",
    "http://events.tc.umn.edu/event/19113",
    "https://events.tc.umn.edu.evil.example/event/19113",
    "https://events.tc.umn.edu@evil.example/event/19113",
    "https://evil@events.tc.umn.edu/event/19113",
    "https://events.tc.umn.edu:444/event/19113",
    "https://events.tc.umn.edu/event/19113?next=https://evil.example",
    "https://events.tc.umn.edu/event/19113#fragment",
  ])("rejects malicious event source URL %s", (url) => {
    const fixture = liveWhaleFixture();
    eventAt(fixture, 0).url = url;
    expect(() => parseLiveWhaleEvents(fixture, "tc")).toThrow(/bounded UMN HTTPS domain/u);
  });

  it("accepts a clean HTTPS detail link on another UMN-owned subdomain", () => {
    const fixture = liveWhaleFixture();
    eventAt(fixture, 0).url = "https://boynton.umn.edu/event/campus-wellbeing";

    expect(parseLiveWhaleEvents(fixture, "tc")[0]?.sourceUrl).toBe(
      "https://boynton.umn.edu/event/campus-wellbeing",
    );
  });

  it("allows only the reviewed Duluth CampusGroups RSVP link shape", () => {
    const fixture = liveWhaleFixture("https://calendar.d.umn.edu");
    eventAt(fixture, 0).url = "https://duluthumn.campusgroups.com/rsvp?id=2250834";
    expect(parseLiveWhaleEvents(fixture, "duluth")[0]?.sourceUrl).toBe(
      "https://duluthumn.campusgroups.com/rsvp?id=2250834",
    );

    expect(() => parseLiveWhaleEvents(fixture, "tc")).toThrow(/bounded UMN HTTPS domain/u);
    eventAt(fixture, 0).url = "https://duluthumn.campusgroups.com/rsvp?id=2250834&next=https://evil.example";
    expect(() => parseLiveWhaleEvents(fixture, "duluth")).toThrow(/bounded UMN HTTPS domain/u);
  });

  it.each([
    ["missing data", {}],
    ["wrong title type", { title: 7 }],
    ["bad start instant", { date_iso: "tomorrow" }],
    ["reversed times", { date2_iso: "2026-09-08T08:00:00-05:00" }],
    ["unknown timezone", { timezone: "Mars/Olympus_Mons" }],
    ["non-IANA timezone abbreviation", { timezone: "CST" }],
    ["invalid all-day marker", { is_all_day: 2 }],
    ["unknown status", { status: 3 }],
  ])("fails closed on %s schema drift", (_label, mutation) => {
    if (Object.keys(mutation).length === 0) {
      expect(() => parseLiveWhaleEvents({}, "tc")).toThrow(UpstreamSchemaError);
      return;
    }
    const fixture = liveWhaleFixture();
    Object.assign(eventAt(fixture, 0), mutation);
    expect(() => parseLiveWhaleEvents(fixture, "tc")).toThrow(UpstreamSchemaError);
  });

  it("collapses exact duplicate occurrences and rejects conflicts", () => {
    const fixture = liveWhaleFixture();
    fixture.data.push(structuredClone(eventAt(fixture, 0)));
    expect(parseLiveWhaleEvents(fixture, "tc")).toHaveLength(1);
    eventAt(fixture, 1).title = "Conflicting title";
    expect(() => parseLiveWhaleEvents(fixture, "tc")).toThrow(/conflicting duplicate occurrence/u);
  });
});
