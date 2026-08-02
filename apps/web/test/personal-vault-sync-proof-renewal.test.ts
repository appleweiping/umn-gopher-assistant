// @vitest-environment node

import { createVaultCrypto } from "@umn-gopher-assistant/crypto";
import { describe, expect, it } from "vitest";

import {
  buildPersistedRemoteVaultAdoptionV2,
  buildPersistedVaultSyncCommitV2,
  buildPersistedVaultSyncProofRenewalV2,
} from "../lib/personal-vault/idb";
import { classifyVerifiedPendingUpdateHead } from "../lib/personal-vault/ordinary-sync-retry";
import {
  createVaultGenesisCommand,
  createVaultPayloadUpdateCommand,
  renewVaultSyncCommandProof,
  verifyAndDecryptRemoteSnapshot,
} from "../lib/personal-vault/sync-protocol";

const OWNER = "ERERERERERERERERERERERERERERERERERERERERERE";
const VAULT_ID = "10000000-0000-4000-8000-000000000001";
const DEVICE_ID = "20000000-0000-4000-8000-000000000002";
const AUTH_KEY_ID = "30000000-0000-4000-8000-000000000003";
const RECOVERY_AUTH_KEY_ID = "40000000-0000-4000-8000-000000000004";

function clock(uuid: string, timestamp: number) {
  return {
    now: () => new Date(timestamp),
    randomUuid: () => uuid,
  };
}

describe("durable ordinary vault proof renewal", () => {
  it("renews expired create/update proofs without changing their durable business intent", async () => {
    const crypto = await createVaultCrypto();
    const deviceKey = crypto.generateDeviceKey({ deviceId: DEVICE_ID });
    const authorizationKey = crypto.generateAuthorizationKey({
      ownerBinding: OWNER,
      deviceId: DEVICE_ID,
      keyId: AUTH_KEY_ID,
    });
    const vaultKey = crypto.generateVaultKey({ vaultId: VAULT_ID });
    const keyring = crypto.createKeyring({
      key: vaultKey,
      revision: 1,
      recipients: [deviceKey.publicKey],
    });
    const recoveryAuthorizationKey = crypto.deriveRecoveryAuthorizationKey({
      recoveryCode: keyring.recoveryCode,
      ownerBinding: OWNER,
      vaultId: VAULT_ID,
      keyId: RECOVERY_AUTH_KEY_ID,
    });
    const genesisPlaintext = new TextEncoder().encode('{"formatVersion":1,"tasks":[]}');
    const updatePlaintext = new TextEncoder().encode(
      '{"formatVersion":1,"tasks":[{"id":"one","title":"Private","done":false}]}',
    );
    try {
      const baseTime = Date.now() + 1_000;
      const genesis = createVaultGenesisCommand({
        crypto,
        vaultKey,
        authorizationKey,
        ownerBinding: OWNER,
        device: crypto.createDeviceDescriptorV2({
          ownerBinding: OWNER,
          encryptionKey: deviceKey,
          authorizationKey,
        }),
        recoveryAuthorization: crypto.createRecoveryAuthorizationPublicKeyV2({
          authorizationKey: recoveryAuthorizationKey,
        }),
        keyring: keyring.keyring,
        plaintext: genesisPlaintext,
        clock: clock("50000000-0000-4000-8000-000000000005", baseTime),
      });
      const createRenewedAt = Date.parse(genesis.proof.expiresAt) + 1_000;
      const renewedCreate = renewVaultSyncCommandProof({
        crypto,
        authorizationKey,
        command: genesis,
        clock: clock("51000000-0000-4000-8000-000000000005", createRenewedAt),
      });
      const createRecord = {
        formatVersion: 2 as const,
        ownerBinding: OWNER,
        vaultId: VAULT_ID,
        authorizationKeyId: AUTH_KEY_ID,
        etag: null,
        highWater: null,
        snapshot: null,
        pending: { kind: "create" as const, command: genesis },
        updatedAt: new Date(baseTime + 1_000).toISOString(),
      };
      const renewedCreateRecord = buildPersistedVaultSyncProofRenewalV2(
        createRecord,
        genesis,
        renewedCreate,
        new Date(createRenewedAt).toISOString(),
      );
      expect(renewedCreateRecord.pending?.command).toEqual(renewedCreate);
      expect({ ...renewedCreate, proof: genesis.proof }).toEqual(genesis);
      expect(Date.parse(renewedCreate.proof.issuedAt)).toBeGreaterThan(Date.parse(genesis.proof.expiresAt));
      expect(createRecord.pending.command).toEqual(genesis);

      const update = createVaultPayloadUpdateCommand({
        crypto,
        vaultKey,
        authorizationKey,
        current: genesis.snapshot,
        plaintext: updatePlaintext,
        clock: clock("60000000-0000-4000-8000-000000000006", baseTime + 120_000),
      });
      const updateRenewedAt = Date.parse(update.proof.expiresAt) + 25 * 60 * 60_000;
      const renewedUpdate = renewVaultSyncCommandProof({
        crypto,
        authorizationKey,
        command: update,
        clock: clock("61000000-0000-4000-8000-000000000006", updateRenewedAt),
      });
      const updateRecord = {
        formatVersion: 2 as const,
        ownerBinding: OWNER,
        vaultId: VAULT_ID,
        authorizationKeyId: AUTH_KEY_ID,
        etag: `"pv2:${genesis.snapshot.commitHash}"`,
        highWater: {
          ownerBinding: OWNER,
          vaultId: VAULT_ID,
          epoch: genesis.snapshot.commit.epoch,
          sequence: genesis.snapshot.commit.sequence,
          commitHash: genesis.snapshot.commitHash,
        },
        snapshot: genesis.snapshot,
        pending: { kind: "update" as const, command: update },
        updatedAt: new Date(baseTime + 121_000).toISOString(),
      };
      const renewedUpdateRecord = buildPersistedVaultSyncProofRenewalV2(
        updateRecord,
        update,
        renewedUpdate,
        new Date(updateRenewedAt).toISOString(),
      );
      expect(renewedUpdateRecord.pending?.command).toEqual(renewedUpdate);
      expect({ ...renewedUpdate, proof: update.proof }).toEqual(update);
      expect(updateRecord.pending.command).toEqual(update);
      // Models a successful upload whose response and durable receipt were
      // both lost while the client stayed offline for more than 24 hours.
      const appliedReadBack = verifyAndDecryptRemoteSnapshot(
        crypto,
        vaultKey,
        update.nextSnapshot,
        OWNER,
        updateRecord.highWater,
      );
      try {
        expect(
          classifyVerifiedPendingUpdateHead({
            base: genesis.snapshot,
            intended: update.nextSnapshot,
            remote: appliedReadBack.snapshot,
          }),
        ).toBe("applied");
      } finally {
        appliedReadBack.plaintext.fill(0);
      }
      const committedUpdate = buildPersistedVaultSyncCommitV2(
        updateRecord,
        update.operationId,
        `"pv2:${update.nextSnapshot.commitHash}"`,
        update.nextSnapshot,
      );
      expect(committedUpdate.pending).toBeNull();
      expect(committedUpdate.snapshot).toEqual(update.nextSnapshot);

      const sameOperationDifferentSuccessor = createVaultPayloadUpdateCommand({
        crypto,
        vaultKey,
        authorizationKey,
        current: genesis.snapshot,
        plaintext: genesisPlaintext,
        clock: clock(update.operationId, baseTime + 180_000),
      });
      expect(sameOperationDifferentSuccessor.operationId).toBe(update.operationId);
      expect(sameOperationDifferentSuccessor.nextSnapshot).not.toEqual(update.nextSnapshot);
      expect(() =>
        buildPersistedVaultSyncCommitV2(
          updateRecord,
          update.operationId,
          `"pv2:${sameOperationDifferentSuccessor.nextSnapshot.commitHash}"`,
          sameOperationDifferentSuccessor.nextSnapshot,
        ),
      ).toThrow("exact staged successor");
      const directSuccessor = createVaultPayloadUpdateCommand({
        crypto,
        vaultKey,
        authorizationKey,
        current: update.nextSnapshot,
        plaintext: genesisPlaintext,
        clock: clock("64000000-0000-4000-8000-000000000006", baseTime + 240_000),
      });
      expect(
        buildPersistedRemoteVaultAdoptionV2(
          committedUpdate,
          update.nextSnapshot.commitHash,
          `"pv2:${directSuccessor.nextSnapshot.commitHash}"`,
          directSuccessor.nextSnapshot,
        ).snapshot,
      ).toEqual(directSuccessor.nextSnapshot);
      expect(
        buildPersistedRemoteVaultAdoptionV2(
          committedUpdate,
          update.nextSnapshot.commitHash,
          `"pv2:${update.nextSnapshot.commitHash}"`,
          update.nextSnapshot,
        ).snapshot,
      ).toEqual(update.nextSnapshot);
      const skippedSuccessor = createVaultPayloadUpdateCommand({
        crypto,
        vaultKey,
        authorizationKey,
        current: directSuccessor.nextSnapshot,
        plaintext: updatePlaintext,
        clock: clock("65000000-0000-4000-8000-000000000006", baseTime + 300_000),
      });
      expect(() =>
        buildPersistedRemoteVaultAdoptionV2(
          committedUpdate,
          update.nextSnapshot.commitHash,
          `"pv2:${skippedSuccessor.nextSnapshot.commitHash}"`,
          skippedSuccessor.nextSnapshot,
        ),
      ).toThrow("direct successor");
      const forkChild = createVaultPayloadUpdateCommand({
        crypto,
        vaultKey,
        authorizationKey,
        current: sameOperationDifferentSuccessor.nextSnapshot,
        plaintext: updatePlaintext,
        clock: clock("66000000-0000-4000-8000-000000000006", baseTime + 360_000),
      });
      expect(() =>
        buildPersistedRemoteVaultAdoptionV2(
          committedUpdate,
          update.nextSnapshot.commitHash,
          `"pv2:${forkChild.nextSnapshot.commitHash}"`,
          forkChild.nextSnapshot,
        ),
      ).toThrow("direct successor");

      const laterRenewal = renewVaultSyncCommandProof({
        crypto,
        authorizationKey,
        command: renewedUpdate,
        clock: clock("62000000-0000-4000-8000-000000000006", updateRenewedAt + 120_000),
      });
      expect(() => buildPersistedVaultSyncProofRenewalV2(renewedUpdateRecord, update, laterRenewal)).toThrow(
        "no longer matches the durable intent",
      );

      const differentIntent = createVaultPayloadUpdateCommand({
        crypto,
        vaultKey,
        authorizationKey,
        current: genesis.snapshot,
        plaintext: genesisPlaintext,
        clock: clock("63000000-0000-4000-8000-000000000006", updateRenewedAt + 180_000),
      });
      expect(() => buildPersistedVaultSyncProofRenewalV2(updateRecord, update, differentIntent)).toThrow(
        "no longer matches the durable intent",
      );
    } finally {
      genesisPlaintext.fill(0);
      updatePlaintext.fill(0);
      recoveryAuthorizationKey.destroy();
      authorizationKey.destroy();
      deviceKey.destroy();
      vaultKey.destroy();
    }
  }, 30_000);
});
