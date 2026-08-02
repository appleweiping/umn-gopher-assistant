import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { Injectable } from "@nestjs/common";
import {
  DevicePairingRequestV2Schema,
  DevicePairingViewV2Schema,
  VaultSyncSnapshotV2Schema,
  type DeviceDescriptorV2,
  type DevicePairingViewV2,
  type VaultSyncSnapshotV2,
} from "@umn-gopher-assistant/contracts";
import { VAULT_MAX_DEVICE_ENVELOPES } from "@umn-gopher-assistant/crypto";
import type { Sql, TransactionSql } from "postgres";
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
import { assertSnapshotIntegrity, decodedBase64UrlLength, hashBase64UrlToHex } from "./vault-integrity.js";

type Transaction = TransactionSql<Record<string, never>>;
const MAX_CONCURRENT_PENDING_PAIRINGS = 8;

interface SnapshotRow {
  readonly accountId: string;
  readonly commit: unknown;
  readonly commitHashHex: string;
  readonly currentKeyringId: string;
  readonly currentManifestId: string;
  readonly currentPayloadId: string;
  readonly currentRevision: number | string;
  readonly headCommitId: string;
  readonly keyring: unknown;
  readonly manifest: unknown;
  readonly payload: unknown;
  readonly vaultId: string;
}

interface CommandRow {
  readonly requestHash: string;
  readonly responseBody: unknown;
  readonly responseEtag: string | null;
  readonly responseRevision: number | string | null;
  readonly status: "failed" | "pending" | "succeeded";
}

interface PairingRow {
  readonly createdAt: Date | string;
  readonly expiresAt: Date | string;
  readonly id: string;
  readonly requestPayload: unknown;
  readonly state: "approved" | "cancelled" | "consumed" | "expired" | "pending";
  readonly updatedAt: Date | string;
  readonly vaultId: string;
}

function numericRevision(value: number | string | null): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("Personal repository returned an invalid revision");
  }
  return parsed;
}

function canonicalTimestamp(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("Personal repository returned an invalid timestamp");
  }
  return parsed.toISOString();
}

function etagFor(snapshot: VaultSyncSnapshotV2): string {
  return `"pv2:${snapshot.commitHash}"`;
}

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function keyDigest(device: DeviceDescriptorV2): Buffer {
  return createHash("sha256")
    .update(device.authorizationKey.keyId)
    .update("\0")
    .update(device.authorizationKey.publicKey)
    .digest();
}

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function snapshotFromRow(row: SnapshotRow): VaultSnapshotRecord {
  const manifest =
    typeof row.manifest === "object" && row.manifest !== null
      ? (row.manifest as { readonly ownerBinding?: unknown })
      : {};
  const snapshot = VaultSyncSnapshotV2Schema.parse({
    formatVersion: 2,
    ownerBinding: manifest.ownerBinding,
    vaultId: row.vaultId,
    commitHash: Buffer.from(row.commitHashHex, "hex").toString("base64url"),
    commit: row.commit,
    payload: row.payload,
    keyring: row.keyring,
    authorizationManifest: row.manifest,
  });
  return {
    etag: etagFor(snapshot),
    revision: numericRevision(row.currentRevision),
    snapshot,
  };
}

function pairingView(row: PairingRow): DevicePairingViewV2 {
  const request = DevicePairingRequestV2Schema.parse(row.requestPayload);
  return DevicePairingViewV2Schema.parse({
    id: row.id,
    vaultId: row.vaultId,
    requestingDevice: request.requestingDevice,
    state: row.state,
    expiresAt: canonicalTimestamp(row.expiresAt),
    createdAt: canonicalTimestamp(row.createdAt),
    updatedAt: canonicalTimestamp(row.updatedAt),
  });
}

function sameCommitment(left: Buffer, right: string): boolean {
  const rightBytes = Buffer.from(right, "base64url");
  try {
    return left.byteLength === rightBytes.byteLength && timingSafeEqual(left, rightBytes);
  } finally {
    rightBytes.fill(0);
  }
}

@Injectable()
export class PostgresPersonalVaultRepository implements PersonalVaultRepository {
  constructor(private readonly sql: Sql<Record<string, never>>) {}

  async #validatedSnapshot(row: SnapshotRow): Promise<VaultSnapshotRecord> {
    const record = snapshotFromRow(row);
    await assertSnapshotIntegrity(record.snapshot);
    return record;
  }

  async #withAccount<T>(accountId: string, operation: (transaction: Transaction) => Promise<T>): Promise<T> {
    return (await this.sql.begin(async (transaction) => {
      // set_config(..., true) is PostgreSQL's parameter-safe equivalent of
      // SET LOCAL and is intentionally the first statement in every tenant
      // transaction. RLS denies all rows if this GUC is absent.
      await transaction`select set_config('app.account_id', ${accountId}, true)`;
      return operation(transaction);
    })) as T;
  }

  async #selectSnapshot(
    transaction: Transaction,
    accountId: string,
    lock: boolean,
  ): Promise<SnapshotRow | null> {
    const rows = lock
      ? await transaction<readonly SnapshotRow[]>`
          select
            v.id as "vaultId",
            v.account_id as "accountId",
            v.current_revision as "currentRevision",
            v.current_payload_id as "currentPayloadId",
            v.current_keyring_id as "currentKeyringId",
            v.current_manifest_id as "currentManifestId",
            v.head_commit_id as "headCommitId",
            p.wire_payload as payload,
            k.wire_payload as keyring,
            m.wire_payload as manifest,
            c.wire_payload as commit,
            c.content_hash as "commitHashHex"
          from personal_vaults v
          join personal_vault_payloads p
            on p.id = v.current_payload_id
           and p.account_id = v.account_id
           and p.vault_id = v.id
          join personal_vault_keyrings k
            on k.id = v.current_keyring_id
           and k.account_id = v.account_id
           and k.vault_id = v.id
          join personal_vault_manifests m
            on m.id = v.current_manifest_id
           and m.account_id = v.account_id
           and m.vault_id = v.id
          join personal_vault_commits c
            on c.id = v.head_commit_id
           and c.account_id = v.account_id
           and c.vault_id = v.id
          where v.account_id = ${accountId}
          for update of v`
      : await transaction<readonly SnapshotRow[]>`
          select
            v.id as "vaultId",
            v.account_id as "accountId",
            v.current_revision as "currentRevision",
            v.current_payload_id as "currentPayloadId",
            v.current_keyring_id as "currentKeyringId",
            v.current_manifest_id as "currentManifestId",
            v.head_commit_id as "headCommitId",
            p.wire_payload as payload,
            k.wire_payload as keyring,
            m.wire_payload as manifest,
            c.wire_payload as commit,
            c.content_hash as "commitHashHex"
          from personal_vaults v
          join personal_vault_payloads p
            on p.id = v.current_payload_id
           and p.account_id = v.account_id
           and p.vault_id = v.id
          join personal_vault_keyrings k
            on k.id = v.current_keyring_id
           and k.account_id = v.account_id
           and k.vault_id = v.id
          join personal_vault_manifests m
            on m.id = v.current_manifest_id
           and m.account_id = v.account_id
           and m.vault_id = v.id
          join personal_vault_commits c
            on c.id = v.head_commit_id
           and c.account_id = v.account_id
           and c.vault_id = v.id
          where v.account_id = ${accountId}`;
    return rows[0] ?? null;
  }

  async #selectCommand(
    transaction: Transaction,
    accountId: string,
    vaultId: string,
    idempotencyKey: string,
  ): Promise<CommandRow | null> {
    const rows = await transaction<readonly CommandRow[]>`
      select
        request_hash as "requestHash",
        status,
        response_body as "responseBody",
        response_etag as "responseEtag",
        response_revision as "responseRevision"
      from personal_vault_commands
      where account_id = ${accountId}
        and vault_id = ${vaultId}
        and idempotency_key = ${idempotencyKey}
      for update`;
    return rows[0] ?? null;
  }

  async #selectCommandByOperation(
    transaction: Transaction,
    accountId: string,
    idempotencyKey: string,
  ): Promise<CommandRow | null> {
    const rows = await transaction<readonly CommandRow[]>`
      select
        request_hash as "requestHash",
        status,
        response_body as "responseBody",
        response_etag as "responseEtag",
        response_revision as "responseRevision"
      from personal_vault_commands
      where account_id = ${accountId}
        and idempotency_key = ${idempotencyKey}
      order by created_at
      limit 2
      for share`;
    if (rows.length > 1) {
      throw new Error("An idempotency key mapped to more than one personal vault");
    }
    return rows[0] ?? null;
  }

  #assertCommandHash(command: CommandRow, requestHash: string): void {
    if (command.requestHash !== requestHash) {
      throw new PersonalVaultRepositoryError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency-Key was already used for a different request",
      );
    }
    if (
      command.status !== "succeeded" ||
      command.responseBody === null ||
      command.responseEtag === null ||
      command.responseRevision === null
    ) {
      throw new PersonalVaultRepositoryError(
        "IDEMPOTENCY_CONFLICT",
        "The previous operation with this Idempotency-Key did not complete",
      );
    }
  }

  async #vaultReplay(command: CommandRow, requestHash: string): Promise<VaultWriteResult> {
    this.#assertCommandHash(command, requestHash);
    if (command.responseEtag === null) {
      throw new Error("Succeeded vault command has no response ETag");
    }
    const snapshot = VaultSyncSnapshotV2Schema.parse(command.responseBody);
    await assertSnapshotIntegrity(snapshot);
    return {
      etag: command.responseEtag,
      replayed: true,
      revision: numericRevision(command.responseRevision),
      snapshot,
    };
  }

  #pairingReplay(command: CommandRow, requestHash: string): PairingWriteResult {
    this.#assertCommandHash(command, requestHash);
    if (command.responseEtag === null) {
      throw new Error("Succeeded pairing command has no response ETag");
    }
    return {
      etag: command.responseEtag,
      pairing: DevicePairingViewV2Schema.parse(command.responseBody),
      replayed: true,
      revision: numericRevision(command.responseRevision),
    };
  }

  async #insertCommand(
    transaction: Transaction,
    input: {
      readonly accountId: string;
      readonly actorKeyId: string | null;
      readonly actorKind: "account" | "device" | "recovery";
      readonly idempotencyKey: string;
      readonly requestHash: string;
      readonly vaultId: string;
    },
  ): Promise<void> {
    await transaction`
      insert into personal_vault_commands (
        account_id, vault_id, idempotency_key, actor_kind, actor_key_id,
        request_hash, status
      ) values (
        ${input.accountId},
        ${input.vaultId},
        ${input.idempotencyKey},
        ${input.actorKind},
        ${input.actorKeyId},
        ${input.requestHash},
        'pending'
      )`;
  }

  async #completeCommand(
    transaction: Transaction,
    input: {
      readonly accountId: string;
      readonly body: unknown;
      readonly etag: string;
      readonly idempotencyKey: string;
      readonly revision: number;
      readonly vaultId: string;
    },
  ): Promise<void> {
    await transaction`
      update personal_vault_commands
         set status = 'succeeded',
             response_body = ${transaction.json(input.body as never)},
             response_etag = ${input.etag},
             response_revision = ${input.revision},
             completed_at = clock_timestamp()
       where account_id = ${input.accountId}
         and vault_id = ${input.vaultId}
         and idempotency_key = ${input.idempotencyKey}`;
  }

  async #writePayload(
    transaction: Transaction,
    accountId: string,
    vaultId: string,
    id: string,
    snapshot: VaultSyncSnapshotV2,
  ): Promise<void> {
    await transaction`
      insert into personal_vault_payloads (
        id, account_id, vault_id, revision, wire_payload, content_hash,
        byte_length, created_at
      ) values (
        ${id}, ${accountId}, ${vaultId}, ${snapshot.payload.revision},
        ${transaction.json(snapshot.payload as never)},
        ${hashBase64UrlToHex(snapshot.commit.payloadHash)},
        ${decodedBase64UrlLength(snapshot.payload.ciphertext)},
        ${snapshot.payload.createdAt}
      )`;
  }

  async #writeKeyring(
    transaction: Transaction,
    accountId: string,
    vaultId: string,
    id: string,
    snapshot: VaultSyncSnapshotV2,
  ): Promise<void> {
    await transaction`
      insert into personal_vault_keyrings (
        id, account_id, vault_id, revision, wire_payload, content_hash,
        byte_length, created_at
      ) values (
        ${id}, ${accountId}, ${vaultId}, ${snapshot.keyring.revision},
        ${transaction.json(snapshot.keyring as never)},
        ${hashBase64UrlToHex(snapshot.commit.keyringHash)},
        ${jsonByteLength(snapshot.keyring)},
        ${snapshot.keyring.createdAt}
      )`;
  }

  async #writeManifest(
    transaction: Transaction,
    accountId: string,
    vaultId: string,
    id: string,
    snapshot: VaultSyncSnapshotV2,
  ): Promise<void> {
    await transaction`
      insert into personal_vault_manifests (
        id, account_id, vault_id, revision, wire_payload, content_hash,
        byte_length, created_at
      ) values (
        ${id}, ${accountId}, ${vaultId},
        ${snapshot.authorizationManifest.revision},
        ${transaction.json(snapshot.authorizationManifest as never)},
        ${hashBase64UrlToHex(snapshot.commit.authorizationManifestHash)},
        ${jsonByteLength(snapshot.authorizationManifest)},
        ${snapshot.authorizationManifest.createdAt}
      )`;
  }

  async #syncDevices(
    transaction: Transaction,
    accountId: string,
    snapshot: VaultSyncSnapshotV2,
  ): Promise<void> {
    for (const device of snapshot.authorizationManifest.devices) {
      const authoredCurrentCommit =
        snapshot.commit.author.kind === "DEVICE" &&
        snapshot.commit.author.deviceId === device.deviceId &&
        snapshot.commit.author.keyId === device.authorizationKey.keyId;
      const digest = keyDigest(device);
      try {
        const rows = await transaction<readonly { readonly id: string }[]>`
          insert into personal_vault_devices (
            id, account_id, vault_id, key_id, wrapping_public_key,
            signing_public_key, key_digest, status, last_seen_at, created_at, revoked_at
          ) values (
            ${device.deviceId},
            ${accountId},
            ${snapshot.vaultId},
            ${device.authorizationKey.keyId},
            ${transaction.json(device.encryptionKey as never)},
            ${transaction.json(device.authorizationKey as never)},
            ${digest},
            ${device.revokedAt === null ? "active" : "revoked"},
            case
              when ${authoredCurrentCommit}
                then greatest(clock_timestamp(), ${device.createdAt}::timestamptz)
              else null
            end,
            ${device.createdAt},
            ${device.revokedAt}
          )
          on conflict (id) do update set
            key_id = excluded.key_id,
            wrapping_public_key = excluded.wrapping_public_key,
            signing_public_key = excluded.signing_public_key,
            key_digest = excluded.key_digest,
            status = excluded.status,
            revoked_at = excluded.revoked_at,
            last_seen_at = case
              when ${authoredCurrentCommit}
                then greatest(
                  personal_vault_devices.last_seen_at,
                  personal_vault_devices.created_at,
                  clock_timestamp()
                )
              else personal_vault_devices.last_seen_at
            end
          where personal_vault_devices.account_id = excluded.account_id
            and personal_vault_devices.vault_id = excluded.vault_id
          returning id`;
        if (rows.length !== 1 || rows[0]?.id !== device.deviceId) {
          throw new Error("Device row upsert did not affect the authenticated account");
        }
      } finally {
        digest.fill(0);
      }
    }
  }

  async #writeSnapshot(
    transaction: Transaction,
    accountId: string,
    snapshot: VaultSyncSnapshotV2,
    previous: SnapshotRow | null,
  ): Promise<VaultWriteResult> {
    const revision = previous === null ? 1 : numericRevision(previous.currentRevision) + 1;
    const previousSnapshot = previous === null ? null : (await this.#validatedSnapshot(previous)).snapshot;
    const payloadUnchanged = previousSnapshot?.commit.payloadHash === snapshot.commit.payloadHash;
    const keyringUnchanged = previousSnapshot?.commit.keyringHash === snapshot.commit.keyringHash;
    const manifestUnchanged =
      previousSnapshot?.commit.authorizationManifestHash === snapshot.commit.authorizationManifestHash;
    const payloadId = payloadUnchanged && previous !== null ? previous.currentPayloadId : randomUUID();
    const keyringId = keyringUnchanged && previous !== null ? previous.currentKeyringId : randomUUID();
    const manifestId = manifestUnchanged && previous !== null ? previous.currentManifestId : randomUUID();
    const commitId = randomUUID();

    if (!payloadUnchanged) {
      await this.#writePayload(transaction, accountId, snapshot.vaultId, payloadId, snapshot);
    }
    if (!keyringUnchanged) {
      await this.#writeKeyring(transaction, accountId, snapshot.vaultId, keyringId, snapshot);
    }
    if (!manifestUnchanged) {
      await this.#writeManifest(transaction, accountId, snapshot.vaultId, manifestId, snapshot);
    }
    await transaction`
      insert into personal_vault_commits (
        id, account_id, vault_id, revision, parent_commit_id, payload_id,
        keyring_id, manifest_id, wire_payload, content_hash, byte_length, created_at
      ) values (
        ${commitId},
        ${accountId},
        ${snapshot.vaultId},
        ${revision},
        ${previous?.headCommitId ?? null},
        ${payloadId},
        ${keyringId},
        ${manifestId},
        ${transaction.json(snapshot.commit as never)},
        ${hashBase64UrlToHex(snapshot.commitHash)},
        ${jsonByteLength(snapshot.commit)},
        ${snapshot.commit.createdAt}
      )`;
    await transaction`
      update personal_vaults
         set current_revision = ${revision},
             current_payload_id = ${payloadId},
             current_keyring_id = ${keyringId},
             current_manifest_id = ${manifestId},
             head_commit_id = ${commitId},
             updated_at = clock_timestamp()
       where id = ${snapshot.vaultId}
         and account_id = ${accountId}`;
    await this.#syncDevices(transaction, accountId, snapshot);
    return {
      etag: etagFor(snapshot),
      replayed: false,
      revision,
      snapshot,
    };
  }

  async getSnapshot(accountId: string): Promise<VaultSnapshotRecord | null> {
    return this.#withAccount(accountId, async (transaction) => {
      const row = await this.#selectSnapshot(transaction, accountId, false);
      return row === null ? null : this.#validatedSnapshot(row);
    });
  }

  async findDurableReplay(input: DurableReplayRepositoryInput): Promise<DurableReplayResult | null> {
    return this.#withAccount(input.accountId, async (transaction) => {
      const command = await this.#selectCommandByOperation(
        transaction,
        input.accountId,
        input.idempotencyKey,
      );
      if (command === null) return null;
      this.#assertCommandHash(command, input.requestHash);
      if (input.resultKind === "vault") {
        const parsed = VaultSyncSnapshotV2Schema.safeParse(command.responseBody);
        if (!parsed.success) {
          throw new PersonalVaultRepositoryError(
            "IDEMPOTENCY_CONFLICT",
            "Idempotency-Key belongs to a different operation result",
          );
        }
        return {
          kind: "vault",
          result: await this.#vaultReplay(command, input.requestHash),
        };
      }
      const parsed = DevicePairingViewV2Schema.safeParse(command.responseBody);
      if (!parsed.success) {
        throw new PersonalVaultRepositoryError(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key belongs to a different operation result",
        );
      }
      return {
        kind: "pairing",
        result: this.#pairingReplay(command, input.requestHash),
      };
    });
  }

  async createVault(input: CreateVaultRepositoryInput): Promise<VaultWriteResult> {
    try {
      return await this.#withAccount(input.accountId, async (transaction) => {
        await transaction`
          select pg_advisory_xact_lock(hashtextextended(${input.accountId}, 0))`;
        const existing = await this.#selectSnapshot(transaction, input.accountId, true);
        if (existing !== null) {
          const replay = await this.#selectCommand(
            transaction,
            input.accountId,
            existing.vaultId,
            input.idempotencyKey,
          );
          if (replay !== null) return this.#vaultReplay(replay, input.requestHash);
          throw new PersonalVaultRepositoryError(
            "ALREADY_EXISTS",
            "An account may have only one personal vault",
          );
        }
        await transaction`
          insert into personal_vaults (id, account_id)
          values (${input.command.vaultId}, ${input.accountId})`;
        await this.#insertCommand(transaction, {
          accountId: input.accountId,
          actorKeyId: input.command.proof.signer.keyId,
          actorKind: input.command.proof.signer.kind === "DEVICE" ? "device" : "recovery",
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          vaultId: input.command.vaultId,
        });
        const result = await this.#writeSnapshot(transaction, input.accountId, input.command.snapshot, null);
        await this.#completeCommand(transaction, {
          accountId: input.accountId,
          body: result.snapshot,
          etag: result.etag,
          idempotencyKey: input.idempotencyKey,
          revision: result.revision,
          vaultId: input.command.vaultId,
        });
        return result;
      });
    } catch (error) {
      if (error instanceof PersonalVaultRepositoryError) throw error;
      if (postgresErrorCode(error) === "23505") {
        throw new PersonalVaultRepositoryError(
          "ALREADY_EXISTS",
          "An account may have only one personal vault",
        );
      }
      throw error;
    }
  }

  async commitSnapshot(input: CommitVaultRepositoryInput): Promise<VaultWriteResult> {
    return this.#withAccount(input.accountId, async (transaction) => {
      const current = await this.#selectSnapshot(transaction, input.accountId, true);
      if (current === null || current.vaultId !== input.command.vaultId) {
        throw new PersonalVaultRepositoryError("NOT_FOUND", "Personal vault was not found");
      }
      const replay = await this.#selectCommand(
        transaction,
        input.accountId,
        input.command.vaultId,
        input.idempotencyKey,
      );
      if (replay !== null) return this.#vaultReplay(replay, input.requestHash);
      const currentRecord = await this.#validatedSnapshot(current);
      if (
        currentRecord.etag !== input.expectedEtag ||
        currentRecord.snapshot.commitHash !== input.command.expectedParentCommitHash
      ) {
        throw new PersonalVaultRepositoryError("STALE_WRITE", "Vault changed after the client read it");
      }
      await this.#insertCommand(transaction, {
        accountId: input.accountId,
        actorKeyId: input.command.proof.signer.keyId,
        actorKind: input.command.proof.signer.kind === "DEVICE" ? "device" : "recovery",
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        vaultId: input.command.vaultId,
      });
      const result = await this.#writeSnapshot(
        transaction,
        input.accountId,
        input.command.nextSnapshot,
        current,
      );
      await this.#completeCommand(transaction, {
        accountId: input.accountId,
        body: result.snapshot,
        etag: result.etag,
        idempotencyKey: input.idempotencyKey,
        revision: result.revision,
        vaultId: input.command.vaultId,
      });
      return result;
    });
  }

  async listPairings(accountId: string): Promise<readonly DevicePairingViewV2[]> {
    return this.#withAccount(accountId, async (transaction) => {
      const current = await this.#selectSnapshot(transaction, accountId, false);
      if (current === null) {
        throw new PersonalVaultRepositoryError("NOT_FOUND", "Personal vault was not found");
      }
      await this.#validatedSnapshot(current);
      await transaction`
        update personal_vault_pairings
           set state = 'expired', updated_at = clock_timestamp()
         where account_id = ${accountId}
           and vault_id = ${current.vaultId}
           and state = 'pending'
           and expires_at <= clock_timestamp()`;
      const rows = await transaction<readonly PairingRow[]>`
        select
          id,
          vault_id as "vaultId",
          state,
          request_payload as "requestPayload",
          expires_at as "expiresAt",
          created_at as "createdAt",
          updated_at as "updatedAt"
        from personal_vault_pairings
        where account_id = ${accountId}
          and vault_id = ${current.vaultId}
        order by created_at desc
        limit 100`;
      return rows.map((row) => pairingView(row));
    });
  }

  async createPairing(input: CreatePairingRepositoryInput): Promise<PairingWriteResult> {
    return this.#withAccount(input.accountId, async (transaction) => {
      const current = await this.#selectSnapshot(transaction, input.accountId, true);
      if (current === null || current.vaultId !== input.request.vaultId) {
        throw new PersonalVaultRepositoryError("NOT_FOUND", "Personal vault was not found");
      }
      const replay = await this.#selectCommand(
        transaction,
        input.accountId,
        input.request.vaultId,
        input.idempotencyKey,
      );
      if (replay !== null) return this.#pairingReplay(replay, input.requestHash);
      const currentRecord = await this.#validatedSnapshot(current);
      if (currentRecord.etag !== input.expectedEtag) {
        throw new PersonalVaultRepositoryError("STALE_WRITE", "Vault changed after the client read it");
      }
      const active = currentRecord.snapshot.authorizationManifest.devices.some(
        (device) =>
          device.revokedAt === null &&
          (device.deviceId === input.request.requestingDevice.deviceId ||
            device.encryptionKey.keyId === input.request.requestingDevice.encryptionKey.keyId ||
            device.authorizationKey.keyId === input.request.requestingDevice.authorizationKey.keyId),
      );
      const pending = await transaction<readonly { readonly count: number | string }[]>`
        select count(*) as count
          from personal_vault_pairings
          where account_id = ${input.accountId}
            and vault_id = ${input.request.vaultId}
            and state = 'pending'
            and expires_at > clock_timestamp()`;
      const pendingCount = Number(pending[0]?.count ?? Number.NaN);
      if (!Number.isSafeInteger(pendingCount) || pendingCount < 0) {
        throw new Error("Personal repository returned an invalid pending-pairing count");
      }
      const duplicatePending = await transaction<readonly { readonly exists: boolean }[]>`
        select exists (
          select 1 from personal_vault_pairings
          where account_id = ${input.accountId}
            and vault_id = ${input.request.vaultId}
            and (
              code_digest = ${Buffer.from(input.request.pairingCodeCommitment, "base64url")}
              or (
                state = 'pending'
                and expires_at > clock_timestamp()
                and (
                  requesting_device_id = ${input.request.requestingDevice.deviceId}
                  or request_payload #>> '{requestingDevice,encryptionKey,keyId}'
                    = ${input.request.requestingDevice.encryptionKey.keyId}
                  or request_payload #>> '{requestingDevice,authorizationKey,keyId}'
                    = ${input.request.requestingDevice.authorizationKey.keyId}
                )
              )
            )
        ) as exists`;
      if (
        active ||
        duplicatePending[0]?.exists === true ||
        currentRecord.snapshot.authorizationManifest.devices.length >= VAULT_MAX_DEVICE_ENVELOPES ||
        pendingCount >= MAX_CONCURRENT_PENDING_PAIRINGS
      ) {
        throw new PersonalVaultRepositoryError(
          "PAIRING_CONFLICT",
          "Device is already active, has a pending pairing, or the vault pairing limit is reached",
        );
      }
      await this.#insertCommand(transaction, {
        accountId: input.accountId,
        actorKeyId: input.request.requestingDevice.authorizationKey.keyId,
        actorKind: "device",
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        vaultId: input.request.vaultId,
      });
      const id = randomUUID();
      const inserted = await transaction<readonly PairingRow[]>`
        insert into personal_vault_pairings (
          id, account_id, vault_id, requesting_device_id, state, code_digest,
          request_payload, expires_at
        )
        select
          ${id},
          ${input.accountId},
          ${input.request.vaultId},
          ${input.request.requestingDevice.deviceId},
          'pending',
          ${Buffer.from(input.request.pairingCodeCommitment, "base64url")},
          ${transaction.json(input.request as never)},
          ${input.request.expiresAt}
        where ${input.request.expiresAt}::timestamptz > clock_timestamp()
        returning
          id,
          vault_id as "vaultId",
          state,
          request_payload as "requestPayload",
          expires_at as "expiresAt",
          created_at as "createdAt",
          updated_at as "updatedAt"`;
      const insertedPairing = inserted[0];
      if (insertedPairing === undefined) {
        throw new PersonalVaultRepositoryError(
          "PAIRING_CONFLICT",
          "Pairing request expired before it could be stored",
        );
      }
      const pairing = pairingView(insertedPairing);
      const result: PairingWriteResult = {
        etag: currentRecord.etag,
        pairing,
        replayed: false,
        revision: currentRecord.revision,
      };
      await this.#completeCommand(transaction, {
        accountId: input.accountId,
        body: pairing,
        etag: result.etag,
        idempotencyKey: input.idempotencyKey,
        revision: result.revision,
        vaultId: input.request.vaultId,
      });
      return result;
    });
  }

  async cancelPairing(input: CancelPairingRepositoryInput): Promise<PairingWriteResult> {
    return this.#withAccount(input.accountId, async (transaction) => {
      const current = await this.#selectSnapshot(transaction, input.accountId, true);
      if (current === null) {
        throw new PersonalVaultRepositoryError("NOT_FOUND", "Personal vault was not found");
      }
      const replay = await this.#selectCommand(
        transaction,
        input.accountId,
        current.vaultId,
        input.idempotencyKey,
      );
      if (replay !== null) return this.#pairingReplay(replay, input.requestHash);
      const currentRecord = await this.#validatedSnapshot(current);
      if (currentRecord.etag !== input.expectedEtag) {
        throw new PersonalVaultRepositoryError("STALE_WRITE", "Vault changed after the client read it");
      }
      const rows = await transaction<readonly (PairingRow & { readonly codeDigest: Buffer })[]>`
        select
          id,
          vault_id as "vaultId",
          state,
          code_digest as "codeDigest",
          request_payload as "requestPayload",
          expires_at as "expiresAt",
          created_at as "createdAt",
          updated_at as "updatedAt"
        from personal_vault_pairings
        where id = ${input.pairingId}
          and account_id = ${input.accountId}
          and vault_id = ${current.vaultId}
        for update`;
      const row = rows[0];
      if (row === undefined) {
        throw new PersonalVaultRepositoryError("NOT_FOUND", "Pairing was not found");
      }
      if (row.state !== "pending") {
        throw new PersonalVaultRepositoryError("PAIRING_CONFLICT", "Only a pending pairing can be cancelled");
      }
      await this.#insertCommand(transaction, {
        accountId: input.accountId,
        actorKeyId: null,
        actorKind: "account",
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        vaultId: current.vaultId,
      });
      const updatedRows = await transaction<readonly PairingRow[]>`
        update personal_vault_pairings
           set state = 'cancelled', updated_at = clock_timestamp()
         where id = ${input.pairingId}
           and account_id = ${input.accountId}
           and vault_id = ${current.vaultId}
        returning
          id,
          vault_id as "vaultId",
          state,
          request_payload as "requestPayload",
          expires_at as "expiresAt",
          created_at as "createdAt",
          updated_at as "updatedAt"`;
      const updated = updatedRows[0];
      if (updated === undefined) {
        throw new Error("Pairing cancellation did not update a row");
      }
      const pairing = pairingView(updated);
      const result: PairingWriteResult = {
        etag: currentRecord.etag,
        pairing,
        replayed: false,
        revision: currentRecord.revision,
      };
      await this.#completeCommand(transaction, {
        accountId: input.accountId,
        body: pairing,
        etag: result.etag,
        idempotencyKey: input.idempotencyKey,
        revision: result.revision,
        vaultId: current.vaultId,
      });
      return result;
    });
  }

  async approvePairing(input: ApprovePairingRepositoryInput): Promise<VaultWriteResult> {
    return this.#withAccount(input.accountId, async (transaction) => {
      const current = await this.#selectSnapshot(transaction, input.accountId, true);
      if (current === null || current.vaultId !== input.command.vaultId) {
        throw new PersonalVaultRepositoryError("NOT_FOUND", "Personal vault was not found");
      }
      const replay = await this.#selectCommand(
        transaction,
        input.accountId,
        input.command.vaultId,
        input.idempotencyKey,
      );
      if (replay !== null) return this.#vaultReplay(replay, input.requestHash);
      const currentRecord = await this.#validatedSnapshot(current);
      if (
        currentRecord.etag !== input.expectedEtag ||
        currentRecord.snapshot.commitHash !== input.command.expectedParentCommitHash
      ) {
        throw new PersonalVaultRepositoryError("STALE_WRITE", "Vault changed after the client read it");
      }
      const rows = await transaction<readonly (PairingRow & { readonly codeDigest: Buffer })[]>`
        select
          id,
          vault_id as "vaultId",
          state,
          code_digest as "codeDigest",
          request_payload as "requestPayload",
          expires_at as "expiresAt",
          created_at as "createdAt",
          updated_at as "updatedAt"
        from personal_vault_pairings
        where id = ${input.pairingId}
          and account_id = ${input.accountId}
          and vault_id = ${input.command.vaultId}
        for update`;
      const pairing = rows[0];
      if (pairing === undefined) {
        throw new PersonalVaultRepositoryError("NOT_FOUND", "Pairing was not found");
      }
      const request = DevicePairingRequestV2Schema.parse(pairing.requestPayload);
      if (
        pairing.state !== "pending" ||
        Date.parse(canonicalTimestamp(pairing.expiresAt)) <= Date.now() ||
        !sameCommitment(pairing.codeDigest, input.pairingCodeCommitment) ||
        JSON.stringify(request.requestingDevice) !== JSON.stringify(input.command.pairedDevice)
      ) {
        throw new PersonalVaultRepositoryError(
          "PAIRING_CONFLICT",
          "Pairing is expired, already used, or does not match the approved device",
        );
      }
      await this.#insertCommand(transaction, {
        accountId: input.accountId,
        actorKeyId: input.command.proof.signer.keyId,
        actorKind: input.command.proof.signer.kind === "DEVICE" ? "device" : "recovery",
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        vaultId: input.command.vaultId,
      });
      const result = await this.#writeSnapshot(
        transaction,
        input.accountId,
        input.command.nextSnapshot,
        current,
      );
      await transaction`
        update personal_vault_pairings
           set state = 'consumed',
               approving_device_id = ${input.command.proof.signer.deviceId},
               response_payload = ${transaction.json(result.snapshot as never)},
               consumed_at = clock_timestamp(),
               updated_at = clock_timestamp()
         where id = ${input.pairingId}
           and account_id = ${input.accountId}
           and vault_id = ${input.command.vaultId}`;
      await this.#completeCommand(transaction, {
        accountId: input.accountId,
        body: result.snapshot,
        etag: result.etag,
        idempotencyKey: input.idempotencyKey,
        revision: result.revision,
        vaultId: input.command.vaultId,
      });
      return result;
    });
  }
}
