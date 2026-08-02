import type {
  AuthorizationKeyHandle,
  DeviceDescriptorV2,
  EncryptedVaultPayloadEnvelopeV1,
  RecoveryAuthorizationPublicKeyV2,
  VaultCrypto,
  VaultKeyHandle,
  VaultKeyringV1,
} from "@umn-gopher-assistant/crypto";
import {
  AuthorizationManifestV2Schema,
  DevicePairingRequestCanonicalInputV2Schema,
  encodeVaultReadProofHeaderV2,
  PairingApprovalRequestV2Schema,
  VaultCreateCommandV2Schema,
  VaultPairDeviceCommandV2Schema,
  VaultRotateKeyCommandV2Schema,
  VaultSyncSnapshotV2Schema,
  VaultUpdatePayloadCommandV2Schema,
  type AuthorizationManifestV2,
  type DevicePairingRequestV2,
  type PairingApprovalRequestV2,
  type VaultCommitAuthorV2,
  type VaultCreateCommandV2,
  type VaultPairDeviceCommandV2,
  type VaultRotateKeyCommandV2,
  type VaultSyncSnapshotV2,
  type VaultUpdatePayloadCommandV2,
} from "@umn-gopher-assistant/contracts";
import { createTaskDocument, type PersonalVaultDocumentV1 } from "./protocol";

const PROOF_LIFETIME_MS = 60_000;
const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface VaultSyncClock {
  readonly now?: () => Date;
  readonly randomUuid?: () => string;
  readonly randomBytes?: (size: number) => Uint8Array;
}

export interface VaultSyncHighWater {
  readonly ownerBinding: string;
  readonly vaultId: string;
  readonly epoch: number;
  readonly sequence: number;
  readonly commitHash: string;
}

export interface VerifiedVaultSnapshot {
  readonly plaintext: Uint8Array;
  readonly snapshot: VaultSyncSnapshotV2;
  readonly highWater: VaultSyncHighWater;
}

export class VaultSyncProtocolError extends Error {
  constructor(readonly code: "INTEGRITY_FAILED" | "ROLLBACK_DETECTED") {
    super(code === "ROLLBACK_DETECTED" ? "Remote vault rollback detected" : "Remote vault integrity failed");
    this.name = "VaultSyncProtocolError";
  }
}

function failIntegrity(): never {
  throw new VaultSyncProtocolError("INTEGRITY_FAILED");
}

function now(clock: VaultSyncClock): Date {
  const value = clock.now?.() ?? new Date();
  if (!Number.isFinite(value.getTime())) failIntegrity();
  return value;
}

function operationId(clock: VaultSyncClock): string {
  return (clock.randomUuid ?? crypto.randomUUID.bind(crypto))();
}

function proofExpiry(issuedAt: Date): string {
  return new Date(issuedAt.getTime() + PROOF_LIFETIME_MS).toISOString();
}

function auditTime(clock: VaultSyncClock, ...lowerBounds: readonly string[]): Date {
  let timestamp = now(clock).getTime();
  for (const lowerBound of lowerBounds) {
    const parsed = Date.parse(lowerBound);
    if (!Number.isFinite(parsed)) failIntegrity();
    timestamp = Math.max(timestamp, parsed);
  }
  return new Date(timestamp);
}

function authorFor(key: AuthorizationKeyHandle): VaultCommitAuthorV2 {
  if (key.kind === "DEVICE" && key.deviceId !== null) {
    return { kind: "DEVICE", keyId: key.keyId, deviceId: key.deviceId };
  }
  if (key.kind === "RECOVERY" && key.deviceId === null) {
    return { kind: "RECOVERY", keyId: key.keyId, deviceId: null };
  }
  failIntegrity();
}

function signingPublicKey(snapshot: VaultSyncSnapshotV2) {
  const author = snapshot.commit.author;
  if (author.kind === "RECOVERY") {
    const recovery = snapshot.authorizationManifest.recoveryAuthorization;
    return recovery.revokedAt === null && recovery.keyId === author.keyId ? recovery : undefined;
  }
  return snapshot.authorizationManifest.devices.find(
    (device) =>
      device.revokedAt === null &&
      device.deviceId === author.deviceId &&
      device.authorizationKey.keyId === author.keyId,
  )?.authorizationKey;
}

function assertSnapshotHashes(cryptoFacade: VaultCrypto, snapshot: VaultSyncSnapshotV2): void {
  if (
    snapshot.commit.payloadHash !== cryptoFacade.hashVaultPayloadV2(snapshot.payload) ||
    snapshot.commit.keyringHash !== cryptoFacade.hashVaultKeyringV1(snapshot.keyring) ||
    snapshot.commit.authorizationManifestHash !==
      cryptoFacade.hashAuthorizationManifestV2(snapshot.authorizationManifest) ||
    snapshot.commitHash !== cryptoFacade.computeVaultCommitHash(snapshot.commit)
  ) {
    failIntegrity();
  }
}

function assertRecipientAgreement(snapshot: VaultSyncSnapshotV2): void {
  const active = snapshot.authorizationManifest.devices.filter((device) => device.revokedAt === null);
  if (active.length !== snapshot.keyring.deviceEnvelopes.length) failIntegrity();
  for (const device of active) {
    const envelope = snapshot.keyring.deviceEnvelopes.find(
      (candidate) => candidate.recipientDeviceId === device.deviceId,
    );
    if (
      envelope === undefined ||
      envelope.recipientKeyId !== device.encryptionKey.keyId ||
      envelope.recipientPublicKeyFingerprint !== device.encryptionKey.fingerprint
    ) {
      failIntegrity();
    }
  }
}

function nextHighWater(snapshot: VaultSyncSnapshotV2): VaultSyncHighWater {
  return Object.freeze({
    ownerBinding: snapshot.ownerBinding,
    vaultId: snapshot.vaultId,
    epoch: snapshot.commit.epoch,
    sequence: snapshot.commit.sequence,
    commitHash: snapshot.commitHash,
  });
}

function assertNotRolledBack(snapshot: VaultSyncSnapshotV2, highWater: VaultSyncHighWater | undefined): void {
  if (highWater === undefined) return;
  if (snapshot.ownerBinding !== highWater.ownerBinding || snapshot.vaultId !== highWater.vaultId) {
    failIntegrity();
  }
  const rollback =
    snapshot.commit.epoch < highWater.epoch ||
    snapshot.commit.sequence < highWater.sequence ||
    (snapshot.commit.sequence === highWater.sequence && snapshot.commitHash !== highWater.commitHash);
  if (rollback) throw new VaultSyncProtocolError("ROLLBACK_DETECTED");
  if (snapshot.commit.epoch > highWater.epoch + 1 || snapshot.commit.sequence > highWater.sequence + 1) {
    // A signed/root-MAC-authenticated head still does not prove that omitted
    // intermediate commits descend from this device's trusted anchor. Until
    // the API exposes a verifiable commit chain, skip-ahead adoption must fail
    // closed instead of accepting a potentially valid fork.
    throw new VaultSyncProtocolError("ROLLBACK_DETECTED");
  }
  if (
    snapshot.commit.sequence === highWater.sequence + 1 &&
    snapshot.commit.parentCommitHash !== highWater.commitHash
  ) {
    throw new VaultSyncProtocolError("ROLLBACK_DETECTED");
  }
}

/**
 * Authenticates an opaque server snapshot before exposing a single plaintext
 * byte. The root-key MAC is deliberately client-only; API and storage tiers
 * can validate public signatures and hashes but cannot forge this check.
 */
export function verifyAndDecryptRemoteSnapshot(
  cryptoFacade: VaultCrypto,
  vaultKey: VaultKeyHandle,
  candidate: unknown,
  expectedOwnerBinding: string,
  highWater?: VaultSyncHighWater,
): VerifiedVaultSnapshot {
  let snapshot: VaultSyncSnapshotV2;
  try {
    snapshot = VaultSyncSnapshotV2Schema.parse(candidate);
  } catch {
    failIntegrity();
  }
  if (
    snapshot.ownerBinding !== expectedOwnerBinding ||
    vaultKey.vaultId !== snapshot.vaultId ||
    vaultKey.vaultKeyId !== snapshot.payload.vaultKeyId ||
    vaultKey.vaultKeyId !== snapshot.keyring.vaultKeyId
  ) {
    failIntegrity();
  }
  assertSnapshotHashes(cryptoFacade, snapshot);
  assertRecipientAgreement(snapshot);
  const publicKey = signingPublicKey(snapshot);
  if (
    publicKey === undefined ||
    !cryptoFacade.verifyVaultCommitSignature({ commit: snapshot.commit, publicKey }) ||
    !cryptoFacade.verifyRootKeyStateMac({ vaultKey, commit: snapshot.commit })
  ) {
    failIntegrity();
  }
  assertNotRolledBack(snapshot, highWater);
  try {
    return Object.freeze({
      plaintext: cryptoFacade.decryptPayloadV2({ key: vaultKey, envelope: snapshot.payload }),
      snapshot,
      highWater: nextHighWater(snapshot),
    });
  } catch {
    failIntegrity();
  }
}

/**
 * Resolves the response-loss case for a durable key rotation. A server may
 * forget its idempotency receipt while the device is offline and correctly
 * answer the exact replay with 412 because the intended successor is already
 * current. Only the exact staged successor is eligible; it still has to pass
 * every normal snapshot, root-MAC, signature, recipient, and high-water check.
 */
export function verifyAppliedRecoveryRotationReadBack(input: {
  readonly crypto: VaultCrypto;
  readonly vaultKey: VaultKeyHandle;
  readonly candidate: unknown;
  readonly expectedSnapshot: VaultSyncSnapshotV2;
  readonly expectedOwnerBinding: string;
  readonly highWater: VaultSyncHighWater;
}): VerifiedVaultSnapshot | null {
  let candidate: VaultSyncSnapshotV2;
  let expected: VaultSyncSnapshotV2;
  try {
    candidate = VaultSyncSnapshotV2Schema.parse(input.candidate);
    expected = VaultSyncSnapshotV2Schema.parse(input.expectedSnapshot);
  } catch {
    failIntegrity();
  }
  if (JSON.stringify(candidate) !== JSON.stringify(expected)) return null;
  return verifyAndDecryptRemoteSnapshot(
    input.crypto,
    input.vaultKey,
    candidate,
    input.expectedOwnerBinding,
    input.highWater,
  );
}

function buildSnapshot(
  cryptoFacade: VaultCrypto,
  vaultKey: VaultKeyHandle,
  authorizationKey: AuthorizationKeyHandle,
  input: {
    readonly ownerBinding: string;
    readonly epoch: number;
    readonly sequence: number;
    readonly parentCommitHash: string | null;
    readonly operationId: string;
    readonly commitCreatedAt: string;
    readonly payload: VaultSyncSnapshotV2["payload"];
    readonly keyring: VaultKeyringV1;
    readonly manifest: AuthorizationManifestV2;
  },
): VaultSyncSnapshotV2 {
  const commitCreatedAt = Date.parse(input.commitCreatedAt);
  if (
    !Number.isFinite(commitCreatedAt) ||
    new Date(commitCreatedAt).toISOString() !== input.commitCreatedAt ||
    commitCreatedAt < Date.parse(input.payload.createdAt) ||
    commitCreatedAt < Date.parse(input.keyring.updatedAt) ||
    commitCreatedAt < Date.parse(input.manifest.updatedAt)
  ) {
    failIntegrity();
  }
  const commit = cryptoFacade.signVaultCommit({
    authorizationKey,
    vaultKey,
    commit: {
      formatVersion: 2,
      ownerBinding: input.ownerBinding,
      vaultId: vaultKey.vaultId,
      epoch: input.epoch,
      sequence: input.sequence,
      parentCommitHash: input.parentCommitHash,
      payloadHash: cryptoFacade.hashVaultPayloadV2(input.payload),
      keyringHash: cryptoFacade.hashVaultKeyringV1(input.keyring),
      authorizationManifestHash: cryptoFacade.hashAuthorizationManifestV2(input.manifest),
      operationId: input.operationId,
      author: authorFor(authorizationKey),
      createdAt: input.commitCreatedAt,
    },
  });
  return VaultSyncSnapshotV2Schema.parse({
    formatVersion: 2,
    ownerBinding: input.ownerBinding,
    vaultId: vaultKey.vaultId,
    commitHash: cryptoFacade.computeVaultCommitHash(commit),
    commit,
    payload: input.payload,
    keyring: input.keyring,
    authorizationManifest: input.manifest,
  });
}

function signedCommandProof(
  cryptoFacade: VaultCrypto,
  authorizationKey: AuthorizationKeyHandle,
  snapshot: VaultSyncSnapshotV2,
  commandType: "CREATE_VAULT" | "PAIR_DEVICE" | "ROTATE_KEY" | "UPDATE_PAYLOAD",
  expectedParentCommitHash: string | null,
  issuedAt: Date,
) {
  if (issuedAt.getTime() < Date.parse(snapshot.commit.createdAt)) failIntegrity();
  return cryptoFacade.signVaultCommandProof({
    authorizationKey,
    proof: {
      formatVersion: 2,
      commandType,
      ownerBinding: snapshot.ownerBinding,
      vaultId: snapshot.vaultId,
      operationId: snapshot.commit.operationId,
      expectedParentCommitHash,
      nextCommitHash: snapshot.commitHash,
      signer: authorFor(authorizationKey),
      issuedAt: issuedAt.toISOString(),
      expiresAt: proofExpiry(issuedAt),
    },
  });
}

function devicePublicKeyV1(device: DeviceDescriptorV2) {
  return {
    formatVersion: 1 as const,
    deviceId: device.deviceId,
    deviceKeyId: device.encryptionKey.keyId,
    keyAlgorithm: "X25519" as const,
    publicKey: device.encryptionKey.publicKey,
    publicKeyFingerprint: device.encryptionKey.fingerprint,
    createdAt: device.createdAt,
    revokedAt: device.revokedAt,
  };
}

/**
 * Builds the only permitted pairing transition: preserve payload/root key and
 * every existing active device, append exactly the explicitly approved
 * descriptor, then advance keyring/manifest/commit by one.
 */
export function createVaultPairDeviceCommand(input: {
  readonly crypto: VaultCrypto;
  readonly vaultKey: VaultKeyHandle;
  readonly authorizationKey: AuthorizationKeyHandle;
  readonly current: VaultSyncSnapshotV2;
  readonly pairedDevice: DeviceDescriptorV2;
  readonly pairingCodeCommitment: string;
  readonly clock?: VaultSyncClock;
}): PairingApprovalRequestV2 {
  const clock = input.clock ?? {};
  const current = VaultSyncSnapshotV2Schema.parse(input.current);
  if (
    input.pairedDevice.ownerBinding !== current.ownerBinding ||
    input.pairedDevice.revokedAt !== null ||
    current.authorizationManifest.devices.some(
      (device) =>
        device.deviceId === input.pairedDevice.deviceId ||
        device.encryptionKey.keyId === input.pairedDevice.encryptionKey.keyId ||
        device.authorizationKey.keyId === input.pairedDevice.authorizationKey.keyId,
    )
  ) {
    failIntegrity();
  }
  const recipient = devicePublicKeyV1(input.pairedDevice);
  const wrappedEnvelope = input.crypto.wrapVaultKeyForDevice({
    key: input.vaultKey,
    recipient,
  });
  const transitionTime = auditTime(
    clock,
    current.payload.createdAt,
    current.keyring.updatedAt,
    current.authorizationManifest.updatedAt,
    recipient.createdAt,
    wrappedEnvelope.createdAt,
  );
  const timestamp = transitionTime.toISOString();
  const manifest = AuthorizationManifestV2Schema.parse({
    ...current.authorizationManifest,
    revision: current.authorizationManifest.revision + 1,
    devices: [...current.authorizationManifest.devices, input.pairedDevice],
    updatedAt: timestamp,
  });
  const keyring = {
    ...current.keyring,
    revision: current.keyring.revision + 1,
    updatedAt: timestamp,
    devicePublicKeys: [...(current.keyring.devicePublicKeys ?? []), recipient],
    deviceEnvelopes: [...current.keyring.deviceEnvelopes, wrappedEnvelope],
  };
  const id = operationId(clock);
  const snapshot = buildSnapshot(input.crypto, input.vaultKey, input.authorizationKey, {
    ownerBinding: current.ownerBinding,
    epoch: current.commit.epoch,
    sequence: current.commit.sequence + 1,
    parentCommitHash: current.commitHash,
    operationId: id,
    commitCreatedAt: timestamp,
    payload: current.payload,
    keyring,
    manifest,
  });
  const command: VaultPairDeviceCommandV2 = VaultPairDeviceCommandV2Schema.parse({
    formatVersion: 2,
    commandType: "PAIR_DEVICE",
    ownerBinding: current.ownerBinding,
    vaultId: current.vaultId,
    operationId: id,
    expectedParentCommitHash: current.commitHash,
    pairedDevice: input.pairedDevice,
    proof: signedCommandProof(
      input.crypto,
      input.authorizationKey,
      snapshot,
      "PAIR_DEVICE",
      current.commitHash,
      transitionTime,
    ),
    nextSnapshot: snapshot,
  });
  return PairingApprovalRequestV2Schema.parse({
    pairingCodeCommitment: input.pairingCodeCommitment,
    command,
  });
}

export function createDevicePairingRequest(input: {
  readonly crypto: VaultCrypto;
  readonly authorizationKey: AuthorizationKeyHandle;
  readonly ownerBinding: string;
  readonly vaultId: string;
  readonly requestingDevice: DeviceDescriptorV2;
  readonly pairingCodeCommitment: string;
  readonly clock?: VaultSyncClock;
}): DevicePairingRequestV2 {
  const clock = input.clock ?? {};
  const issuedAt = now(clock);
  const canonical = DevicePairingRequestCanonicalInputV2Schema.parse({
    formatVersion: 2,
    ownerBinding: input.ownerBinding,
    vaultId: input.vaultId,
    operationId: operationId(clock),
    requestingDevice: input.requestingDevice,
    pairingCodeCommitment: input.pairingCodeCommitment,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 15 * 60 * 1_000).toISOString(),
  });
  return input.crypto.signDevicePairingRequest({
    authorizationKey: input.authorizationKey,
    request: canonical,
  });
}

export async function hashPairingCode(code: string): Promise<string> {
  if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/u.test(code)) failIntegrity();
  const input = new TextEncoder().encode(`UGA2/DEVICE-PAIRING/CODE\0${code}`);
  try {
    return uint8ToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", input)));
  } finally {
    input.fill(0);
  }
}

/** Eight uniformly sampled base32 symbols; the hyphen is display-only. */
export function generatePairingCode(): string {
  const random = crypto.getRandomValues(new Uint8Array(8));
  try {
    let code = "";
    // The alphabet has exactly 32 symbols, so masking five bits introduces no
    // modulo bias. No user-controlled or pseudorandom fallback is permitted.
    for (const byte of random) code += PAIRING_ALPHABET.charAt(byte & 31);
    return `${code.slice(0, 4)}-${code.slice(4)}`;
  } finally {
    random.fill(0);
  }
}

/**
 * Re-authenticates the original recovery secret before a local-only vault can
 * acquire an account binding. The recovered key is used to independently
 * authenticate the durable ciphertext and is destroyed before this function
 * returns. No authorization material or storage mutation is produced on
 * failure.
 */
export function verifyLocalRecoveryCodeForAccountSync(input: {
  readonly crypto: VaultCrypto;
  readonly activeVaultKey: VaultKeyHandle;
  readonly keyring: VaultKeyringV1;
  readonly payload: EncryptedVaultPayloadEnvelopeV1;
  readonly expectedPlaintext: Uint8Array;
  readonly recoveryCode: string;
}): boolean {
  let recovered: VaultKeyHandle | undefined;
  let plaintext: Uint8Array | undefined;
  try {
    recovered = input.crypto.recoverVaultKey({
      envelope: input.keyring.recoveryEnvelope,
      recoveryCode: input.recoveryCode,
    });
    if (
      recovered.vaultId !== input.activeVaultKey.vaultId ||
      recovered.vaultKeyId !== input.activeVaultKey.vaultKeyId ||
      recovered.vaultId !== input.payload.vaultId ||
      recovered.vaultKeyId !== input.payload.vaultKeyId
    ) {
      return false;
    }
    plaintext = input.crypto.decryptPayload({ key: recovered, envelope: input.payload });
    if (plaintext.byteLength !== input.expectedPlaintext.byteLength) return false;
    let difference = 0;
    for (let index = 0; index < plaintext.byteLength; index += 1) {
      difference |= (plaintext[index] ?? 0) ^ (input.expectedPlaintext[index] ?? 0);
    }
    return difference === 0;
  } catch {
    return false;
  } finally {
    plaintext?.fill(0);
    recovered?.destroy();
  }
}

export function createVaultGenesisCommand(input: {
  readonly crypto: VaultCrypto;
  readonly vaultKey: VaultKeyHandle;
  readonly authorizationKey: AuthorizationKeyHandle;
  readonly ownerBinding: string;
  readonly device: DeviceDescriptorV2;
  readonly recoveryAuthorization: RecoveryAuthorizationPublicKeyV2;
  readonly keyring: VaultKeyringV1;
  readonly plaintext: Uint8Array;
  readonly clock?: VaultSyncClock;
}): VaultCreateCommandV2 {
  const clock = input.clock ?? {};
  const timestamp = now(clock).toISOString();
  const manifest = AuthorizationManifestV2Schema.parse({
    formatVersion: 2,
    ownerBinding: input.ownerBinding,
    vaultId: input.vaultKey.vaultId,
    epoch: 1,
    revision: 1,
    devices: [input.device],
    recoveryAuthorization: input.recoveryAuthorization,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const id = operationId(clock);
  const payload = input.crypto.encryptPayloadV2({
    key: input.vaultKey,
    ownerBinding: input.ownerBinding,
    plaintext: input.plaintext,
    revision: 1,
    baseRevision: null,
  });
  const commitTime = auditTime(clock, payload.createdAt, input.keyring.updatedAt, manifest.updatedAt);
  const snapshot = buildSnapshot(input.crypto, input.vaultKey, input.authorizationKey, {
    ownerBinding: input.ownerBinding,
    epoch: 1,
    sequence: 1,
    parentCommitHash: null,
    operationId: id,
    commitCreatedAt: commitTime.toISOString(),
    payload,
    keyring: input.keyring,
    manifest,
  });
  return VaultCreateCommandV2Schema.parse({
    formatVersion: 2,
    commandType: "CREATE_VAULT",
    ownerBinding: input.ownerBinding,
    vaultId: input.vaultKey.vaultId,
    operationId: id,
    proof: signedCommandProof(
      input.crypto,
      input.authorizationKey,
      snapshot,
      "CREATE_VAULT",
      null,
      commitTime,
    ),
    snapshot,
  });
}

export function createVaultPayloadUpdateCommand(input: {
  readonly crypto: VaultCrypto;
  readonly vaultKey: VaultKeyHandle;
  readonly authorizationKey: AuthorizationKeyHandle;
  readonly current: VaultSyncSnapshotV2;
  readonly plaintext: Uint8Array;
  readonly clock?: VaultSyncClock;
}): VaultUpdatePayloadCommandV2 {
  const clock = input.clock ?? {};
  const id = operationId(clock);
  const payload = input.crypto.encryptPayloadV2({
    key: input.vaultKey,
    ownerBinding: input.current.ownerBinding,
    plaintext: input.plaintext,
    revision: input.current.payload.revision + 1,
    baseRevision: input.current.payload.revision,
  });
  const commitTime = auditTime(
    clock,
    payload.createdAt,
    input.current.keyring.updatedAt,
    input.current.authorizationManifest.updatedAt,
  );
  const snapshot = buildSnapshot(input.crypto, input.vaultKey, input.authorizationKey, {
    ownerBinding: input.current.ownerBinding,
    epoch: input.current.commit.epoch,
    sequence: input.current.commit.sequence + 1,
    parentCommitHash: input.current.commitHash,
    operationId: id,
    commitCreatedAt: commitTime.toISOString(),
    payload,
    keyring: input.current.keyring,
    manifest: input.current.authorizationManifest,
  });
  return VaultUpdatePayloadCommandV2Schema.parse({
    formatVersion: 2,
    commandType: "UPDATE_PAYLOAD",
    ownerBinding: input.current.ownerBinding,
    vaultId: input.current.vaultId,
    operationId: id,
    expectedParentCommitHash: input.current.commitHash,
    proof: signedCommandProof(
      input.crypto,
      input.authorizationKey,
      snapshot,
      "UPDATE_PAYLOAD",
      input.current.commitHash,
      commitTime,
    ),
    nextSnapshot: snapshot,
  });
}

export type RenewableVaultSyncCommandV2 = VaultCreateCommandV2 | VaultUpdatePayloadCommandV2;

/**
 * Re-signs only the short-lived authorization proof of an already-durable
 * ordinary sync command. The operation id is the command's replay identity,
 * so the encrypted snapshot, commit, parent and every other business field
 * remain byte-for-byte unchanged.
 */
export function renewVaultSyncCommandProof(input: {
  readonly crypto: VaultCrypto;
  readonly authorizationKey: AuthorizationKeyHandle;
  readonly command: RenewableVaultSyncCommandV2;
  readonly clock?: VaultSyncClock;
}): RenewableVaultSyncCommandV2 {
  const command =
    input.command.commandType === "CREATE_VAULT"
      ? VaultCreateCommandV2Schema.parse(input.command)
      : VaultUpdatePayloadCommandV2Schema.parse(input.command);
  const snapshot = command.commandType === "CREATE_VAULT" ? command.snapshot : command.nextSnapshot;
  const expectedParentCommitHash =
    command.commandType === "CREATE_VAULT" ? null : command.expectedParentCommitHash;
  const signer = snapshot.commit.author;
  const signingKey = signingPublicKey(snapshot);
  if (
    input.authorizationKey.kind !== "DEVICE" ||
    input.authorizationKey.deviceId === null ||
    input.authorizationKey.ownerBinding !== command.ownerBinding ||
    input.authorizationKey.deviceId !== signer.deviceId ||
    input.authorizationKey.keyId !== signer.keyId ||
    snapshot.commit.operationId !== command.operationId ||
    snapshot.commit.parentCommitHash !== expectedParentCommitHash ||
    signingKey === undefined
  ) {
    failIntegrity();
  }
  assertSnapshotHashes(input.crypto, snapshot);
  if (
    !input.crypto.verifyVaultCommitSignature({
      commit: snapshot.commit,
      publicKey: signingKey,
    })
  ) {
    failIntegrity();
  }
  const observedNow = now(input.clock ?? {});
  const issuedAt = new Date(Math.max(observedNow.getTime(), Date.parse(command.proof.issuedAt) + 1));
  const proof = signedCommandProof(
    input.crypto,
    input.authorizationKey,
    snapshot,
    command.commandType,
    expectedParentCommitHash,
    issuedAt,
  );
  return command.commandType === "CREATE_VAULT"
    ? VaultCreateCommandV2Schema.parse({ ...command, proof })
    : VaultUpdatePayloadCommandV2Schema.parse({ ...command, proof });
}

/**
 * Builds the mandatory recovery-hardening transition. The replacement device
 * must already be present in the authenticated current head. Every other
 * active device is revoked in one direction, the root key and recovery
 * authorization are replaced, and only the replacement device receives the
 * successor root key.
 */
export function createVaultRecoveryRotationCommand(input: {
  readonly crypto: VaultCrypto;
  readonly previousVaultKey: VaultKeyHandle;
  readonly nextVaultKey: VaultKeyHandle;
  readonly authorizationKey: AuthorizationKeyHandle;
  readonly current: VaultSyncSnapshotV2;
  readonly replacementDeviceId: string;
  readonly nextKeyring: VaultKeyringV1;
  readonly nextRecoveryAuthorization: RecoveryAuthorizationPublicKeyV2;
  readonly plaintext: Uint8Array;
  readonly clock?: VaultSyncClock;
}): VaultRotateKeyCommandV2 {
  const clock = input.clock ?? {};
  const current = VaultSyncSnapshotV2Schema.parse(input.current);
  const replacement = current.authorizationManifest.devices.find(
    (device) => device.deviceId === input.replacementDeviceId && device.revokedAt === null,
  );
  const nextDevicePublicKeys = input.nextKeyring.devicePublicKeys;
  if (
    replacement === undefined ||
    input.authorizationKey.kind !== "DEVICE" ||
    input.authorizationKey.deviceId !== replacement.deviceId ||
    input.authorizationKey.keyId !== replacement.authorizationKey.keyId ||
    input.authorizationKey.ownerBinding !== current.ownerBinding ||
    input.previousVaultKey.vaultId !== current.vaultId ||
    input.previousVaultKey.vaultKeyId !== current.keyring.vaultKeyId ||
    input.nextVaultKey.vaultId !== current.vaultId ||
    input.nextVaultKey.vaultKeyId === input.previousVaultKey.vaultKeyId ||
    input.nextKeyring.vaultId !== current.vaultId ||
    input.nextKeyring.vaultKeyId !== input.nextVaultKey.vaultKeyId ||
    input.nextKeyring.revision !== current.keyring.revision + 1 ||
    input.nextKeyring.deviceEnvelopes.length !== 1 ||
    nextDevicePublicKeys?.length !== 1
  ) {
    failIntegrity();
  }
  const replacementRecipient = devicePublicKeyV1(replacement);
  const suppliedRecipient = nextDevicePublicKeys[0];
  const suppliedEnvelope = input.nextKeyring.deviceEnvelopes[0];
  if (
    suppliedRecipient === undefined ||
    suppliedEnvelope === undefined ||
    suppliedRecipient.deviceId !== replacementRecipient.deviceId ||
    suppliedRecipient.deviceKeyId !== replacementRecipient.deviceKeyId ||
    suppliedRecipient.publicKey !== replacementRecipient.publicKey ||
    suppliedRecipient.publicKeyFingerprint !== replacementRecipient.publicKeyFingerprint ||
    suppliedRecipient.revokedAt !== null ||
    suppliedEnvelope.recipientDeviceId !== replacement.deviceId ||
    suppliedEnvelope.recipientKeyId !== replacement.encryptionKey.keyId ||
    suppliedEnvelope.recipientPublicKeyFingerprint !== replacement.encryptionKey.fingerprint ||
    input.nextRecoveryAuthorization.ownerBinding !== current.ownerBinding ||
    input.nextRecoveryAuthorization.vaultId !== current.vaultId ||
    input.nextRecoveryAuthorization.keyId === current.authorizationManifest.recoveryAuthorization.keyId ||
    input.nextRecoveryAuthorization.revokedAt !== null
  ) {
    failIntegrity();
  }
  const payload = input.crypto.encryptPayloadV2({
    key: input.nextVaultKey,
    ownerBinding: current.ownerBinding,
    plaintext: input.plaintext,
    revision: current.payload.revision + 1,
    baseRevision: current.payload.revision,
  });
  const transitionTime = auditTime(
    clock,
    current.commit.createdAt,
    current.authorizationManifest.updatedAt,
    current.keyring.updatedAt,
    payload.createdAt,
    input.nextKeyring.updatedAt,
    input.nextRecoveryAuthorization.createdAt,
  );
  const timestamp = transitionTime.toISOString();
  const devices = current.authorizationManifest.devices.map((device) =>
    device.deviceId === replacement.deviceId || device.revokedAt !== null
      ? device
      : { ...device, revokedAt: timestamp },
  );
  const manifest = AuthorizationManifestV2Schema.parse({
    ...current.authorizationManifest,
    epoch: current.authorizationManifest.epoch + 1,
    revision: current.authorizationManifest.revision + 1,
    devices,
    recoveryAuthorization: input.nextRecoveryAuthorization,
    updatedAt: timestamp,
  });
  const id = operationId(clock);
  const snapshot = buildSnapshot(input.crypto, input.nextVaultKey, input.authorizationKey, {
    ownerBinding: current.ownerBinding,
    epoch: current.commit.epoch + 1,
    sequence: current.commit.sequence + 1,
    parentCommitHash: current.commitHash,
    operationId: id,
    commitCreatedAt: timestamp,
    payload,
    keyring: input.nextKeyring,
    manifest,
  });
  return VaultRotateKeyCommandV2Schema.parse({
    formatVersion: 2,
    commandType: "ROTATE_KEY",
    ownerBinding: current.ownerBinding,
    vaultId: current.vaultId,
    operationId: id,
    expectedParentCommitHash: current.commitHash,
    reason: "RECOVERY_ROTATED",
    proof: signedCommandProof(
      input.crypto,
      input.authorizationKey,
      snapshot,
      "ROTATE_KEY",
      current.commitHash,
      transitionTime,
    ),
    nextSnapshot: snapshot,
  });
}

/**
 * Renews only the short-lived authorization proof for an otherwise immutable,
 * already-durable recovery rotation. The operation id, parent, encrypted
 * successor, commit, and audit reason remain byte-for-byte unchanged.
 */
export function renewVaultRecoveryRotationCommandProof(input: {
  readonly crypto: VaultCrypto;
  readonly authorizationKey: AuthorizationKeyHandle;
  readonly command: VaultRotateKeyCommandV2;
  readonly clock?: VaultSyncClock;
}): VaultRotateKeyCommandV2 {
  const command = VaultRotateKeyCommandV2Schema.parse(input.command);
  const signer = command.nextSnapshot.commit.author;
  if (
    input.authorizationKey.kind !== "DEVICE" ||
    input.authorizationKey.deviceId === null ||
    input.authorizationKey.ownerBinding !== command.ownerBinding ||
    input.authorizationKey.deviceId !== signer.deviceId ||
    input.authorizationKey.keyId !== signer.keyId ||
    command.nextSnapshot.commit.operationId !== command.operationId ||
    command.nextSnapshot.commit.parentCommitHash !== command.expectedParentCommitHash
  ) {
    failIntegrity();
  }
  const issuedAt = now(input.clock ?? {});
  return VaultRotateKeyCommandV2Schema.parse({
    ...command,
    proof: signedCommandProof(
      input.crypto,
      input.authorizationKey,
      command.nextSnapshot,
      "ROTATE_KEY",
      command.expectedParentCommitHash,
      issuedAt,
    ),
  });
}

export function createVaultReadProofHeader(input: {
  readonly crypto: VaultCrypto;
  readonly authorizationKey: AuthorizationKeyHandle;
  readonly ownerBinding: string;
  readonly vaultId: string;
  readonly clock?: VaultSyncClock;
}): string {
  const clock = input.clock ?? {};
  const issuedAt = now(clock);
  const nonce = input.clock?.randomBytes?.(32) ?? crypto.getRandomValues(new Uint8Array(32));
  if (nonce.byteLength !== 32) failIntegrity();
  try {
    const proof = input.crypto.signVaultReadProof({
      authorizationKey: input.authorizationKey,
      proof: {
        formatVersion: 2,
        ownerBinding: input.ownerBinding,
        vaultId: input.vaultId,
        signer: authorFor(input.authorizationKey),
        nonce: uint8ToBase64Url(nonce),
        issuedAt: issuedAt.toISOString(),
        expiresAt: proofExpiry(issuedAt),
      },
    });
    return encodeVaultReadProofHeaderV2(proof);
  } finally {
    nonce.fill(0);
  }
}

function uint8ToBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function taskValue(document: PersonalVaultDocumentV1, id: string) {
  return document.tasks.find((task) => task.id === id);
}

function sameTask(
  left: PersonalVaultDocumentV1["tasks"][number] | undefined,
  right: PersonalVaultDocumentV1["tasks"][number] | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Stable task-id three-way merge; divergent edits never become last-write-wins. */
export function mergeTaskDocuments(
  base: PersonalVaultDocumentV1,
  local: PersonalVaultDocumentV1,
  remote: PersonalVaultDocumentV1,
): PersonalVaultDocumentV1 | null {
  const ids = new Set([
    ...base.tasks.map((task) => task.id),
    ...remote.tasks.map((task) => task.id),
    ...local.tasks.map((task) => task.id),
  ]);
  const merged: PersonalVaultDocumentV1["tasks"][number][] = [];
  for (const id of ids) {
    const prior = taskValue(base, id);
    const ours = taskValue(local, id);
    const theirs = taskValue(remote, id);
    const oursChanged = !sameTask(prior, ours);
    const theirsChanged = !sameTask(prior, theirs);
    let selected;
    if (!oursChanged) selected = theirs;
    else if (!theirsChanged || sameTask(ours, theirs)) selected = ours;
    else return null;
    if (selected !== undefined) merged.push(selected);
  }
  return createTaskDocument(merged);
}
