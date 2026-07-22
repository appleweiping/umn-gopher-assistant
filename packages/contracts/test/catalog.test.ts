import { describe, expect, it } from "vitest";

import { AcademicSessionSchema, PublicEventSchema, SourceObservationSchema } from "../src/index.js";

const observationId = "123e4567-e89b-42d3-a456-426614174000";

const academicSession = {
  id: "umntc_ugrd_1269_001",
  campusId: "rochester",
  institutionCode: "UMNTC",
  academicCareerCode: "UGRD",
  termCode: "1269",
  sessionCode: "001",
  name: "Regular academic session",
  beginDate: "2026-09-08",
  endDate: "2026-12-23",
  enrollmentOpenDate: "2026-03-01",
  sourceId: "umn-sessions-rochester",
  sourceObservationId: observationId,
  observedAt: "2026-07-22T12:00:00.000Z",
} as const;

const publicEvent = {
  id: "synthetic-event-2026-001",
  campusId: "duluth",
  title: "Synthetic welcome event",
  descriptionText: "Synthetic fixture; not a real University event.",
  language: "en",
  startsAt: "2026-09-08T14:00:00.000-05:00",
  endsAt: "2026-09-08T15:00:00.000-05:00",
  allDay: false,
  timeZone: "America/Chicago",
  status: "SCHEDULED",
  location: {
    name: "Synthetic campus room",
    address: null,
    coordinates: null,
    onlineUrl: null,
  },
  canonicalUrl: "https://example.invalid/events/synthetic-event-2026-001",
  categories: ["Orientation", "Synthetic fixture"],
  sourceId: "duluth-events-feed",
  sourceObservationId: observationId,
  observedAt: "2026-07-22T12:00:00.000Z",
} as const;

const successfulObservation = {
  observationId,
  sourceId: "duluth-events-feed",
  campusId: "duluth",
  observedAt: "2026-07-22T12:00:00.000Z",
  durationMs: 125,
  outcome: "SUCCESS",
  httpStatus: 200,
  parserVersion: "public-events@1.0.0",
  rawSha256: "a".repeat(64),
  rawByteLength: 512,
  recordsAccepted: 1,
  recordsRejected: 0,
  freshnessState: "FRESH",
  licenseStatus: "LIVE_ONLY",
  cachePolicy: "NO_CONTENT_CACHE",
  appliedCacheDisposition: "DISCARDED_AFTER_RESPONSE",
  dataClassification: "PUBLIC",
  failureCode: null,
} as const;

describe("academic session contract", () => {
  it("accepts a synthetic Rochester record only through the UMNTC mapping", () => {
    expect(AcademicSessionSchema.parse(academicSession)).toEqual(academicSession);
    expect(AcademicSessionSchema.safeParse({ ...academicSession, institutionCode: "UMNMO" }).success).toBe(
      false,
    );
  });

  it("rejects impossible date order and undeclared fields", () => {
    expect(AcademicSessionSchema.safeParse({ ...academicSession, endDate: "2026-01-01" }).success).toBe(
      false,
    );
    expect(AcademicSessionSchema.safeParse({ ...academicSession, studentId: "synthetic" }).success).toBe(
      false,
    );
  });
});

describe("public event contract", () => {
  it("accepts a bounded plain-text synthetic event", () => {
    expect(PublicEventSchema.parse(publicEvent)).toEqual(publicEvent);
  });

  it("rejects reversed times, invalid zones, duplicate categories, and insecure URLs", () => {
    expect(
      PublicEventSchema.safeParse({ ...publicEvent, endsAt: "2026-09-08T13:59:00.000-05:00" }).success,
    ).toBe(false);
    expect(PublicEventSchema.safeParse({ ...publicEvent, timeZone: "Mars/Olympus" }).success).toBe(false);
    expect(
      PublicEventSchema.safeParse({ ...publicEvent, categories: ["Orientation", "Orientation"] }).success,
    ).toBe(false);
    expect(
      PublicEventSchema.safeParse({ ...publicEvent, canonicalUrl: "http://example.invalid/event" }).success,
    ).toBe(false);
  });
});

describe("source observation contract", () => {
  it("records integrity and proves that LIVE_ONLY content was discarded", () => {
    expect(SourceObservationSchema.parse(successfulObservation)).toEqual(successfulObservation);
  });

  it("rejects a success without integrity evidence or with cached LIVE_ONLY content", () => {
    expect(SourceObservationSchema.safeParse({ ...successfulObservation, rawSha256: null }).success).toBe(
      false,
    );
    expect(
      SourceObservationSchema.safeParse({
        ...successfulObservation,
        appliedCacheDisposition: "CONTENT_CACHED",
      }).success,
    ).toBe(false);
  });

  it("accepts fail-closed evidence for a disabled unapproved source", () => {
    expect(
      SourceObservationSchema.safeParse({
        ...successfulObservation,
        sourceId: "morris-events-feed",
        campusId: "morris",
        outcome: "DISABLED",
        httpStatus: null,
        rawSha256: null,
        rawByteLength: null,
        recordsAccepted: 0,
        recordsRejected: 0,
        freshnessState: "UNKNOWN",
        licenseStatus: "APPROVAL_REQUIRED",
        cachePolicy: "NO_ACCESS",
        appliedCacheDisposition: "NO_ACCESS",
        failureCode: "SOURCE_DISABLED",
      }).success,
    ).toBe(true);
  });

  it("rejects network evidence for a source whose policy is NO_ACCESS", () => {
    expect(
      SourceObservationSchema.safeParse({
        ...successfulObservation,
        licenseStatus: "APPROVAL_REQUIRED",
        cachePolicy: "NO_ACCESS",
      }).success,
    ).toBe(false);
  });
});
