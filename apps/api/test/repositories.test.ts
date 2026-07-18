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
    expect(sources).toHaveLength(1);
    expect(sources[0]?.sourceUrl).toBe("https://morris.umn.edu/");
    expect(sources[0]?.officialStatus).toBe("UNVERIFIED");
  });

  it("returns a schematic manifest only for configured campuses", async () => {
    const repository = new InMemoryWorldManifestRepository();
    expect((await repository.findByCampusId("tc"))?.verificationState).toBe("schematic");
    expect(await repository.findByCampusId("unsupported")).toBeNull();
  });
});
