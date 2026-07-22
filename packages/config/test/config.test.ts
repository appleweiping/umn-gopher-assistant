import { describe, expect, it } from "vitest";

import { resolveAcademicInstitution } from "@umn-gopher-assistant/contracts";

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
    expect(sources).toHaveLength(15);
    expect(sources.every((source) => source.officialStatus === "UNVERIFIED")).toBe(true);
  });

  it("registers one LIVE_ONLY, non-caching Sessions source per campus", () => {
    const sessionSources = sources.filter((source) => source.resourceKinds.includes("ACADEMIC_SESSION"));

    expect(sessionSources).toHaveLength(5);
    expect(sessionSources.flatMap((source) => source.campusIds).sort()).toEqual([
      "crookston",
      "duluth",
      "morris",
      "rochester",
      "tc",
    ]);
    for (const source of sessionSources) {
      const campusId = source.campusIds[0];
      if (campusId === undefined) throw new Error(`${source.id} has no campus`);
      expect(source.licenseStatus).toBe("LIVE_ONLY");
      expect(source.cachePolicy).toBe("NO_CONTENT_CACHE");
      expect(source.cacheDisposition).toMatchObject({
        rawResponse: "TRANSIENT_ONLY",
        normalizedRecords: "TRANSIENT_ONLY",
        derivedArtifacts: "PROHIBITED",
        retentionSeconds: null,
      });
      expect(source.termsReviewedAt).toBe("2026-07-22T00:00:00.000Z");
      expect(source.termsReviewExpiresAt).toBe("2027-07-22T00:00:00.000Z");
      expect(source.authorizationEvidenceUrl).toBe("https://asr-custom.umn.edu/sessions_data_service/");
      expect(new URL(source.sourceUrl).searchParams.get("q")).toBe(
        `institution_id=${resolveAcademicInstitution(campusId)}`,
      );
    }
    expect(sources.find((source) => source.id === "umn-sessions-rochester")?.sourceUrl).toContain(
      "institution_id=UMNTC",
    );
  });

  it("fails closed for event feeds whose reuse rights are not established", () => {
    expect(sources.find((source) => source.id === "tc-events-feed")).toMatchObject({
      licenseStatus: "LIVE_ONLY",
      cachePolicy: "NO_CONTENT_CACHE",
      freshnessState: "UNKNOWN",
      authorizationEvidenceUrl: "https://events.tc.umn.edu/feed_builder",
      termsReviewedAt: "2026-07-22T00:00:00.000Z",
      termsReviewExpiresAt: "2027-07-22T00:00:00.000Z",
    });
    expect(sources.find((source) => source.id === "duluth-events-feed")).toMatchObject({
      licenseStatus: "LIVE_ONLY",
      cachePolicy: "NO_CONTENT_CACHE",
      freshnessState: "UNKNOWN",
      authorizationEvidenceUrl: "https://calendar.d.umn.edu/feed_builder",
      termsReviewedAt: "2026-07-22T00:00:00.000Z",
      termsReviewExpiresAt: "2027-07-22T00:00:00.000Z",
    });
    expect(sources.find((source) => source.id === "morris-events-feed")).toMatchObject({
      licenseStatus: "APPROVAL_REQUIRED",
      cachePolicy: "NO_ACCESS",
      freshnessState: "UNKNOWN",
      killSwitch: { defaultState: "DISABLED" },
    });

    const remainingEventSources = sources.filter(
      (source) =>
        source.resourceKinds.includes("PUBLIC_EVENT") &&
        !["tc-events-feed", "duluth-events-feed", "morris-events-feed"].includes(source.id),
    );
    expect(remainingEventSources.map((source) => source.id).sort()).toEqual([
      "crookston-events",
      "rochester-events",
    ]);
    expect(
      remainingEventSources.every(
        (source) => source.licenseStatus === "DEEPLINK_ONLY" && source.freshnessState === "UNKNOWN",
      ),
    ).toBe(true);
  });

  it("leaves every source outside the seven reviewed live adapters unreviewed", () => {
    const reviewedLiveIds = new Set([
      "umn-sessions-tc",
      "umn-sessions-duluth",
      "umn-sessions-crookston",
      "umn-sessions-morris",
      "umn-sessions-rochester",
      "tc-events-feed",
      "duluth-events-feed",
    ]);
    expect(
      sources
        .filter((source) => !reviewedLiveIds.has(source.id))
        .every(
          (source) =>
            source.termsReviewedAt === null &&
            source.termsReviewExpiresAt === null &&
            (source.licenseStatus !== "LIVE_ONLY" || source.killSwitch.defaultState === "DISABLED"),
        ),
    ).toBe(true);
  });

  it("records evidence, owner, bounded purpose, and expiry for every reviewed live adapter", () => {
    const reviewedLiveSources = sources.filter((source) => source.licenseStatus === "LIVE_ONLY");

    expect(reviewedLiveSources).toHaveLength(7);
    for (const source of reviewedLiveSources) {
      expect(source.authorizationEvidenceUrl).not.toBeNull();
      expect(source.owner).toEqual({
        teamId: "catalog-integrations",
        contactUrl: "https://github.com/appleweiping/umn-gopher-assistant/security/policy",
      });
      expect(source.resourceKinds).toHaveLength(1);
      expect(["ACADEMIC_SESSION", "PUBLIC_EVENT"]).toContain(source.resourceKinds[0]);
      expect(source.termsReviewedAt).toBe("2026-07-22T00:00:00.000Z");
      expect(source.termsReviewExpiresAt).toBe("2027-07-22T00:00:00.000Z");
    }
  });

  it("contains no unsupported OPEN_REUSE or synthetic FRESH claims", () => {
    expect(sources.some((source) => source.licenseStatus === "OPEN_REUSE")).toBe(false);
    expect(sources.some((source) => source.freshnessState === "FRESH")).toBe(false);
    expect(sources.every((source) => source.lastCheckedAt === null)).toBe(true);
  });

  it("has unique source IDs, kill switches, owners, and explicit public-data classification", () => {
    expect(new Set(sources.map((source) => source.id)).size).toBe(sources.length);
    expect(new Set(sources.map((source) => source.killSwitch.key)).size).toBe(sources.length);
    expect(
      sources.every(
        (source) =>
          source.owner.teamId.length > 0 &&
          source.owner.contactUrl.startsWith("https://") &&
          source.dataClassification === "PUBLIC" &&
          source.dataClasses.includes("PUBLIC_METADATA"),
      ),
    ).toBe(true);
  });
});
