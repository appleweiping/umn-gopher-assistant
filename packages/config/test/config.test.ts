import { describe, expect, it } from "vitest";

import { campuses, sources } from "../src/index.js";

describe("foundation configuration", () => {
  it("exposes five bilingual campuses with Rochester using the Twin Cities academic calendar", () => {
    expect(campuses).toHaveLength(5);
    expect(campuses.every((campus) => campus.name.en.length > 0 && campus.name["zh-CN"].length > 0)).toBe(
      true,
    );
    expect(campuses.find((campus) => campus.id === "rochester")?.academicCalendarCampusId).toBe("tc");
  });

  it("keeps academic institution identity distinct from calendar routing", () => {
    expect(campuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "tc", academicInstitutionCode: "UMNTC" }),
        expect.objectContaining({ id: "duluth", academicInstitutionCode: "UMNDL" }),
        expect.objectContaining({ id: "crookston", academicInstitutionCode: "UMNCR" }),
        expect.objectContaining({ id: "morris", academicInstitutionCode: "UMNMO" }),
        expect.objectContaining({ id: "rochester", academicInstitutionCode: "UMNTC" }),
      ]),
    );
  });

  it("does not claim official integration status for seed sources", () => {
    expect(sources).toHaveLength(5);
    expect(sources.every((source) => source.officialStatus === "UNVERIFIED")).toBe(true);
  });
});
