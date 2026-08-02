import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  DevicePairingRequestV2Schema,
  PairingApprovalRequestV2Schema,
  RecoveryAuthorizationPublicKeyV2Schema,
  VaultCreateCommandV2Schema,
  VaultRotateKeyCommandV2Schema,
  VaultUpdatePayloadCommandV2Schema,
  type DevicePairingViewV2,
  type RecoveryAuthorizationPublicKeyV2,
  type VaultCreateCommandV2,
  type VaultMutationCommandV2,
  type VaultPairDeviceCommandV2,
  type VaultRotateKeyCommandV2,
  type VaultSyncSnapshotV2,
  type VaultUpdatePayloadCommandV2,
  decodeVaultReadProofHeaderV2,
} from "@umn-gopher-assistant/contracts";
import { ZodError } from "zod";

import { ACCOUNT_RESOLVER } from "../accounts/account.tokens.js";
import {
  AccountIdentityInactiveError,
  AccountIdentityUnavailableError,
  type AccountContext,
  type AccountResolver,
} from "../accounts/account.types.js";
import type { AuthPrincipal } from "../auth/auth.types.js";
import { PERSONAL_VAULT_REPOSITORY } from "./personal-vault.tokens.js";
import {
  PersonalVaultRepositoryError,
  type DurableReplayResult,
  type PairingWriteResult,
  type PersonalVaultRepository,
  type VaultSnapshotRecord,
  type VaultWriteResult,
} from "./personal-vault.repository.js";
import { ReadProofReplayGuard } from "./read-proof-replay.guard.js";
import {
  VaultProtocolError,
  assertCommandProof,
  assertCommitSignature,
  assertPairingRequest,
  assertReadProof,
  assertSnapshotIntegrity,
} from "./vault-integrity.js";

const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{16,128}$/u;
const STRONG_ETAG_PATTERN = /^"[\x21\x23-\x7e]+"$/u;

function parseBody<T>(schema: { parse(value: unknown): T }, body: unknown): T {
  try {
    return schema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new BadRequestException(
        error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      );
    }
    throw error;
  }
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseIdempotencyKey(value: string | undefined, operationId?: string): string {
  if (value === undefined) {
    throw new HttpException("Idempotency-Key is required", HttpStatus.PRECONDITION_REQUIRED);
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(value) || /\s/u.test(value)) {
    throw new BadRequestException(
      "Idempotency-Key must contain 16 through 128 visible non-whitespace ASCII characters",
    );
  }
  if (operationId !== undefined && value !== operationId) {
    throw new BadRequestException("Idempotency-Key must exactly equal command operationId");
  }
  return value;
}

function parseIfMatch(value: string | undefined): string {
  if (value === undefined) {
    throw new HttpException("If-Match is required", HttpStatus.PRECONDITION_REQUIRED);
  }
  if (!STRONG_ETAG_PATTERN.test(value) || value.startsWith('W/"') || value.includes(",")) {
    throw new BadRequestException("If-Match must contain exactly one strong entity tag");
  }
  return value;
}

function assertCreatePrecondition(value: string | undefined): void {
  if (value === undefined) {
    throw new HttpException("If-None-Match: * is required", HttpStatus.PRECONDITION_REQUIRED);
  }
  if (value.trim() !== "*") {
    throw new BadRequestException("Vault creation requires If-None-Match: *");
  }
}

function assertAccountBinding(account: AccountContext, ownerBinding: string): void {
  if (ownerBinding !== account.ownerBinding) {
    // Do not reveal whether a client-supplied owner or vault identifier belongs
    // to another account.
    throw new NotFoundException("Personal vault was not found");
  }
}

function assertVaultBinding(current: VaultSnapshotRecord, vaultId: string): void {
  if (current.snapshot.vaultId !== vaultId) {
    throw new NotFoundException("Personal vault was not found");
  }
}

function assertNextSequence(current: VaultSyncSnapshotV2, next: VaultSyncSnapshotV2): void {
  if (next.commit.sequence !== current.commit.sequence + 1) {
    throw new ConflictException("Vault commit sequence must advance by exactly one");
  }
}

function assertSameJson(left: unknown, right: unknown, message: string): void {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new ConflictException(message);
  }
}

export function assertGenesisTransition(command: VaultCreateCommandV2): void {
  const snapshot = command.snapshot;
  if (
    snapshot.commit.epoch !== 1 ||
    snapshot.commit.sequence !== 1 ||
    snapshot.commit.parentCommitHash !== null ||
    snapshot.payload.revision !== 1 ||
    snapshot.payload.baseRevision !== null ||
    snapshot.keyring.revision !== 1 ||
    snapshot.authorizationManifest.epoch !== 1 ||
    snapshot.authorizationManifest.revision !== 1
  ) {
    throw new BadRequestException("Vault creation requires epoch-one genesis artifacts at revision one");
  }
  const commitCreatedAt = Date.parse(snapshot.commit.createdAt);
  if (
    Date.parse(snapshot.payload.createdAt) > commitCreatedAt ||
    Date.parse(snapshot.keyring.createdAt) > commitCreatedAt ||
    Date.parse(snapshot.keyring.updatedAt) > commitCreatedAt ||
    Date.parse(snapshot.authorizationManifest.createdAt) > commitCreatedAt ||
    Date.parse(snapshot.authorizationManifest.updatedAt) > commitCreatedAt ||
    commitCreatedAt > Date.parse(command.proof.issuedAt)
  ) {
    throw new BadRequestException("Genesis artifact timestamps must precede the commit and command proof");
  }
}

function assertUpdateTransition(current: VaultSyncSnapshotV2, command: VaultUpdatePayloadCommandV2): void {
  const next = command.nextSnapshot;
  assertNextSequence(current, next);
  if (
    next.commit.epoch !== current.commit.epoch ||
    next.payload.revision !== current.payload.revision + 1 ||
    next.payload.baseRevision !== current.payload.revision
  ) {
    throw new ConflictException(
      "Payload update must advance only the consecutive payload and commit revisions",
    );
  }
  assertSameJson(next.keyring, current.keyring, "Payload update must not rewrite the keyring");
  assertSameJson(
    next.authorizationManifest,
    current.authorizationManifest,
    "Payload update must not rewrite the authorization manifest",
  );
}

export function assertPairTransition(current: VaultSyncSnapshotV2, command: VaultPairDeviceCommandV2): void {
  const next = command.nextSnapshot;
  assertNextSequence(current, next);
  if (
    next.commit.epoch !== current.commit.epoch ||
    next.payload.revision !== current.payload.revision ||
    next.keyring.revision !== current.keyring.revision + 1 ||
    next.authorizationManifest.revision !== current.authorizationManifest.revision + 1
  ) {
    throw new ConflictException(
      "Pairing must preserve payload and epoch while advancing keyring and manifest once",
    );
  }
  assertSameJson(next.payload, current.payload, "Pairing must not rewrite encrypted personal content");
  assertSameJson(
    next.authorizationManifest.recoveryAuthorization,
    current.authorizationManifest.recoveryAuthorization,
    "Pairing must not rotate the recovery authorization key",
  );
  const currentDevices = current.authorizationManifest.devices;
  const nextDevices = next.authorizationManifest.devices;
  const appended = nextDevices.at(-1);
  if (
    nextDevices.length !== currentDevices.length + 1 ||
    currentDevices.some((device, index) => JSON.stringify(device) !== JSON.stringify(nextDevices[index])) ||
    JSON.stringify(appended) !== JSON.stringify(command.pairedDevice)
  ) {
    throw new ConflictException(
      "Pairing may append exactly the approved device without changing any existing descriptor",
    );
  }
}

export function assertRotationTransition(
  current: VaultSyncSnapshotV2,
  command: VaultRotateKeyCommandV2,
): void {
  const next = command.nextSnapshot;
  assertNextSequence(current, next);
  if (
    next.commit.epoch !== current.commit.epoch + 1 ||
    next.payload.revision !== current.payload.revision + 1 ||
    next.payload.baseRevision !== current.payload.revision ||
    next.keyring.revision !== current.keyring.revision + 1 ||
    next.authorizationManifest.revision !== current.authorizationManifest.revision + 1 ||
    next.authorizationManifest.epoch !== current.authorizationManifest.epoch + 1 ||
    next.keyring.vaultKeyId === current.keyring.vaultKeyId
  ) {
    throw new ConflictException(
      "Rotation must atomically advance epoch, payload, keyring, manifest, and root-key identity",
    );
  }
  const currentDevices = current.authorizationManifest.devices;
  const nextDevices = next.authorizationManifest.devices;
  if (
    nextDevices.length !== currentDevices.length ||
    currentDevices.some((device) => {
      const nextDevice = nextDevices.find((candidate) => candidate.deviceId === device.deviceId);
      if (nextDevice === undefined) return true;
      const { revokedAt: currentRevokedAt, ...currentStable } = device;
      const { revokedAt: nextRevokedAt, ...nextStable } = nextDevice;
      return (
        JSON.stringify(currentStable) !== JSON.stringify(nextStable) ||
        (currentRevokedAt !== null && nextRevokedAt !== currentRevokedAt)
      );
    })
  ) {
    throw new ConflictException(
      "Rotation may change only the one-way revocation timestamp of existing device descriptors",
    );
  }
  if (
    command.reason !== "RECOVERY_ROTATED" &&
    JSON.stringify(next.authorizationManifest.recoveryAuthorization) !==
      JSON.stringify(current.authorizationManifest.recoveryAuthorization)
  ) {
    throw new ConflictException("Only RECOVERY_ROTATED may replace the recovery authorization descriptor");
  }
  if (
    command.reason === "DEVICE_REVOKED" &&
    !current.authorizationManifest.devices.some((currentDevice) => {
      const nextDevice = next.authorizationManifest.devices.find(
        (candidate) => candidate.deviceId === currentDevice.deviceId,
      );
      return currentDevice.revokedAt === null && nextDevice?.revokedAt !== null;
    })
  ) {
    throw new ConflictException("DEVICE_REVOKED rotation must revoke at least one previously active device");
  }
  if (command.reason === "RECOVERY_ROTATED") {
    const replacementAuthor = next.commit.author;
    const replacementDevice =
      replacementAuthor.kind === "DEVICE" && replacementAuthor.deviceId !== null
        ? currentDevices.find(
            (device) =>
              device.deviceId === replacementAuthor.deviceId &&
              device.authorizationKey.keyId === replacementAuthor.keyId &&
              device.revokedAt === null,
          )
        : undefined;
    const proofSigner = command.proof.signer;
    if (
      replacementDevice === undefined ||
      proofSigner.kind !== "DEVICE" ||
      proofSigner.deviceId !== replacementDevice.deviceId ||
      proofSigner.keyId !== replacementDevice.authorizationKey.keyId
    ) {
      throw new ConflictException(
        "RECOVERY_ROTATED must be authorized by the currently active replacement device",
      );
    }

    const activeNextDevices = nextDevices.filter((device) => device.revokedAt === null);
    if (
      activeNextDevices.length !== 1 ||
      activeNextDevices[0]?.deviceId !== replacementDevice.deviceId ||
      currentDevices.some((device) => {
        if (device.revokedAt !== null || device.deviceId === replacementDevice.deviceId) return false;
        return nextDevices.find((candidate) => candidate.deviceId === device.deviceId)?.revokedAt === null;
      })
    ) {
      throw new ConflictException(
        "RECOVERY_ROTATED must revoke every prior active device except the replacement",
      );
    }

    const replacementEnvelope = next.keyring.deviceEnvelopes[0];
    if (
      next.keyring.deviceEnvelopes.length !== 1 ||
      replacementEnvelope?.recipientDeviceId !== replacementDevice.deviceId ||
      replacementEnvelope.recipientKeyId !== replacementDevice.encryptionKey.keyId ||
      replacementEnvelope.recipientPublicKeyFingerprint !== replacementDevice.encryptionKey.fingerprint
    ) {
      throw new ConflictException(
        "RECOVERY_ROTATED keyring must contain only the replacement device recipient",
      );
    }

    const currentRecovery = current.authorizationManifest.recoveryAuthorization;
    const nextRecovery = next.authorizationManifest.recoveryAuthorization;
    if (
      nextRecovery.keyId === currentRecovery.keyId ||
      nextRecovery.publicKey === currentRecovery.publicKey ||
      nextRecovery.fingerprint === currentRecovery.fingerprint
    ) {
      throw new ConflictException("RECOVERY_ROTATED must publish a genuinely new recovery authorization key");
    }
  }
}

function mapProtocolError(error: VaultProtocolError): never {
  switch (error.code) {
    case "OWNER_MISMATCH":
      throw new NotFoundException("Personal vault was not found");
    case "AUTHORIZATION_FAILED":
      throw new HttpException(
        { message: error.message, failureCode: "VAULT_AUTHORIZATION_FAILED" },
        HttpStatus.FORBIDDEN,
      );
    case "EXPIRED_PROOF":
      throw new HttpException(
        { message: error.message, failureCode: "VAULT_PROOF_EXPIRED" },
        HttpStatus.FORBIDDEN,
      );
    case "INTEGRITY_FAILED":
      throw new BadRequestException(error.message);
  }
}

function mapRepositoryError(error: PersonalVaultRepositoryError): never {
  switch (error.code) {
    case "NOT_FOUND":
      throw new NotFoundException("Personal vault was not found");
    case "ALREADY_EXISTS":
      throw new HttpException(
        { message: error.message, failureCode: "VAULT_ALREADY_EXISTS" },
        HttpStatus.PRECONDITION_FAILED,
      );
    case "STALE_WRITE":
      throw new HttpException(
        { message: error.message, failureCode: "VAULT_STALE_WRITE" },
        HttpStatus.PRECONDITION_FAILED,
      );
    case "IDEMPOTENCY_CONFLICT":
      throw new HttpException(
        { message: error.message, failureCode: "IDEMPOTENCY_CONFLICT" },
        HttpStatus.CONFLICT,
      );
    case "PAIRING_CONFLICT":
      throw new HttpException(
        { message: error.message, failureCode: "PAIRING_CONFLICT" },
        HttpStatus.CONFLICT,
      );
  }
}

export type VaultBootstrapResponse =
  | {
      readonly formatVersion: 2;
      readonly ownerBinding: string;
      readonly vault: { readonly exists: false };
    }
  | {
      readonly formatVersion: 2;
      readonly ownerBinding: string;
      readonly vault: {
        readonly exists: true;
        readonly vaultId: string;
        readonly etag: string;
        readonly recoveryAuthorization: RecoveryAuthorizationPublicKeyV2;
      };
    };

@Injectable()
export class PersonalVaultService {
  constructor(
    @Inject(ACCOUNT_RESOLVER) private readonly accounts: AccountResolver,
    @Inject(PERSONAL_VAULT_REPOSITORY)
    private readonly repository: PersonalVaultRepository,
    private readonly readReplay: ReadProofReplayGuard,
  ) {}

  async #account(principal: AuthPrincipal): Promise<AccountContext> {
    try {
      return await this.accounts.resolve(principal);
    } catch (error) {
      if (error instanceof AccountIdentityInactiveError) {
        throw new ForbiddenException("Personal account is inactive");
      }
      if (error instanceof AccountIdentityUnavailableError) {
        throw new ServiceUnavailableException("Personal account resolution is unavailable");
      }
      throw new ServiceUnavailableException("Personal account resolution is unavailable");
    }
  }

  async #current(accountId: string): Promise<VaultSnapshotRecord> {
    let current: VaultSnapshotRecord | null;
    try {
      current = await this.repository.getSnapshot(accountId);
    } catch (error) {
      if (error instanceof VaultProtocolError || error instanceof ZodError) {
        throw new ServiceUnavailableException("Stored personal vault integrity verification failed");
      }
      throw new ServiceUnavailableException("Personal vault storage is unavailable");
    }
    if (current === null) throw new NotFoundException("Personal vault was not found");
    try {
      await assertSnapshotIntegrity(current.snapshot);
    } catch (error) {
      if (error instanceof VaultProtocolError) {
        throw new ServiceUnavailableException("Stored personal vault integrity verification failed");
      }
      throw error;
    }
    return current;
  }

  async #durableReplay(
    account: AccountContext,
    idempotencyKey: string,
    hash: string,
    resultKind: "pairing" | "vault",
    vaultId: string,
  ): Promise<DurableReplayResult | null> {
    let replay: DurableReplayResult | null;
    try {
      replay = await this.repository.findDurableReplay({
        accountId: account.accountId,
        idempotencyKey,
        requestHash: hash,
        resultKind,
      });
    } catch (error) {
      if (error instanceof PersonalVaultRepositoryError) mapRepositoryError(error);
      if (error instanceof VaultProtocolError || error instanceof ZodError) {
        throw new ServiceUnavailableException("Stored idempotency result failed integrity verification");
      }
      throw new ServiceUnavailableException("Personal vault idempotency storage is unavailable");
    }
    if (replay === null) return null;
    if (replay.kind !== resultKind) {
      throw new ServiceUnavailableException("Stored idempotency result has an invalid representation");
    }
    if (replay.kind === "vault") {
      try {
        await assertSnapshotIntegrity(replay.result.snapshot);
      } catch (error) {
        if (error instanceof VaultProtocolError) {
          throw new ServiceUnavailableException("Stored idempotency result failed integrity verification");
        }
        throw error;
      }
      if (
        replay.result.snapshot.ownerBinding !== account.ownerBinding ||
        replay.result.snapshot.vaultId !== vaultId ||
        replay.result.etag !== `"pv2:${replay.result.snapshot.commitHash}"`
      ) {
        throw new ServiceUnavailableException(
          "Stored idempotency result does not match the authenticated vault",
        );
      }
    } else if (
      replay.result.pairing.vaultId !== vaultId ||
      replay.result.pairing.requestingDevice.ownerBinding !== account.ownerBinding
    ) {
      throw new ServiceUnavailableException(
        "Stored idempotency result does not match the authenticated vault",
      );
    }
    return replay;
  }

  async #verifyNewSnapshot(
    current: VaultSyncSnapshotV2,
    command: Exclude<VaultMutationCommandV2, VaultCreateCommandV2>,
    now: Date,
  ): Promise<void> {
    try {
      await assertSnapshotIntegrity(command.nextSnapshot);
      await assertCommandProof(command.proof, current.authorizationManifest, now);
      await assertCommitSignature(command.nextSnapshot, current.authorizationManifest);
    } catch (error) {
      if (error instanceof VaultProtocolError) mapProtocolError(error);
      throw error;
    }
  }

  async bootstrap(principal: AuthPrincipal): Promise<VaultBootstrapResponse> {
    const account = await this.#account(principal);
    let current: VaultSnapshotRecord | null;
    try {
      current = await this.repository.getSnapshot(account.accountId);
    } catch {
      throw new ServiceUnavailableException("Personal vault bootstrap storage is unavailable");
    }
    if (current === null) {
      return {
        formatVersion: 2,
        ownerBinding: account.ownerBinding,
        vault: { exists: false },
      };
    }
    let recoveryAuthorization: RecoveryAuthorizationPublicKeyV2;
    try {
      await assertSnapshotIntegrity(current.snapshot);
      recoveryAuthorization = RecoveryAuthorizationPublicKeyV2Schema.parse(
        structuredClone(current.snapshot.authorizationManifest.recoveryAuthorization),
      );
    } catch {
      throw new ServiceUnavailableException("Stored personal vault integrity verification failed");
    }
    assertAccountBinding(account, current.snapshot.ownerBinding);
    return {
      formatVersion: 2,
      ownerBinding: account.ownerBinding,
      vault: {
        exists: true,
        vaultId: current.snapshot.vaultId,
        etag: current.etag,
        recoveryAuthorization,
      },
    };
  }

  async read(principal: AuthPrincipal, encodedReadProof: string | undefined): Promise<VaultSnapshotRecord> {
    if (encodedReadProof === undefined) {
      throw new HttpException("X-Vault-Read-Proof is required", HttpStatus.PRECONDITION_REQUIRED);
    }
    const account = await this.#account(principal);
    const current = await this.#current(account.accountId);
    assertAccountBinding(account, current.snapshot.ownerBinding);
    try {
      const proof = decodeVaultReadProofHeaderV2(encodedReadProof);
      await assertReadProof(proof, current.snapshot, new Date());
      const accepted = await this.readReplay.consume(
        proof.ownerBinding,
        proof.signer.keyId,
        proof.nonce,
        proof.expiresAt,
      );
      if (!accepted) throw new ForbiddenException("Vault read proof was already used");
    } catch (error) {
      if (error instanceof VaultProtocolError) mapProtocolError(error);
      if (error instanceof HttpException) throw error;
      if (error instanceof TypeError || error instanceof ZodError) {
        throw new BadRequestException("X-Vault-Read-Proof is malformed");
      }
      throw new ServiceUnavailableException("Vault read replay protection is unavailable");
    }
    return current;
  }

  async create(
    principal: AuthPrincipal,
    body: unknown,
    ifNoneMatch: string | undefined,
    idempotencyHeader: string | undefined,
  ): Promise<VaultWriteResult> {
    assertCreatePrecondition(ifNoneMatch);
    const command = parseBody(VaultCreateCommandV2Schema, body);
    const idempotencyKey = parseIdempotencyKey(idempotencyHeader, command.operationId);
    const account = await this.#account(principal);
    assertAccountBinding(account, command.ownerBinding);
    const hash = requestHash(command);
    const replay = await this.#durableReplay(account, idempotencyKey, hash, "vault", command.vaultId);
    if (replay?.kind === "vault") return replay.result;
    try {
      assertGenesisTransition(command);
      await assertSnapshotIntegrity(command.snapshot);
      await assertCommandProof(command.proof, command.snapshot.authorizationManifest, new Date());
      await assertCommitSignature(command.snapshot, command.snapshot.authorizationManifest);
      return await this.repository.createVault({
        accountId: account.accountId,
        command,
        idempotencyKey,
        requestHash: hash,
      });
    } catch (error) {
      if (error instanceof VaultProtocolError) mapProtocolError(error);
      if (error instanceof PersonalVaultRepositoryError) mapRepositoryError(error);
      throw error;
    }
  }

  async updatePayload(
    principal: AuthPrincipal,
    body: unknown,
    ifMatchHeader: string | undefined,
    idempotencyHeader: string | undefined,
  ): Promise<VaultWriteResult> {
    const command = parseBody(VaultUpdatePayloadCommandV2Schema, body);
    return this.#commitMutation(principal, command, ifMatchHeader, idempotencyHeader, assertUpdateTransition);
  }

  async rotate(
    principal: AuthPrincipal,
    body: unknown,
    ifMatchHeader: string | undefined,
    idempotencyHeader: string | undefined,
  ): Promise<VaultWriteResult> {
    const command = parseBody(VaultRotateKeyCommandV2Schema, body);
    return this.#commitMutation(
      principal,
      command,
      ifMatchHeader,
      idempotencyHeader,
      assertRotationTransition,
    );
  }

  async #commitMutation<T extends VaultUpdatePayloadCommandV2 | VaultRotateKeyCommandV2>(
    principal: AuthPrincipal,
    command: T,
    ifMatchHeader: string | undefined,
    idempotencyHeader: string | undefined,
    assertTransition: (current: VaultSyncSnapshotV2, command: T) => void,
  ): Promise<VaultWriteResult> {
    const expectedEtag = parseIfMatch(ifMatchHeader);
    const idempotencyKey = parseIdempotencyKey(idempotencyHeader, command.operationId);
    const account = await this.#account(principal);
    assertAccountBinding(account, command.ownerBinding);
    const hash = requestHash(command);
    const replay = await this.#durableReplay(account, idempotencyKey, hash, "vault", command.vaultId);
    if (replay?.kind === "vault") return replay.result;
    const current = await this.#current(account.accountId);
    assertAccountBinding(account, current.snapshot.ownerBinding);
    assertVaultBinding(current, command.vaultId);
    await this.#verifyNewSnapshot(current.snapshot, command, new Date());
    assertTransition(current.snapshot, command);
    try {
      return await this.repository.commitSnapshot({
        accountId: account.accountId,
        command,
        expectedEtag,
        idempotencyKey,
        requestHash: hash,
      });
    } catch (error) {
      if (error instanceof PersonalVaultRepositoryError) mapRepositoryError(error);
      throw error;
    }
  }

  async listPairings(principal: AuthPrincipal): Promise<readonly DevicePairingViewV2[]> {
    const account = await this.#account(principal);
    const current = await this.#current(account.accountId);
    assertAccountBinding(account, current.snapshot.ownerBinding);
    try {
      return await this.repository.listPairings(account.accountId);
    } catch (error) {
      if (error instanceof PersonalVaultRepositoryError) mapRepositoryError(error);
      throw error;
    }
  }

  async createPairing(
    principal: AuthPrincipal,
    body: unknown,
    ifMatchHeader: string | undefined,
    idempotencyHeader: string | undefined,
  ): Promise<PairingWriteResult> {
    const request = parseBody(DevicePairingRequestV2Schema, body);
    const expectedEtag = parseIfMatch(ifMatchHeader);
    const idempotencyKey = parseIdempotencyKey(idempotencyHeader, request.operationId);
    const account = await this.#account(principal);
    assertAccountBinding(account, request.ownerBinding);
    const hash = requestHash(request);
    const replay = await this.#durableReplay(account, idempotencyKey, hash, "pairing", request.vaultId);
    if (replay?.kind === "pairing") return replay.result;
    const current = await this.#current(account.accountId);
    assertAccountBinding(account, current.snapshot.ownerBinding);
    assertVaultBinding(current, request.vaultId);
    try {
      await assertPairingRequest(request, new Date());
      return await this.repository.createPairing({
        accountId: account.accountId,
        expectedEtag,
        idempotencyKey,
        request,
        requestHash: hash,
      });
    } catch (error) {
      if (error instanceof VaultProtocolError) mapProtocolError(error);
      if (error instanceof PersonalVaultRepositoryError) mapRepositoryError(error);
      throw error;
    }
  }

  async cancelPairing(
    principal: AuthPrincipal,
    pairingId: string,
    ifMatchHeader: string | undefined,
    idempotencyHeader: string | undefined,
  ): Promise<PairingWriteResult> {
    const expectedEtag = parseIfMatch(ifMatchHeader);
    const idempotencyKey = parseIdempotencyKey(idempotencyHeader);
    const account = await this.#account(principal);
    const current = await this.#current(account.accountId);
    assertAccountBinding(account, current.snapshot.ownerBinding);
    const hash = requestHash({
      operation: "CANCEL_PAIRING",
      pairingId,
      vaultId: current.snapshot.vaultId,
    });
    try {
      return await this.repository.cancelPairing({
        accountId: account.accountId,
        expectedEtag,
        idempotencyKey,
        pairingId,
        requestHash: hash,
      });
    } catch (error) {
      if (error instanceof PersonalVaultRepositoryError) mapRepositoryError(error);
      throw error;
    }
  }

  async approvePairing(
    principal: AuthPrincipal,
    pairingId: string,
    body: unknown,
    ifMatchHeader: string | undefined,
    idempotencyHeader: string | undefined,
  ): Promise<VaultWriteResult> {
    const approval = parseBody(PairingApprovalRequestV2Schema, body);
    const command = approval.command;
    const expectedEtag = parseIfMatch(ifMatchHeader);
    const idempotencyKey = parseIdempotencyKey(idempotencyHeader, command.operationId);
    const account = await this.#account(principal);
    assertAccountBinding(account, command.ownerBinding);
    const hash = requestHash({ approval, pairingId });
    const replay = await this.#durableReplay(account, idempotencyKey, hash, "vault", command.vaultId);
    if (replay?.kind === "vault") return replay.result;
    const current = await this.#current(account.accountId);
    assertAccountBinding(account, current.snapshot.ownerBinding);
    assertVaultBinding(current, command.vaultId);
    await this.#verifyNewSnapshot(current.snapshot, command, new Date());
    assertPairTransition(current.snapshot, command);
    try {
      return await this.repository.approvePairing({
        accountId: account.accountId,
        command,
        expectedEtag,
        idempotencyKey,
        pairingCodeCommitment: approval.pairingCodeCommitment,
        pairingId,
        requestHash: hash,
      });
    } catch (error) {
      if (error instanceof PersonalVaultRepositoryError) mapRepositoryError(error);
      throw error;
    }
  }
}
