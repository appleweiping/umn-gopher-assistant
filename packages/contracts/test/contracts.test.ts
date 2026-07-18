import { describe, expect, it } from "vitest";

import * as campusContracts from "../src/campus.js";
import {
  ACADEMIC_CALENDAR_CAMPUS_MAP,
  AuditEventSchema,
  CampusIdSchema,
  CampusWorldManifestSchema,
  DeviceKeyEnvelopeSchema,
  EncryptedVaultEnvelopeSchema,
  LiveEventPolicySchema,
  ModerationCaseSchema,
  RouteSegmentSchema,
  SourceDescriptorSchema,
  VerificationStateSchema,
  WorldJoinTicketSchema,
  resolveAcademicCalendarCampus,
} from "../src/index.js";

const source = {
  id: "tc-campus-home",
  campusIds: ["tc"],
  name: { en: "Twin Cities campus website", "zh-CN": "双城校区网站" },
  publisher: "University of Minnesota",
  sourceUrl: "https://twin-cities.umn.edu/",
  licenseStatus: "DEEPLINK_ONLY",
  freshnessState: "UNKNOWN",
  verificationState: "surveyed",
  officialStatus: "UNVERIFIED",
  attribution: "Source link: University of Minnesota Twin Cities",
  cachePolicy: "NO_CONTENT_CACHE",
  lastCheckedAt: null,
} as const;

describe("campus contracts", () => {
  const academicContracts = campusContracts as unknown as {
    AcademicInstitutionCodeSchema?: { readonly options: readonly string[] };
    resolveAcademicInstitution?: (campusId: string) => string;
  };

  it("accepts the five campus identifiers", () => {
    expect(CampusIdSchema.options).toEqual(["tc", "duluth", "crookston", "morris", "rochester"]);
  });

  it("rejects unsupported campus identifiers", () => {
    expect(CampusIdSchema.safeParse("twin-cities").success).toBe(false);
  });

  it("maps Rochester academics to Twin Cities", () => {
    expect(ACADEMIC_CALENDAR_CAMPUS_MAP.rochester).toBe("tc");
    expect(resolveAcademicCalendarCampus("rochester")).toBe("tc");
  });

  it("models academic institutions separately and maps Rochester to UMNTC", () => {
    expect(academicContracts.AcademicInstitutionCodeSchema?.options).toEqual([
      "UMNTC",
      "UMNDL",
      "UMNCR",
      "UMNMO",
    ]);
    expect(academicContracts.resolveAcademicInstitution?.("rochester")).toBe("UMNTC");
  });
});

describe("verification contracts", () => {
  it("uses the exact cross-stack verification lifecycle", () => {
    expect(VerificationStateSchema.options).toEqual([
      "schematic",
      "surveyed",
      "campus-reviewed",
      "verified",
      "retired",
    ]);
  });
});

describe("source contracts", () => {
  it("accepts provenance without implying an official integration", () => {
    expect(SourceDescriptorSchema.parse(source)).toEqual(source);
  });

  it("rejects prohibited sources that allow access or caching", () => {
    expect(
      SourceDescriptorSchema.safeParse({
        ...source,
        licenseStatus: "PROHIBITED",
        cachePolicy: "CACHE_ALLOWED",
      }).success,
    ).toBe(false);
  });
});

describe("world and route contracts", () => {
  const manifest = {
    campusId: "tc",
    worldVersion: "tc-schematic-v1",
    revision: 1,
    generatedAt: "2026-07-19T00:00:00.000Z",
    verificationState: "schematic",
    etag: '"tc-schematic-v1-r1"',
    sourceIds: ["tc-campus-home"],
    tiles: [
      {
        id: "tc-base-0",
        url: "https://assets.example.invalid/worlds/tc/base.pmtiles",
        contentType: "application/vnd.pmtiles",
        minZoom: 10,
        maxZoom: 18,
        bounds: [-93.3, 44.95, -93.15, 45.02],
        sha256: "a".repeat(64),
        byteLength: 1024,
        licenseStatus: "OPEN_REUSE",
        verificationState: "schematic",
      },
    ],
    portals: [
      {
        id: "tc-to-duluth",
        label: { en: "Duluth portal", "zh-CN": "前往德卢斯" },
        fromCampusId: "tc",
        toCampusId: "duluth",
        position: [-93.2277, 44.9739, 0],
        targetWorldVersion: "duluth-schematic-v1",
        verificationState: "schematic",
      },
    ],
  } as const;

  it("accepts a provenance-bound schematic world manifest", () => {
    expect(CampusWorldManifestSchema.parse(manifest).campusId).toBe("tc");
  });

  it("rejects a tile whose zoom range is reversed", () => {
    const invalid = {
      ...manifest,
      tiles: [{ ...manifest.tiles[0], minZoom: 19 }],
    };
    expect(CampusWorldManifestSchema.safeParse(invalid).success).toBe(false);
  });

  it("accepts a verified route segment", () => {
    const result = RouteSegmentSchema.safeParse({
      id: "segment-1",
      profile: "WHEELCHAIR",
      geometry: [
        [-93.2277, 44.9739],
        [-93.227, 44.974],
      ],
      distanceMeters: 75,
      durationSeconds: 90,
      instructions: { en: "Continue on the verified path", "zh-CN": "沿已核验路线前行" },
      verificationState: "verified",
      safetyCritical: true,
      sourceIds: ["tc-accessibility"],
      validUntil: "2026-08-19T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a route with fewer than two geometry points", () => {
    expect(
      RouteSegmentSchema.safeParse({
        id: "segment-1",
        profile: "WALK",
        geometry: [[-93.2277, 44.9739]],
        distanceMeters: 1,
        durationSeconds: 1,
        instructions: { en: "Move", "zh-CN": "前行" },
        verificationState: "schematic",
        safetyCritical: false,
        sourceIds: ["tc-campus-home"],
        validUntil: null,
      }).success,
    ).toBe(false);
  });
});

describe("live and encrypted state contracts", () => {
  it("accepts a short-lived, device-bound world join ticket", () => {
    const result = WorldJoinTicketSchema.safeParse({
      ticketId: "018fb9d8-3ec5-7e8b-a512-35f8ff523101",
      campusId: "duluth",
      participantId: "pseudonymous-player-1",
      roomName: "duluth-lobby",
      token: "opaque.join.ticket.value",
      deviceBoundNonce: "device-nonce-1",
      scopes: ["world:join", "presence:publish"],
      issuedAt: "2026-07-19T00:00:00.000Z",
      expiresAt: "2026-07-19T00:05:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a join ticket that expires before issuance", () => {
    expect(
      WorldJoinTicketSchema.safeParse({
        ticketId: "018fb9d8-3ec5-7e8b-a512-35f8ff523101",
        campusId: "duluth",
        participantId: "player-1",
        roomName: "duluth-lobby",
        token: "opaque.join.ticket.value",
        deviceBoundNonce: "device-nonce-1",
        scopes: ["world:join"],
        issuedAt: "2026-07-19T00:05:00.000Z",
        expiresAt: "2026-07-19T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("requires consent whenever recording is allowed", () => {
    expect(
      LiveEventPolicySchema.safeParse({
        eventId: "event-1",
        policyVersion: "1.0.0",
        recordingAllowed: true,
        transcriptionAllowed: false,
        consentRequired: false,
        retentionDays: 0,
        consentNotice: { en: "Recording notice", "zh-CN": "录制通知" },
        effectiveAt: "2026-07-19T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("accepts device-key and encrypted-vault envelopes", () => {
    const deviceEnvelope = DeviceKeyEnvelopeSchema.parse({
      deviceId: "device-1",
      keyId: "vault-key-1",
      algorithm: "X25519_XCHACHA20_POLY1305",
      ephemeralPublicKey: "QmFzZTY0dXJsS2V5",
      wrappedKey: "V3JhcHBlZEtleQ",
      nonce: "Tm9uY2U",
      createdAt: "2026-07-19T00:00:00.000Z",
    });
    expect(
      EncryptedVaultEnvelopeSchema.safeParse({
        version: 1,
        algorithm: "XCHACHA20_POLY1305",
        keyId: "vault-key-1",
        ciphertext: "RW5jcnlwdGVkVmF1bHQ",
        nonce: "Tm9uY2U",
        aad: "VmF1bHQtMQ",
        deviceEnvelopes: [deviceEnvelope],
        createdAt: "2026-07-19T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });
});

describe("moderation and audit contracts", () => {
  it("requires resolution details for resolved moderation cases", () => {
    expect(
      ModerationCaseSchema.safeParse({
        id: "018fb9d8-3ec5-7e8b-a512-35f8ff523102",
        kind: "COMMUNITY_REPORT",
        state: "RESOLVED",
        priority: "NORMAL",
        target: { type: "community_post", id: "post-1" },
        reasonCodes: ["HARASSMENT"],
        reporterActorId: null,
        assignedModeratorId: "moderator-1",
        resolution: null,
        createdAt: "2026-07-19T00:00:00.000Z",
        updatedAt: "2026-07-19T01:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("accepts a structured audit event", () => {
    expect(
      AuditEventSchema.safeParse({
        id: "018fb9d8-3ec5-7e8b-a512-35f8ff523103",
        occurredAt: "2026-07-19T00:00:00.000Z",
        actor: { type: "service", id: "catalog-api" },
        action: "source.read",
        target: { type: "source", id: "tc-campus-home" },
        outcome: "SUCCESS",
        traceId: "8fdb8f9fd89a47c5b3ce5f7f9bb81120",
        metadata: { campusId: "tc" },
      }).success,
    ).toBe(true);
  });
});
