// @vitest-environment node

import { describe, expect, it } from "vitest";

import { campuses, demoRecords } from "../lib/data/registry";

describe("five-campus demo registry", () => {
  it("covers all five campuses and keeps Rochester on the UMNTC academic institution", async () => {
    expect(campuses.map((campus) => campus.id)).toEqual(["tc", "duluth", "crookston", "morris", "rochester"]);
    expect(campuses.find((campus) => campus.id === "rochester")?.academicInstitutionCode).toBe("UMNTC");
  });

  it("carries provenance, freshness, licensing, and campus ownership on every demo record", async () => {
    expect(demoRecords.length).toBeGreaterThanOrEqual(25);
    for (const record of demoRecords) {
      expect(record.source.url).toMatch(/^https:\/\//u);
      expect(record.source.label.en.length).toBeGreaterThan(0);
      expect(record.licensing).toMatch(/^(OPEN_REUSE|DEEPLINK_ONLY|LIVE_ONLY|APPROVAL_REQUIRED)$/u);
      expect(record.freshness).toMatch(/^(fresh|aging|stale|unknown)$/u);
      expect(Number.isNaN(Date.parse(record.updatedAt))).toBe(false);
      expect(campuses.some((campus) => campus.id === record.campus)).toBe(true);
    }
  });

  it("marks only explicitly confirmed machine feeds as open reuse", async () => {
    const openReuseIds = demoRecords
      .filter((record) => record.licensing === "OPEN_REUSE")
      .map((record) => record.id)
      .sort();

    expect(openReuseIds).toEqual(["duluth-events-feed", "morris-events-feed", "tc-events-feed"]);
  });

  it("provides every campus with the eight daily-service source categories", () => {
    const expectedKinds = ["calendar", "map", "transit", "dining", "events", "library", "safety", "service"];
    for (const campus of campuses) {
      const kinds = demoRecords.filter((record) => record.campus === campus.id).map((record) => record.kind);
      expect(kinds).toEqual(expect.arrayContaining(expectedKinds));
    }
  });
});
