import type {
  DeviceDescriptorV2,
  VaultPairDeviceCommandV2,
  VaultRotateKeyCommandV2,
  VaultSyncSnapshotV2,
} from "@umn-gopher-assistant/contracts";
import { describe, expect, it } from "vitest";

import {
  assertPairTransition,
  assertRotationTransition,
} from "../src/personal-vault/personal-vault.service.js";

const OWNER = Buffer.alloc(32, 1).toString("base64url");
const B64 = Buffer.alloc(32, 2).toString("base64url");
const NEXT_B64 = Buffer.alloc(32, 3).toString("base64url");
const CREATED_AT = "2026-07-23T00:00:00.000Z";
const REVOKED_AT = "2026-07-23T00:01:00.000Z";

function descriptor(seed: number): DeviceDescriptorV2 {
  return {
    formatVersion: 2,
    ownerBinding: OWNER,
    deviceId: `018fb9d8-3ec5-7e8b-a512-35f8ff5231${seed.toString().padStart(2, "0")}`,
    encryptionKey: {
      keyId: `018fb9d8-3ec5-7e8b-a512-35f8ff5232${seed.toString().padStart(2, "0")}`,
      algorithm: "X25519",
      publicKey: B64,
      fingerprint: B64,
    },
    authorizationKey: {
      keyId: `018fb9d8-3ec5-7e8b-a512-35f8ff5233${seed.toString().padStart(2, "0")}`,
      algorithm: "ED25519",
      publicKey: B64,
      fingerprint: B64,
    },
    createdAt: CREATED_AT,
    revokedAt: null,
  };
}

function currentSnapshot(...existing: readonly DeviceDescriptorV2[]): VaultSyncSnapshotV2 {
  const author = existing[0];
  if (author === undefined) throw new TypeError("At least one device is required");
  return {
    commit: {
      epoch: 1,
      sequence: 1,
      author: {
        kind: "DEVICE",
        deviceId: author.deviceId,
        keyId: author.authorizationKey.keyId,
      },
    } as VaultSyncSnapshotV2["commit"],
    payload: { revision: 1 } as VaultSyncSnapshotV2["payload"],
    keyring: {
      revision: 1,
      vaultKeyId: "018fb9d8-3ec5-7e8b-a512-35f8ff523410",
      deviceEnvelopes: existing.map((device) => ({
        recipientDeviceId: device.deviceId,
        recipientKeyId: device.encryptionKey.keyId,
        recipientPublicKeyFingerprint: device.encryptionKey.fingerprint,
      })),
    } as VaultSyncSnapshotV2["keyring"],
    authorizationManifest: {
      epoch: 1,
      revision: 1,
      devices: existing,
      recoveryAuthorization: {
        formatVersion: 2,
        ownerBinding: OWNER,
        vaultId: "018fb9d8-3ec5-7e8b-a512-35f8ff523400",
        keyId: "018fb9d8-3ec5-7e8b-a512-35f8ff523420",
        algorithm: "ED25519",
        publicKey: B64,
        fingerprint: B64,
        createdAt: CREATED_AT,
        revokedAt: null,
      },
    } as VaultSyncSnapshotV2["authorizationManifest"],
  } as VaultSyncSnapshotV2;
}

function recoveryRotation(
  current: VaultSyncSnapshotV2,
  replacement: DeviceDescriptorV2,
): VaultRotateKeyCommandV2 {
  const signer = {
    kind: "DEVICE" as const,
    deviceId: replacement.deviceId,
    keyId: replacement.authorizationKey.keyId,
  };
  return {
    reason: "RECOVERY_ROTATED",
    proof: { signer },
    nextSnapshot: {
      ...current,
      commit: { ...current.commit, epoch: 2, sequence: 2, author: signer },
      payload: { ...current.payload, revision: 2, baseRevision: 1 },
      keyring: {
        ...current.keyring,
        revision: 2,
        vaultKeyId: "018fb9d8-3ec5-7e8b-a512-35f8ff523411",
        deviceEnvelopes: [
          {
            recipientDeviceId: replacement.deviceId,
            recipientKeyId: replacement.encryptionKey.keyId,
            recipientPublicKeyFingerprint: replacement.encryptionKey.fingerprint,
          },
        ],
      },
      authorizationManifest: {
        ...current.authorizationManifest,
        epoch: 2,
        revision: 2,
        devices: current.authorizationManifest.devices.map((device) =>
          device.deviceId === replacement.deviceId || device.revokedAt !== null
            ? device
            : { ...device, revokedAt: REVOKED_AT },
        ),
        recoveryAuthorization: {
          ...current.authorizationManifest.recoveryAuthorization,
          keyId: "018fb9d8-3ec5-7e8b-a512-35f8ff523421",
          publicKey: NEXT_B64,
          fingerprint: NEXT_B64,
          createdAt: REVOKED_AT,
        },
      },
    },
  } as VaultRotateKeyCommandV2;
}

describe("vault manifest transition invariants", () => {
  it("allows only an exact append during pairing and rejects existing-key substitution", () => {
    const existing = descriptor(1);
    const paired = descriptor(2);
    const current = currentSnapshot(existing);
    const validNext = {
      ...current,
      commit: { ...current.commit, sequence: 2 },
      keyring: { ...current.keyring, revision: 2 },
      authorizationManifest: {
        ...current.authorizationManifest,
        revision: 2,
        devices: [existing, paired],
      },
    };
    const valid = {
      pairedDevice: paired,
      nextSnapshot: validNext,
    } as VaultPairDeviceCommandV2;
    expect(() => assertPairTransition(current, valid)).not.toThrow();

    const substituted = {
      ...existing,
      authorizationKey: {
        ...existing.authorizationKey,
        publicKey: Buffer.alloc(32, 9).toString("base64url"),
        fingerprint: Buffer.alloc(32, 9).toString("base64url"),
      },
    };
    expect(() =>
      assertPairTransition(current, {
        ...valid,
        nextSnapshot: {
          ...validNext,
          authorizationManifest: {
            ...validNext.authorizationManifest,
            devices: [substituted, paired],
          },
        },
      }),
    ).toThrow("without changing any existing descriptor");
  });

  it("keeps device identity fields stable across rotation and gates recovery replacement by reason", () => {
    const existing = descriptor(3);
    const current = currentSnapshot(existing);
    const valid = {
      reason: "SCHEDULED",
      nextSnapshot: {
        ...current,
        commit: { ...current.commit, epoch: 2, sequence: 2 },
        payload: { ...current.payload, revision: 2, baseRevision: 1 },
        keyring: {
          ...current.keyring,
          revision: 2,
          vaultKeyId: "018fb9d8-3ec5-7e8b-a512-35f8ff523411",
        },
        authorizationManifest: {
          ...current.authorizationManifest,
          epoch: 2,
          revision: 2,
        },
      },
    } as VaultRotateKeyCommandV2;
    expect(() => assertRotationTransition(current, valid)).not.toThrow();

    expect(() =>
      assertRotationTransition(current, {
        ...valid,
        nextSnapshot: {
          ...valid.nextSnapshot,
          authorizationManifest: {
            ...valid.nextSnapshot.authorizationManifest,
            devices: [
              {
                ...existing,
                encryptionKey: {
                  ...existing.encryptionKey,
                  publicKey: Buffer.alloc(32, 7).toString("base64url"),
                },
              },
            ],
          },
        },
      }),
    ).toThrow("existing device descriptors");

    expect(() =>
      assertRotationTransition(current, {
        ...valid,
        nextSnapshot: {
          ...valid.nextSnapshot,
          authorizationManifest: {
            ...valid.nextSnapshot.authorizationManifest,
            recoveryAuthorization: {
              ...valid.nextSnapshot.authorizationManifest.recoveryAuthorization,
              keyId: "018fb9d8-3ec5-7e8b-a512-35f8ff523421",
            },
          },
        },
      }),
    ).toThrow("Only RECOVERY_ROTATED");
  });

  it("accepts only replacement-device-exclusive recovery hardening", () => {
    const replacement = descriptor(4);
    const oldDevice = descriptor(5);
    const current = currentSnapshot(replacement, oldDevice);
    const valid = recoveryRotation(current, replacement);
    const validEnvelope = valid.nextSnapshot.keyring.deviceEnvelopes[0];
    if (validEnvelope === undefined) throw new TypeError("Recovery rotation needs one envelope");

    expect(() => assertRotationTransition(current, valid)).not.toThrow();

    expect(() =>
      assertRotationTransition(current, {
        ...valid,
        nextSnapshot: {
          ...valid.nextSnapshot,
          authorizationManifest: {
            ...valid.nextSnapshot.authorizationManifest,
            devices: current.authorizationManifest.devices,
          },
        },
      }),
    ).toThrow("revoke every prior active device except the replacement");

    expect(() =>
      assertRotationTransition(current, {
        ...valid,
        nextSnapshot: {
          ...valid.nextSnapshot,
          keyring: {
            ...valid.nextSnapshot.keyring,
            deviceEnvelopes: [
              {
                ...validEnvelope,
                recipientDeviceId: oldDevice.deviceId,
                recipientKeyId: oldDevice.encryptionKey.keyId,
                recipientPublicKeyFingerprint: oldDevice.encryptionKey.fingerprint,
              },
            ],
          },
        },
      }),
    ).toThrow("only the replacement device recipient");

    expect(() =>
      assertRotationTransition(current, {
        ...valid,
        nextSnapshot: {
          ...valid.nextSnapshot,
          authorizationManifest: {
            ...valid.nextSnapshot.authorizationManifest,
            recoveryAuthorization: {
              ...current.authorizationManifest.recoveryAuthorization,
              keyId: valid.nextSnapshot.authorizationManifest.recoveryAuthorization.keyId,
            },
          },
        },
      }),
    ).toThrow("genuinely new recovery authorization key");
  });
});
