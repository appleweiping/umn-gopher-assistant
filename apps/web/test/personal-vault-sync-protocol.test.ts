// @vitest-environment node

import { decodeVaultReadProofHeaderV2 } from "@umn-gopher-assistant/contracts";
import {
  createVaultCrypto,
  type AuthorizationKeyHandle,
  type VaultKeyHandle,
} from "@umn-gopher-assistant/crypto";
import { describe, expect, it } from "vitest";

import {
  createVaultGenesisCommand,
  createVaultPairDeviceCommand,
  createVaultPayloadUpdateCommand,
  createVaultRecoveryRotationCommand,
  createVaultReadProofHeader,
  generatePairingCode,
  hashPairingCode,
  mergeTaskDocuments,
  renewVaultSyncCommandProof,
  renewVaultRecoveryRotationCommandProof,
  verifyAppliedRecoveryRotationReadBack,
  verifyLocalRecoveryCodeForAccountSync,
  VaultSyncProtocolError,
  verifyAndDecryptRemoteSnapshot,
} from "../lib/personal-vault/sync-protocol";
import { createTaskDocument } from "../lib/personal-vault/protocol";
import {
  classifyVerifiedPendingUpdateHead,
  isDurableOrdinarySyncRecoveryStatus,
  mayRenewOrdinarySyncProof,
} from "../lib/personal-vault/ordinary-sync-retry";

const OWNER = "ERERERERERERERERERERERERERERERERERERERERERE";
const VAULT_ID = "10000000-0000-4000-8000-000000000001";
const DEVICE_ID = "20000000-0000-4000-8000-000000000002";
const AUTH_KEY_ID = "30000000-0000-4000-8000-000000000003";
const RECOVERY_AUTH_KEY_ID = "40000000-0000-4000-8000-000000000004";

function clock(uuid: string, timestamp: number) {
  return {
    now: () => new Date(timestamp),
    randomBytes: (size: number) => new Uint8Array(size).fill(37),
    randomUuid: () => uuid,
  };
}

function expectAuditableOrder(
  snapshot: {
    readonly commit: { readonly createdAt: string };
    readonly payload: { readonly createdAt: string };
    readonly keyring: { readonly updatedAt: string };
    readonly authorizationManifest: { readonly updatedAt: string };
  },
  proof: { readonly issuedAt: string },
) {
  const committedAt = Date.parse(snapshot.commit.createdAt);
  expect(committedAt).toBeGreaterThanOrEqual(Date.parse(snapshot.payload.createdAt));
  expect(committedAt).toBeGreaterThanOrEqual(Date.parse(snapshot.keyring.updatedAt));
  expect(committedAt).toBeGreaterThanOrEqual(Date.parse(snapshot.authorizationManifest.updatedAt));
  expect(Date.parse(proof.issuedAt)).toBeGreaterThanOrEqual(committedAt);
}

describe("account-bound personal-vault synchronization protocol", () => {
  it("builds, signs, verifies, decrypts, and advances a private commit without exposing plaintext", async () => {
    const crypto = await createVaultCrypto();
    const deviceKey = crypto.generateDeviceKey({ deviceId: DEVICE_ID });
    const authorizationKey = crypto.generateAuthorizationKey({
      ownerBinding: OWNER,
      deviceId: DEVICE_ID,
      keyId: AUTH_KEY_ID,
    });
    const vaultKey = crypto.generateVaultKey({ vaultId: VAULT_ID });
    const keyringResult = crypto.createKeyring({
      key: vaultKey,
      revision: 1,
      recipients: [deviceKey.publicKey],
    });
    const recoveryAuthorizationKey = crypto.deriveRecoveryAuthorizationKey({
      recoveryCode: keyringResult.recoveryCode,
      ownerBinding: OWNER,
      vaultId: VAULT_ID,
      keyId: RECOVERY_AUTH_KEY_ID,
    });
    const pairedDeviceKey = crypto.generateDeviceKey({
      deviceId: "80000000-0000-4000-8000-000000000008",
    });
    const pairedAuthorizationKey = crypto.generateAuthorizationKey({
      ownerBinding: OWNER,
      deviceId: pairedDeviceKey.publicKey.deviceId,
      keyId: "90000000-0000-4000-8000-000000000009",
    });
    const firstPlaintext = new TextEncoder().encode('{"formatVersion":1,"tasks":[]}');
    const secondPlaintext = new TextEncoder().encode(
      '{"formatVersion":1,"tasks":[{"id":"one","title":"Private","done":false}]}',
    );
    try {
      const device = crypto.createDeviceDescriptorV2({
        ownerBinding: OWNER,
        encryptionKey: deviceKey,
        authorizationKey,
      });
      const genesis = createVaultGenesisCommand({
        crypto,
        vaultKey,
        authorizationKey,
        ownerBinding: OWNER,
        device,
        recoveryAuthorization: crypto.createRecoveryAuthorizationPublicKeyV2({
          authorizationKey: recoveryAuthorizationKey,
        }),
        keyring: keyringResult.keyring,
        plaintext: firstPlaintext,
        clock: clock("50000000-0000-4000-8000-000000000005", Date.now() + 1_000),
      });

      expect(JSON.stringify(genesis)).not.toContain("Private");
      const genesisDevice = genesis.snapshot.authorizationManifest.devices[0];
      if (genesisDevice === undefined) throw new Error("Genesis device is missing");
      expect(
        crypto.verifyVaultCommitSignature({
          commit: genesis.snapshot.commit,
          publicKey: genesisDevice.authorizationKey,
        }),
      ).toBe(true);
      expect(crypto.verifyRootKeyStateMac({ vaultKey, commit: genesis.snapshot.commit })).toBe(true);
      expectAuditableOrder(genesis.snapshot, genesis.proof);
      expect(() =>
        verifyAndDecryptRemoteSnapshot(
          crypto,
          vaultKey,
          { ...genesis.snapshot, commitHash: "IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiI" },
          OWNER,
        ),
      ).toThrow(VaultSyncProtocolError);
      expect(() =>
        verifyAndDecryptRemoteSnapshot(
          crypto,
          vaultKey,
          genesis.snapshot,
          "IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiI",
        ),
      ).toThrow(VaultSyncProtocolError);
      const verifiedGenesis = verifyAndDecryptRemoteSnapshot(crypto, vaultKey, genesis.snapshot, OWNER);
      expect(new TextDecoder().decode(verifiedGenesis.plaintext)).toBe(
        new TextDecoder().decode(firstPlaintext),
      );
      verifiedGenesis.plaintext.fill(0);
      const genesisRenewalTime = Date.parse(genesis.proof.expiresAt) + 25 * 60 * 60_000;
      const renewedGenesis = renewVaultSyncCommandProof({
        crypto,
        authorizationKey,
        command: genesis,
        clock: clock("51000000-0000-4000-8000-000000000005", genesisRenewalTime),
      });
      expect(renewedGenesis.commandType).toBe("CREATE_VAULT");
      expect({ ...renewedGenesis, proof: genesis.proof }).toEqual(genesis);
      expect(renewedGenesis.proof.issuedAt).toBe(new Date(genesisRenewalTime).toISOString());
      expect(renewedGenesis.proof.signature).not.toBe(genesis.proof.signature);
      expect(
        crypto.verifyVaultCommandProof({
          proof: renewedGenesis.proof,
          publicKey: genesisDevice.authorizationKey,
        }),
      ).toBe(true);

      const update = createVaultPayloadUpdateCommand({
        crypto,
        vaultKey,
        authorizationKey,
        current: genesis.snapshot,
        plaintext: secondPlaintext,
        clock: clock("60000000-0000-4000-8000-000000000006", Date.now() + 2_000),
      });
      const verifiedUpdate = verifyAndDecryptRemoteSnapshot(
        crypto,
        vaultKey,
        update.nextSnapshot,
        OWNER,
        verifiedGenesis.highWater,
      );
      expect(new TextDecoder().decode(verifiedUpdate.plaintext)).toBe(
        new TextDecoder().decode(secondPlaintext),
      );
      verifiedUpdate.plaintext.fill(0);
      expectAuditableOrder(update.nextSnapshot, update.proof);
      const updateRenewalTime = Date.parse(update.proof.expiresAt) + 25 * 60 * 60_000;
      const renewedUpdate = renewVaultSyncCommandProof({
        crypto,
        authorizationKey,
        command: update,
        clock: clock("61000000-0000-4000-8000-000000000006", updateRenewalTime),
      });
      expect(renewedUpdate.commandType).toBe("UPDATE_PAYLOAD");
      expect({ ...renewedUpdate, proof: update.proof }).toEqual(update);
      expect(renewedUpdate.proof.issuedAt).toBe(new Date(updateRenewalTime).toISOString());
      expect(renewedUpdate.proof.signature).not.toBe(update.proof.signature);
      expect(
        crypto.verifyVaultCommandProof({
          proof: renewedUpdate.proof,
          publicKey: genesisDevice.authorizationKey,
        }),
      ).toBe(true);
      const concurrentUpdate = createVaultPayloadUpdateCommand({
        crypto,
        vaultKey,
        authorizationKey,
        current: genesis.snapshot,
        plaintext: firstPlaintext,
        clock: clock("62000000-0000-4000-8000-000000000006", Date.now() + 2_500),
      });
      const unprovenMultiHop = createVaultPayloadUpdateCommand({
        crypto,
        vaultKey,
        authorizationKey,
        current: concurrentUpdate.nextSnapshot,
        plaintext: secondPlaintext,
        clock: clock("64000000-0000-4000-8000-000000000006", Date.now() + 2_750),
      });

      const pair = createVaultPairDeviceCommand({
        crypto,
        vaultKey,
        authorizationKey,
        current: update.nextSnapshot,
        pairedDevice: crypto.createDeviceDescriptorV2({
          ownerBinding: OWNER,
          encryptionKey: pairedDeviceKey,
          authorizationKey: pairedAuthorizationKey,
        }),
        pairingCodeCommitment: await hashPairingCode("ABCD-2345"),
        clock: clock("a0000000-0000-4000-8000-00000000000a", Date.now() + 3_000),
      });
      expectAuditableOrder(pair.command.nextSnapshot, pair.command.proof);
      expect(pair.command.nextSnapshot.keyring.updatedAt).toBe(
        pair.command.nextSnapshot.authorizationManifest.updatedAt,
      );
      expect(Date.parse(pair.command.nextSnapshot.commit.createdAt)).toBeGreaterThan(
        Date.parse(pair.command.nextSnapshot.payload.createdAt),
      );
      expect(
        classifyVerifiedPendingUpdateHead({
          base: genesis.snapshot,
          intended: update.nextSnapshot,
          remote: update.nextSnapshot,
        }),
      ).toBe("applied");
      expect(
        classifyVerifiedPendingUpdateHead({
          base: genesis.snapshot,
          intended: update.nextSnapshot,
          remote: genesis.snapshot,
        }),
      ).toBe("parent");
      expect(
        classifyVerifiedPendingUpdateHead({
          base: genesis.snapshot,
          intended: update.nextSnapshot,
          remote: concurrentUpdate.nextSnapshot,
        }),
      ).toBe("payload-child");
      expect(() =>
        verifyAndDecryptRemoteSnapshot(
          crypto,
          vaultKey,
          unprovenMultiHop.nextSnapshot,
          OWNER,
          verifiedGenesis.highWater,
        ),
      ).toThrow(VaultSyncProtocolError);
      expect(
        classifyVerifiedPendingUpdateHead({
          base: genesis.snapshot,
          intended: update.nextSnapshot,
          remote: unprovenMultiHop.nextSnapshot,
        }),
      ).toBe("unsafe");
      expect(
        classifyVerifiedPendingUpdateHead({
          base: genesis.snapshot,
          intended: update.nextSnapshot,
          remote: pair.command.nextSnapshot,
        }),
      ).toBe("unsafe");
      expect(isDurableOrdinarySyncRecoveryStatus(403)).toBe(true);
      expect(isDurableOrdinarySyncRecoveryStatus(409)).toBe(true);
      expect(isDurableOrdinarySyncRecoveryStatus(412)).toBe(true);
      expect(mayRenewOrdinarySyncProof(403)).toBe(true);
      expect(mayRenewOrdinarySyncProof(409)).toBe(false);

      expect(() =>
        verifyAndDecryptRemoteSnapshot(crypto, vaultKey, genesis.snapshot, OWNER, verifiedUpdate.highWater),
      ).toThrow(VaultSyncProtocolError);
    } finally {
      firstPlaintext.fill(0);
      secondPlaintext.fill(0);
      recoveryAuthorizationKey.destroy();
      pairedAuthorizationKey.destroy();
      pairedDeviceKey.destroy();
      authorizationKey.destroy();
      deviceKey.destroy();
      vaultKey.destroy();
    }
  }, 30_000);

  it("creates a short-lived canonical read proof bound to the owner, vault, and device", async () => {
    const crypto = await createVaultCrypto();
    const authorizationKey = crypto.generateAuthorizationKey({
      ownerBinding: OWNER,
      deviceId: DEVICE_ID,
      keyId: AUTH_KEY_ID,
    });
    try {
      const header = createVaultReadProofHeader({
        crypto,
        authorizationKey,
        ownerBinding: OWNER,
        vaultId: VAULT_ID,
        clock: clock("70000000-0000-4000-8000-000000000007", Date.now()),
      });
      const proof = decodeVaultReadProofHeaderV2(header);
      expect(proof.ownerBinding).toBe(OWNER);
      expect(proof.vaultId).toBe(VAULT_ID);
      expect(proof.signer.deviceId).toBe(DEVICE_ID);
      expect(
        crypto.verifyVaultReadProof({
          proof,
          publicKey: {
            algorithm: "ED25519",
            keyId: authorizationKey.keyId,
            publicKey: authorizationKey.publicKey,
            fingerprint: authorizationKey.fingerprint,
          },
        }),
      ).toBe(true);
    } finally {
      authorizationKey.destroy();
    }
  });

  it("rotates recovery/root material and verifies the exact applied head after a stale-parent replay", async () => {
    const crypto = await createVaultCrypto();
    const oldDevice = crypto.generateDeviceKey({ deviceId: DEVICE_ID });
    const oldAuthorization = crypto.generateAuthorizationKey({
      ownerBinding: OWNER,
      deviceId: DEVICE_ID,
      keyId: AUTH_KEY_ID,
    });
    const oldVaultKey = crypto.generateVaultKey({ vaultId: VAULT_ID });
    const initialKeyring = crypto.createKeyring({
      key: oldVaultKey,
      revision: 1,
      recipients: [oldDevice.publicKey],
    });
    const oldRecoveryAuthorization = crypto.deriveRecoveryAuthorizationKey({
      recoveryCode: initialKeyring.recoveryCode,
      ownerBinding: OWNER,
      vaultId: VAULT_ID,
      keyId: RECOVERY_AUTH_KEY_ID,
    });
    const replacementDevice = crypto.generateDeviceKey({
      deviceId: "80000000-0000-4000-8000-000000000008",
    });
    const replacementAuthorization = crypto.generateAuthorizationKey({
      ownerBinding: OWNER,
      deviceId: replacementDevice.publicKey.deviceId,
      keyId: "90000000-0000-4000-8000-000000000009",
    });
    const plaintext = new TextEncoder().encode(
      '{"formatVersion":1,"tasks":[{"id":"safe","title":"Recovered","done":false}]}',
    );
    let nextVaultKey: VaultKeyHandle | undefined;
    let nextRecoveryAuthorization: AuthorizationKeyHandle | undefined;
    try {
      const genesis = createVaultGenesisCommand({
        crypto,
        vaultKey: oldVaultKey,
        authorizationKey: oldAuthorization,
        ownerBinding: OWNER,
        device: crypto.createDeviceDescriptorV2({
          ownerBinding: OWNER,
          encryptionKey: oldDevice,
          authorizationKey: oldAuthorization,
        }),
        recoveryAuthorization: crypto.createRecoveryAuthorizationPublicKeyV2({
          authorizationKey: oldRecoveryAuthorization,
        }),
        keyring: initialKeyring.keyring,
        plaintext,
        clock: clock("50000000-0000-4000-8000-000000000005", Date.now() + 1_000),
      });
      const paired = createVaultPairDeviceCommand({
        crypto,
        vaultKey: oldVaultKey,
        authorizationKey: oldRecoveryAuthorization,
        current: genesis.snapshot,
        pairedDevice: crypto.createDeviceDescriptorV2({
          ownerBinding: OWNER,
          encryptionKey: replacementDevice,
          authorizationKey: replacementAuthorization,
        }),
        pairingCodeCommitment: await hashPairingCode("ABCD-2345"),
        clock: clock("60000000-0000-4000-8000-000000000006", Date.now() + 2_000),
      }).command.nextSnapshot;
      const rotated = crypto.rotateKeyring({
        previousKey: oldVaultKey,
        previousKeyring: paired.keyring,
        recipients: [replacementDevice.publicKey],
      });
      nextVaultKey = rotated.key;
      nextRecoveryAuthorization = crypto.deriveRecoveryAuthorizationKey({
        recoveryCode: rotated.recoveryCode,
        ownerBinding: OWNER,
        vaultId: VAULT_ID,
        keyId: "a0000000-0000-4000-8000-00000000000a",
      });
      const preparationTime = Date.now() + 3_000;
      const confirmationTime = preparationTime + 11 * 60_000;
      const command = createVaultRecoveryRotationCommand({
        crypto,
        previousVaultKey: oldVaultKey,
        nextVaultKey: rotated.key,
        authorizationKey: replacementAuthorization,
        current: paired,
        replacementDeviceId: replacementDevice.publicKey.deviceId,
        nextKeyring: rotated.keyring,
        nextRecoveryAuthorization: crypto.createRecoveryAuthorizationPublicKeyV2({
          authorizationKey: nextRecoveryAuthorization,
        }),
        plaintext,
        clock: clock("b0000000-0000-4000-8000-00000000000b", confirmationTime),
      });
      const concurrentPayloadChild = createVaultPayloadUpdateCommand({
        crypto,
        vaultKey: oldVaultKey,
        authorizationKey: replacementAuthorization,
        current: paired,
        plaintext,
        clock: clock("b1000000-0000-4000-8000-00000000000b", confirmationTime + 1_000),
      });
      const unprovenRotationRebaseHead = createVaultPayloadUpdateCommand({
        crypto,
        vaultKey: oldVaultKey,
        authorizationKey: replacementAuthorization,
        current: concurrentPayloadChild.nextSnapshot,
        plaintext,
        clock: clock("b2000000-0000-4000-8000-00000000000b", confirmationTime + 2_000),
      });
      expect(
        classifyVerifiedPendingUpdateHead({
          base: paired,
          intended: command.nextSnapshot,
          remote: concurrentPayloadChild.nextSnapshot,
        }),
      ).toBe("payload-child");
      expect(() =>
        verifyAndDecryptRemoteSnapshot(crypto, oldVaultKey, unprovenRotationRebaseHead.nextSnapshot, OWNER, {
          ownerBinding: OWNER,
          vaultId: VAULT_ID,
          epoch: paired.commit.epoch,
          sequence: paired.commit.sequence,
          commitHash: paired.commitHash,
        }),
      ).toThrow(VaultSyncProtocolError);
      expect(
        classifyVerifiedPendingUpdateHead({
          base: paired,
          intended: command.nextSnapshot,
          remote: unprovenRotationRebaseHead.nextSnapshot,
        }),
      ).toBe("unsafe");

      expect(command.reason).toBe("RECOVERY_ROTATED");
      expect(command.proof.issuedAt).toBe(new Date(confirmationTime).toISOString());
      expect(Date.parse(command.proof.expiresAt) - Date.parse(command.proof.issuedAt)).toBe(60_000);
      expect(Date.parse(command.proof.issuedAt)).toBeGreaterThan(preparationTime + 10 * 60_000);
      const renewalTime = confirmationTime + 25 * 60 * 60_000;
      const renewed = renewVaultRecoveryRotationCommandProof({
        crypto,
        authorizationKey: replacementAuthorization,
        command,
        clock: clock("d0000000-0000-4000-8000-00000000000d", renewalTime),
      });
      expect(renewed.operationId).toBe(command.operationId);
      expect(renewed.nextSnapshot).toEqual(command.nextSnapshot);
      expect(renewed.expectedParentCommitHash).toBe(command.expectedParentCommitHash);
      expect(renewed.proof.issuedAt).toBe(new Date(renewalTime).toISOString());
      expect(renewed.proof.signature).not.toBe(command.proof.signature);
      const replacementDescriptor = paired.authorizationManifest.devices.find(
        (device) => device.deviceId === replacementDevice.publicKey.deviceId,
      );
      if (replacementDescriptor === undefined) {
        throw new Error("Replacement device descriptor is missing.");
      }
      expect(
        crypto.verifyVaultCommandProof({
          proof: renewed.proof,
          publicKey: replacementDescriptor.authorizationKey,
        }),
      ).toBe(true);
      expect(command.nextSnapshot.commit.epoch).toBe(paired.commit.epoch + 1);
      expect(command.nextSnapshot.commit.sequence).toBe(paired.commit.sequence + 1);
      expect(command.nextSnapshot.payload.revision).toBe(paired.payload.revision + 1);
      expect(command.nextSnapshot.keyring.revision).toBe(paired.keyring.revision + 1);
      expect(
        command.nextSnapshot.authorizationManifest.devices.find((device) => device.deviceId === DEVICE_ID)
          ?.revokedAt,
      ).not.toBeNull();
      expect(
        command.nextSnapshot.authorizationManifest.devices.find(
          (device) => device.deviceId === replacementDevice.publicKey.deviceId,
        )?.revokedAt,
      ).toBeNull();
      expect(command.nextSnapshot.keyring.deviceEnvelopes).toHaveLength(1);
      expect(command.nextSnapshot.keyring.deviceEnvelopes[0]?.recipientDeviceId).toBe(
        replacementDevice.publicKey.deviceId,
      );
      expect(command.nextSnapshot.commit.author).toEqual({
        kind: "DEVICE",
        keyId: replacementAuthorization.keyId,
        deviceId: replacementDevice.publicKey.deviceId,
      });
      const verified = verifyAndDecryptRemoteSnapshot(crypto, rotated.key, command.nextSnapshot, OWNER);
      expect(new TextDecoder().decode(verified.plaintext)).toBe(new TextDecoder().decode(plaintext));
      verified.plaintext.fill(0);
      // Models: mutation committed, response lost, the client remained offline
      // past the idempotency-receipt retention window, and the exact replay got
      // 403 for its expired proof (or 412 for the now-stale `paired` parent).
      const appliedReadBack = verifyAppliedRecoveryRotationReadBack({
        crypto,
        vaultKey: rotated.key,
        candidate: command.nextSnapshot,
        expectedSnapshot: command.nextSnapshot,
        expectedOwnerBinding: OWNER,
        highWater: {
          ownerBinding: paired.ownerBinding,
          vaultId: paired.vaultId,
          epoch: paired.commit.epoch,
          sequence: paired.commit.sequence,
          commitHash: paired.commitHash,
        },
      });
      expect(appliedReadBack).not.toBeNull();
      expect(new TextDecoder().decode(appliedReadBack?.plaintext)).toBe(new TextDecoder().decode(plaintext));
      appliedReadBack?.plaintext.fill(0);
      expect(
        verifyAppliedRecoveryRotationReadBack({
          crypto,
          vaultKey: rotated.key,
          candidate: {
            ...command.nextSnapshot,
            commit: {
              ...command.nextSnapshot.commit,
              operationId: "c0000000-0000-4000-8000-00000000000c",
            },
          },
          expectedSnapshot: command.nextSnapshot,
          expectedOwnerBinding: OWNER,
          highWater: {
            ownerBinding: paired.ownerBinding,
            vaultId: paired.vaultId,
            epoch: paired.commit.epoch,
            sequence: paired.commit.sequence,
            commitHash: paired.commitHash,
          },
        }),
      ).toBeNull();
      expect(() =>
        crypto.recoverVaultKey({
          envelope: rotated.keyring.recoveryEnvelope,
          recoveryCode: initialKeyring.recoveryCode,
        }),
      ).toThrow();
      const recovered = crypto.recoverVaultKey({
        envelope: rotated.keyring.recoveryEnvelope,
        recoveryCode: rotated.recoveryCode,
      });
      recovered.destroy();
    } finally {
      plaintext.fill(0);
      nextRecoveryAuthorization?.destroy();
      nextVaultKey?.destroy();
      replacementAuthorization.destroy();
      replacementDevice.destroy();
      oldRecoveryAuthorization.destroy();
      oldVaultKey.destroy();
      oldAuthorization.destroy();
      oldDevice.destroy();
    }
  }, 30_000);

  it("re-authenticates a local-only vault without producing state for a wrong recovery code", async () => {
    const crypto = await createVaultCrypto();
    const deviceKey = crypto.generateDeviceKey({ deviceId: DEVICE_ID });
    const vaultKey = crypto.generateVaultKey({ vaultId: VAULT_ID });
    const keyring = crypto.createKeyring({
      key: vaultKey,
      revision: 1,
      recipients: [deviceKey.publicKey],
    });
    const plaintext = new TextEncoder().encode('{"formatVersion":1,"tasks":[]}');
    try {
      const payload = crypto.encryptPayload({
        key: vaultKey,
        plaintext,
        revision: 1,
        baseRevision: null,
      });
      expect(
        verifyLocalRecoveryCodeForAccountSync({
          crypto,
          activeVaultKey: vaultKey,
          keyring: keyring.keyring,
          payload,
          expectedPlaintext: plaintext,
          recoveryCode: "wrong-code",
        }),
      ).toBe(false);
      expect(
        verifyLocalRecoveryCodeForAccountSync({
          crypto,
          activeVaultKey: vaultKey,
          keyring: keyring.keyring,
          payload,
          expectedPlaintext: plaintext,
          recoveryCode: keyring.recoveryCode,
        }),
      ).toBe(true);
    } finally {
      plaintext.fill(0);
      deviceKey.destroy();
      vaultKey.destroy();
    }
  }, 30_000);

  it("three-way merges independent task-id edits and locks divergent edits", () => {
    const base = createTaskDocument([
      { id: "one", title: "One", done: false },
      { id: "two", title: "Two", done: false },
    ]);
    const local = createTaskDocument([
      { id: "one", title: "One", done: true },
      { id: "two", title: "Two", done: false },
      { id: "local", title: "Local", done: false },
    ]);
    const remote = createTaskDocument([
      { id: "one", title: "One", done: false },
      { id: "two", title: "Two remote", done: false },
      { id: "remote", title: "Remote", done: false },
    ]);

    expect(mergeTaskDocuments(base, local, remote)?.tasks).toEqual([
      { id: "one", title: "One", done: true },
      { id: "two", title: "Two remote", done: false },
      { id: "remote", title: "Remote", done: false },
      { id: "local", title: "Local", done: false },
    ]);
    expect(
      mergeTaskDocuments(
        base,
        createTaskDocument([
          { id: "one", title: "Local edit", done: false },
          { id: "two", title: "Two", done: false },
        ]),
        createTaskDocument([
          { id: "one", title: "Remote edit", done: false },
          { id: "two", title: "Two", done: false },
        ]),
      ),
    ).toBeNull();
  });

  it("generates uniformly mapped base32 pairing codes and binds the exact entered code", async () => {
    const codes = Array.from({ length: 64 }, () => generatePairingCode());
    expect(codes.every((code) => /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/u.test(code))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(60);
    await expect(hashPairingCode("ABCD-2345")).resolves.not.toBe(await hashPairingCode("ABCD-2346"));
    await expect(hashPairingCode("wrong-code")).rejects.toBeInstanceOf(VaultSyncProtocolError);
  });
});
