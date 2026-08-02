import { VaultSyncSnapshotV2Schema, type VaultSyncSnapshotV2 } from "@umn-gopher-assistant/contracts";

export type RecoverableOrdinarySyncFailureStatus = 403 | 409 | 412 | 422;

export type VerifiedPendingUpdateHead = "applied" | "parent" | "payload-child" | "unsafe";

export function isDurableOrdinarySyncRecoveryStatus(
  status: number,
): status is RecoverableOrdinarySyncFailureStatus {
  return status === 403 || status === 409 || status === 412 || status === 422;
}

/**
 * A 409 means this operation id is already bound to a different request
 * digest. Re-signing would retain that operation id while changing its proof
 * bytes, so it must be inspected by read-back but never blindly retried.
 */
export function mayRenewOrdinarySyncProof(status: RecoverableOrdinarySyncFailureStatus): boolean {
  return status !== 409;
}

function exactSnapshot(left: VaultSyncSnapshotV2, right: VaultSyncSnapshotV2): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Classifies a head only after the caller has completed schema, hash,
 * signature, root-MAC, decryption and high-water verification. Authorization
 * or keyring transitions are never treated as an ordinary payload rebase.
 */
export function classifyVerifiedPendingUpdateHead(input: {
  readonly base: VaultSyncSnapshotV2;
  readonly intended: VaultSyncSnapshotV2;
  readonly remote: VaultSyncSnapshotV2;
}): VerifiedPendingUpdateHead {
  const base = VaultSyncSnapshotV2Schema.parse(input.base);
  const intended = VaultSyncSnapshotV2Schema.parse(input.intended);
  const remote = VaultSyncSnapshotV2Schema.parse(input.remote);
  if (
    intended.ownerBinding !== base.ownerBinding ||
    intended.vaultId !== base.vaultId ||
    intended.commit.parentCommitHash !== base.commitHash
  ) {
    return "unsafe";
  }
  if (exactSnapshot(remote, intended)) return "applied";
  if (exactSnapshot(remote, base)) return "parent";
  // Without a server-supplied, fully verified commit chain, a later sequence
  // number does not prove ancestry. Only an exact direct child of our durable
  // high-water can be safely used as a three-way-merge branch.
  const payloadOnlyChild =
    remote.ownerBinding === base.ownerBinding &&
    remote.vaultId === base.vaultId &&
    remote.commit.epoch === base.commit.epoch &&
    remote.commit.sequence === base.commit.sequence + 1 &&
    remote.commit.parentCommitHash === base.commitHash &&
    remote.payload.revision === base.payload.revision + 1 &&
    remote.payload.baseRevision === base.payload.revision &&
    remote.payload.vaultKeyId === base.payload.vaultKeyId &&
    JSON.stringify(remote.keyring) === JSON.stringify(base.keyring) &&
    JSON.stringify(remote.authorizationManifest) === JSON.stringify(base.authorizationManifest);
  return payloadOnlyChild ? "payload-child" : "unsafe";
}
