/* eslint-disable @typescript-eslint/require-await -- the in-memory adapter intentionally mirrors the async repository port. */
import { timingSafeEqual } from "node:crypto";

import { Injectable } from "@nestjs/common";
import type {
  DevicePairingRequestV2,
  DevicePairingViewV2,
  PairingStateV2,
  VaultMutationCommandV2,
  VaultSyncSnapshotV2,
} from "@umn-gopher-assistant/contracts";
import { VAULT_MAX_DEVICE_ENVELOPES } from "@umn-gopher-assistant/crypto";
import {
  PersonalVaultRepositoryError,
  type ApprovePairingRepositoryInput,
  type CancelPairingRepositoryInput,
  type CommitVaultRepositoryInput,
  type CreatePairingRepositoryInput,
  type CreateVaultRepositoryInput,
  type DurableReplayRepositoryInput,
  type DurableReplayResult,
  type PairingWriteResult,
  type PersonalVaultRepository,
  type VaultSnapshotRecord,
  type VaultWriteResult,
} from "./personal-vault.repository.js";

interface MutablePairing {
  readonly createdAt: string;
  readonly id: string;
  readonly pairingCodeCommitment: string;
  readonly request: DevicePairingRequestV2;
  state: PairingStateV2;
  updatedAt: string;
}

type StoredResult =
  | { readonly kind: "pairing"; readonly requestHash: string; readonly result: PairingWriteResult }
  | { readonly kind: "vault"; readonly requestHash: string; readonly result: VaultWriteResult };

interface AccountVaultState {
  readonly commands: Map<string, StoredResult>;
  readonly pairings: Map<string, MutablePairing>;
  revision: number;
  snapshot: VaultSyncSnapshotV2;
}

const MAX_CONCURRENT_PENDING_PAIRINGS = 8;

function etagFor(snapshot: VaultSyncSnapshotV2): string {
  return `"pv2:${snapshot.commitHash}"`;
}

function snapshotRecord(state: AccountVaultState): VaultSnapshotRecord {
  return {
    etag: etagFor(state.snapshot),
    revision: state.revision,
    snapshot: structuredClone(state.snapshot),
  };
}

function replayVault(result: VaultWriteResult): VaultWriteResult {
  return { ...structuredClone(result), replayed: true };
}

function replayPairing(result: PairingWriteResult): PairingWriteResult {
  return { ...structuredClone(result), replayed: true };
}

function commandKey(vaultId: string, idempotencyKey: string): string {
  return `${vaultId}\0${idempotencyKey}`;
}

function pairingView(pairing: MutablePairing): DevicePairingViewV2 {
  return {
    id: pairing.id,
    vaultId: pairing.request.vaultId,
    requestingDevice: structuredClone(pairing.request.requestingDevice),
    state: pairing.state,
    expiresAt: pairing.request.expiresAt,
    createdAt: pairing.createdAt,
    updatedAt: pairing.updatedAt,
  };
}

function sameCommitment(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "base64url");
  const rightBytes = Buffer.from(right, "base64url");
  try {
    return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
  } finally {
    leftBytes.fill(0);
    rightBytes.fill(0);
  }
}

@Injectable()
export class InMemoryPersonalVaultRepository implements PersonalVaultRepository {
  readonly #accounts = new Map<string, AccountVaultState>();

  #storedByOperation(state: AccountVaultState, idempotencyKey: string): StoredResult | null {
    const suffix = `\0${idempotencyKey}`;
    const matches = [...state.commands.entries()]
      .filter(([key]) => key.endsWith(suffix))
      .map(([, stored]) => stored);
    if (matches.length > 1) {
      throw new Error("An idempotency key mapped to more than one personal vault");
    }
    return matches[0] ?? null;
  }

  #replayed(
    state: AccountVaultState,
    vaultId: string,
    idempotencyKey: string,
    requestHash: string,
  ): StoredResult | null {
    const stored = state.commands.get(commandKey(vaultId, idempotencyKey));
    if (stored === undefined) return null;
    if (stored.requestHash !== requestHash) {
      throw new PersonalVaultRepositoryError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency-Key was already used for a different request",
      );
    }
    return stored;
  }

  #stateFor(accountId: string, vaultId?: string): AccountVaultState {
    const state = this.#accounts.get(accountId);
    if (state === undefined || (vaultId !== undefined && state.snapshot.vaultId !== vaultId)) {
      throw new PersonalVaultRepositoryError("NOT_FOUND", "Personal vault was not found");
    }
    return state;
  }

  #assertCurrent(state: AccountVaultState, expectedEtag: string, expectedParentCommitHash: string): void {
    if (etagFor(state.snapshot) !== expectedEtag || state.snapshot.commitHash !== expectedParentCommitHash) {
      throw new PersonalVaultRepositoryError("STALE_WRITE", "Vault changed after the client read it");
    }
  }

  #commit(
    state: AccountVaultState,
    command: Exclude<VaultMutationCommandV2, { readonly commandType: "CREATE_VAULT" }>,
  ): VaultWriteResult {
    state.revision += 1;
    state.snapshot = structuredClone(command.nextSnapshot);
    return { ...snapshotRecord(state), replayed: false };
  }

  async getSnapshot(accountId: string): Promise<VaultSnapshotRecord | null> {
    const state = this.#accounts.get(accountId);
    return state === undefined ? null : snapshotRecord(state);
  }

  async findDurableReplay(input: DurableReplayRepositoryInput): Promise<DurableReplayResult | null> {
    const state = this.#accounts.get(input.accountId);
    if (state === undefined) return null;
    const stored = this.#storedByOperation(state, input.idempotencyKey);
    if (stored === null) return null;
    if (stored.requestHash !== input.requestHash || stored.kind !== input.resultKind) {
      throw new PersonalVaultRepositoryError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency-Key was already used for a different request",
      );
    }
    return stored.kind === "vault"
      ? { kind: "vault", result: replayVault(stored.result) }
      : { kind: "pairing", result: replayPairing(stored.result) };
  }

  async createVault(input: CreateVaultRepositoryInput): Promise<VaultWriteResult> {
    const existing = this.#accounts.get(input.accountId);
    if (existing !== undefined) {
      const replay = this.#replayed(existing, input.command.vaultId, input.idempotencyKey, input.requestHash);
      if (replay?.kind === "vault") return replayVault(replay.result);
      throw new PersonalVaultRepositoryError("ALREADY_EXISTS", "An account may have only one personal vault");
    }

    const state: AccountVaultState = {
      commands: new Map(),
      pairings: new Map(),
      revision: 1,
      snapshot: structuredClone(input.command.snapshot),
    };
    const result: VaultWriteResult = { ...snapshotRecord(state), replayed: false };
    state.commands.set(commandKey(input.command.vaultId, input.idempotencyKey), {
      kind: "vault",
      requestHash: input.requestHash,
      result: structuredClone(result),
    });
    this.#accounts.set(input.accountId, state);
    return result;
  }

  async commitSnapshot(input: CommitVaultRepositoryInput): Promise<VaultWriteResult> {
    const state = this.#stateFor(input.accountId, input.command.vaultId);
    const replay = this.#replayed(state, input.command.vaultId, input.idempotencyKey, input.requestHash);
    if (replay?.kind === "vault") return replayVault(replay.result);
    this.#assertCurrent(state, input.expectedEtag, input.command.expectedParentCommitHash);
    const result = this.#commit(state, input.command);
    state.commands.set(commandKey(input.command.vaultId, input.idempotencyKey), {
      kind: "vault",
      requestHash: input.requestHash,
      result: structuredClone(result),
    });
    return result;
  }

  async listPairings(accountId: string): Promise<readonly DevicePairingViewV2[]> {
    const state = this.#stateFor(accountId);
    const now = Date.now();
    for (const pairing of state.pairings.values()) {
      if (pairing.state === "pending" && Date.parse(pairing.request.expiresAt) <= now) {
        pairing.state = "expired";
        pairing.updatedAt = new Date(now).toISOString();
      }
    }
    return [...state.pairings.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 100)
      .map((pairing) => pairingView(pairing));
  }

  async createPairing(input: CreatePairingRepositoryInput): Promise<PairingWriteResult> {
    const state = this.#stateFor(input.accountId, input.request.vaultId);
    const replay = this.#replayed(state, input.request.vaultId, input.idempotencyKey, input.requestHash);
    if (replay?.kind === "pairing") return replayPairing(replay.result);
    this.#assertCurrent(state, input.expectedEtag, state.snapshot.commitHash);
    const nowMilliseconds = Date.now();
    const expiredAt = new Date(nowMilliseconds).toISOString();
    for (const pairing of state.pairings.values()) {
      if (pairing.state === "pending" && Date.parse(pairing.request.expiresAt) <= nowMilliseconds) {
        pairing.state = "expired";
        pairing.updatedAt = expiredAt;
      }
    }
    const alreadyActive = state.snapshot.authorizationManifest.devices.some(
      (device) =>
        device.revokedAt === null &&
        (device.deviceId === input.request.requestingDevice.deviceId ||
          device.encryptionKey.keyId === input.request.requestingDevice.encryptionKey.keyId ||
          device.authorizationKey.keyId === input.request.requestingDevice.authorizationKey.keyId),
    );
    const pendingPairings = [...state.pairings.values()].filter(
      (pairing) => pairing.state === "pending" && Date.parse(pairing.request.expiresAt) > nowMilliseconds,
    );
    const alreadyPending = pendingPairings.some(
      (pairing) =>
        pairing.request.requestingDevice.deviceId === input.request.requestingDevice.deviceId ||
        pairing.request.requestingDevice.encryptionKey.keyId ===
          input.request.requestingDevice.encryptionKey.keyId ||
        pairing.request.requestingDevice.authorizationKey.keyId ===
          input.request.requestingDevice.authorizationKey.keyId,
    );
    const reusedCommitment = [...state.pairings.values()].some(
      (pairing) => pairing.pairingCodeCommitment === input.request.pairingCodeCommitment,
    );
    if (
      Date.parse(input.request.expiresAt) <= nowMilliseconds ||
      alreadyActive ||
      alreadyPending ||
      reusedCommitment ||
      state.snapshot.authorizationManifest.devices.length >= VAULT_MAX_DEVICE_ENVELOPES ||
      pendingPairings.length >= MAX_CONCURRENT_PENDING_PAIRINGS
    ) {
      throw new PersonalVaultRepositoryError(
        "PAIRING_CONFLICT",
        "Device is already active, has a pending pairing, or the vault pairing limit is reached",
      );
    }
    const now = new Date().toISOString();
    const pairing: MutablePairing = {
      createdAt: now,
      id: crypto.randomUUID(),
      pairingCodeCommitment: input.request.pairingCodeCommitment,
      request: structuredClone(input.request),
      state: "pending",
      updatedAt: now,
    };
    state.pairings.set(pairing.id, pairing);
    const result: PairingWriteResult = {
      etag: etagFor(state.snapshot),
      pairing: pairingView(pairing),
      replayed: false,
      revision: state.revision,
    };
    state.commands.set(commandKey(input.request.vaultId, input.idempotencyKey), {
      kind: "pairing",
      requestHash: input.requestHash,
      result: structuredClone(result),
    });
    return result;
  }

  async cancelPairing(input: CancelPairingRepositoryInput): Promise<PairingWriteResult> {
    const state = this.#stateFor(input.accountId);
    const replay = this.#replayed(state, state.snapshot.vaultId, input.idempotencyKey, input.requestHash);
    if (replay?.kind === "pairing") return replayPairing(replay.result);
    this.#assertCurrent(state, input.expectedEtag, state.snapshot.commitHash);
    const pairing = state.pairings.get(input.pairingId);
    if (pairing === undefined) {
      throw new PersonalVaultRepositoryError("NOT_FOUND", "Pairing was not found");
    }
    if (pairing.state !== "pending") {
      throw new PersonalVaultRepositoryError("PAIRING_CONFLICT", "Only a pending pairing can be cancelled");
    }
    pairing.state = "cancelled";
    pairing.updatedAt = new Date().toISOString();
    const result: PairingWriteResult = {
      etag: etagFor(state.snapshot),
      pairing: pairingView(pairing),
      replayed: false,
      revision: state.revision,
    };
    state.commands.set(commandKey(state.snapshot.vaultId, input.idempotencyKey), {
      kind: "pairing",
      requestHash: input.requestHash,
      result: structuredClone(result),
    });
    return result;
  }

  async approvePairing(input: ApprovePairingRepositoryInput): Promise<VaultWriteResult> {
    const state = this.#stateFor(input.accountId, input.command.vaultId);
    const replay = this.#replayed(state, input.command.vaultId, input.idempotencyKey, input.requestHash);
    if (replay?.kind === "vault") return replayVault(replay.result);
    this.#assertCurrent(state, input.expectedEtag, input.command.expectedParentCommitHash);
    const pairing = state.pairings.get(input.pairingId);
    if (pairing === undefined) {
      throw new PersonalVaultRepositoryError("NOT_FOUND", "Pairing was not found");
    }
    if (
      pairing.state !== "pending" ||
      Date.parse(pairing.request.expiresAt) <= Date.now() ||
      !sameCommitment(pairing.pairingCodeCommitment, input.pairingCodeCommitment) ||
      JSON.stringify(pairing.request.requestingDevice) !== JSON.stringify(input.command.pairedDevice)
    ) {
      throw new PersonalVaultRepositoryError(
        "PAIRING_CONFLICT",
        "Pairing is expired, already used, or does not match the approved device",
      );
    }
    const result = this.#commit(state, input.command);
    pairing.state = "consumed";
    pairing.updatedAt = new Date().toISOString();
    state.commands.set(commandKey(input.command.vaultId, input.idempotencyKey), {
      kind: "vault",
      requestHash: input.requestHash,
      result: structuredClone(result),
    });
    return result;
  }
}
