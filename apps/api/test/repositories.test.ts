import { describe, expect, it } from "vitest";

import { InMemoryCampusRepository } from "../src/repositories/in-memory-campus.repository.js";
import { InMemorySourceRepository } from "../src/repositories/in-memory-source.repository.js";
import { InMemoryWorldManifestRepository } from "../src/repositories/in-memory-world-manifest.repository.js";

describe("in-memory foundation repositories", () => {
  it("lists five campuses and preserves the Rochester academic mapping", async () => {
    const campuses = await new InMemoryCampusRepository().list();
    expect(campuses).toHaveLength(5);
    expect(campuses.find((campus) => campus.id === "rochester")?.academicCalendarCampusId).toBe("tc");
    expect(campuses.find((campus) => campus.id === "rochester")).toMatchObject({
      academicInstitutionCode: "UMNTC",
    });
  });

  it("filters provenance-bearing sources by campus", async () => {
    const sources = await new InMemorySourceRepository().list("morris");
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((source) => source.campusIds.includes("morris"))).toBe(true);

    expect(sources.find((source) => source.id === "morris-campus-home")).toMatchObject({
      sourceUrl: "https://morris.umn.edu/",
      licenseStatus: "DEEPLINK_ONLY",
      cachePolicy: "NO_CONTENT_CACHE",
      officialStatus: "UNVERIFIED",
    });
    expect(sources.find((source) => source.id === "umn-sessions-morris")).toMatchObject({
      sourceUrl: "https://sessions.umn.edu/sessions.json?q=institution_id=UMNMO",
      licenseStatus: "LIVE_ONLY",
      cacheDisposition: {
        rawResponse: "TRANSIENT_ONLY",
        normalizedRecords: "TRANSIENT_ONLY",
      },
    });
    expect(sources.find((source) => source.id === "morris-events-feed")).toMatchObject({
      licenseStatus: "APPROVAL_REQUIRED",
      cachePolicy: "NO_ACCESS",
      killSwitch: { defaultState: "DISABLED" },
    });
  });

  it("returns a schematic manifest only for configured campuses", async () => {
    const repository = new InMemoryWorldManifestRepository();
    expect((await repository.findByCampusId("tc"))?.verificationState).toBe("schematic");
    expect(await repository.findByCampusId("unsupported")).toBeNull();
  });
});
