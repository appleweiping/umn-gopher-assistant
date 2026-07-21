import { describe, expect, it } from "vitest";

import {
  buildDeviceEnvelopeHeaderV1,
  buildPayloadAadV1,
  buildRecoveryAadV1,
  DeviceKeyEnvelopeV1Schema,
  DevicePublicKeyV1Schema,
  EncryptedVaultPayloadEnvelopeV1Schema,
  RecoveryKeyEnvelopeV1Schema,
  VAULT_MAX_CIPHERTEXT_BYTES,
  VAULT_MAX_DEVICE_ENVELOPES,
  VaultKeyringV1Schema,
} from "../src/security.js";

const ids = {
  vault: "018fb9d8-3ec5-7e8b-a512-35f8ff523110",
  vaultKey: "018fb9d8-3ec5-7e8b-a512-35f8ff523111",
  device: "018fb9d8-3ec5-7e8b-a512-35f8ff523112",
  deviceKey: "018fb9d8-3ec5-7e8b-a512-35f8ff523113",
  secondDevice: "018fb9d8-3ec5-7e8b-a512-35f8ff523114",
  secondDeviceKey: "018fb9d8-3ec5-7e8b-a512-35f8ff523115",
} as const;

const encodedBytes = (length: number, fill = 7): string => Buffer.alloc(length, fill).toString("base64url");
const indexedUuid = (index: number): string =>
  `018fb9d8-3ec5-7e8b-a512-${index.toString(16).padStart(12, "0")}`;

const deviceEnvelope = {
  formatVersion: 1,
  vaultId: ids.vault,
  vaultKeyId: ids.vaultKey,
  recipientDeviceId: ids.device,
  recipientKeyId: ids.deviceKey,
  recipientPublicKeyFingerprint: encodedBytes(32, 1),
  cipherSuite: "X25519_XCHACHA20_POLY1305",
  ephemeralPublicKey: encodedBytes(32, 2),
  nonce: encodedBytes(24, 3),
  wrappedKey: encodedBytes(80, 4),
  createdAt: "2026-07-19T00:00:00.000Z",
} as const;

const recoveryHeader = {
  formatVersion: 1,
  vaultId: ids.vault,
  vaultKeyId: ids.vaultKey,
  cipherSuite: "XCHACHA20_POLY1305",
  kdf: {
    algorithm: "ARGON2ID13",
    salt: encodedBytes(16, 5),
    opsLimit: 3,
    memLimitBytes: 64 * 1024 * 1024,
    outputBytes: 32,
  },
  nonce: encodedBytes(24, 6),
  createdAt: "2026-07-19T00:00:00.000Z",
} as const;
const recoveryEnvelope = {
  ...recoveryHeader,
  wrappedKey: encodedBytes(48, 7),
  aad: buildRecoveryAadV1(recoveryHeader),
} as const;

const payloadHeader = {
  formatVersion: 1,
  vaultId: ids.vault,
  vaultKeyId: ids.vaultKey,
  revision: 1,
  baseRevision: null,
  cipherSuite: "XCHACHA20_POLY1305",
  contentType: "application/vnd.umn-gopher-assistant.personal-vault+json",
  contentSchemaVersion: 1,
  padding: { algorithm: "SODIUM_PAD", blockSize: 4096 },
  nonce: encodedBytes(24, 9),
  createdAt: "2026-07-19T00:00:00.000Z",
} as const;
const payloadEnvelope = {
  ...payloadHeader,
  ciphertext: encodedBytes(4_112, 10),
  aad: buildPayloadAadV1(payloadHeader),
} as const;

describe("E2EE v1 security contracts", () => {
  it("produces fixed, domain-separated canonical AAD vectors", () => {
    expect([
      buildPayloadAadV1(payloadHeader),
      buildRecoveryAadV1(recoveryHeader),
      buildDeviceEnvelopeHeaderV1(deviceEnvelope),
    ]).toEqual([
      "WyJVR0ExL1BBWUxPQUQvQUFEIiwxLCIwMThmYjlkOC0zZWM1LTdlOGItYTUxMi0zNWY4ZmY1MjMxMTAiLCIwMThmYjlkOC0zZWM1LTdlOGItYTUxMi0zNWY4ZmY1MjMxMTEiLDEsbnVsbCwiWENIQUNIQTIwX1BPTFkxMzA1IiwiYXBwbGljYXRpb24vdm5kLnVtbi1nb3BoZXItYXNzaXN0YW50LnBlcnNvbmFsLXZhdWx0K2pzb24iLDEsIlNPRElVTV9QQUQiLDQwOTYsIkNRa0pDUWtKQ1FrSkNRa0pDUWtKQ1FrSkNRa0pDUWtKIiwiMjAyNi0wNy0xOVQwMDowMDowMC4wMDBaIl0",
      "WyJVR0ExL1JFQ09WRVJZL0FBRCIsMSwiMDE4ZmI5ZDgtM2VjNS03ZThiLWE1MTItMzVmOGZmNTIzMTEwIiwiMDE4ZmI5ZDgtM2VjNS03ZThiLWE1MTItMzVmOGZmNTIzMTExIiwiWENIQUNIQTIwX1BPTFkxMzA1IiwiQVJHT04ySUQxMyIsIkJRVUZCUVVGQlFVRkJRVUZCUVVGQlEiLDMsNjcxMDg4NjQsMzIsIkJnWUdCZ1lHQmdZR0JnWUdCZ1lHQmdZR0JnWUdCZ1lHIiwiMjAyNi0wNy0xOVQwMDowMDowMC4wMDBaIl0",
      "WyJVR0ExL0RFVklDRS1FTlZFTE9QRS9IRUFERVIiLDEsIjAxOGZiOWQ4LTNlYzUtN2U4Yi1hNTEyLTM1ZjhmZjUyMzExMCIsIjAxOGZiOWQ4LTNlYzUtN2U4Yi1hNTEyLTM1ZjhmZjUyMzExMSIsIjAxOGZiOWQ4LTNlYzUtN2U4Yi1hNTEyLTM1ZjhmZjUyMzExMiIsIjAxOGZiOWQ4LTNlYzUtN2U4Yi1hNTEyLTM1ZjhmZjUyMzExMyIsIkFRRUJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUUiLCJYMjU1MTlfWENIQUNIQTIwX1BPTFkxMzA1IiwiQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSSIsIkF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EIiwiMjAyNi0wNy0xOVQwMDowMDowMC4wMDBaIl0",
    ]);
  });

  it("accepts fixed-size device and recovery key material", () => {
    expect(
      DevicePublicKeyV1Schema.safeParse({
        formatVersion: 1,
        deviceId: ids.device,
        deviceKeyId: ids.deviceKey,
        keyAlgorithm: "X25519",
        publicKey: encodedBytes(32, 12),
        publicKeyFingerprint: encodedBytes(32, 13),
        createdAt: "2026-07-19T00:00:00.000Z",
        revokedAt: null,
      }).success,
    ).toBe(true);
    expect(DeviceKeyEnvelopeV1Schema.safeParse(deviceEnvelope).success).toBe(true);
    expect(RecoveryKeyEnvelopeV1Schema.safeParse(recoveryEnvelope).success).toBe(true);
  });

  it("requires canonical unpadded base64url", () => {
    const canonical = encodedBytes(32, 14);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const finalIndex = alphabet.indexOf(canonical.at(-1) ?? "");
    const nonCanonical = `${canonical.slice(0, -1)}${alphabet[finalIndex | 1]}`;

    expect(DeviceKeyEnvelopeV1Schema.safeParse(deviceEnvelope).success).toBe(true);
    expect(
      DeviceKeyEnvelopeV1Schema.safeParse({
        ...deviceEnvelope,
        recipientPublicKeyFingerprint: nonCanonical,
      }).success,
    ).toBe(false);
    expect(
      DeviceKeyEnvelopeV1Schema.safeParse({ ...deviceEnvelope, nonce: `${encodedBytes(24)}=` }).success,
    ).toBe(false);
    expect(DeviceKeyEnvelopeV1Schema.safeParse({ ...deviceEnvelope, ephemeralPublicKey: "A" }).success).toBe(
      false,
    );
  });

  it("enforces exact byte lengths on every cryptographic field", () => {
    for (const [field, length] of [
      ["recipientPublicKeyFingerprint", 32],
      ["ephemeralPublicKey", 32],
      ["nonce", 24],
      ["wrappedKey", 80],
    ] as const) {
      expect(
        DeviceKeyEnvelopeV1Schema.safeParse({
          ...deviceEnvelope,
          [field]: encodedBytes(length - 1),
        }).success,
      ).toBe(false);
      expect(
        DeviceKeyEnvelopeV1Schema.safeParse({
          ...deviceEnvelope,
          [field]: encodedBytes(length + 1),
        }).success,
      ).toBe(false);
    }

    expect(
      RecoveryKeyEnvelopeV1Schema.safeParse({
        ...recoveryEnvelope,
        kdf: { ...recoveryEnvelope.kdf, salt: encodedBytes(15) },
      }).success,
    ).toBe(false);
    expect(
      RecoveryKeyEnvelopeV1Schema.safeParse({
        ...recoveryEnvelope,
        wrappedKey: encodedBytes(49),
      }).success,
    ).toBe(false);
  });

  it("rejects weakened or resource-exhausting Argon2id parameters", () => {
    for (const memLimitBytes of [64 * 1024 * 1024 - 1, 256 * 1024 * 1024 + 1]) {
      expect(
        RecoveryKeyEnvelopeV1Schema.safeParse({
          ...recoveryEnvelope,
          kdf: { ...recoveryEnvelope.kdf, memLimitBytes },
        }).success,
      ).toBe(false);
    }
    for (const opsLimit of [1, 11]) {
      expect(
        RecoveryKeyEnvelopeV1Schema.safeParse({
          ...recoveryEnvelope,
          kdf: { ...recoveryEnvelope.kdf, opsLimit },
        }).success,
      ).toBe(false);
    }
    expect(
      RecoveryKeyEnvelopeV1Schema.safeParse({
        ...recoveryEnvelope,
        kdf: { ...recoveryEnvelope.kdf, algorithm: "PBKDF2" },
      }).success,
    ).toBe(false);
    expect(
      RecoveryKeyEnvelopeV1Schema.safeParse({
        ...recoveryEnvelope,
        kdf: { ...recoveryEnvelope.kdf, outputBytes: 64 },
      }).success,
    ).toBe(false);
  });

  it("binds payload metadata to the v1 suite and 4 KiB padding contract", () => {
    expect(EncryptedVaultPayloadEnvelopeV1Schema.safeParse(payloadEnvelope).success).toBe(true);
    expect(
      EncryptedVaultPayloadEnvelopeV1Schema.safeParse({
        ...payloadEnvelope,
        cipherSuite: "AES_256_GCM",
      }).success,
    ).toBe(false);
    expect(
      EncryptedVaultPayloadEnvelopeV1Schema.safeParse({
        ...payloadEnvelope,
        padding: { algorithm: "PKCS7", blockSize: 4096 },
      }).success,
    ).toBe(false);
    expect(
      EncryptedVaultPayloadEnvelopeV1Schema.safeParse({
        ...payloadEnvelope,
        padding: { algorithm: "SODIUM_PAD", blockSize: 1024 },
      }).success,
    ).toBe(false);
    expect(
      EncryptedVaultPayloadEnvelopeV1Schema.safeParse({
        ...payloadEnvelope,
        baseRevision: 2,
      }).success,
    ).toBe(false);
    expect(
      EncryptedVaultPayloadEnvelopeV1Schema.safeParse({
        ...payloadEnvelope,
        injectedMetadata: "ignored only by an unsafe parser",
      }).success,
    ).toBe(false);
  });

  it("requires exact canonical AAD and consecutive payload revisions", () => {
    expect(
      EncryptedVaultPayloadEnvelopeV1Schema.safeParse({
        ...payloadEnvelope,
        createdAt: "2026-07-19T00:00:01.000Z",
      }).success,
    ).toBe(false);
    expect(
      RecoveryKeyEnvelopeV1Schema.safeParse({
        ...recoveryEnvelope,
        kdf: { ...recoveryEnvelope.kdf, opsLimit: 4 },
      }).success,
    ).toBe(false);

    const revisionTwoHeader = { ...payloadHeader, revision: 2, baseRevision: 1 } as const;
    expect(
      EncryptedVaultPayloadEnvelopeV1Schema.safeParse({
        ...payloadEnvelope,
        ...revisionTwoHeader,
        aad: buildPayloadAadV1(revisionTwoHeader),
      }).success,
    ).toBe(true);

    const skippedRevisionHeader = { ...payloadHeader, revision: 3, baseRevision: 1 } as const;
    expect(
      EncryptedVaultPayloadEnvelopeV1Schema.safeParse({
        ...payloadEnvelope,
        ...skippedRevisionHeader,
        aad: buildPayloadAadV1(skippedRevisionHeader),
      }).success,
    ).toBe(false);
    expect(() =>
      buildPayloadAadV1({
        ...payloadHeader,
        createdAt: "2026-07-19T00:00:00.000Z-é",
      }),
    ).toThrow("ASCII");
  });

  it("rejects malformed and oversized ciphertext before decoding it", () => {
    expect(
      EncryptedVaultPayloadEnvelopeV1Schema.safeParse({
        ...payloadEnvelope,
        ciphertext: encodedBytes(4_111),
      }).success,
    ).toBe(false);
    expect(
      EncryptedVaultPayloadEnvelopeV1Schema.safeParse({
        ...payloadEnvelope,
        ciphertext: "A".repeat(Math.ceil(((VAULT_MAX_CIPHERTEXT_BYTES + 1) * 8) / 6)),
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate recipients and keyring metadata substitution", () => {
    const keyring = {
      formatVersion: 1,
      vaultId: ids.vault,
      vaultKeyId: ids.vaultKey,
      revision: 1,
      deviceEnvelopes: [deviceEnvelope],
      recoveryEnvelope,
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:01:00.000Z",
    } as const;
    expect(VaultKeyringV1Schema.safeParse(keyring).success).toBe(true);

    expect(
      VaultKeyringV1Schema.safeParse({
        ...keyring,
        deviceEnvelopes: [
          deviceEnvelope,
          {
            ...deviceEnvelope,
            recipientKeyId: ids.secondDeviceKey,
            ephemeralPublicKey: encodedBytes(32, 20),
            nonce: encodedBytes(24, 21),
            wrappedKey: encodedBytes(80, 22),
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      VaultKeyringV1Schema.safeParse({
        ...keyring,
        deviceEnvelopes: [
          deviceEnvelope,
          {
            ...deviceEnvelope,
            recipientDeviceId: ids.secondDevice,
            ephemeralPublicKey: encodedBytes(32, 23),
            nonce: encodedBytes(24, 24),
            wrappedKey: encodedBytes(80, 25),
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      VaultKeyringV1Schema.safeParse({
        ...keyring,
        recoveryEnvelope: { ...recoveryEnvelope, vaultKeyId: ids.secondDeviceKey },
      }).success,
    ).toBe(false);
    expect(
      VaultKeyringV1Schema.safeParse({
        ...keyring,
        deviceEnvelopes: [
          {
            ...deviceEnvelope,
            vaultId: ids.secondDevice,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      VaultKeyringV1Schema.safeParse({
        ...keyring,
        deviceEnvelopes: Array.from({ length: VAULT_MAX_DEVICE_ENVELOPES + 1 }, (_, index) => ({
          ...deviceEnvelope,
          recipientDeviceId: indexedUuid(1_000 + index),
          recipientKeyId: indexedUuid(2_000 + index),
        })),
      }).success,
    ).toBe(false);
  });

  it("fails closed on unknown fields and invalid lifecycle timestamps", () => {
    const publicKey = {
      formatVersion: 1,
      deviceId: ids.device,
      deviceKeyId: ids.deviceKey,
      keyAlgorithm: "X25519",
      publicKey: encodedBytes(32),
      publicKeyFingerprint: encodedBytes(32),
      createdAt: "2026-07-19T01:00:00.000Z",
      revokedAt: null,
    } as const;
    expect(DevicePublicKeyV1Schema.safeParse({ ...publicKey, serverCanDecrypt: true }).success).toBe(false);
    expect(
      DevicePublicKeyV1Schema.safeParse({
        ...publicKey,
        revokedAt: "2026-07-19T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(DevicePublicKeyV1Schema.safeParse({ ...publicKey, deviceId: "device-1" }).success).toBe(false);
  });
});
