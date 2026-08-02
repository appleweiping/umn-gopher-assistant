import { randomBytes, randomUUID } from "node:crypto";

import {
  AuthorizationManifestV2Schema,
  DevicePairingRequestV2Schema,
  PairingApprovalRequestV2Schema,
  VaultCreateCommandV2Schema,
  VaultRotateKeyCommandV2Schema,
  VaultSyncSnapshotV2Schema,
  VaultUpdatePayloadCommandV2Schema,
  type DeviceDescriptorV2,
  type DevicePublicKeyV1,
  type VaultSyncSnapshotV2,
} from "@umn-gopher-assistant/contracts";
import {
  createVaultCrypto,
  type AuthorizationKeyHandle,
  type DeviceKeyHandle,
  type VaultCrypto,
  type VaultKeyHandle,
} from "@umn-gopher-assistant/crypto";
import { describe, expect, it, vi } from "vitest";

import type { AccountResolver } from "../src/accounts/account.types.js";
import type { AuthPrincipal } from "../src/auth/auth.types.js";
import { InMemoryPersonalVaultRepository } from "../src/personal-vault/in-memory-personal-vault.repository.js";
import {
  PersonalVaultService,
  assertGenesisTransition,
} from "../src/personal-vault/personal-vault.service.js";
import type { ReadProofReplayGuard } from "../src/personal-vault/read-proof-replay.guard.js";
import { assertPairingRequest } from "../src/personal-vault/vault-integrity.js";

const RECOVERY_CODE = "UGA1-000G-40R4-0M30-E209-185G-R38E-1W81-24GK";
const OWNER_BINDING = Buffer.alloc(32, 21).toString("base64url");
const ACCOUNT_ID = "018fb9d8-3ec5-7e8b-a512-35f8ff523500";
const principal: AuthPrincipal = {
  clientId: "gopher-web",
  issuer: "https://identity.example.edu/realms/gopher",
  scopes: ["personal:read", "personal:write"],
  subject: "durable-replay-student",
};

interface Fixture {
  readonly authorization: AuthorizationKeyHandle;
  readonly command: ReturnType<typeof VaultCreateCommandV2Schema.parse>;
  readonly crypto: VaultCrypto;
  readonly device: DeviceKeyHandle;
  readonly vault: VaultKeyHandle;
}

function expiry(issuedAt: string, minutes = 5): string {
  return new Date(Date.parse(issuedAt) + minutes * 60_000).toISOString();
}

function flipSignature(signature: string): string {
  return `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
}

function recipient(device: DeviceDescriptorV2): DevicePublicKeyV1 {
  return {
    formatVersion: 1,
    deviceId: device.deviceId,
    deviceKeyId: device.encryptionKey.keyId,
    keyAlgorithm: "X25519",
    publicKey: device.encryptionKey.publicKey,
    publicKeyFingerprint: device.encryptionKey.fingerprint,
    createdAt: device.createdAt,
    revokedAt: device.revokedAt,
  };
}

async function afterProofExpiration<T>(expiresAt: string, action: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(Date.parse(expiresAt) + 1_000));
  try {
    return await action();
  } finally {
    vi.useRealTimers();
  }
}

async function genesisFixture(): Promise<Fixture> {
  const crypto = await createVaultCrypto();
  const vaultId = randomUUID();
  const vault = crypto.generateVaultKey({ vaultId });
  const device = crypto.generateDeviceKey({
    deviceId: randomUUID(),
    deviceKeyId: randomUUID(),
  });
  const authorization = crypto.generateAuthorizationKey({
    ownerBinding: OWNER_BINDING,
    deviceId: device.publicKey.deviceId,
    keyId: randomUUID(),
  });
  const descriptor = crypto.createDeviceDescriptorV2({
    ownerBinding: OWNER_BINDING,
    encryptionKey: device,
    authorizationKey: authorization,
  });
  const recovery = crypto.deriveRecoveryAuthorizationKey({
    recoveryCode: RECOVERY_CODE,
    ownerBinding: OWNER_BINDING,
    vaultId,
    keyId: randomUUID(),
  });
  const keyring = crypto.createKeyring({
    key: vault,
    recoveryCode: RECOVERY_CODE,
    recipients: [device.publicKey],
    revision: 1,
  }).keyring;
  const payload = crypto.encryptPayloadV2({
    key: vault,
    ownerBinding: OWNER_BINDING,
    plaintext: new TextEncoder().encode('{"tasks":[]}'),
    revision: 1,
    baseRevision: null,
  });
  const manifest = AuthorizationManifestV2Schema.parse({
    formatVersion: 2,
    ownerBinding: OWNER_BINDING,
    vaultId,
    epoch: 1,
    revision: 1,
    devices: [descriptor],
    recoveryAuthorization: crypto.createRecoveryAuthorizationPublicKeyV2({
      authorizationKey: recovery,
    }),
    createdAt: descriptor.createdAt,
    updatedAt: new Date().toISOString(),
  });
  const operationId = randomUUID();
  const commit = crypto.signVaultCommit({
    authorizationKey: authorization,
    vaultKey: vault,
    commit: {
      formatVersion: 2,
      ownerBinding: OWNER_BINDING,
      vaultId,
      epoch: 1,
      sequence: 1,
      parentCommitHash: null,
      payloadHash: crypto.hashVaultPayloadV2(payload),
      keyringHash: crypto.hashVaultKeyringV1(keyring),
      authorizationManifestHash: crypto.hashAuthorizationManifestV2(manifest),
      operationId,
      author: {
        kind: "DEVICE",
        keyId: authorization.keyId,
        deviceId: authorization.deviceId,
      },
      createdAt: new Date().toISOString(),
    },
  });
  const snapshot = VaultSyncSnapshotV2Schema.parse({
    formatVersion: 2,
    ownerBinding: OWNER_BINDING,
    vaultId,
    commitHash: crypto.computeVaultCommitHash(commit),
    commit,
    payload,
    keyring,
    authorizationManifest: manifest,
  });
  const issuedAt = new Date().toISOString();
  const proof = crypto.signVaultCommandProof({
    authorizationKey: authorization,
    proof: {
      formatVersion: 2,
      commandType: "CREATE_VAULT",
      ownerBinding: OWNER_BINDING,
      vaultId,
      operationId,
      expectedParentCommitHash: null,
      nextCommitHash: snapshot.commitHash,
      signer: commit.author,
      issuedAt,
      expiresAt: expiry(issuedAt),
    },
  });
  recovery.destroy();
  return {
    authorization,
    command: VaultCreateCommandV2Schema.parse({
      formatVersion: 2,
      commandType: "CREATE_VAULT",
      ownerBinding: OWNER_BINDING,
      vaultId,
      operationId,
      proof,
      snapshot,
    }),
    crypto,
    device,
    vault,
  };
}

function payloadUpdate(
  fixture: Fixture,
  current: VaultSyncSnapshotV2,
): ReturnType<typeof VaultUpdatePayloadCommandV2Schema.parse> {
  const operationId = randomUUID();
  const payload = fixture.crypto.encryptPayloadV2({
    key: fixture.vault,
    ownerBinding: OWNER_BINDING,
    plaintext: new TextEncoder().encode('{"tasks":[{"id":"durable"}]}'),
    revision: current.payload.revision + 1,
    baseRevision: current.payload.revision,
  });
  const commit = fixture.crypto.signVaultCommit({
    authorizationKey: fixture.authorization,
    vaultKey: fixture.vault,
    commit: {
      formatVersion: 2,
      ownerBinding: current.ownerBinding,
      vaultId: current.vaultId,
      epoch: current.commit.epoch,
      sequence: current.commit.sequence + 1,
      parentCommitHash: current.commitHash,
      payloadHash: fixture.crypto.hashVaultPayloadV2(payload),
      keyringHash: current.commit.keyringHash,
      authorizationManifestHash: current.commit.authorizationManifestHash,
      operationId,
      author: current.commit.author,
      createdAt: new Date().toISOString(),
    },
  });
  const nextSnapshot = VaultSyncSnapshotV2Schema.parse({
    ...current,
    commitHash: fixture.crypto.computeVaultCommitHash(commit),
    commit,
    payload,
  });
  const issuedAt = new Date().toISOString();
  return VaultUpdatePayloadCommandV2Schema.parse({
    formatVersion: 2,
    commandType: "UPDATE_PAYLOAD",
    ownerBinding: OWNER_BINDING,
    vaultId: current.vaultId,
    operationId,
    expectedParentCommitHash: current.commitHash,
    nextSnapshot,
    proof: fixture.crypto.signVaultCommandProof({
      authorizationKey: fixture.authorization,
      proof: {
        formatVersion: 2,
        commandType: "UPDATE_PAYLOAD",
        ownerBinding: OWNER_BINDING,
        vaultId: current.vaultId,
        operationId,
        expectedParentCommitHash: current.commitHash,
        nextCommitHash: nextSnapshot.commitHash,
        signer: commit.author,
        issuedAt,
        expiresAt: expiry(issuedAt),
      },
    }),
  });
}

function pairingApproval(
  fixture: Fixture,
  current: VaultSyncSnapshotV2,
  pairedDevice: DeviceDescriptorV2,
  pairingCodeCommitment: string,
): ReturnType<typeof PairingApprovalRequestV2Schema.parse> {
  const wrapped = fixture.crypto.wrapVaultKeyForDevice({
    key: fixture.vault,
    recipient: recipient(pairedDevice),
  });
  const timestamp = new Date().toISOString();
  const keyring = {
    ...current.keyring,
    revision: current.keyring.revision + 1,
    devicePublicKeys: [...(current.keyring.devicePublicKeys ?? []), recipient(pairedDevice)],
    deviceEnvelopes: [...current.keyring.deviceEnvelopes, wrapped],
    updatedAt: timestamp,
  };
  const manifest = AuthorizationManifestV2Schema.parse({
    ...current.authorizationManifest,
    revision: current.authorizationManifest.revision + 1,
    devices: [...current.authorizationManifest.devices, pairedDevice],
    updatedAt: timestamp,
  });
  const operationId = randomUUID();
  const commit = fixture.crypto.signVaultCommit({
    authorizationKey: fixture.authorization,
    vaultKey: fixture.vault,
    commit: {
      formatVersion: 2,
      ownerBinding: current.ownerBinding,
      vaultId: current.vaultId,
      epoch: current.commit.epoch,
      sequence: current.commit.sequence + 1,
      parentCommitHash: current.commitHash,
      payloadHash: current.commit.payloadHash,
      keyringHash: fixture.crypto.hashVaultKeyringV1(keyring),
      authorizationManifestHash: fixture.crypto.hashAuthorizationManifestV2(manifest),
      operationId,
      author: current.commit.author,
      createdAt: new Date().toISOString(),
    },
  });
  const nextSnapshot = VaultSyncSnapshotV2Schema.parse({
    ...current,
    commitHash: fixture.crypto.computeVaultCommitHash(commit),
    commit,
    keyring,
    authorizationManifest: manifest,
  });
  const issuedAt = new Date().toISOString();
  return PairingApprovalRequestV2Schema.parse({
    pairingCodeCommitment,
    command: {
      formatVersion: 2,
      commandType: "PAIR_DEVICE",
      ownerBinding: OWNER_BINDING,
      vaultId: current.vaultId,
      operationId,
      expectedParentCommitHash: current.commitHash,
      pairedDevice,
      nextSnapshot,
      proof: fixture.crypto.signVaultCommandProof({
        authorizationKey: fixture.authorization,
        proof: {
          formatVersion: 2,
          commandType: "PAIR_DEVICE",
          ownerBinding: OWNER_BINDING,
          vaultId: current.vaultId,
          operationId,
          expectedParentCommitHash: current.commitHash,
          nextCommitHash: nextSnapshot.commitHash,
          signer: commit.author,
          issuedAt,
          expiresAt: expiry(issuedAt),
        },
      }),
    },
  });
}

function rotation(
  fixture: Fixture,
  current: VaultSyncSnapshotV2,
): {
  readonly command: ReturnType<typeof VaultRotateKeyCommandV2Schema.parse>;
  readonly nextKey: VaultKeyHandle;
} {
  const recipients = current.authorizationManifest.devices.map((device) => recipient(device));
  const rotated = fixture.crypto.rotateKeyring({
    previousKey: fixture.vault,
    previousKeyring: current.keyring,
    recoveryCode: RECOVERY_CODE,
    recipients,
  });
  const plaintext = fixture.crypto.decryptPayloadV2({
    key: fixture.vault,
    envelope: current.payload,
  });
  let payload;
  try {
    payload = fixture.crypto.encryptPayloadV2({
      key: rotated.key,
      ownerBinding: OWNER_BINDING,
      plaintext,
      revision: current.payload.revision + 1,
      baseRevision: current.payload.revision,
    });
  } finally {
    plaintext.fill(0);
  }
  const manifest = AuthorizationManifestV2Schema.parse({
    ...current.authorizationManifest,
    epoch: current.authorizationManifest.epoch + 1,
    revision: current.authorizationManifest.revision + 1,
    updatedAt: new Date().toISOString(),
  });
  const operationId = randomUUID();
  const commit = fixture.crypto.signVaultCommit({
    authorizationKey: fixture.authorization,
    vaultKey: rotated.key,
    commit: {
      formatVersion: 2,
      ownerBinding: current.ownerBinding,
      vaultId: current.vaultId,
      epoch: current.commit.epoch + 1,
      sequence: current.commit.sequence + 1,
      parentCommitHash: current.commitHash,
      payloadHash: fixture.crypto.hashVaultPayloadV2(payload),
      keyringHash: fixture.crypto.hashVaultKeyringV1(rotated.keyring),
      authorizationManifestHash: fixture.crypto.hashAuthorizationManifestV2(manifest),
      operationId,
      author: current.commit.author,
      createdAt: new Date().toISOString(),
    },
  });
  const nextSnapshot = VaultSyncSnapshotV2Schema.parse({
    ...current,
    commitHash: fixture.crypto.computeVaultCommitHash(commit),
    commit,
    payload,
    keyring: rotated.keyring,
    authorizationManifest: manifest,
  });
  const issuedAt = new Date().toISOString();
  return {
    command: VaultRotateKeyCommandV2Schema.parse({
      formatVersion: 2,
      commandType: "ROTATE_KEY",
      ownerBinding: OWNER_BINDING,
      vaultId: current.vaultId,
      operationId,
      expectedParentCommitHash: current.commitHash,
      reason: "SCHEDULED",
      nextSnapshot,
      proof: fixture.crypto.signVaultCommandProof({
        authorizationKey: fixture.authorization,
        proof: {
          formatVersion: 2,
          commandType: "ROTATE_KEY",
          ownerBinding: OWNER_BINDING,
          vaultId: current.vaultId,
          operationId,
          expectedParentCommitHash: current.commitHash,
          nextCommitHash: nextSnapshot.commitHash,
          signer: commit.author,
          issuedAt,
          expiresAt: expiry(issuedAt),
        },
      }),
    }),
    nextKey: rotated.key,
  };
}

function expectConflict(action: Promise<unknown>): Promise<void> {
  return expect(action).rejects.toMatchObject({
    status: 409,
    response: { failureCode: "IDEMPOTENCY_CONFLICT" },
  });
}

describe("durable personal-vault command replay", () => {
  it("fails closed when stable account binding and stored vault binding diverge", async () => {
    const fixture = await genesisFixture();
    const repository = new InMemoryPersonalVaultRepository();
    const creator = new PersonalVaultService(
      {
        resolve: () => Promise.resolve({ accountId: ACCOUNT_ID, ownerBinding: OWNER_BINDING }),
      },
      repository,
      {} as ReadProofReplayGuard,
    );
    const mismatchedBinding = Buffer.alloc(32, 99).toString("base64url");
    const mismatched = new PersonalVaultService(
      {
        resolve: () => Promise.resolve({ accountId: ACCOUNT_ID, ownerBinding: mismatchedBinding }),
      },
      repository,
      {} as ReadProofReplayGuard,
    );
    try {
      const created = await creator.create(principal, fixture.command, "*", fixture.command.operationId);
      await expect(mismatched.listPairings(principal)).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        mismatched.cancelPairing(principal, randomUUID(), created.etag, randomUUID()),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      fixture.authorization.destroy();
      fixture.device.destroy();
      fixture.vault.destroy();
    }
  });

  it("rejects a signed pending-device request whose descriptor postdates its proof", async () => {
    const crypto = await createVaultCrypto();
    const device = crypto.generateDeviceKey({
      deviceId: randomUUID(),
      deviceKeyId: randomUUID(),
    });
    const authorization = crypto.generateAuthorizationKey({
      ownerBinding: OWNER_BINDING,
      deviceId: device.publicKey.deviceId,
      keyId: randomUUID(),
    });
    try {
      const issuedAt = new Date();
      const descriptor = {
        ...crypto.createDeviceDescriptorV2({
          ownerBinding: OWNER_BINDING,
          encryptionKey: device,
          authorizationKey: authorization,
        }),
        createdAt: new Date(issuedAt.getTime() + 60_000).toISOString(),
      };
      const request = crypto.signDevicePairingRequest({
        authorizationKey: authorization,
        request: {
          formatVersion: 2,
          ownerBinding: OWNER_BINDING,
          vaultId: randomUUID(),
          operationId: randomUUID(),
          requestingDevice: descriptor,
          pairingCodeCommitment: Buffer.alloc(32, 7).toString("base64url"),
          issuedAt: issuedAt.toISOString(),
          expiresAt: new Date(issuedAt.getTime() + 5 * 60_000).toISOString(),
        },
      });
      await expect(assertPairingRequest(request, issuedAt)).rejects.toMatchObject({
        code: "AUTHORIZATION_FAILED",
      });

      const validDescriptor = crypto.createDeviceDescriptorV2({
        ownerBinding: OWNER_BINDING,
        encryptionKey: device,
        authorizationKey: authorization,
      });
      const validIssuedAt = new Date(Date.parse(validDescriptor.createdAt) + 1_000);
      const validExpiresAt = new Date(validIssuedAt.getTime() + 5 * 60_000);
      const expiringRequest = crypto.signDevicePairingRequest({
        authorizationKey: authorization,
        request: {
          formatVersion: 2,
          ownerBinding: OWNER_BINDING,
          vaultId: randomUUID(),
          operationId: randomUUID(),
          requestingDevice: validDescriptor,
          pairingCodeCommitment: Buffer.alloc(32, 8).toString("base64url"),
          issuedAt: validIssuedAt.toISOString(),
          expiresAt: validExpiresAt.toISOString(),
        },
      });
      await expect(assertPairingRequest(expiringRequest, validExpiresAt)).rejects.toMatchObject({
        code: "EXPIRED_PROOF",
      });
    } finally {
      authorization.destroy();
      device.destroy();
    }
  });

  it("bounds concurrent pending pairings while allowing expired slots to be reused", async () => {
    const fixture = await genesisFixture();
    const repository = new InMemoryPersonalVaultRepository();
    const created = await repository.createVault({
      accountId: ACCOUNT_ID,
      command: fixture.command,
      idempotencyKey: fixture.command.operationId,
      requestHash: randomBytes(32).toString("hex"),
    });
    const devices = fixture.command.snapshot.authorizationManifest.devices;
    const baseDevice = devices[0];
    if (baseDevice === undefined) throw new Error("Genesis fixture has no device");
    const clock = Date.now();
    const makeRequest = (expiresAt: string) =>
      DevicePairingRequestV2Schema.parse({
        formatVersion: 2,
        ownerBinding: OWNER_BINDING,
        vaultId: fixture.command.vaultId,
        operationId: randomUUID(),
        requestingDevice: {
          ...baseDevice,
          deviceId: randomUUID(),
          encryptionKey: { ...baseDevice.encryptionKey, keyId: randomUUID() },
          authorizationKey: {
            ...baseDevice.authorizationKey,
            keyId: randomUUID(),
          },
        },
        pairingCodeCommitment: randomBytes(32).toString("base64url"),
        issuedAt: new Date(clock).toISOString(),
        expiresAt,
        signature: fixture.command.proof.signature,
      });
    vi.useFakeTimers();
    vi.setSystemTime(clock);
    try {
      const expiryTime = new Date(clock + 60_000).toISOString();
      for (let index = 0; index < 8; index += 1) {
        const request = makeRequest(expiryTime);
        await repository.createPairing({
          accountId: ACCOUNT_ID,
          expectedEtag: created.etag,
          idempotencyKey: request.operationId,
          request,
          requestHash: randomBytes(32).toString("hex"),
        });
      }
      const blocked = makeRequest(expiryTime);
      await expect(
        repository.createPairing({
          accountId: ACCOUNT_ID,
          expectedEtag: created.etag,
          idempotencyKey: blocked.operationId,
          request: blocked,
          requestHash: randomBytes(32).toString("hex"),
        }),
      ).rejects.toMatchObject({ code: "PAIRING_CONFLICT" });

      vi.setSystemTime(clock + 60_001);
      const replacement = makeRequest(new Date(clock + 120_000).toISOString());
      await expect(
        repository.createPairing({
          accountId: ACCOUNT_ID,
          expectedEtag: created.etag,
          idempotencyKey: replacement.operationId,
          request: replacement,
          requestHash: randomBytes(32).toString("hex"),
        }),
      ).resolves.toMatchObject({ replayed: false });
    } finally {
      vi.useRealTimers();
      fixture.authorization.destroy();
      fixture.device.destroy();
      fixture.vault.destroy();
    }
  });

  it("rejects an expired, never-applied rotation with 403 before repository preconditions", async () => {
    const fixture = await genesisFixture();
    const service = new PersonalVaultService(
      {
        resolve: () => Promise.resolve({ accountId: ACCOUNT_ID, ownerBinding: OWNER_BINDING }),
      },
      new InMemoryPersonalVaultRepository(),
      {} as ReadProofReplayGuard,
    );
    let nextKey: VaultKeyHandle | undefined;
    try {
      const created = await service.create(principal, fixture.command, "*", fixture.command.operationId);
      const rotated = rotation(fixture, created.snapshot);
      nextKey = rotated.nextKey;

      await expect(
        afterProofExpiration(rotated.command.proof.expiresAt, () =>
          service.rotate(principal, rotated.command, created.etag, rotated.command.operationId),
        ),
      ).rejects.toMatchObject({
        status: 403,
        response: { failureCode: "VAULT_PROOF_EXPIRED" },
      });
    } finally {
      nextKey?.destroy();
      fixture.authorization.destroy();
      fixture.device.destroy();
      fixture.vault.destroy();
    }
  });

  it("replays exact expired create, update, pairing, approval, and rotation requests", async () => {
    const fixture = await genesisFixture();
    const pendingDevice = fixture.crypto.generateDeviceKey({
      deviceId: randomUUID(),
      deviceKeyId: randomUUID(),
    });
    const pendingAuthorization = fixture.crypto.generateAuthorizationKey({
      ownerBinding: OWNER_BINDING,
      deviceId: pendingDevice.publicKey.deviceId,
      keyId: randomUUID(),
    });
    const accountResolver: AccountResolver = {
      resolve: () => Promise.resolve({ accountId: ACCOUNT_ID, ownerBinding: OWNER_BINDING }),
    };
    const service = new PersonalVaultService(
      accountResolver,
      new InMemoryPersonalVaultRepository(),
      {} as ReadProofReplayGuard,
    );
    let nextKey: VaultKeyHandle | undefined;
    try {
      const created = await service.create(principal, fixture.command, "*", fixture.command.operationId);
      expect(created.replayed).toBe(false);
      expect(
        (
          await afterProofExpiration(fixture.command.proof.expiresAt, () =>
            service.create(principal, fixture.command, "*", fixture.command.operationId),
          )
        ).replayed,
      ).toBe(true);
      await expectConflict(
        service.create(
          principal,
          {
            ...fixture.command,
            proof: {
              ...fixture.command.proof,
              signature: flipSignature(fixture.command.proof.signature),
            },
          },
          "*",
          fixture.command.operationId,
        ),
      );

      const update = payloadUpdate(fixture, created.snapshot);
      const updated = await service.updatePayload(principal, update, created.etag, update.operationId);
      expect(
        (
          await afterProofExpiration(update.proof.expiresAt, () =>
            service.updatePayload(principal, update, created.etag, update.operationId),
          )
        ).replayed,
      ).toBe(true);
      await expectConflict(
        service.updatePayload(
          principal,
          {
            ...update,
            proof: {
              ...update.proof,
              signature: flipSignature(update.proof.signature),
            },
          },
          created.etag,
          update.operationId,
        ),
      );

      const pairedDevice = fixture.crypto.createDeviceDescriptorV2({
        ownerBinding: OWNER_BINDING,
        encryptionKey: pendingDevice,
        authorizationKey: pendingAuthorization,
      });
      const issuedAt = new Date().toISOString();
      const pairingCodeCommitment = randomBytes(32).toString("base64url");
      const pairingRequest = DevicePairingRequestV2Schema.parse(
        fixture.crypto.signDevicePairingRequest({
          authorizationKey: pendingAuthorization,
          request: {
            formatVersion: 2,
            ownerBinding: OWNER_BINDING,
            vaultId: updated.snapshot.vaultId,
            operationId: randomUUID(),
            requestingDevice: pairedDevice,
            pairingCodeCommitment,
            issuedAt,
            expiresAt: expiry(issuedAt, 15),
          },
        }),
      );
      const pairing = await service.createPairing(
        principal,
        pairingRequest,
        updated.etag,
        pairingRequest.operationId,
      );
      expect(
        (
          await afterProofExpiration(pairingRequest.expiresAt, () =>
            service.createPairing(principal, pairingRequest, updated.etag, pairingRequest.operationId),
          )
        ).replayed,
      ).toBe(true);
      await expectConflict(
        service.createPairing(
          principal,
          {
            ...pairingRequest,
            signature: flipSignature(pairingRequest.signature),
          },
          updated.etag,
          pairingRequest.operationId,
        ),
      );

      const approval = pairingApproval(fixture, updated.snapshot, pairedDevice, pairingCodeCommitment);
      const approved = await service.approvePairing(
        principal,
        pairing.pairing.id,
        approval,
        pairing.etag,
        approval.command.operationId,
      );
      expect(
        (
          await afterProofExpiration(approval.command.proof.expiresAt, () =>
            service.approvePairing(
              principal,
              pairing.pairing.id,
              approval,
              pairing.etag,
              approval.command.operationId,
            ),
          )
        ).replayed,
      ).toBe(true);
      await expectConflict(
        service.approvePairing(principal, randomUUID(), approval, pairing.etag, approval.command.operationId),
      );

      const rotated = rotation(fixture, approved.snapshot);
      nextKey = rotated.nextKey;
      const rotationResult = await service.rotate(
        principal,
        rotated.command,
        approved.etag,
        rotated.command.operationId,
      );
      expect(rotationResult.replayed).toBe(false);
      expect(
        (
          await afterProofExpiration(rotated.command.proof.expiresAt, () =>
            service.rotate(principal, rotated.command, approved.etag, rotated.command.operationId),
          )
        ).replayed,
      ).toBe(true);
      await expectConflict(
        service.rotate(
          principal,
          {
            ...rotated.command,
            proof: {
              ...rotated.command.proof,
              signature: flipSignature(rotated.command.proof.signature),
            },
          },
          approved.etag,
          rotated.command.operationId,
        ),
      );
    } finally {
      nextKey?.destroy();
      pendingAuthorization.destroy();
      pendingDevice.destroy();
      fixture.authorization.destroy();
      fixture.device.destroy();
      fixture.vault.destroy();
    }
  }, 60_000);

  it("fails closed on non-genesis keyring revisions and inconsistent timestamps", async () => {
    const fixture = await genesisFixture();
    try {
      expect(() =>
        assertGenesisTransition({
          ...fixture.command,
          snapshot: {
            ...fixture.command.snapshot,
            keyring: { ...fixture.command.snapshot.keyring, revision: 2 },
          },
        }),
      ).toThrow("revision one");
      expect(() =>
        assertGenesisTransition({
          ...fixture.command,
          snapshot: {
            ...fixture.command.snapshot,
            keyring: {
              ...fixture.command.snapshot.keyring,
              updatedAt: new Date(
                Date.parse(fixture.command.snapshot.commit.createdAt) + 60_000,
              ).toISOString(),
            },
          },
        }),
      ).toThrow("timestamps");
    } finally {
      fixture.authorization.destroy();
      fixture.device.destroy();
      fixture.vault.destroy();
    }
  });
});
