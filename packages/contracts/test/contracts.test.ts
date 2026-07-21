import { describe, expect, it } from "vitest";

import * as campusContracts from "../src/campus.js";
import {
  ACADEMIC_CALENDAR_CAMPUS_MAP,
  AuditEventSchema,
  buildPayloadAadV1,
  CampusIdSchema,
  CampusMetadataSchema,
  CampusWorldManifestSchema,
  DeviceKeyEnvelopeSchema,
  EncryptedVaultEnvelopeSchema,
  LiveEventPolicySchema,
  ModerationCaseSchema,
  RouteProfileSchema,
  RouteSegmentSchema,
  SourceDescriptorSchema,
  VerificationStateSchema,
  WorldJoinTicketSchema,
  resolveAcademicCalendarCampus,
} from "../src/index.js";

const encodedBytes = (length: number): string => Buffer.alloc(length, 7).toString("base64url");

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

  it("rejects campus metadata whose institution or calendar mapping is inconsistent", () => {
    const rochester = {
      id: "rochester",
      name: { en: "Rochester", "zh-CN": "罗切斯特校区" },
      city: { en: "Rochester", "zh-CN": "罗切斯特" },
      timeZone: "America/Chicago",
      academicInstitutionCode: "UMNTC",
      academicCalendarCampusId: "tc",
      sourceUrl: "https://r.umn.edu/",
      officialStatus: "UNVERIFIED",
    } as const;

    expect(CampusMetadataSchema.safeParse(rochester).success).toBe(true);
    expect(CampusMetadataSchema.safeParse({ ...rochester, academicInstitutionCode: "UMNMO" }).success).toBe(
      false,
    );
    expect(
      CampusMetadataSchema.safeParse({ ...rochester, academicCalendarCampusId: "rochester" }).success,
    ).toBe(false);
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
      profile: "wheelchair",
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
        profile: "walking",
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

  it("limits the first route contract to walking and wheelchair profiles", () => {
    expect(RouteProfileSchema.options).toEqual(["walking", "wheelchair"]);
    expect(RouteProfileSchema.safeParse("bicycle").success).toBe(false);
    expect(RouteProfileSchema.safeParse("TRANSIT").success).toBe(false);
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
      formatVersion: 1,
      vaultId: "018fb9d8-3ec5-7e8b-a512-35f8ff523110",
      vaultKeyId: "018fb9d8-3ec5-7e8b-a512-35f8ff523111",
      recipientDeviceId: "018fb9d8-3ec5-7e8b-a512-35f8ff523112",
      recipientKeyId: "018fb9d8-3ec5-7e8b-a512-35f8ff523113",
      recipientPublicKeyFingerprint: encodedBytes(32),
      cipherSuite: "X25519_XCHACHA20_POLY1305",
      ephemeralPublicKey: encodedBytes(32),
      wrappedKey: encodedBytes(80),
      nonce: encodedBytes(24),
      createdAt: "2026-07-19T00:00:00.000Z",
    });
    const payloadHeader = {
      formatVersion: 1,
      vaultId: "018fb9d8-3ec5-7e8b-a512-35f8ff523110",
      vaultKeyId: "018fb9d8-3ec5-7e8b-a512-35f8ff523111",
      revision: 1,
      baseRevision: null,
      cipherSuite: "XCHACHA20_POLY1305",
      contentType: "application/vnd.umn-gopher-assistant.personal-vault+json",
      contentSchemaVersion: 1,
      padding: { algorithm: "SODIUM_PAD", blockSize: 4096 },
      nonce: encodedBytes(24),
      createdAt: "2026-07-19T00:00:00.000Z",
    } as const;
    expect(
      EncryptedVaultEnvelopeSchema.safeParse({
        ...payloadHeader,
        ciphertext: encodedBytes(4_112),
        aad: buildPayloadAadV1(payloadHeader),
      }).success,
    ).toBe(true);
    expect(deviceEnvelope.recipientDeviceId).toBe("018fb9d8-3ec5-7e8b-a512-35f8ff523112");
  });

  it("enforces X25519 and XChaCha20-Poly1305 byte lengths", () => {
    const baseEnvelope = {
      formatVersion: 1,
      vaultId: "018fb9d8-3ec5-7e8b-a512-35f8ff523110",
      vaultKeyId: "018fb9d8-3ec5-7e8b-a512-35f8ff523111",
      recipientDeviceId: "018fb9d8-3ec5-7e8b-a512-35f8ff523112",
      recipientKeyId: "018fb9d8-3ec5-7e8b-a512-35f8ff523113",
      recipientPublicKeyFingerprint: encodedBytes(32),
      cipherSuite: "X25519_XCHACHA20_POLY1305",
      ephemeralPublicKey: encodedBytes(32),
      wrappedKey: encodedBytes(80),
      nonce: encodedBytes(24),
      createdAt: "2026-07-19T00:00:00.000Z",
    } as const;

    expect(DeviceKeyEnvelopeSchema.safeParse(baseEnvelope).success).toBe(true);
    for (const length of [31, 33]) {
      expect(
        DeviceKeyEnvelopeSchema.safeParse({ ...baseEnvelope, ephemeralPublicKey: encodedBytes(length) })
          .success,
      ).toBe(false);
    }
    for (const length of [23, 25]) {
      expect(
        DeviceKeyEnvelopeSchema.safeParse({ ...baseEnvelope, nonce: encodedBytes(length) }).success,
      ).toBe(false);
    }
  });

  it("fails closed instead of accepting the retired AES placeholder", () => {
    const payload = {
      formatVersion: 1,
      vaultId: "018fb9d8-3ec5-7e8b-a512-35f8ff523110",
      vaultKeyId: "018fb9d8-3ec5-7e8b-a512-35f8ff523111",
      revision: 1,
      baseRevision: null,
      cipherSuite: "AES_256_GCM",
      contentType: "application/vnd.umn-gopher-assistant.personal-vault+json",
      contentSchemaVersion: 1,
      padding: { algorithm: "SODIUM_PAD", blockSize: 4096 },
      ciphertext: encodedBytes(4_112),
      nonce: encodedBytes(12),
      aad: encodedBytes(32),
      createdAt: "2026-07-19T00:00:00.000Z",
    };
    expect(EncryptedVaultEnvelopeSchema.safeParse(payload).success).toBe(false);
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
