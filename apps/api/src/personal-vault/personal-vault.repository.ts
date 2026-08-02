import type {
  DevicePairingRequestV2,
  DevicePairingViewV2,
  VaultCreateCommandV2,
  VaultMutationCommandV2,
  VaultPairDeviceCommandV2,
  VaultSyncSnapshotV2,
} from "@umn-gopher-assistant/contracts";

export interface VaultSnapshotRecord {
  readonly etag: string;
  readonly revision: number;
  readonly snapshot: VaultSyncSnapshotV2;
}

export interface VaultWriteResult extends VaultSnapshotRecord {
  readonly replayed: boolean;
}

export interface PairingWriteResult {
  readonly etag: string;
  readonly pairing: DevicePairingViewV2;
  readonly replayed: boolean;
  readonly revision: number;
}

export interface DurableReplayRepositoryInput {
  readonly accountId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly resultKind: "pairing" | "vault";
}

export type DurableReplayResult =
  | { readonly kind: "pairing"; readonly result: PairingWriteResult }
  | { readonly kind: "vault"; readonly result: VaultWriteResult };

export interface CreateVaultRepositoryInput {
  readonly accountId: string;
  readonly command: VaultCreateCommandV2;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface CommitVaultRepositoryInput {
  readonly accountId: string;
  readonly command: Exclude<VaultMutationCommandV2, VaultCreateCommandV2>;
  readonly expectedEtag: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface CreatePairingRepositoryInput {
  readonly accountId: string;
  readonly expectedEtag: string;
  readonly idempotencyKey: string;
  readonly request: DevicePairingRequestV2;
  readonly requestHash: string;
}

export interface CancelPairingRepositoryInput {
  readonly accountId: string;
  readonly expectedEtag: string;
  readonly idempotencyKey: string;
  readonly pairingId: string;
  readonly requestHash: string;
}

export interface ApprovePairingRepositoryInput {
  readonly accountId: string;
  readonly command: VaultPairDeviceCommandV2;
  readonly expectedEtag: string;
  readonly idempotencyKey: string;
  readonly pairingCodeCommitment: string;
  readonly pairingId: string;
  readonly requestHash: string;
}

export class PersonalVaultRepositoryError extends Error {
  constructor(
    readonly code:
      | "ALREADY_EXISTS"
      | "IDEMPOTENCY_CONFLICT"
      | "NOT_FOUND"
      | "PAIRING_CONFLICT"
      | "STALE_WRITE",
    message: string,
  ) {
    super(message);
    this.name = "PersonalVaultRepositoryError";
  }
}

export interface PersonalVaultRepository {
  approvePairing(input: ApprovePairingRepositoryInput): Promise<VaultWriteResult>;
  cancelPairing(input: CancelPairingRepositoryInput): Promise<PairingWriteResult>;
  commitSnapshot(input: CommitVaultRepositoryInput): Promise<VaultWriteResult>;
  createPairing(input: CreatePairingRepositoryInput): Promise<PairingWriteResult>;
  createVault(input: CreateVaultRepositoryInput): Promise<VaultWriteResult>;
  findDurableReplay(input: DurableReplayRepositoryInput): Promise<DurableReplayResult | null>;
  getSnapshot(accountId: string): Promise<VaultSnapshotRecord | null>;
  listPairings(accountId: string): Promise<readonly DevicePairingViewV2[]>;
}
