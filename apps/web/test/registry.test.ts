// @vitest-environment node

import { describe, expect, it } from "vitest";

import { campuses, demoRecords } from "../lib/data/registry";

describe("five-campus official-link registry", () => {
  it("covers all five campuses and keeps Rochester on the UMNTC academic institution", async () => {
    expect(campuses.map((campus) => campus.id)).toEqual(["tc", "duluth", "crookston", "morris", "rochester"]);
    expect(campuses.find((campus) => campus.id === "rochester")?.academicInstitutionCode).toBe("UMNTC");
  });

  it("carries provenance and campus ownership without claiming unobserved freshness", async () => {
    expect(demoRecords.length).toBeGreaterThanOrEqual(25);
    for (const record of demoRecords) {
      expect(record.source.url).toMatch(/^https:\/\//u);
      expect(record.source.label.en.length).toBeGreaterThan(0);
      expect(record.licensing).toBe("DEEPLINK_ONLY");
      expect(record.freshness).toBe("unknown");
      expect(campuses.some((campus) => campus.id === record.campus)).toBe(true);
    }
  });

  it("keeps machine-readable live feeds outside the persistent static registry", async () => {
    expect(new Set(demoRecords.map((record) => record.licensing))).toEqual(new Set(["DEEPLINK_ONLY"]));
    expect(demoRecords.some((record) => record.source.url.includes("/live/json"))).toBe(false);
    expect(demoRecords.some((record) => record.source.url.includes("/api/2/events"))).toBe(false);
  });

  it("provides every campus with the eight daily-service source categories", () => {
    const expectedKinds = ["calendar", "map", "transit", "dining", "events", "library", "safety", "service"];
    for (const campus of campuses) {
      const kinds = demoRecords.filter((record) => record.campus === campus.id).map((record) => record.kind);
      expect(kinds).toEqual(expect.arrayContaining(expectedKinds));
    }
  });
});
