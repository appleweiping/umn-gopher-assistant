import { describe, expect, it } from "vitest";

import {
  AuthorizationManifestV2Schema,
  buildDevicePairingRequestBytesV2,
  buildPayloadAadV2,
  buildVaultCommandProofBytesV2,
  buildVaultCommitMacBytesV2,
  buildVaultCommitSigningBytesV2,
  buildVaultReadProofBytesV2,
  decodeVaultReadProofHeaderV2,
  DeviceDescriptorV2Schema,
  encodeVaultReadProofHeaderV2,
  EncryptedVaultPayloadEnvelopeV2Schema,
  VaultCommandProofV2Schema,
  VaultCommitV2Schema,
  VaultReadProofV2Schema,
} from "../src/vault-sync.js";

const encodedBytes = (length: number, fill: number): string =>
  Buffer.alloc(length, fill).toString("base64url");

const ids = {
  vault: "018fb9d8-3ec5-7e8b-a512-35f8ff523110",
  vaultKey: "018fb9d8-3ec5-7e8b-a512-35f8ff523111",
  device: "018fb9d8-3ec5-7e8b-a512-35f8ff523112",
  encryptionKey: "018fb9d8-3ec5-7e8b-a512-35f8ff523113",
  authorizationKey: "018fb9d8-3ec5-7e8b-a512-35f8ff523114",
  recoveryKey: "018fb9d8-3ec5-7e8b-a512-35f8ff523115",
  operation: "018fb9d8-3ec5-7e8b-a512-35f8ff523116",
} as const;
const ownerBinding = encodedBytes(32, 1);
const createdAt = "2026-07-23T00:00:00.000Z";

const device = {
  formatVersion: 2,
  ownerBinding,
  deviceId: ids.device,
  encryptionKey: {
    keyId: ids.encryptionKey,
    algorithm: "X25519",
    publicKey: encodedBytes(32, 2),
    fingerprint: encodedBytes(32, 3),
  },
  authorizationKey: {
    keyId: ids.authorizationKey,
    algorithm: "ED25519",
    publicKey: encodedBytes(32, 4),
    fingerprint: encodedBytes(32, 5),
  },
  createdAt,
  revokedAt: null,
} as const;

const recoveryAuthorization = {
  formatVersion: 2,
  ownerBinding,
  vaultId: ids.vault,
  keyId: ids.recoveryKey,
  algorithm: "ED25519",
  publicKey: encodedBytes(32, 6),
  fingerprint: encodedBytes(32, 7),
  createdAt,
  revokedAt: null,
} as const;

const manifest = {
  formatVersion: 2,
  ownerBinding,
  vaultId: ids.vault,
  epoch: 1,
  revision: 1,
  devices: [device],
  recoveryAuthorization,
  createdAt,
  updatedAt: createdAt,
} as const;

const payloadHeader = {
  formatVersion: 2,
  ownerBinding,
  vaultId: ids.vault,
  vaultKeyId: ids.vaultKey,
  revision: 1,
  baseRevision: null,
  cipherSuite: "XCHACHA20_POLY1305",
  contentType: "application/vnd.umn-gopher-assistant.personal-vault+json",
  contentSchemaVersion: 1,
  padding: { algorithm: "SODIUM_PAD", blockSize: 4_096 },
  nonce: encodedBytes(24, 8),
  createdAt,
} as const;
const payload = {
  ...payloadHeader,
  ciphertext: encodedBytes(4_112, 9),
  aad: buildPayloadAadV2(payloadHeader),
} as const;

const author = {
  kind: "DEVICE",
  keyId: ids.authorizationKey,
  deviceId: ids.device,
} as const;
const commitBody = {
  formatVersion: 2,
  ownerBinding,
  vaultId: ids.vault,
  epoch: 1,
  sequence: 1,
  parentCommitHash: null,
  payloadHash: encodedBytes(32, 10),
  keyringHash: encodedBytes(32, 11),
  authorizationManifestHash: encodedBytes(32, 12),
  operationId: ids.operation,
  author,
  createdAt,
} as const;
const commit = {
  ...commitBody,
  stateMac: encodedBytes(32, 13),
  signature: encodedBytes(64, 14),
} as const;

const commandProofBody = {
  formatVersion: 2,
  commandType: "CREATE_VAULT",
  ownerBinding,
  vaultId: ids.vault,
  operationId: ids.operation,
  expectedParentCommitHash: null,
  nextCommitHash: encodedBytes(32, 15),
  signer: author,
  issuedAt: createdAt,
  expiresAt: "2026-07-23T00:05:00.000Z",
} as const;
const commandProof = {
  ...commandProofBody,
  signature: encodedBytes(64, 16),
} as const;

const readProofBody = {
  formatVersion: 2,
  ownerBinding,
  vaultId: ids.vault,
  signer: author,
  nonce: encodedBytes(32, 17),
  issuedAt: createdAt,
  expiresAt: "2026-07-23T00:02:00.000Z",
} as const;
const readProof = {
  ...readProofBody,
  signature: encodedBytes(64, 18),
} as const;
const pairingRequestBody = {
  formatVersion: 2,
  ownerBinding,
  vaultId: ids.vault,
  operationId: ids.operation,
  requestingDevice: device,
  pairingCodeCommitment: encodedBytes(32, 19),
  issuedAt: createdAt,
  expiresAt: "2026-07-23T00:15:00.000Z",
} as const;

describe("account-bound E2EE sync v2 contracts", () => {
  it("has fixed canonical vectors for every signature and MAC boundary", () => {
    expect({
      payload: buildPayloadAadV2(payloadHeader),
      commitSignature: buildVaultCommitSigningBytesV2(commitBody),
      commitMac: buildVaultCommitMacBytesV2(commitBody),
      command: buildVaultCommandProofBytesV2(commandProofBody),
      read: buildVaultReadProofBytesV2(readProofBody),
      pairing: buildDevicePairingRequestBytesV2(pairingRequestBody),
    }).toMatchInlineSnapshot(`
      {
        "command": "WyJVR0EyL1ZBVUxULUNPTU1BTkQvUFJPT0YiLDIsIkNSRUFURV9WQVVMVCIsIkFRRUJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUUiLCIwMThmYjlkOC0zZWM1LTdlOGItYTUxMi0zNWY4ZmY1MjMxMTAiLCIwMThmYjlkOC0zZWM1LTdlOGItYTUxMi0zNWY4ZmY1MjMxMTYiLG51bGwsIkR3OFBEdzhQRHc4UER3OFBEdzhQRHc4UER3OFBEdzhQRHc4UER3OFBEdzgiLCJERVZJQ0UiLCIwMThmYjlkOC0zZWM1LTdlOGItYTUxMi0zNWY4ZmY1MjMxMTQiLCIwMThmYjlkOC0zZWM1LTdlOGItYTUxMi0zNWY4ZmY1MjMxMTIiLCIyMDI2LTA3LTIzVDAwOjAwOjAwLjAwMFoiLCIyMDI2LTA3LTIzVDAwOjA1OjAwLjAwMFoiXQ",
        "commitMac": "WyJVR0EyL1ZBVUxULUNPTU1JVC9TVEFURS1NQUMiLDIsIkFRRUJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUUiLCIwMThmYjlkOC0zZWM1LTdlOGItYTUxMi0zNWY4ZmY1MjMxMTAiLDEsMSxudWxsLCJDZ29LQ2dvS0Nnb0tDZ29LQ2dvS0Nnb0tDZ29LQ2dvS0Nnb0tDZ29LQ2dvIiwiQ3dzTEN3c0xDd3NMQ3dzTEN3c0xDd3NMQ3dzTEN3c0xDd3NMQ3dzTEN3cyIsIkRBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXciLCIwMThmYjlkOC0zZWM1LTdlOGItYTUxMi0zNWY4ZmY1MjMxMTYiLCJERVZJQ0UiLCIwMThmYjlkOC0zZWM1LTdlOGItYTUxMi0zNWY4ZmY1MjMxMTQiLCIwMThmYjlkOC0zZWM1LTdlOGItYTUxMi0zNWY4ZmY1MjMxMTIiLCIyMDI2LTA3LTIzVDAwOjAwOjAwLjAwMFoiXQ",
        "commitSignature": "WyJVR0EyL1ZBVUxULUNPTU1JVC9TSUdOQVRVUkUiLDIsIkFRRUJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUUiLCIwMThmYjlkOC0zZWM1LTdlOGItYTUxMi0zNWY4ZmY1MjMxMTAiLDEsMSxudWxsLCJDZ29LQ2dvS0Nnb0tDZ29LQ2dvS0Nnb0tDZ29LQ2dvS0Nnb0tDZ29LQ2dvIiwiQ3dzTEN3c0xDd3NMQ3dzTEN3c0xDd3NMQ3dzTEN3c0xDd3NMQ3dzTEN3cyIsIkRBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXciLCIwMThmYjlkOC0zZWM1LTdlOGItYTUxMi0zNWY4ZmY1MjMxMTYiLCJERVZJQ0UiLCIwMThmYjlkOC0zZWM1LTdlOGItYTUxMi0zNWY4ZmY1MjMxMTQiLCIwMThmYjlkOC0zZWM1LTdlOGItYTUxMi0zNWY4ZmY1MjMxMTIiLCIyMDI2LTA3LTIzVDAwOjAwOjAwLjAwMFoiXQ",
        "pairing": "WyJVR0EyL0RFVklDRS1QQUlSSU5HL1JFUVVFU1QiLDIsIkFRRUJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUUiLCIwMThmYjlkOC0zZWM1LTdlOGItYTUxMi0zNWY4ZmY1MjMxMTAiLCIwMThmYjlkOC0zZWM1LTdlOGItYTUxMi0zNWY4ZmY1MjMxMTYiLCIwMThmYjlkOC0zZWM1LTdlOGItYTUxMi0zNWY4ZmY1MjMxMTIiLCIwMThmYjlkOC0zZWM1LTdlOGItYTUxMi0zNWY4ZmY1MjMxMTMiLCJBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJIiwiQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TURBd01EQXdNREF3TSIsIjAxOGZiOWQ4LTNlYzUtN2U4Yi1hNTEyLTM1ZjhmZjUyMzExNCIsIkJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUVCQVEiLCJCUVVGQlFVRkJRVUZCUVVGQlFVRkJRVUZCUVVGQlFVRkJRVUZCUVVGQlFVIiwiMjAyNi0wNy0yM1QwMDowMDowMC4wMDBaIiwiRXhNVEV4TVRFeE1URXhNVEV4TVRFeE1URXhNVEV4TVRFeE1URXhNVEV4TSIsIjIwMjYtMDctMjNUMDA6MDA6MDAuMDAwWiIsIjIwMjYtMDctMjNUMDA6MTU6MDAuMDAwWiJd",
        "payload": "WyJVR0EyL1BBWUxPQUQvQUFEIiwyLCJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUVCQVFFIiwiMDE4ZmI5ZDgtM2VjNS03ZThiLWE1MTItMzVmOGZmNTIzMTEwIiwiMDE4ZmI5ZDgtM2VjNS03ZThiLWE1MTItMzVmOGZmNTIzMTExIiwxLG51bGwsIlhDSEFDSEEyMF9QT0xZMTMwNSIsImFwcGxpY2F0aW9uL3ZuZC51bW4tZ29waGVyLWFzc2lzdGFudC5wZXJzb25hbC12YXVsdCtqc29uIiwxLCJTT0RJVU1fUEFEIiw0MDk2LCJDQWdJQ0FnSUNBZ0lDQWdJQ0FnSUNBZ0lDQWdJQ0FnSSIsIjIwMjYtMDctMjNUMDA6MDA6MDAuMDAwWiJd",
        "read": "WyJVR0EyL1ZBVUxULVJFQUQvUFJPT0YiLDIsIkFRRUJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUVCQVFFQkFRRUJBUUUiLCIwMThmYjlkOC0zZWM1LTdlOGItYTUxMi0zNWY4ZmY1MjMxMTAiLCJERVZJQ0UiLCIwMThmYjlkOC0zZWM1LTdlOGItYTUxMi0zNWY4ZmY1MjMxMTQiLCIwMThmYjlkOC0zZWM1LTdlOGItYTUxMi0zNWY4ZmY1MjMxMTIiLCJFUkVSRVJFUkVSRVJFUkVSRVJFUkVSRVJFUkVSRVJFUkVSRVJFUkVSRVJFIiwiMjAyNi0wNy0yM1QwMDowMDowMC4wMDBaIiwiMjAyNi0wNy0yM1QwMDowMjowMC4wMDBaIl0",
      }
    `);
  });

  it("requires both device keys and rejects unknown fields at every level", () => {
    expect(DeviceDescriptorV2Schema.safeParse(device).success).toBe(true);
    expect(
      DeviceDescriptorV2Schema.safeParse({
        ...device,
        authorizationKey: undefined,
      }).success,
    ).toBe(false);
    expect(
      DeviceDescriptorV2Schema.safeParse({
        ...device,
        encryptionKey: { ...device.encryptionKey, privateKey: encodedBytes(32, 19) },
      }).success,
    ).toBe(false);
    expect(DeviceDescriptorV2Schema.safeParse({ ...device, serverTrusted: true }).success).toBe(false);
  });

  it("binds owner identity and every payload metadata field into v2 AAD", () => {
    expect(EncryptedVaultPayloadEnvelopeV2Schema.safeParse(payload).success).toBe(true);
    expect(
      EncryptedVaultPayloadEnvelopeV2Schema.safeParse({
        ...payload,
        ownerBinding: encodedBytes(32, 20),
      }).success,
    ).toBe(false);
    expect(
      EncryptedVaultPayloadEnvelopeV2Schema.safeParse({
        ...payload,
        createdAt: "2026-07-23T00:00:01.000Z",
      }).success,
    ).toBe(false);
    expect(EncryptedVaultPayloadEnvelopeV2Schema.safeParse({ ...payload, ignored: true }).success).toBe(
      false,
    );
  });

  it("enforces a coherent authorization manifest and a linear commit genesis", () => {
    expect(AuthorizationManifestV2Schema.safeParse(manifest).success).toBe(true);
    expect(
      AuthorizationManifestV2Schema.safeParse({
        ...manifest,
        recoveryAuthorization: {
          ...recoveryAuthorization,
          ownerBinding: encodedBytes(32, 21),
        },
      }).success,
    ).toBe(false);
    expect(VaultCommitV2Schema.safeParse(commit).success).toBe(true);
    expect(
      VaultCommitV2Schema.safeParse({
        ...commit,
        sequence: 2,
      }).success,
    ).toBe(false);
    expect(
      VaultCommitV2Schema.safeParse({
        ...commit,
        parentCommitHash: encodedBytes(32, 22),
      }).success,
    ).toBe(false);
    expect(VaultCommitV2Schema.safeParse({ ...commit, unsignedMetadata: "ignored" }).success).toBe(false);
  });

  it("strictly validates command and read-proof lifetimes", () => {
    expect(VaultCommandProofV2Schema.safeParse(commandProof).success).toBe(true);
    expect(
      VaultCommandProofV2Schema.safeParse({
        ...commandProof,
        expiresAt: "2026-07-23T00:10:00.001Z",
      }).success,
    ).toBe(false);
    expect(VaultReadProofV2Schema.safeParse(readProof).success).toBe(true);
    expect(
      VaultReadProofV2Schema.safeParse({
        ...readProof,
        expiresAt: "2026-07-23T00:02:00.001Z",
      }).success,
    ).toBe(false);
  });

  it("round-trips only the one canonical browser-compatible read-proof header", () => {
    const encoded = encodeVaultReadProofHeaderV2(readProof);
    expect(decodeVaultReadProofHeaderV2(encoded)).toEqual(readProof);

    const reordered = {
      ownerBinding: readProof.ownerBinding,
      formatVersion: readProof.formatVersion,
      vaultId: readProof.vaultId,
      signer: readProof.signer,
      nonce: readProof.nonce,
      issuedAt: readProof.issuedAt,
      expiresAt: readProof.expiresAt,
      signature: readProof.signature,
    };
    const alternateEncoding = Buffer.from(JSON.stringify(reordered)).toString("base64url");
    expect(() => decodeVaultReadProofHeaderV2(alternateEncoding)).toThrow(
      "Invalid canonical vault read-proof header",
    );
    expect(() => decodeVaultReadProofHeaderV2(`${encoded}=`)).toThrow(
      "Invalid canonical vault read-proof header",
    );
  });
});
