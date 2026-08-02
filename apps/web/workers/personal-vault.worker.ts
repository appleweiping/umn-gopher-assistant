/// <reference lib="webworker" />

import {
  createVaultCrypto,
  type AuthorizationKeyHandle,
  type DeviceKeyHandle,
  type EncryptedVaultPayloadEnvelopeV1,
  type RecoveryAuthorizationPublicKeyV2,
  type VaultCrypto,
  type VaultKeyHandle,
  type VaultKeyringV1,
} from "@umn-gopher-assistant/crypto";
import {
  DevicePairingViewV2Schema,
  type DevicePairingViewV2,
  type VaultSyncSnapshotV2,
} from "@umn-gopher-assistant/contracts";
import {
  createBrowserDeviceWrappingKey,
  openBrowserDeviceKey,
  sealBrowserDeviceKey,
} from "@umn-gopher-assistant/crypto/browser";

import {
  createTaskDocument,
  createSnapshot,
  parseLegacyTasks,
  parseVaultRpcRequest,
  parsePersonalVaultDocumentBytes,
  serializePersonalVaultDocument,
  type PersonalVaultDocumentV1,
  type SetupSource,
  type VaultRpcError,
  type VaultRpcRequest,
  type VaultRpcResponse,
  type VaultSnapshot,
  type VaultSyncState,
} from "../lib/personal-vault/protocol";
import {
  abandonRemoteRecoveryPairingV2,
  adoptPersistedRemoteVaultSyncV2,
  adoptPersistedRemoteVaultSyncAndPayloadV2,
  beginExistingVaultSyncV2,
  clearPendingPairingV2,
  commitRemoteRecoveryRotationV2,
  commitPersistedVaultSyncV2,
  completeRemoteRecoveryPairingV2,
  completePairedVaultSetupV2,
  createActiveVaultMeta,
  createPersistedVault,
  createPersistedVaultAndBeginSyncV2,
  persistPendingPairingV2,
  persistRemoteRecoveryPairingIdV2,
  persistRemoteRecoveryPairingV2,
  planDeviceRecipientRotation,
  probePersonalVaultStorage,
  readPendingPairingV2,
  readPersistedRemoteRecoveryV2,
  readPersistedVaultSyncV2,
  readRecoverableVault,
  readPersistedVault,
  rebaseRemoteRecoveryRotationV2,
  renewRemoteRecoveryRotationProofV2,
  renewPersistedVaultSyncCommandProofV2,
  rebasePersistedVaultSyncUpdateAndPayloadV2,
  replacePayloadIfRevision,
  replaceVaultAfterRotationIfRevision,
  stagePendingPairingCancellationV2,
  stageRemoteRecoveryRotationV2,
  stagePersistedVaultSyncUpdateV2,
  type PersistedPendingPairingV2,
  type PersistedRemoteRecoveryPairingV2,
  type PersistedRemoteRecoveryRotationV2,
  type PersistedVaultSyncV2,
} from "../lib/personal-vault/idb";
import {
  destroyVaultStateHandles,
  destroyVaultStateOnFailure,
  prepareVaultStateForPublication,
} from "../lib/personal-vault/key-handle-lifecycle";
import {
  classifyVerifiedPendingUpdateHead,
  isDurableOrdinarySyncRecoveryStatus,
  mayRenewOrdinarySyncProof,
  type RecoverableOrdinarySyncFailureStatus,
} from "../lib/personal-vault/ordinary-sync-retry";
import {
  isDurableCommandRecoveryStatus,
  mayRenewRecoveryRotationProof,
} from "../lib/personal-vault/remote-recovery-retry";
import {
  createDevicePairingRequest,
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
  verifyAndDecryptRemoteSnapshot,
  VaultSyncProtocolError,
} from "../lib/personal-vault/sync-protocol";
import {
  PersonalVaultSyncHttpClient,
  VaultHttpProtocolError,
  type VaultBootstrap,
} from "../lib/personal-vault/sync-http-client";
import { isKnownUnsafeAppleWebKitVault } from "../lib/personal-vault/webkit-safety";

const DEFAULT_TASKS = [
  { id: "reading-response", title: "Draft reading response", done: false },
  { id: "transit-check", title: "Review transit notes", done: false },
] as const;

const INITIAL_DOCUMENT_REVISION = 1;
const MAX_MUTATION_ATTEMPTS = 4;

interface PendingSetup {
  readonly crypto: VaultCrypto;
  readonly deviceKey: DeviceKeyHandle;
  readonly vaultKey: VaultKeyHandle;
  readonly keyring: VaultKeyringV1;
  readonly document: PersonalVaultDocumentV1;
  readonly source: SetupSource;
  readonly recoveryCode: string;
}

interface UnlockedVault {
  readonly crypto: VaultCrypto;
  readonly deviceKey: DeviceKeyHandle | undefined;
  readonly vaultKey: VaultKeyHandle;
  revision: number;
  document: PersonalVaultDocumentV1;
  syncState: VaultSyncState;
}

interface PendingRemoteRotation {
  readonly nextVaultKey: VaultKeyHandle;
  readonly nextKeyring: VaultKeyringV1;
  readonly nextLocalPayload: EncryptedVaultPayloadEnvelopeV1;
  readonly nextRecoveryAuthorization: RecoveryAuthorizationPublicKeyV2;
  readonly recoveryCode: string;
}

type VaultMutation =
  | {
      readonly kind: "add-task";
      readonly task: PersonalVaultDocumentV1["tasks"][number];
    }
  | {
      readonly kind: "set-task-done";
      readonly taskId: string;
      readonly done: boolean;
    };

let pendingSetup: PendingSetup | undefined;
let pendingRemoteRotation: PendingRemoteRotation | undefined;
let unlocked: UnlockedVault | undefined;
let queue = Promise.resolve();
const syncHttp = new PersonalVaultSyncHttpClient();

function assertSafeBrowserPersistence(): void {
  if (isKnownUnsafeAppleWebKitVault(self.navigator.userAgent)) {
    throw Object.assign(new Error("This Apple WebKit version cannot safely persist the vault."), {
      code: "UNAVAILABLE",
    });
  }
}

function generateId(): string {
  return crypto.randomUUID();
}

function destroyPendingSetup(): void {
  if (pendingSetup === undefined) return;
  const current = pendingSetup;
  pendingSetup = undefined;
  destroyVaultStateHandles(current);
}

function destroyPendingRemoteRotation(): void {
  pendingRemoteRotation?.nextVaultKey.destroy();
  pendingRemoteRotation = undefined;
}

function destroyUnlocked(): void {
  if (unlocked === undefined) return;
  const current = unlocked;
  unlocked = undefined;
  destroyVaultStateHandles(current);
}

function destroyVaultState(state: UnlockedVault): void {
  destroyVaultStateHandles(state);
}

function asVaultError(error: unknown): VaultRpcError {
  if (error instanceof Error && "code" in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (code === "AUTHENTICATION_FAILED") return { code: "AUTHENTICATION_FAILED" };
    if (code === "CONFLICT") return { code: "CONFLICT" };
    if (code === "DEVICE_ENVELOPE_LIMIT_REACHED") return { code: "DEVICE_ENVELOPE_LIMIT_REACHED" };
    if (code === "NOT_READY") return { code: "NOT_READY" };
    if (code === "OWNER_MISMATCH") return { code: "OWNER_MISMATCH" };
    if (code === "PAIRING_FAILED" || code === "SIGNED_OUT") return { code: "PAIRING_FAILED" };
    if (code === "SYNC_CONFLICT") return { code: "SYNC_CONFLICT" };
    if (code === "UNAVAILABLE") return { code: "UNAVAILABLE" };
  }
  if (error instanceof VaultSyncProtocolError && error.code === "ROLLBACK_DETECTED") {
    return { code: "ROLLBACK_DETECTED" };
  }
  if (error instanceof Error && error.name === "PersonalVaultSchemaError") return { code: "INVALID_LEGACY" };
  return { code: "STORAGE_FAILED" };
}

function respond(response: VaultRpcResponse): void {
  self.postMessage(response);
}

function snapshot(state: UnlockedVault): VaultSnapshot {
  return createSnapshot(state.revision, state.document);
}

function decodeDocument(
  cryptoFacade: VaultCrypto,
  key: VaultKeyHandle,
  payload: EncryptedVaultPayloadEnvelopeV1,
) {
  const bytes = cryptoFacade.decryptPayload({ key, envelope: payload });
  try {
    return parsePersonalVaultDocumentBytes(bytes);
  } finally {
    bytes.fill(0);
  }
}

function syncSnapshot(state: UnlockedVault): VaultSnapshot {
  return createSnapshot(state.revision, state.document);
}

async function bootstrap(): Promise<VaultBootstrap | VaultSyncState> {
  try {
    const result = await syncHttp.bootstrap();
    if (result.kind === "ok") return result.value;
    return result.status === 401 ? "signed-out" : "deferred";
  } catch (error) {
    if (error instanceof VaultHttpProtocolError && error.code === "NETWORK_UNAVAILABLE") return "deferred";
    throw error;
  }
}

function deviceAuthorization(
  state: UnlockedVault,
  binding: { readonly ownerBinding: string; readonly authorizationKeyId: string },
): AuthorizationKeyHandle {
  if (state.deviceKey === undefined) throw new Error("A trusted device is required for sync.");
  return state.crypto.deriveDeviceAuthorizationKey({
    ownerBinding: binding.ownerBinding,
    deviceKey: state.deviceKey,
    keyId: binding.authorizationKeyId,
  });
}

function verifiedRemoteDocument(
  state: UnlockedVault,
  candidate: unknown,
  ownerBinding: string,
  highWater?: PersistedVaultSyncV2["highWater"],
): { readonly document: PersonalVaultDocumentV1; readonly snapshot: VaultSyncSnapshotV2 } {
  const verified = verifyAndDecryptRemoteSnapshot(
    state.crypto,
    state.vaultKey,
    candidate,
    ownerBinding,
    highWater ?? undefined,
  );
  try {
    return {
      document: parsePersonalVaultDocumentBytes(verified.plaintext),
      snapshot: verified.snapshot,
    };
  } finally {
    verified.plaintext.fill(0);
  }
}

function encryptLocalDocumentSuccessor(
  state: UnlockedVault,
  document: PersonalVaultDocumentV1,
): EncryptedVaultPayloadEnvelopeV1 {
  const bytes = serializePersonalVaultDocument(document);
  try {
    return state.crypto.encryptPayload({
      key: state.vaultKey,
      plaintext: bytes,
      revision: state.revision + 1,
      baseRevision: state.revision,
    });
  } finally {
    bytes.fill(0);
  }
}

async function readFreshAuthenticatedVault(
  state: UnlockedVault,
  record: PersistedVaultSyncV2,
  authorizationKey: AuthorizationKeyHandle,
): Promise<
  | {
      readonly kind: "ok";
      readonly etag: string;
      readonly verified: ReturnType<typeof verifiedRemoteDocument>;
    }
  | { readonly kind: "state"; readonly state: VaultSyncState }
> {
  const proof = createVaultReadProofHeader({
    crypto: state.crypto,
    authorizationKey,
    ownerBinding: record.ownerBinding,
    vaultId: record.vaultId,
  });
  let remoteResult;
  try {
    remoteResult = await syncHttp.read(proof);
  } catch (error) {
    if (error instanceof VaultHttpProtocolError && error.code === "NETWORK_UNAVAILABLE") {
      return { kind: "state", state: "deferred" };
    }
    throw error;
  }
  if (remoteResult.kind !== "ok") {
    if (remoteResult.kind === "not-modified") {
      throw new Error("A fresh vault read unexpectedly returned not-modified.");
    }
    return {
      kind: "state",
      state:
        remoteResult.status === 401
          ? "signed-out"
          : remoteResult.status === 429 || remoteResult.status === 502 || remoteResult.status === 503
            ? "deferred"
            : "conflict",
    };
  }
  return {
    kind: "ok",
    etag: remoteResult.etag,
    verified: verifiedRemoteDocument(state, remoteResult.value, record.ownerBinding, record.highWater),
  };
}

async function rebaseVerifiedStaleUpdate(
  state: UnlockedVault,
  record: PersistedVaultSyncV2,
  authorizationKey: AuthorizationKeyHandle,
  remoteEtag: string,
  remote: ReturnType<typeof verifiedRemoteDocument>,
): Promise<PersistedVaultSyncV2> {
  if (record.snapshot === null || record.highWater === null || record.pending?.kind !== "update") {
    throw Object.assign(new Error("Stale update cannot be rebased."), {
      code: "SYNC_CONFLICT",
    });
  }
  const base = verifiedRemoteDocument(state, record.snapshot, record.ownerBinding).document;
  // Authenticate the durable intended successor even when later offline edits
  // have advanced the local v1 document beyond it.
  verifiedRemoteDocument(state, record.pending.command.nextSnapshot, record.ownerBinding, record.highWater);
  const merged = mergeTaskDocuments(base, state.document, remote.document);
  if (merged === null) {
    throw Object.assign(new Error("Concurrent task edits conflict."), { code: "SYNC_CONFLICT" });
  }
  const bytes = serializePersonalVaultDocument(merged);
  try {
    const rebased = createVaultPayloadUpdateCommand({
      crypto: state.crypto,
      vaultKey: state.vaultKey,
      authorizationKey,
      current: remote.snapshot,
      plaintext: bytes,
    });
    const localPayload = encryptLocalDocumentSuccessor(state, merged);
    const next = await rebasePersistedVaultSyncUpdateAndPayloadV2(
      record.pending.command.operationId,
      state.revision,
      localPayload,
      remoteEtag,
      remote.snapshot,
      rebased,
    );
    state.revision = localPayload.revision;
    state.document = merged;
    return next;
  } finally {
    bytes.fill(0);
  }
}

async function reconcilePendingCreate(
  state: UnlockedVault,
  record: PersistedVaultSyncV2,
  authorizationKey: AuthorizationKeyHandle,
  failureStatus: RecoverableOrdinarySyncFailureStatus,
  intendedDocument: PersonalVaultDocumentV1,
): Promise<PersistedVaultSyncV2 | VaultSyncState> {
  if (record.pending?.kind !== "create") return "conflict";
  let currentBootstrap;
  try {
    currentBootstrap = await syncHttp.bootstrap();
  } catch (error) {
    if (error instanceof VaultHttpProtocolError && error.code === "NETWORK_UNAVAILABLE") {
      return "deferred";
    }
    throw error;
  }
  if (currentBootstrap.kind === "failure") {
    return currentBootstrap.status === 401 ? "signed-out" : "deferred";
  }
  if (currentBootstrap.value.ownerBinding !== record.ownerBinding) {
    throw Object.assign(new Error("Authenticated account does not match the pending vault."), {
      code: "OWNER_MISMATCH",
    });
  }
  if (!currentBootstrap.value.vault.exists) {
    // A 409 binds this operation id to a different request digest. Changing
    // its proof and retrying would remain a conflict rather than prove safety.
    if (!mayRenewOrdinarySyncProof(failureStatus)) return "conflict";
    const renewed = renewVaultSyncCommandProof({
      crypto: state.crypto,
      authorizationKey,
      command: record.pending.command,
    });
    return renewPersistedVaultSyncCommandProofV2(record.pending.command, renewed);
  }
  if (currentBootstrap.value.vault.vaultId !== record.vaultId) return "conflict";
  const remote = await readFreshAuthenticatedVault(state, record, authorizationKey);
  if (remote.kind === "state") return remote.state;
  if (JSON.stringify(remote.verified.snapshot) !== JSON.stringify(record.pending.command.snapshot)) {
    return "conflict";
  }
  const committed = await commitPersistedVaultSyncV2(
    record.pending.command.operationId,
    remote.etag,
    remote.verified.snapshot,
  );
  if (JSON.stringify(state.document) === JSON.stringify(intendedDocument)) {
    state.document = remote.verified.document;
  }
  return committed;
}

async function reconcilePendingUpdate(
  state: UnlockedVault,
  record: PersistedVaultSyncV2,
  authorizationKey: AuthorizationKeyHandle,
  failureStatus: RecoverableOrdinarySyncFailureStatus,
  intendedDocument: PersonalVaultDocumentV1,
): Promise<PersistedVaultSyncV2 | VaultSyncState> {
  if (
    record.snapshot === null ||
    record.highWater === null ||
    record.etag === null ||
    record.pending?.kind !== "update"
  ) {
    return "conflict";
  }
  const remote = await readFreshAuthenticatedVault(state, record, authorizationKey);
  if (remote.kind === "state") return remote.state;
  const classification = classifyVerifiedPendingUpdateHead({
    base: record.snapshot,
    intended: record.pending.command.nextSnapshot,
    remote: remote.verified.snapshot,
  });
  if (classification === "applied") {
    const committed = await commitPersistedVaultSyncV2(
      record.pending.command.operationId,
      remote.etag,
      remote.verified.snapshot,
    );
    if (JSON.stringify(state.document) === JSON.stringify(intendedDocument)) {
      state.document = remote.verified.document;
    }
    return committed;
  }
  if (classification === "parent") {
    if (remote.etag !== record.etag || !mayRenewOrdinarySyncProof(failureStatus)) {
      return "conflict";
    }
    const renewed = renewVaultSyncCommandProof({
      crypto: state.crypto,
      authorizationKey,
      command: record.pending.command,
    });
    return renewPersistedVaultSyncCommandProofV2(record.pending.command, renewed);
  }
  if (classification === "payload-child") {
    return rebaseVerifiedStaleUpdate(state, record, authorizationKey, remote.etag, remote.verified);
  }
  return "conflict";
}

async function uploadPending(
  state: UnlockedVault,
  initial: PersistedVaultSyncV2,
  authorizationKey: AuthorizationKeyHandle,
): Promise<PersistedVaultSyncV2 | VaultSyncState> {
  let record = initial;
  for (let attempt = 0; attempt < MAX_MUTATION_ATTEMPTS; attempt += 1) {
    const pending = record.pending;
    if (pending === null) return record;
    const pendingSnapshot =
      pending.kind === "create" ? pending.command.snapshot : pending.command.nextSnapshot;
    const intendedDocument = verifiedRemoteDocument(
      state,
      pendingSnapshot,
      record.ownerBinding,
      record.highWater,
    ).document;
    let result;
    try {
      result =
        pending.kind === "create"
          ? await syncHttp.create(pending.command)
          : await syncHttp.update(pending.command, record.etag ?? "");
    } catch (error) {
      if (error instanceof VaultHttpProtocolError && error.code === "NETWORK_UNAVAILABLE") return "deferred";
      throw error;
    }
    if (result.kind === "failure") {
      if (result.status === 401) return "signed-out";
      if (isDurableOrdinarySyncRecoveryStatus(result.status)) {
        const reconciled =
          pending.kind === "create"
            ? await reconcilePendingCreate(state, record, authorizationKey, result.status, intendedDocument)
            : await reconcilePendingUpdate(state, record, authorizationKey, result.status, intendedDocument);
        if (typeof reconciled === "string") return reconciled;
        record = reconciled;
        if (record.pending === null) return record;
        continue;
      }
      return "deferred";
    }
    if (result.kind !== "ok") throw new Error("Mutation returned not-modified.");
    const verified = verifiedRemoteDocument(state, result.value, record.ownerBinding, record.highWater);
    if (JSON.stringify(verified.snapshot) !== JSON.stringify(pendingSnapshot)) {
      throw Object.assign(new Error("Mutation result does not match the exact staged successor."), {
        code: "SYNC_CONFLICT",
      });
    }
    record = await commitPersistedVaultSyncV2(pending.command.operationId, result.etag, verified.snapshot);
    // Offline edits may have advanced the durable local v1 document after
    // this command was staged. Preserve them; synchronizeUnlocked will stage
    // a successor after the idempotent predecessor is confirmed.
    if (JSON.stringify(state.document) === JSON.stringify(intendedDocument)) {
      state.document = verified.document;
    }
    return record;
  }
  return "conflict";
}

async function synchronizeUnlocked(state: UnlockedVault): Promise<VaultSyncState> {
  const bootstrapResult = await bootstrap();
  if (typeof bootstrapResult === "string") return bootstrapResult;
  let record = await readPersistedVaultSyncV2();
  if (record === null) {
    return bootstrapResult.vault.exists ? "conflict" : "local-only";
  }
  if (
    record.ownerBinding !== bootstrapResult.ownerBinding ||
    (bootstrapResult.vault.exists &&
      (record.vaultId !== bootstrapResult.vault.vaultId ||
        (record.etag !== null && record.etag !== bootstrapResult.vault.etag && record.snapshot === null)))
  ) {
    throw Object.assign(new Error("Authenticated account does not match the local sync binding."), {
      code: "OWNER_MISMATCH",
    });
  }
  const authorizationKey = deviceAuthorization(state, record);
  try {
    const uploaded = await uploadPending(state, record, authorizationKey);
    if (typeof uploaded === "string") return uploaded;
    record = uploaded;
    if (record.snapshot === null || record.etag === null) return "deferred";
    const remoteDocument = verifiedRemoteDocument(
      state,
      record.snapshot,
      record.ownerBinding,
      record.highWater,
    ).document;
    if (JSON.stringify(remoteDocument) !== JSON.stringify(state.document)) {
      const bytes = serializePersonalVaultDocument(state.document);
      try {
        const catchup = createVaultPayloadUpdateCommand({
          crypto: state.crypto,
          vaultKey: state.vaultKey,
          authorizationKey,
          current: record.snapshot,
          plaintext: bytes,
        });
        record = await stagePersistedVaultSyncUpdateV2(record.etag, catchup);
      } finally {
        bytes.fill(0);
      }
      const caughtUp = await uploadPending(state, record, authorizationKey);
      if (typeof caughtUp === "string") return caughtUp;
      record = caughtUp;
    }
    if (record.snapshot === null || record.etag === null) return "deferred";
    const proof = createVaultReadProofHeader({
      crypto: state.crypto,
      authorizationKey,
      ownerBinding: record.ownerBinding,
      vaultId: record.vaultId,
    });
    let result;
    try {
      result = await syncHttp.read(proof, record.etag);
    } catch (error) {
      if (error instanceof VaultHttpProtocolError && error.code === "NETWORK_UNAVAILABLE") return "deferred";
      throw error;
    }
    if (result.kind === "not-modified") {
      if (result.etag !== record.etag) throw new Error("304 ETag changed.");
      return "synced";
    }
    if (result.kind === "failure") return result.status === 401 ? "signed-out" : "deferred";
    const verified = verifiedRemoteDocument(state, result.value, record.ownerBinding, record.highWater);
    if (JSON.stringify(verified.document) === JSON.stringify(state.document)) {
      await adoptPersistedRemoteVaultSyncV2(record.snapshot.commitHash, result.etag, verified.snapshot);
    } else {
      const localPayload = encryptLocalDocumentSuccessor(state, verified.document);
      await adoptPersistedRemoteVaultSyncAndPayloadV2(
        record.snapshot.commitHash,
        state.revision,
        localPayload,
        result.etag,
        verified.snapshot,
      );
      state.revision = localPayload.revision;
      state.document = verified.document;
    }
    return "synced";
  } finally {
    authorizationKey.destroy();
  }
}

async function unlockPersistedVault(): Promise<UnlockedVault> {
  const record = await readPersistedVault();
  if (record === null) throw new Error("Personal vault has not been created.");
  const cryptoFacade = await createVaultCrypto();
  let deviceKey: DeviceKeyHandle | undefined;
  let vaultKey: VaultKeyHandle | undefined;
  try {
    deviceKey = await openBrowserDeviceKey({
      publicKey: record.trustedDevice.publicKey,
      wrappingKey: record.trustedDevice.wrappingKey,
      envelope: record.trustedDevice.envelope,
    });
    const deviceEnvelope = record.keyring.deviceEnvelopes.find(
      (candidate) => candidate.recipientDeviceId === deviceKey?.publicKey.deviceId,
    );
    if (deviceEnvelope === undefined) throw new Error("Missing local device envelope.");
    vaultKey = cryptoFacade.unwrapVaultKeyForDevice({ deviceKey, envelope: deviceEnvelope });
    const document = decodeDocument(cryptoFacade, vaultKey, record.payload);
    const state: UnlockedVault = {
      crypto: cryptoFacade,
      deviceKey,
      vaultKey,
      revision: record.payload.revision,
      document,
      syncState: "local-only",
    };
    deviceKey = undefined;
    vaultKey = undefined;
    return state;
  } finally {
    if (deviceKey !== undefined) deviceKey.destroy();
    if (vaultKey !== undefined) vaultKey.destroy();
  }
}

function inputDocument(source: SetupSource, legacyRaw: string | null): PersonalVaultDocumentV1 {
  if (source === "legacy") {
    if (legacyRaw === null) throw new Error("Legacy data is required.");
    return parseLegacyTasks(legacyRaw);
  }
  if (legacyRaw !== null || source === "empty") return createTaskDocument([]);
  return createTaskDocument(DEFAULT_TASKS);
}

async function beginSetup(source: SetupSource, legacyRaw: string | null) {
  destroyPendingSetup();
  const document = inputDocument(source, legacyRaw);
  const cryptoFacade = await createVaultCrypto();
  const deviceKey = cryptoFacade.generateDeviceKey({ deviceId: generateId() });
  const vaultKey = cryptoFacade.generateVaultKey({ vaultId: generateId() });
  try {
    const keyring = cryptoFacade.createKeyring({
      key: vaultKey,
      revision: INITIAL_DOCUMENT_REVISION,
      recipients: [deviceKey.publicKey],
    });
    pendingSetup = {
      crypto: cryptoFacade,
      deviceKey,
      vaultKey,
      keyring: keyring.keyring,
      document,
      source,
      recoveryCode: keyring.recoveryCode,
    };
    return { recoveryCode: keyring.recoveryCode, source };
  } catch (error) {
    deviceKey.destroy();
    vaultKey.destroy();
    throw error;
  }
}

async function confirmSetup(): Promise<{
  readonly snapshot: VaultSnapshot;
  readonly syncState: VaultSyncState;
}> {
  const setup = pendingSetup;
  if (setup === undefined) throw new Error("No pending setup.");
  const bytes = serializePersonalVaultDocument(setup.document);
  let authorizationKey: AuthorizationKeyHandle | undefined;
  let recoveryAuthorization: AuthorizationKeyHandle | undefined;
  try {
    const bootstrapResult = await bootstrap();
    if (typeof bootstrapResult !== "string" && bootstrapResult.vault.exists) {
      throw Object.assign(new Error("This account already has a remote vault; pair this device instead."), {
        code: "SYNC_CONFLICT",
      });
    }
    const payload = setup.crypto.encryptPayload({
      key: setup.vaultKey,
      plaintext: bytes,
      revision: INITIAL_DOCUMENT_REVISION,
      baseRevision: null,
    });
    const wrappingKey = await createBrowserDeviceWrappingKey();
    const deviceEnvelope = await sealBrowserDeviceKey({ deviceKey: setup.deviceKey, wrappingKey });
    const localRecord = {
      meta: createActiveVaultMeta(setup.vaultKey.vaultId),
      keyring: setup.keyring,
      payload,
      trustedDevice: {
        formatVersion: 1 as const,
        publicKey: setup.deviceKey.publicKey,
        envelope: deviceEnvelope,
        wrappingKey,
      },
    };
    let draft: PersistedVaultSyncV2 | null = null;
    if (typeof bootstrapResult !== "string") {
      const authorizationKeyId = generateId();
      authorizationKey = setup.crypto.deriveDeviceAuthorizationKey({
        ownerBinding: bootstrapResult.ownerBinding,
        deviceKey: setup.deviceKey,
        keyId: authorizationKeyId,
      });
      recoveryAuthorization = setup.crypto.deriveRecoveryAuthorizationKey({
        recoveryCode: setup.recoveryCode,
        ownerBinding: bootstrapResult.ownerBinding,
        vaultId: setup.vaultKey.vaultId,
        keyId: generateId(),
      });
      const command = createVaultGenesisCommand({
        crypto: setup.crypto,
        vaultKey: setup.vaultKey,
        authorizationKey,
        ownerBinding: bootstrapResult.ownerBinding,
        device: setup.crypto.createDeviceDescriptorV2({
          ownerBinding: bootstrapResult.ownerBinding,
          encryptionKey: setup.deviceKey,
          authorizationKey,
        }),
        recoveryAuthorization: setup.crypto.createRecoveryAuthorizationPublicKeyV2({
          authorizationKey: recoveryAuthorization,
        }),
        keyring: setup.keyring,
        plaintext: bytes,
      });
      draft = await createPersistedVaultAndBeginSyncV2(localRecord, authorizationKeyId, command);
    } else {
      await createPersistedVault(localRecord);
    }
    // The independently reopened state remains caller-local until its exact
    // plaintext and any initial remote upload have both completed. A rejected
    // upload must not publish live handles or plaintext through `unlocked`.
    destroyUnlocked();
    let syncState: VaultSyncState = "local-only";
    const readBack = await prepareVaultStateForPublication(
      await unlockPersistedVault(),
      async (candidate) => {
        const expected = JSON.stringify(setup.document);
        const actual = JSON.stringify(candidate.document);
        if (expected !== actual || candidate.revision !== INITIAL_DOCUMENT_REVISION)
          throw new Error("Vault read-back verification failed.");
        // The pending creator handles are no longer needed after a durable,
        // independently reopened record verified the exact plaintext.
        setup.deviceKey.destroy();
        setup.vaultKey.destroy();
        pendingSetup = undefined;
        if (draft === null || authorizationKey === undefined) {
          syncState = bootstrapResult === "signed-out" ? "signed-out" : "local-only";
        } else {
          const result = await uploadPending(candidate, draft, authorizationKey);
          syncState = typeof result === "string" ? result : "synced";
        }
        candidate.syncState = syncState;
      },
    );
    unlocked = readBack;
    return { snapshot: snapshot(readBack), syncState };
  } finally {
    bytes.fill(0);
    authorizationKey?.destroy();
    recoveryAuthorization?.destroy();
    destroyPendingSetup();
  }
}

async function enableAccountSync(
  state: UnlockedVault,
  recoveryCode: string,
): Promise<{ readonly snapshot: VaultSnapshot; readonly syncState: VaultSyncState }> {
  const localRecord = await readPersistedVault();
  if (
    localRecord === null ||
    state.deviceKey === undefined ||
    localRecord.meta.vaultId !== state.vaultKey.vaultId ||
    localRecord.keyring.vaultKeyId !== state.vaultKey.vaultKeyId ||
    localRecord.payload.revision !== state.revision
  ) {
    throw Object.assign(new Error("Local vault changed before account sync could be enabled."), {
      code: "CONFLICT",
    });
  }
  const plaintext = serializePersonalVaultDocument(state.document);
  let authorizationKey: AuthorizationKeyHandle | undefined;
  let recoveryAuthorization: AuthorizationKeyHandle | undefined;
  try {
    // Authentication deliberately precedes bootstrap and every storage write:
    // a wrong recovery code has no durable or remote side effect.
    if (
      !verifyLocalRecoveryCodeForAccountSync({
        crypto: state.crypto,
        activeVaultKey: state.vaultKey,
        keyring: localRecord.keyring,
        payload: localRecord.payload,
        expectedPlaintext: plaintext,
        recoveryCode,
      })
    ) {
      throw Object.assign(new Error("Recovery code authentication failed."), {
        code: "AUTHENTICATION_FAILED",
      });
    }

    const bootstrapResult = await bootstrap();
    if (typeof bootstrapResult === "string") {
      throw Object.assign(
        new Error(
          bootstrapResult === "signed-out"
            ? "Sign in before enabling account sync."
            : "Account sync bootstrap is unavailable.",
        ),
        { code: bootstrapResult === "signed-out" ? "NOT_READY" : "STORAGE_FAILED" },
      );
    }
    const existingSync = await readPersistedVaultSyncV2();
    if (existingSync !== null) {
      if (
        existingSync.ownerBinding !== bootstrapResult.ownerBinding ||
        existingSync.vaultId !== localRecord.meta.vaultId
      ) {
        throw Object.assign(new Error("Account sync is bound to a different owner."), {
          code: "OWNER_MISMATCH",
        });
      }
      state.syncState = await synchronizeUnlocked(state);
      return { snapshot: snapshot(state), syncState: state.syncState };
    }
    if (bootstrapResult.vault.exists) {
      throw Object.assign(
        new Error("This account already has a remote vault; the local vault was not uploaded."),
        { code: "SYNC_CONFLICT" },
      );
    }

    const authorizationKeyId = generateId();
    authorizationKey = state.crypto.deriveDeviceAuthorizationKey({
      ownerBinding: bootstrapResult.ownerBinding,
      deviceKey: state.deviceKey,
      keyId: authorizationKeyId,
    });
    recoveryAuthorization = state.crypto.deriveRecoveryAuthorizationKey({
      recoveryCode,
      ownerBinding: bootstrapResult.ownerBinding,
      vaultId: state.vaultKey.vaultId,
      keyId: generateId(),
    });
    const command = createVaultGenesisCommand({
      crypto: state.crypto,
      vaultKey: state.vaultKey,
      authorizationKey,
      ownerBinding: bootstrapResult.ownerBinding,
      device: state.crypto.createDeviceDescriptorV2({
        ownerBinding: bootstrapResult.ownerBinding,
        encryptionKey: state.deviceKey,
        authorizationKey,
      }),
      recoveryAuthorization: state.crypto.createRecoveryAuthorizationPublicKeyV2({
        authorizationKey: recoveryAuthorization,
      }),
      keyring: localRecord.keyring,
      plaintext,
    });
    // Once this strict transaction commits, sync-now can replay the exact
    // signed command after a crash or a lost first response.
    const draft = await beginExistingVaultSyncV2(localRecord, authorizationKeyId, command);
    const uploaded = await uploadPending(state, draft, authorizationKey);
    state.syncState = typeof uploaded === "string" ? uploaded : "synced";
    return { snapshot: snapshot(state), syncState: state.syncState };
  } finally {
    plaintext.fill(0);
    authorizationKey?.destroy();
    recoveryAuthorization?.destroy();
  }
}

function applyMutation(document: PersonalVaultDocumentV1, mutation: VaultMutation): PersonalVaultDocumentV1 {
  if (mutation.kind === "add-task") {
    const existing = document.tasks.find((task) => task.id === mutation.task.id);
    if (existing !== undefined) {
      if (existing.title === mutation.task.title && existing.done === mutation.task.done) return document;
      throw new Error("Task operation identifier collision.");
    }
    return createTaskDocument([...document.tasks, mutation.task]);
  }

  const existing = document.tasks.find((task) => task.id === mutation.taskId);
  if (existing === undefined) throw new Error("Unknown task.");
  if (existing.done === mutation.done) return document;
  return createTaskDocument(
    document.tasks.map((task) => (task.id === mutation.taskId ? { ...task, done: mutation.done } : task)),
  );
}

async function refreshAfterConflict(state: UnlockedVault): Promise<void> {
  const latest = state.deviceKey === undefined ? await readRecoverableVault() : await readPersistedVault();
  if (
    latest === null ||
    latest.payload.vaultId !== state.vaultKey.vaultId ||
    latest.payload.vaultKeyId !== state.vaultKey.vaultKeyId ||
    latest.payload.revision <= state.revision
  ) {
    throw new Error("Concurrent vault state could not be refreshed safely.");
  }
  const document = decodeDocument(state.crypto, state.vaultKey, latest.payload);
  state.revision = latest.payload.revision;
  state.document = document;
}

async function stageLocalDocumentForSync(state: UnlockedVault): Promise<VaultSyncState> {
  const record = await readPersistedVaultSyncV2();
  if (record === null) return state.syncState === "signed-out" ? "signed-out" : "local-only";
  if (record.pending !== null) return "deferred";
  if (record.snapshot === null || record.etag === null) return "deferred";
  const authorizationKey = deviceAuthorization(state, record);
  const bytes = serializePersonalVaultDocument(state.document);
  try {
    const command = createVaultPayloadUpdateCommand({
      crypto: state.crypto,
      vaultKey: state.vaultKey,
      authorizationKey,
      current: record.snapshot,
      plaintext: bytes,
    });
    const staged = await stagePersistedVaultSyncUpdateV2(record.etag, command);
    const uploaded = await uploadPending(state, staged, authorizationKey);
    return typeof uploaded === "string" ? uploaded : "synced";
  } catch (error) {
    if (error instanceof VaultHttpProtocolError && error.code === "NETWORK_UNAVAILABLE") return "deferred";
    throw error;
  } finally {
    bytes.fill(0);
    authorizationKey.destroy();
  }
}

async function writeMutation(
  mutation: VaultMutation,
): Promise<{ readonly snapshot: VaultSnapshot; readonly syncState: VaultSyncState }> {
  const state = unlocked;
  if (state === undefined) throw new Error("Vault is locked.");
  if ((await readPersistedRemoteRecoveryV2()) !== null) {
    throw Object.assign(new Error("Mandatory recovery hardening must finish before private writes."), {
      code: "NOT_READY",
    });
  }
  for (let attempt = 1; attempt <= MAX_MUTATION_ATTEMPTS; attempt += 1) {
    const nextDocument = applyMutation(state.document, mutation);
    if (nextDocument === state.document) return { snapshot: snapshot(state), syncState: state.syncState };
    const bytes = serializePersonalVaultDocument(nextDocument);
    try {
      const envelope = state.crypto.encryptPayload({
        key: state.vaultKey,
        plaintext: bytes,
        revision: state.revision + 1,
        baseRevision: state.revision,
      });
      const didWrite = await replacePayloadIfRevision(state.revision, envelope);
      if (!didWrite) {
        if (attempt === MAX_MUTATION_ATTEMPTS) {
          const conflict = new Error("Concurrent vault modification retry limit reached.");
          Object.assign(conflict, { code: "CONFLICT" });
          throw conflict;
        }
        // Re-read and authenticate the newest ciphertext with the live root
        // key, then reapply the stable operation intent. Add IDs are generated
        // once; toggles carry a target state rather than toggling twice.
        await refreshAfterConflict(state);
        continue;
      }
      // Read the committed ciphertext back through the active key before any
      // caller receives a snapshot or deletes a legacy plaintext source.
      const committed =
        state.deviceKey === undefined ? await readRecoverableVault() : await readPersistedVault();
      if (committed === null || committed.payload.revision < envelope.revision) {
        throw new Error("Vault read-back verification failed.");
      }
      const verified = decodeDocument(state.crypto, state.vaultKey, committed.payload);
      // An exact-revision read must equal the just-written document. If a
      // later valid revision already won another CAS, the successful CAS above
      // still proves this intent committed; adopt the newer authenticated
      // document so this tab does not regress or report a false data-loss error.
      if (
        committed.payload.revision === envelope.revision &&
        JSON.stringify(verified) !== JSON.stringify(nextDocument)
      ) {
        throw new Error("Vault read-back verification failed.");
      }
      state.revision = committed.payload.revision;
      state.document = verified;
      // The local CAS and authenticated read-back are the success boundary.
      // Network failure changes only the sync state; it never converts a
      // durable offline edit into a failed user operation.
      try {
        state.syncState = await stageLocalDocumentForSync(state);
      } catch (syncError) {
        const code =
          syncError instanceof Error && "code" in syncError
            ? (syncError as { readonly code?: unknown }).code
            : undefined;
        if (syncError instanceof VaultSyncProtocolError && syncError.code === "ROLLBACK_DETECTED") {
          state.syncState = "rollback";
        } else if (code === "OWNER_MISMATCH" || code === "SYNC_CONFLICT") {
          state.syncState = "conflict";
        } else {
          state.syncState = "deferred";
        }
      }
      return { snapshot: snapshot(state), syncState: state.syncState };
    } catch (error) {
      // The payload may already be durably changed when a post-write read-back
      // or authentication check fails. Never leave a live key handle paired
      // with a stale plaintext React snapshot in that state.
      destroyUnlocked();
      throw error;
    } finally {
      bytes.fill(0);
    }
  }
  throw new Error("Unreachable vault mutation state.");
}

function pairingView(value: DevicePairingViewV2) {
  return {
    id: value.id,
    deviceId: value.requestingDevice.deviceId,
    expiresAt: value.expiresAt,
    state: value.state,
  } as const;
}

function equalPublicValue(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function assertRecoveryAuthorizationMatchesBootstrap(
  cryptoFacade: VaultCrypto,
  derived: AuthorizationKeyHandle,
  remote: Extract<VaultBootstrap, { readonly vault: { readonly exists: true } }>,
): void {
  const descriptor = remote.vault.recoveryAuthorization;
  const fingerprint = cryptoFacade.computeAuthorizationPublicKeyFingerprintV2(descriptor.publicKey);
  if (
    derived.kind !== "RECOVERY" ||
    derived.deviceId !== null ||
    derived.ownerBinding !== remote.ownerBinding ||
    derived.vaultId !== remote.vault.vaultId ||
    descriptor.revokedAt !== null ||
    !equalPublicValue(descriptor.ownerBinding, remote.ownerBinding) ||
    !equalPublicValue(descriptor.vaultId, remote.vault.vaultId) ||
    !equalPublicValue(descriptor.keyId, derived.keyId) ||
    !equalPublicValue(descriptor.publicKey, derived.publicKey) ||
    !equalPublicValue(descriptor.fingerprint, derived.fingerprint) ||
    !equalPublicValue(descriptor.fingerprint, fingerprint)
  ) {
    throw Object.assign(new Error("Remote recovery authorization did not authenticate."), {
      code: "AUTHENTICATION_FAILED",
    });
  }
}

async function resumeRemoteRecoveryPairing(
  initial?: PersistedRemoteRecoveryPairingV2,
): Promise<UnlockedVault> {
  let recovery = initial ?? (await readPersistedRemoteRecoveryV2());
  if (recovery?.stage !== "pairing-pending") {
    throw Object.assign(new Error("No remote recovery pairing is pending."), {
      code: "NOT_READY",
    });
  }
  const remote = await bootstrap();
  if (typeof remote === "string" || !remote.vault.exists) {
    throw Object.assign(new Error("Remote recovery pairing cannot be resumed."), {
      code: remote === "signed-out" ? "SIGNED_OUT" : "PAIRING_FAILED",
    });
  }
  if (remote.ownerBinding !== recovery.ownerBinding || remote.vault.vaultId !== recovery.vaultId) {
    throw Object.assign(new Error("Remote recovery owner changed."), {
      code: "OWNER_MISMATCH",
    });
  }

  const cryptoFacade = await createVaultCrypto();
  let deviceKey: DeviceKeyHandle | undefined;
  let vaultKey: VaultKeyHandle | undefined;
  try {
    deviceKey = await openBrowserDeviceKey({
      publicKey: recovery.trustedDevice.publicKey,
      wrappingKey: recovery.trustedDevice.wrappingKey,
      envelope: recovery.trustedDevice.envelope,
    });
    vaultKey = cryptoFacade.unwrapVaultKeyForDevice({
      deviceKey,
      envelope: recovery.recoveredVaultEnvelope,
    });
    if (recovery.pairingId === null) {
      const created = await syncHttp.createPairing(recovery.request, recovery.baseEtag);
      if (created.kind !== "ok") {
        throw Object.assign(new Error("Remote recovery pairing request was not accepted."), {
          code:
            created.kind === "failure" && created.status === 401
              ? "SIGNED_OUT"
              : created.kind === "failure" && (created.status === 409 || created.status === 412)
                ? "SYNC_CONFLICT"
                : "PAIRING_FAILED",
        });
      }
      if (
        created.value.vaultId !== recovery.vaultId ||
        created.value.requestingDevice.deviceId !== recovery.trustedDevice.publicKey.deviceId
      ) {
        throw Object.assign(new Error("Remote recovery pairing response was inconsistent."), {
          code: "PAIRING_FAILED",
        });
      }
      recovery = await persistRemoteRecoveryPairingIdV2(recovery.request.operationId, created.value.id);
    }
    const pairingId = recovery.pairingId;
    if (pairingId === null) throw new Error("Remote recovery pairing identifier was not persisted.");
    let approved = await syncHttp.approvePairing(pairingId, recovery.approval, recovery.baseEtag);
    if (approved.kind === "failure" && isDurableCommandRecoveryStatus(approved.status)) {
      let replacementAuthorization: AuthorizationKeyHandle | undefined;
      try {
        replacementAuthorization = cryptoFacade.deriveDeviceAuthorizationKey({
          ownerBinding: recovery.ownerBinding,
          deviceKey,
          keyId: recovery.authorizationKeyId,
        });
        const readProof = createVaultReadProofHeader({
          crypto: cryptoFacade,
          authorizationKey: replacementAuthorization,
          ownerBinding: recovery.ownerBinding,
          vaultId: recovery.vaultId,
        });
        const readBack = await syncHttp.read(readProof);
        if (
          readBack.kind === "ok" &&
          JSON.stringify(readBack.value) === JSON.stringify(recovery.approval.command.nextSnapshot)
        ) {
          approved = readBack;
        }
      } finally {
        replacementAuthorization?.destroy();
      }
    }
    if (approved.kind !== "ok") {
      throw Object.assign(new Error("Remote recovery pairing approval was not accepted."), {
        code:
          approved.kind === "failure" && approved.status === 401
            ? "SIGNED_OUT"
            : approved.kind === "failure" && (approved.status === 409 || approved.status === 412)
              ? "SYNC_CONFLICT"
              : "PAIRING_FAILED",
      });
    }
    const verified = verifyAndDecryptRemoteSnapshot(
      cryptoFacade,
      vaultKey,
      approved.value,
      recovery.ownerBinding,
      {
        ownerBinding: recovery.sourceSnapshot.ownerBinding,
        vaultId: recovery.sourceSnapshot.vaultId,
        epoch: recovery.sourceSnapshot.commit.epoch,
        sequence: recovery.sourceSnapshot.commit.sequence,
        commitHash: recovery.sourceSnapshot.commitHash,
      },
    );
    try {
      const document = parsePersonalVaultDocumentBytes(verified.plaintext);
      const localDocument = decodeDocument(cryptoFacade, vaultKey, recovery.localPayload);
      if (
        JSON.stringify(document) !== JSON.stringify(localDocument) ||
        JSON.stringify(verified.snapshot) !== JSON.stringify(recovery.approval.command.nextSnapshot)
      ) {
        throw Object.assign(new Error("Remote recovery pairing changed private content."), {
          code: "SYNC_CONFLICT",
        });
      }
    } finally {
      verified.plaintext.fill(0);
    }
    await completeRemoteRecoveryPairingV2(
      pairingId,
      {
        meta: createActiveVaultMeta(recovery.vaultId),
        keyring: approved.value.keyring,
        payload: recovery.localPayload,
        trustedDevice: recovery.trustedDevice,
      },
      approved.etag,
      approved.value,
    );
    const state = await unlockPersistedVault();
    state.syncState = "hardening";
    return state;
  } finally {
    vaultKey?.destroy();
    deviceKey?.destroy();
  }
}

async function beginRemoteRecovery(recoveryCode: string): Promise<UnlockedVault> {
  if (
    (await readRecoverableVault()) !== null ||
    (await readPersistedVaultSyncV2()) !== null ||
    (await readPersistedRemoteRecoveryV2()) !== null
  ) {
    throw Object.assign(new Error("A local vault or remote recovery already exists."), {
      code: "CONFLICT",
    });
  }
  const remote = await bootstrap();
  if (typeof remote === "string" || !remote.vault.exists) {
    throw Object.assign(new Error("An authenticated remote vault is required for recovery."), {
      code: remote === "signed-out" ? "SIGNED_OUT" : "NOT_READY",
    });
  }
  const cryptoFacade = await createVaultCrypto();
  let recoveryAuthorization: AuthorizationKeyHandle | undefined;
  let vaultKey: VaultKeyHandle | undefined;
  let replacementDevice: DeviceKeyHandle | undefined;
  let replacementAuthorization: AuthorizationKeyHandle | undefined;
  let verifiedPlaintext: Uint8Array | undefined;
  try {
    try {
      recoveryAuthorization = cryptoFacade.deriveRecoveryAuthorizationKey({
        recoveryCode,
        ownerBinding: remote.ownerBinding,
        vaultId: remote.vault.vaultId,
        keyId: remote.vault.recoveryAuthorization.keyId,
      });
      assertRecoveryAuthorizationMatchesBootstrap(
        cryptoFacade,
        recoveryAuthorization,
        remote as Extract<VaultBootstrap, { readonly vault: { readonly exists: true } }>,
      );
    } catch {
      throw Object.assign(new Error("Remote recovery authorization failed."), {
        code: "AUTHENTICATION_FAILED",
      });
    }

    const readProof = createVaultReadProofHeader({
      crypto: cryptoFacade,
      authorizationKey: recoveryAuthorization,
      ownerBinding: remote.ownerBinding,
      vaultId: remote.vault.vaultId,
    });
    const read = await syncHttp.read(readProof);
    if (read.kind !== "ok") {
      throw Object.assign(new Error("Remote recovery snapshot was not available."), {
        code:
          read.kind === "failure" && (read.status === 401 || read.status === 403)
            ? "AUTHENTICATION_FAILED"
            : read.kind === "failure" && (read.status === 409 || read.status === 412)
              ? "SYNC_CONFLICT"
              : "UNAVAILABLE",
      });
    }
    if (
      read.etag !== remote.vault.etag ||
      JSON.stringify(read.value.authorizationManifest.recoveryAuthorization) !==
        JSON.stringify(remote.vault.recoveryAuthorization)
    ) {
      throw Object.assign(new Error("Remote recovery head changed during authentication."), {
        code: "SYNC_CONFLICT",
      });
    }
    try {
      vaultKey = cryptoFacade.recoverVaultKey({
        envelope: read.value.keyring.recoveryEnvelope,
        recoveryCode,
      });
    } catch {
      throw Object.assign(new Error("Remote recovery envelope did not authenticate."), {
        code: "AUTHENTICATION_FAILED",
      });
    }
    const verified = verifyAndDecryptRemoteSnapshot(cryptoFacade, vaultKey, read.value, remote.ownerBinding);
    verifiedPlaintext = verified.plaintext;
    const document = parsePersonalVaultDocumentBytes(verifiedPlaintext);

    replacementDevice = cryptoFacade.generateDeviceKey({ deviceId: generateId() });
    const authorizationKeyId = generateId();
    replacementAuthorization = cryptoFacade.deriveDeviceAuthorizationKey({
      ownerBinding: remote.ownerBinding,
      deviceKey: replacementDevice,
      keyId: authorizationKeyId,
    });
    const replacementDescriptor = cryptoFacade.createDeviceDescriptorV2({
      ownerBinding: remote.ownerBinding,
      encryptionKey: replacementDevice,
      authorizationKey: replacementAuthorization,
    });
    const wrappingKey = await createBrowserDeviceWrappingKey();
    const localEnvelope = await sealBrowserDeviceKey({
      deviceKey: replacementDevice,
      wrappingKey,
    });
    const trustedDevice = {
      formatVersion: 1 as const,
      publicKey: replacementDevice.publicKey,
      envelope: localEnvelope,
      wrappingKey,
    };
    const pairingCodeCommitment = await hashPairingCode(generatePairingCode());
    const request = createDevicePairingRequest({
      crypto: cryptoFacade,
      authorizationKey: replacementAuthorization,
      ownerBinding: remote.ownerBinding,
      vaultId: remote.vault.vaultId,
      requestingDevice: replacementDescriptor,
      pairingCodeCommitment,
    });
    const approval = createVaultPairDeviceCommand({
      crypto: cryptoFacade,
      vaultKey,
      authorizationKey: recoveryAuthorization,
      current: verified.snapshot,
      pairedDevice: replacementDescriptor,
      pairingCodeCommitment,
    });
    const recoveredVaultEnvelope = cryptoFacade.wrapVaultKeyForDevice({
      key: vaultKey,
      recipient: replacementDevice.publicKey,
    });
    const documentBytes = serializePersonalVaultDocument(document);
    let localPayload: EncryptedVaultPayloadEnvelopeV1;
    try {
      localPayload = cryptoFacade.encryptPayload({
        key: vaultKey,
        plaintext: documentBytes,
        revision: 1,
        baseRevision: null,
      });
    } finally {
      documentBytes.fill(0);
    }
    const createdAt = new Date().toISOString();
    const pending = await persistRemoteRecoveryPairingV2({
      formatVersion: 2,
      stage: "pairing-pending",
      ownerBinding: remote.ownerBinding,
      vaultId: remote.vault.vaultId,
      baseEtag: remote.vault.etag,
      authorizationKeyId,
      request,
      approval,
      pairingId: null,
      trustedDevice,
      recoveredVaultEnvelope,
      sourceSnapshot: verified.snapshot,
      localPayload,
      createdAt,
      updatedAt: createdAt,
    });
    return await resumeRemoteRecoveryPairing(pending);
  } finally {
    verifiedPlaintext?.fill(0);
    replacementAuthorization?.destroy();
    replacementDevice?.destroy();
    vaultKey?.destroy();
    recoveryAuthorization?.destroy();
  }
}

async function abandonRemoteRecoveryPairing(): Promise<void> {
  const recovery = await readPersistedRemoteRecoveryV2();
  if (recovery?.stage !== "pairing-pending") {
    throw Object.assign(new Error("Only a pending remote recovery pairing may be abandoned."), {
      code: "NOT_READY",
    });
  }
  // Cancellation is deliberately best effort. A lost create response may mean
  // there is no known pairing id; an expired/offline server must not trap the
  // user forever. Any server-side pending request has a short expiry, while an
  // already-approved request remains recoverable with the old recovery secret.
  if (recovery.pairingId !== null) {
    try {
      const remote = await bootstrap();
      if (
        typeof remote !== "string" &&
        remote.vault.exists &&
        remote.ownerBinding === recovery.ownerBinding &&
        remote.vault.vaultId === recovery.vaultId
      ) {
        await syncHttp.cancelPairing(recovery.pairingId, remote.vault.etag, generateId());
      }
    } catch {
      // Explicit local abandonment remains available offline. The server
      // pairing contains only public keys/ciphertext and expires independently.
    }
  }
  await abandonRemoteRecoveryPairingV2(recovery.request.operationId);
  destroyPendingRemoteRotation();
  destroyUnlocked();
}

async function prepareRemoteRecoveryRotation(
  state: UnlockedVault,
): Promise<{ readonly recoveryCode: string }> {
  destroyPendingRemoteRotation();
  const recovery = await readPersistedRemoteRecoveryV2();
  const sync = await readPersistedVaultSyncV2();
  const local = await readPersistedVault();
  if (
    recovery?.stage !== "hardening-required" ||
    sync?.snapshot == null ||
    sync.etag !== recovery.etag ||
    sync.snapshot.commitHash !== recovery.pairedCommitHash ||
    local === null ||
    state.deviceKey === undefined ||
    state.vaultKey.vaultKeyId !== local.keyring.vaultKeyId ||
    local.trustedDevice.publicKey.deviceId !== recovery.replacementDeviceId
  ) {
    throw Object.assign(new Error("Remote recovery is not ready for mandatory hardening."), {
      code: "NOT_READY",
    });
  }
  let rotatedVaultKey: VaultKeyHandle | undefined;
  let nextRecoveryAuthorization: AuthorizationKeyHandle | undefined;
  try {
    const rotated = state.crypto.rotateKeyring({
      previousKey: state.vaultKey,
      previousKeyring: local.keyring,
      recipients: [local.trustedDevice.publicKey],
    });
    rotatedVaultKey = rotated.key;
    nextRecoveryAuthorization = state.crypto.deriveRecoveryAuthorizationKey({
      recoveryCode: rotated.recoveryCode,
      ownerBinding: recovery.ownerBinding,
      vaultId: recovery.vaultId,
      keyId: generateId(),
    });
    const nextLocalPayload = state.crypto.reencryptPayloadForRotation({
      previousKey: state.vaultKey,
      nextKey: rotated.key,
      envelope: local.payload,
      revision: local.payload.revision + 1,
    });
    pendingRemoteRotation = {
      nextVaultKey: rotated.key,
      nextKeyring: rotated.keyring,
      nextLocalPayload,
      nextRecoveryAuthorization: state.crypto.createRecoveryAuthorizationPublicKeyV2({
        authorizationKey: nextRecoveryAuthorization,
      }),
      recoveryCode: rotated.recoveryCode,
    };
    rotatedVaultKey = undefined;
    return { recoveryCode: rotated.recoveryCode };
  } finally {
    nextRecoveryAuthorization?.destroy();
    rotatedVaultKey?.destroy();
  }
}

async function rebaseStaleRemoteRecoveryRotation(
  state: UnlockedVault,
  recovery: PersistedRemoteRecoveryRotationV2,
  sync: NonNullable<Awaited<ReturnType<typeof readPersistedVaultSyncV2>>>,
  authorizationKey: AuthorizationKeyHandle,
  allowProofRenewal: boolean,
): Promise<
  | { readonly kind: "applied" }
  | {
      readonly kind: "renewed";
      readonly recovery: PersistedRemoteRecoveryRotationV2;
    }
  | {
      readonly kind: "rebased";
      readonly recovery: PersistedRemoteRecoveryRotationV2;
    }
> {
  if (sync.snapshot === null || sync.highWater === null || state.deviceKey === undefined) {
    throw Object.assign(new Error("Recovery rotation has no authenticated rebase base."), {
      code: "SYNC_CONFLICT",
    });
  }
  const proof = createVaultReadProofHeader({
    crypto: state.crypto,
    authorizationKey,
    ownerBinding: recovery.ownerBinding,
    vaultId: recovery.vaultId,
  });
  const remoteResult = await syncHttp.read(proof);
  if (remoteResult.kind !== "ok") {
    throw Object.assign(new Error("Recovery rotation conflict head is unavailable."), {
      code: remoteResult.kind === "failure" && remoteResult.status === 401 ? "SIGNED_OUT" : "SYNC_CONFLICT",
    });
  }
  // A successful rotation response can be lost and the server's idempotency
  // receipt can expire while this device is offline. A later exact replay can
  // receive 403 for an expired proof before parent validation, or 412 for its
  // now-stale parent, even though the intended successor is already current.
  // Detect that exact state before considering proof renewal or a payload-only
  // rebase. The newly
  // persisted root must authenticate the complete head and the fresh
  // replacement-device read is the independent read-back required before the
  // local high-water can advance.
  const verifiedApplied = verifyAppliedRecoveryRotationReadBack({
    crypto: state.crypto,
    vaultKey: state.vaultKey,
    candidate: remoteResult.value,
    expectedSnapshot: recovery.command.nextSnapshot,
    expectedOwnerBinding: recovery.ownerBinding,
    highWater: sync.highWater,
  });
  if (verifiedApplied !== null) {
    try {
      const appliedDocument = parsePersonalVaultDocumentBytes(verifiedApplied.plaintext);
      if (JSON.stringify(appliedDocument) !== JSON.stringify(state.document)) {
        throw Object.assign(new Error("Applied recovery rotation changed private content."), {
          code: "SYNC_CONFLICT",
        });
      }
      await commitRemoteRecoveryRotationV2(
        recovery.command.operationId,
        remoteResult.etag,
        verifiedApplied.snapshot,
      );
    } finally {
      verifiedApplied.plaintext.fill(0);
    }
    state.syncState = "synced";
    return { kind: "applied" };
  }
  // Authorization and root changes are never auto-rebased. The exact old
  // keyring/manifest comparison is safe to perform before unwrap because both
  // values came from the already authenticated local high-water.
  if (
    JSON.stringify(remoteResult.value.keyring) !== JSON.stringify(sync.snapshot.keyring) ||
    JSON.stringify(remoteResult.value.authorizationManifest) !==
      JSON.stringify(sync.snapshot.authorizationManifest)
  ) {
    throw Object.assign(new Error("Recovery rotation conflict changed authorization state."), {
      code: "SYNC_CONFLICT",
    });
  }
  const oldEnvelope = remoteResult.value.keyring.deviceEnvelopes.find(
    (candidate) =>
      candidate.recipientDeviceId === state.deviceKey?.publicKey.deviceId &&
      candidate.recipientKeyId === state.deviceKey.publicKey.deviceKeyId &&
      candidate.recipientPublicKeyFingerprint === state.deviceKey.publicKey.publicKeyFingerprint,
  );
  if (oldEnvelope === undefined) {
    throw Object.assign(new Error("Replacement device lost access to the old root."), {
      code: "SYNC_CONFLICT",
    });
  }
  const oldVaultKey = state.crypto.unwrapVaultKeyForDevice({
    deviceKey: state.deviceKey,
    envelope: oldEnvelope,
  });
  let remotePlaintext: Uint8Array | undefined;
  let basePlaintext: Uint8Array | undefined;
  try {
    const base = verifyAndDecryptRemoteSnapshot(
      state.crypto,
      oldVaultKey,
      sync.snapshot,
      recovery.ownerBinding,
    );
    basePlaintext = base.plaintext;
    const baseDocument = parsePersonalVaultDocumentBytes(basePlaintext);
    if (JSON.stringify(baseDocument) !== JSON.stringify(state.document)) {
      throw Object.assign(new Error("Local recovery content diverged before rebase."), {
        code: "SYNC_CONFLICT",
      });
    }
    const remote = verifyAndDecryptRemoteSnapshot(
      state.crypto,
      oldVaultKey,
      remoteResult.value,
      recovery.ownerBinding,
      sync.highWater,
    );
    remotePlaintext = remote.plaintext;
    const remoteDocument = parsePersonalVaultDocumentBytes(remotePlaintext);
    const local = await readPersistedVault();
    if (local === null || local.keyring.vaultKeyId !== state.vaultKey.vaultKeyId) {
      throw Object.assign(new Error("Recovery rotation local state changed."), {
        code: "SYNC_CONFLICT",
      });
    }
    const classification = classifyVerifiedPendingUpdateHead({
      base: sync.snapshot,
      intended: recovery.command.nextSnapshot,
      remote: remote.snapshot,
    });
    if (allowProofRenewal && classification === "parent") {
      const renewedCommand = renewVaultRecoveryRotationCommandProof({
        crypto: state.crypto,
        authorizationKey,
        command: recovery.command,
      });
      const renewed = await renewRemoteRecoveryRotationProofV2(recovery.command.operationId, renewedCommand);
      return { kind: "renewed", recovery: renewed };
    }
    if (classification !== "payload-child") {
      throw Object.assign(new Error("Recovery rotation rebase precondition changed."), {
        code: "SYNC_CONFLICT",
      });
    }
    const command = createVaultRecoveryRotationCommand({
      crypto: state.crypto,
      previousVaultKey: oldVaultKey,
      nextVaultKey: state.vaultKey,
      authorizationKey,
      current: remote.snapshot,
      replacementDeviceId: recovery.replacementDeviceId,
      nextKeyring: local.keyring,
      nextRecoveryAuthorization: recovery.command.nextSnapshot.authorizationManifest.recoveryAuthorization,
      plaintext: remotePlaintext,
    });
    const localBytes = serializePersonalVaultDocument(remoteDocument);
    let nextLocalPayload: EncryptedVaultPayloadEnvelopeV1;
    try {
      nextLocalPayload = state.crypto.encryptPayload({
        key: state.vaultKey,
        plaintext: localBytes,
        revision: local.payload.revision + 1,
        baseRevision: local.payload.revision,
      });
    } finally {
      localBytes.fill(0);
    }
    const next = await rebaseRemoteRecoveryRotationV2(
      recovery.command.operationId,
      remoteResult.etag,
      remote.snapshot,
      command,
      nextLocalPayload,
    );
    state.document = remoteDocument;
    state.revision = nextLocalPayload.revision;
    return { kind: "rebased", recovery: next };
  } finally {
    basePlaintext?.fill(0);
    remotePlaintext?.fill(0);
    oldVaultKey.destroy();
  }
}

async function finishRemoteRecoveryRotation(
  state: UnlockedVault,
  initial: PersistedRemoteRecoveryRotationV2,
): Promise<UnlockedVault> {
  let recovery = initial;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const sync = await readPersistedVaultSyncV2();
    if (
      sync?.snapshot == null ||
      sync.snapshot.commitHash !== recovery.baseCommitHash ||
      sync.etag !== recovery.baseEtag
    ) {
      throw Object.assign(new Error("Remote recovery rotation base changed."), {
        code: "SYNC_CONFLICT",
      });
    }
    const authorizationKey = deviceAuthorization(state, sync);
    try {
      const rotated = await syncHttp.rotate(recovery.command, recovery.baseEtag);
      if (rotated.kind === "failure" && isDurableCommandRecoveryStatus(rotated.status) && attempt === 0) {
        const resolution = await rebaseStaleRemoteRecoveryRotation(
          state,
          recovery,
          sync,
          authorizationKey,
          mayRenewRecoveryRotationProof(rotated.status),
        );
        if (resolution.kind === "applied") return state;
        recovery = resolution.recovery;
        continue;
      }
      if (rotated.kind !== "ok") {
        throw Object.assign(new Error("Mandatory recovery rotation was not accepted."), {
          code:
            rotated.kind === "failure" && (rotated.status === 401 || rotated.status === 403)
              ? "SIGNED_OUT"
              : rotated.kind === "failure" &&
                  (rotated.status === 409 || rotated.status === 412 || rotated.status === 422)
                ? "SYNC_CONFLICT"
                : "UNAVAILABLE",
        });
      }
      const highWater = sync.highWater ?? undefined;
      const verifiedResponse = verifyAndDecryptRemoteSnapshot(
        state.crypto,
        state.vaultKey,
        rotated.value,
        recovery.ownerBinding,
        highWater,
      );
      try {
        if (JSON.stringify(verifiedResponse.snapshot) !== JSON.stringify(recovery.command.nextSnapshot)) {
          throw Object.assign(new Error("Rotation response did not match its durable intent."), {
            code: "SYNC_CONFLICT",
          });
        }
      } finally {
        verifiedResponse.plaintext.fill(0);
      }

      const readProof = createVaultReadProofHeader({
        crypto: state.crypto,
        authorizationKey,
        ownerBinding: recovery.ownerBinding,
        vaultId: recovery.vaultId,
      });
      const readBack = await syncHttp.read(readProof);
      if (readBack.kind !== "ok") {
        throw Object.assign(new Error("Rotated vault could not be independently read back."), {
          code: readBack.kind === "failure" && readBack.status === 401 ? "SIGNED_OUT" : "UNAVAILABLE",
        });
      }
      const verifiedReadBack = verifyAndDecryptRemoteSnapshot(
        state.crypto,
        state.vaultKey,
        readBack.value,
        recovery.ownerBinding,
        highWater,
      );
      try {
        const readBackDocument = parsePersonalVaultDocumentBytes(verifiedReadBack.plaintext);
        if (
          JSON.stringify(verifiedReadBack.snapshot) !== JSON.stringify(recovery.command.nextSnapshot) ||
          JSON.stringify(readBackDocument) !== JSON.stringify(state.document)
        ) {
          throw Object.assign(new Error("Rotated vault read-back did not match local state."), {
            code: "SYNC_CONFLICT",
          });
        }
        await commitRemoteRecoveryRotationV2(
          recovery.command.operationId,
          readBack.etag,
          verifiedReadBack.snapshot,
        );
      } finally {
        verifiedReadBack.plaintext.fill(0);
      }
      state.syncState = "synced";
      return state;
    } finally {
      authorizationKey.destroy();
    }
  }
  throw Object.assign(new Error("Recovery rotation conflict retry limit reached."), {
    code: "SYNC_CONFLICT",
  });
}

async function confirmRemoteRecoveryRotation(state: UnlockedVault): Promise<UnlockedVault> {
  const draft = pendingRemoteRotation;
  if (draft === undefined) {
    throw Object.assign(new Error("A replacement recovery code must be generated and confirmed."), {
      code: "NOT_READY",
    });
  }
  const recovery = await readPersistedRemoteRecoveryV2();
  const local = await readPersistedVault();
  const sync = await readPersistedVaultSyncV2();
  if (
    recovery?.stage !== "hardening-required" ||
    local === null ||
    sync?.snapshot == null ||
    sync.etag !== recovery.etag ||
    sync.snapshot.commitHash !== recovery.pairedCommitHash
  ) {
    throw Object.assign(new Error("Remote recovery hardening state changed."), {
      code: "SYNC_CONFLICT",
    });
  }
  const authorizationKey = deviceAuthorization(state, sync);
  const plaintext = serializePersonalVaultDocument(state.document);
  let command: ReturnType<typeof createVaultRecoveryRotationCommand>;
  try {
    // The command proof is intentionally created only after the user confirms
    // that the one-time code is saved. Time spent on the display screen can
    // therefore never turn a short-lived proof into a durable dead-end.
    command = createVaultRecoveryRotationCommand({
      crypto: state.crypto,
      previousVaultKey: state.vaultKey,
      nextVaultKey: draft.nextVaultKey,
      authorizationKey,
      current: sync.snapshot,
      replacementDeviceId: recovery.replacementDeviceId,
      nextKeyring: draft.nextKeyring,
      nextRecoveryAuthorization: draft.nextRecoveryAuthorization,
      plaintext,
    });
  } finally {
    plaintext.fill(0);
    authorizationKey.destroy();
  }
  await stageRemoteRecoveryRotationV2(
    recovery.pairedCommitHash,
    {
      meta: local.meta,
      keyring: draft.nextKeyring,
      payload: draft.nextLocalPayload,
      trustedDevice: local.trustedDevice,
    },
    command,
  );
  destroyPendingRemoteRotation();
  destroyUnlocked();
  const nextState = await unlockPersistedVault();
  nextState.document = state.document;
  nextState.syncState = "hardening";
  const pending = await readPersistedRemoteRecoveryV2();
  if (pending?.stage !== "rotation-pending" || pending.command.operationId !== command.operationId) {
    destroyVaultState(nextState);
    throw new Error("Durable remote recovery rotation could not be reopened.");
  }
  return destroyVaultStateOnFailure(nextState, () => finishRemoteRecoveryRotation(nextState, pending));
}

async function resumeRemoteRecovery(): Promise<UnlockedVault> {
  const recovery = await readPersistedRemoteRecoveryV2();
  if (recovery === null) {
    throw Object.assign(new Error("No remote recovery is pending."), { code: "NOT_READY" });
  }
  if (recovery.stage === "pairing-pending") return resumeRemoteRecoveryPairing(recovery);
  destroyUnlocked();
  const state = await unlockPersistedVault();
  if (recovery.stage === "hardening-required") {
    state.syncState = "hardening";
    return state;
  }
  state.syncState = "hardening";
  return destroyVaultStateOnFailure(state, () => finishRemoteRecoveryRotation(state, recovery));
}

async function beginDevicePairing() {
  if ((await readRecoverableVault()) !== null) {
    throw Object.assign(new Error("This device already has a local vault."), { code: "PAIRING_FAILED" });
  }
  const bootstrapResult = await bootstrap();
  if (typeof bootstrapResult === "string" || !bootstrapResult.vault.exists) {
    throw Object.assign(new Error("A signed-in remote vault is required for pairing."), {
      code: bootstrapResult === "signed-out" ? "SIGNED_OUT" : "PAIRING_FAILED",
    });
  }
  const cryptoFacade = await createVaultCrypto();
  const deviceKey = cryptoFacade.generateDeviceKey({ deviceId: generateId() });
  const authorizationKeyId = generateId();
  const authorizationKey = cryptoFacade.deriveDeviceAuthorizationKey({
    ownerBinding: bootstrapResult.ownerBinding,
    deviceKey,
    keyId: authorizationKeyId,
  });
  const wrappingKey = await createBrowserDeviceWrappingKey();
  const trustedDevice = {
    formatVersion: 1 as const,
    publicKey: deviceKey.publicKey,
    envelope: await sealBrowserDeviceKey({ deviceKey, wrappingKey }),
    wrappingKey,
  };
  const pairingCode = generatePairingCode();
  try {
    const commitment = await hashPairingCode(pairingCode);
    const request = createDevicePairingRequest({
      crypto: cryptoFacade,
      authorizationKey,
      ownerBinding: bootstrapResult.ownerBinding,
      vaultId: bootstrapResult.vault.vaultId,
      requestingDevice: cryptoFacade.createDeviceDescriptorV2({
        ownerBinding: bootstrapResult.ownerBinding,
        encryptionKey: deviceKey,
        authorizationKey,
      }),
      pairingCodeCommitment: commitment,
    });
    const pending = {
      formatVersion: 2 as const,
      ownerBinding: bootstrapResult.ownerBinding,
      vaultId: bootstrapResult.vault.vaultId,
      authorizationKeyId,
      requestOperationId: request.operationId,
      cancelOperationId: null,
      request,
      pairingId: null,
      requestedAt: request.issuedAt,
      expiresAt: request.expiresAt,
      trustedDevice,
    };
    // Private material is origin-bound and strictly durable before the
    // signed request can leave this Worker.
    await persistPendingPairingV2(pending);
    const result = await syncHttp.createPairing(request, bootstrapResult.vault.etag);
    if (result.kind !== "ok") {
      throw Object.assign(new Error("Device pairing request was rejected."), {
        code: result.kind === "failure" && result.status === 401 ? "SIGNED_OUT" : "PAIRING_FAILED",
      });
    }
    await persistPendingPairingV2({ ...pending, pairingId: result.value.id });
    return {
      pairingCode,
      pairingId: result.value.id,
      expiresAt: result.value.expiresAt,
    };
  } finally {
    authorizationKey.destroy();
    deviceKey.destroy();
  }
}

async function ensurePendingPairingRemoteContext(initial: PersistedPendingPairingV2): Promise<{
  readonly pending: PersistedPendingPairingV2;
  readonly pairingId: string;
  readonly etag: string;
}> {
  const bootstrapResult = await bootstrap();
  if (typeof bootstrapResult === "string" || !bootstrapResult.vault.exists) {
    throw Object.assign(new Error("Pairing request cannot be retried yet."), {
      code: bootstrapResult === "signed-out" ? "SIGNED_OUT" : "PAIRING_FAILED",
    });
  }
  if (
    bootstrapResult.ownerBinding !== initial.ownerBinding ||
    bootstrapResult.vault.vaultId !== initial.vaultId
  ) {
    throw Object.assign(new Error("Pairing account binding changed."), { code: "OWNER_MISMATCH" });
  }
  if (initial.pairingId !== null) {
    return { pending: initial, pairingId: initial.pairingId, etag: bootstrapResult.vault.etag };
  }
  const replay = await syncHttp.createPairing(initial.request, bootstrapResult.vault.etag);
  if (replay.kind !== "ok") {
    throw Object.assign(new Error("Pairing request retry failed."), {
      code: replay.kind === "failure" && replay.status === 401 ? "SIGNED_OUT" : "PAIRING_FAILED",
    });
  }
  const pending = { ...initial, pairingId: replay.value.id };
  await persistPendingPairingV2(pending);
  return { pending, pairingId: replay.value.id, etag: replay.etag };
}

async function listDevicePairings(): Promise<readonly DevicePairingViewV2[]> {
  const result = await syncHttp.listPairings();
  if (result.kind !== "ok") {
    throw Object.assign(new Error("Device pairings are unavailable."), {
      code: result.kind === "failure" && result.status === 401 ? "SIGNED_OUT" : "PAIRING_FAILED",
    });
  }
  return result.value.map((item) => DevicePairingViewV2Schema.parse(item));
}

async function cancelDevicePairing(): Promise<void> {
  const initial = await readPendingPairingV2();
  if (initial === null) return;
  // Recover a response-lost create first; cancellation never guesses the
  // server identifier or replaces the original signed request.
  const context = await ensurePendingPairingRemoteContext(initial);
  const operationId = context.pending.cancelOperationId ?? generateId();
  const staged = await stagePendingPairingCancellationV2(context.pairingId, operationId);
  const cancelOperationId = staged.cancelOperationId;
  if (cancelOperationId === null) throw new Error("Pairing cancellation intent was not persisted.");

  // If the response is lost, the staged operation survives and the next click
  // replays this exact DELETE and idempotency key.
  const result = await syncHttp.cancelPairing(context.pairingId, context.etag, cancelOperationId);
  if (result.kind === "ok") {
    if (
      result.value.id !== context.pairingId ||
      result.value.vaultId !== context.pending.vaultId ||
      result.value.state !== "cancelled"
    ) {
      throw Object.assign(new Error("Pairing cancellation response is inconsistent."), {
        code: "PAIRING_FAILED",
      });
    }
    await clearPendingPairingV2(context.pairingId, cancelOperationId);
    return;
  }
  if (result.kind === "not-modified") {
    throw Object.assign(new Error("Pairing cancellation returned an invalid status."), {
      code: "PAIRING_FAILED",
    });
  }
  if (result.status === 401) {
    throw Object.assign(new Error("Pairing cancellation requires sign-in."), { code: "SIGNED_OUT" });
  }
  if (result.status !== 404 && result.status !== 409) {
    throw Object.assign(new Error("Pairing cancellation was not accepted."), { code: "PAIRING_FAILED" });
  }

  // A failure status alone never authorizes deleting the origin-bound key.
  // Confirm a terminal state using the authoritative account-scoped list.
  const pairings = await listDevicePairings();
  const pairing = pairings.find((candidate) => candidate.id === context.pairingId);
  if (pairing?.state === "cancelled" || pairing?.state === "expired") {
    await clearPendingPairingV2(context.pairingId, cancelOperationId);
    return;
  }
  if (pairing === undefined && result.status === 404) {
    await clearPendingPairingV2(context.pairingId, cancelOperationId);
    return;
  }
  throw Object.assign(
    new Error(
      pairing?.state === "consumed"
        ? "The pairing was consumed before cancellation; finish pairing instead."
        : "Pairing cancellation is not yet confirmed.",
    ),
    { code: "PAIRING_FAILED" },
  );
}

async function approveDevicePairing(
  state: UnlockedVault,
  pairingId: string,
  pairingCode: string,
): Promise<VaultSyncState> {
  const record = await readPersistedVaultSyncV2();
  if (record?.snapshot == null || record.etag === null) {
    throw Object.assign(new Error("Cloud sync must be current before approving a device."), {
      code: "PAIRING_FAILED",
    });
  }
  const pairings = await listDevicePairings();
  const pairing = pairings.find((candidate) => candidate.id === pairingId && candidate.state === "pending");
  if (pairing === undefined || Date.parse(pairing.expiresAt) <= Date.now()) {
    throw Object.assign(new Error("The selected pairing is missing or expired."), { code: "PAIRING_FAILED" });
  }
  const authorizationKey = deviceAuthorization(state, record);
  try {
    const commitment = await hashPairingCode(pairingCode);
    const approval = createVaultPairDeviceCommand({
      crypto: state.crypto,
      vaultKey: state.vaultKey,
      authorizationKey,
      current: record.snapshot,
      pairedDevice: pairing.requestingDevice,
      pairingCodeCommitment: commitment,
    });
    const result = await syncHttp.approvePairing(pairingId, approval, record.etag);
    if (result.kind !== "ok") {
      throw Object.assign(new Error("Pairing approval failed."), {
        code:
          result.kind === "failure" && result.status === 401
            ? "SIGNED_OUT"
            : result.kind === "failure" && result.status === 412
              ? "SYNC_CONFLICT"
              : "PAIRING_FAILED",
      });
    }
    const verified = verifiedRemoteDocument(state, result.value, record.ownerBinding, record.highWater);
    await adoptPersistedRemoteVaultSyncV2(record.snapshot.commitHash, result.etag, verified.snapshot);
    if (JSON.stringify(verified.document) !== JSON.stringify(state.document)) {
      throw new Error("Pairing unexpectedly rewrote private content.");
    }
    return "synced";
  } finally {
    authorizationKey.destroy();
  }
}

async function pollDevicePairing(): Promise<
  | { readonly pending: true; readonly syncState: "pairing" }
  | { readonly pending: false; readonly state: UnlockedVault }
> {
  const pending = await readPendingPairingV2();
  if (pending === null) {
    throw Object.assign(new Error("No device pairing is pending."), { code: "PAIRING_FAILED" });
  }
  const context = await ensurePendingPairingRemoteContext(pending);
  const pairingId = context.pairingId;
  const pairings = await listDevicePairings();
  const pairing = pairings.find((candidate) => candidate.id === pairingId);
  if (pairing === undefined || pairing.state === "cancelled" || pairing.state === "expired") {
    await clearPendingPairingV2(pairingId);
    throw Object.assign(new Error("Device pairing was cancelled or expired."), { code: "PAIRING_FAILED" });
  }
  if (pairing.state === "pending") return { pending: true, syncState: "pairing" };

  const cryptoFacade = await createVaultCrypto();
  let deviceKey: DeviceKeyHandle | undefined;
  let vaultKey: VaultKeyHandle | undefined;
  let authorizationKey: AuthorizationKeyHandle | undefined;
  try {
    deviceKey = await openBrowserDeviceKey({
      publicKey: pending.trustedDevice.publicKey,
      wrappingKey: pending.trustedDevice.wrappingKey,
      envelope: pending.trustedDevice.envelope,
    });
    authorizationKey = cryptoFacade.deriveDeviceAuthorizationKey({
      ownerBinding: pending.ownerBinding,
      deviceKey,
      keyId: pending.authorizationKeyId,
    });
    const proof = createVaultReadProofHeader({
      crypto: cryptoFacade,
      authorizationKey,
      ownerBinding: pending.ownerBinding,
      vaultId: pending.vaultId,
    });
    const result = await syncHttp.read(proof);
    if (result.kind !== "ok") {
      throw Object.assign(new Error("Approved vault snapshot is unavailable."), {
        code: result.kind === "failure" && result.status === 401 ? "SIGNED_OUT" : "PAIRING_FAILED",
      });
    }
    const envelope = result.value.keyring.deviceEnvelopes.find(
      (candidate) =>
        candidate.recipientDeviceId === deviceKey?.publicKey.deviceId &&
        candidate.recipientKeyId === deviceKey.publicKey.deviceKeyId,
    );
    if (envelope === undefined) throw new Error("Approved snapshot omitted this device.");
    vaultKey = cryptoFacade.unwrapVaultKeyForDevice({ deviceKey, envelope });
    const temporary: UnlockedVault = {
      crypto: cryptoFacade,
      deviceKey,
      vaultKey,
      revision: 1,
      document: createTaskDocument([]),
      syncState: "pairing",
    };
    const verified = verifiedRemoteDocument(temporary, result.value, pending.ownerBinding);
    const plaintext = serializePersonalVaultDocument(verified.document);
    try {
      const localPayload = cryptoFacade.encryptPayload({
        key: vaultKey,
        plaintext,
        revision: 1,
        baseRevision: null,
      });
      await completePairedVaultSetupV2(
        pairingId,
        {
          meta: createActiveVaultMeta(pending.vaultId),
          keyring: verified.snapshot.keyring,
          payload: localPayload,
          trustedDevice: pending.trustedDevice,
        },
        pending.authorizationKeyId,
        result.etag,
        verified.snapshot,
      );
    } finally {
      plaintext.fill(0);
    }
    const state = await unlockPersistedVault();
    state.syncState = "synced";
    return { pending: false, state };
  } finally {
    authorizationKey?.destroy();
    deviceKey?.destroy();
    vaultKey?.destroy();
  }
}

async function handle(request: VaultRpcRequest): Promise<VaultRpcResponse> {
  try {
    assertSafeBrowserPersistence();
    switch (request.method) {
      case "inspect": {
        await probePersonalVaultStorage();
        // A lost origin-bound trusted-device key must not make the encrypted
        // keyring/payload look like an unsupported browser. `unlock` will
        // correctly fail closed, while the UI retains its recovery-code path.
        const record = await readRecoverableVault();
        const pendingPairing = await readPendingPairingV2();
        const remoteRecovery = await readPersistedRemoteRecoveryV2();
        const syncRecord = await readPersistedVaultSyncV2();
        let syncState: VaultSyncState;
        let remoteRecoveryStage:
          | "available"
          | "pairing-pending"
          | "hardening-required"
          | "rotation-pending"
          | null = remoteRecovery?.stage ?? null;
        if (remoteRecovery?.stage === "pairing-pending") {
          syncState = "recovery";
        } else if (
          remoteRecovery?.stage === "hardening-required" ||
          remoteRecovery?.stage === "rotation-pending"
        ) {
          syncState = "hardening";
        } else if (pendingPairing !== null) {
          syncState = "pairing";
        } else {
          const remote = await bootstrap();
          if (
            remoteRecoveryStage === null &&
            record === null &&
            typeof remote !== "string" &&
            remote.vault.exists
          ) {
            remoteRecoveryStage = "available";
          }
          syncState =
            typeof remote === "string"
              ? remote
              : syncRecord?.pending !== null && syncRecord?.pending !== undefined
                ? "deferred"
                : syncRecord !== null
                  ? "synced"
                  : remote.vault.exists
                    ? "recovery"
                    : "local-only";
        }
        return {
          id: request.id,
          ok: true,
          method: "inspect",
          hasVault: record !== null,
          hasPendingPairing: pendingPairing !== null,
          pairingId: pendingPairing?.pairingId ?? null,
          pairingExpiresAt: pendingPairing?.expiresAt ?? null,
          remoteRecoveryStage,
          syncState,
        };
      }
      case "begin-setup": {
        const result = await beginSetup(request.source, request.legacyRaw);
        return { id: request.id, ok: true, method: "begin-setup", ...result };
      }
      case "confirm-setup": {
        const confirmed = await confirmSetup();
        return { id: request.id, ok: true, method: "confirm-setup", ...confirmed };
      }
      case "cancel-setup":
        destroyPendingSetup();
        return { id: request.id, ok: true, method: "cancel-setup" };
      case "unlock": {
        destroyUnlocked();
        const nextState = await prepareVaultStateForPublication(
          await unlockPersistedVault(),
          async (candidate) => {
            const recovery = await readPersistedRemoteRecoveryV2();
            candidate.syncState =
              recovery?.stage === "hardening-required" || recovery?.stage === "rotation-pending"
                ? "hardening"
                : await synchronizeUnlocked(candidate);
          },
        );
        unlocked = nextState;
        return {
          id: request.id,
          ok: true,
          method: "unlock",
          snapshot: snapshot(nextState),
          syncState: nextState.syncState,
        };
      }
      case "recover": {
        destroyUnlocked();
        const record = await readRecoverableVault();
        if (record === null)
          throw Object.assign(new Error("Authentication failed."), { code: "AUTHENTICATION_FAILED" });
        const cryptoFacade = await createVaultCrypto();
        const vaultKey = cryptoFacade.recoverVaultKey({
          envelope: record.keyring.recoveryEnvelope,
          recoveryCode: request.recoveryCode,
        });
        let replacementDevice: DeviceKeyHandle | undefined;
        let rotatedVaultKey: VaultKeyHandle | undefined;
        let readBack: UnlockedVault | undefined;
        try {
          const document = decodeDocument(cryptoFacade, vaultKey, record.payload);
          // Recovery creates a new root key before repairing this origin-bound
          // access path. Existing devices are retained only when their public
          // descriptors can be used to create fresh envelopes for that key.
          replacementDevice = cryptoFacade.generateDeviceKey({ deviceId: generateId() });
          const wrappingKey = await createBrowserDeviceWrappingKey();
          const localEnvelope = await sealBrowserDeviceKey({ deviceKey: replacementDevice, wrappingKey });
          const rotation = planDeviceRecipientRotation(
            record.keyring,
            record.trustedDevice,
            replacementDevice.publicKey,
            request.allowOldestDeviceRevocation,
          );
          if (rotation.status === "capacity") {
            throw Object.assign(new Error("Device envelope limit reached."), {
              code: "DEVICE_ENVELOPE_LIMIT_REACHED",
            });
          }
          if (rotation.status === "unavailable") {
            throw new Error("A retained device is missing its public-key descriptor.");
          }
          if (
            record.keyring.revision === Number.MAX_SAFE_INTEGER ||
            record.payload.revision === Number.MAX_SAFE_INTEGER
          ) {
            throw new Error("Vault revision cannot advance.");
          }
          const rotated = cryptoFacade.rotateKeyring({
            previousKey: vaultKey,
            previousKeyring: record.keyring,
            recipients: rotation.recipients,
            recoveryCode: request.recoveryCode,
          });
          rotatedVaultKey = rotated.key;
          const rotatedPayload = cryptoFacade.reencryptPayloadForRotation({
            previousKey: vaultKey,
            nextKey: rotated.key,
            envelope: record.payload,
            revision: record.payload.revision + 1,
          });
          const persisted = await replaceVaultAfterRotationIfRevision(
            record.payload.revision,
            record.keyring,
            rotated.keyring,
            rotatedPayload,
            {
              formatVersion: 1,
              publicKey: replacementDevice.publicKey,
              envelope: localEnvelope,
              wrappingKey,
            },
            request.allowOldestDeviceRevocation,
          );
          if (persisted === "capacity") {
            throw Object.assign(new Error("Device envelope limit reached."), {
              code: "DEVICE_ENVELOPE_LIMIT_REACHED",
            });
          }
          if (persisted !== "persisted")
            throw new Error("Vault changed while rebuilding the trusted device.");

          // Independently open the atomic replacement through the ordinary
          // device route and compare plaintext before returning a snapshot.
          readBack = await unlockPersistedVault();
          if (
            readBack.revision !== record.payload.revision + 1 ||
            readBack.vaultKey.vaultKeyId !== rotated.key.vaultKeyId ||
            JSON.stringify(readBack.document) !== JSON.stringify(document)
          ) {
            throw new Error("Root-key rotation read-back verification failed.");
          }
          readBack.syncState = (await readPersistedVaultSyncV2()) === null ? "local-only" : "conflict";
          unlocked = readBack;
          readBack = undefined;
          return {
            id: request.id,
            ok: true,
            method: "recover",
            snapshot: snapshot(unlocked),
            syncState: unlocked.syncState,
          };
        } finally {
          vaultKey.destroy();
          rotatedVaultKey?.destroy();
          replacementDevice?.destroy();
          if (readBack !== undefined) {
            readBack.deviceKey?.destroy();
            readBack.vaultKey.destroy();
          }
        }
      }
      case "lock":
        destroyPendingSetup();
        destroyPendingRemoteRotation();
        destroyUnlocked();
        return { id: request.id, ok: true, method: "lock" };
      case "sync-now": {
        const state = unlocked;
        if (state === undefined) {
          const recovery = await readPersistedRemoteRecoveryV2();
          if (recovery !== null) {
            return {
              id: request.id,
              ok: true,
              method: "sync-now",
              snapshot: null,
              syncState: recovery.stage === "pairing-pending" ? "recovery" : "hardening",
            };
          }
          const remote = await bootstrap();
          return {
            id: request.id,
            ok: true,
            method: "sync-now",
            snapshot: null,
            syncState: typeof remote === "string" ? remote : remote.vault.exists ? "recovery" : "local-only",
          };
        }
        if ((await readPersistedRemoteRecoveryV2()) !== null) {
          state.syncState = "hardening";
          return {
            id: request.id,
            ok: true,
            method: "sync-now",
            snapshot: syncSnapshot(state),
            syncState: state.syncState,
          };
        }
        state.syncState = await synchronizeUnlocked(state);
        return {
          id: request.id,
          ok: true,
          method: "sync-now",
          snapshot: syncSnapshot(state),
          syncState: state.syncState,
        };
      }
      case "enable-account-sync": {
        const state = unlocked;
        if (state === undefined) throw Object.assign(new Error("Vault is locked."), { code: "NOT_READY" });
        const enabled = await enableAccountSync(state, request.recoveryCode);
        return {
          id: request.id,
          ok: true,
          method: "enable-account-sync",
          ...enabled,
        };
      }
      case "begin-remote-recovery": {
        destroyUnlocked();
        unlocked = await beginRemoteRecovery(request.recoveryCode);
        return {
          id: request.id,
          ok: true,
          method: "begin-remote-recovery",
          snapshot: snapshot(unlocked),
          syncState: unlocked.syncState,
        };
      }
      case "resume-remote-recovery": {
        destroyPendingRemoteRotation();
        destroyUnlocked();
        unlocked = await resumeRemoteRecovery();
        return {
          id: request.id,
          ok: true,
          method: "resume-remote-recovery",
          snapshot: snapshot(unlocked),
          syncState: unlocked.syncState,
        };
      }
      case "abandon-remote-recovery-pairing": {
        await abandonRemoteRecoveryPairing();
        return {
          id: request.id,
          ok: true,
          method: "abandon-remote-recovery-pairing",
        };
      }
      case "prepare-remote-recovery-rotation": {
        const state = unlocked;
        if (state === undefined) {
          throw Object.assign(new Error("Recovered vault is locked."), { code: "NOT_READY" });
        }
        const prepared = await prepareRemoteRecoveryRotation(state);
        return {
          id: request.id,
          ok: true,
          method: "prepare-remote-recovery-rotation",
          recoveryCode: prepared.recoveryCode,
          syncState: "hardening",
        };
      }
      case "confirm-remote-recovery-rotation": {
        const state = unlocked;
        if (state === undefined) {
          throw Object.assign(new Error("Recovered vault is locked."), { code: "NOT_READY" });
        }
        unlocked = await confirmRemoteRecoveryRotation(state);
        return {
          id: request.id,
          ok: true,
          method: "confirm-remote-recovery-rotation",
          snapshot: snapshot(unlocked),
          syncState: unlocked.syncState,
        };
      }
      case "begin-device-pairing": {
        const pairing = await beginDevicePairing();
        return {
          id: request.id,
          ok: true,
          method: "begin-device-pairing",
          ...pairing,
          syncState: "pairing",
        };
      }
      case "cancel-device-pairing": {
        await cancelDevicePairing();
        return {
          id: request.id,
          ok: true,
          method: "cancel-device-pairing",
          cancelled: true,
          syncState: "pairing",
        };
      }
      case "list-device-pairings": {
        const items = await listDevicePairings();
        return {
          id: request.id,
          ok: true,
          method: "list-device-pairings",
          items: items.map(pairingView),
          syncState: unlocked?.syncState ?? "pairing",
        };
      }
      case "approve-device-pairing": {
        const state = unlocked;
        if (state === undefined) throw Object.assign(new Error("Vault is locked."), { code: "NOT_READY" });
        state.syncState = await approveDevicePairing(state, request.pairingId, request.pairingCode);
        return {
          id: request.id,
          ok: true,
          method: "approve-device-pairing",
          snapshot: snapshot(state),
          syncState: state.syncState,
        };
      }
      case "poll-device-pairing": {
        const result = await pollDevicePairing();
        if (result.pending) {
          return {
            id: request.id,
            ok: true,
            method: "poll-device-pairing",
            pending: true,
            snapshot: null,
            syncState: "pairing",
          };
        }
        destroyUnlocked();
        unlocked = result.state;
        return {
          id: request.id,
          ok: true,
          method: "poll-device-pairing",
          pending: false,
          snapshot: snapshot(unlocked),
          syncState: "synced",
        };
      }
      case "add-task": {
        const state = unlocked;
        if (state === undefined) throw new Error("Vault is locked.");
        const title = request.title.trim();
        if (title.length === 0) throw new Error("Task title is required.");
        const written = await writeMutation({
          kind: "add-task",
          task: { id: `local-${generateId()}`, title, done: false },
        });
        return {
          id: request.id,
          ok: true,
          method: "add-task",
          ...written,
        };
      }
      case "toggle-task": {
        const state = unlocked;
        if (state === undefined) throw new Error("Vault is locked.");
        const task = state.document.tasks.find((candidate) => candidate.id === request.taskId);
        if (task === undefined) throw new Error("Unknown task.");
        const written = await writeMutation({
          kind: "set-task-done",
          taskId: request.taskId,
          done: !task.done,
        });
        return {
          id: request.id,
          ok: true,
          method: "toggle-task",
          ...written,
        };
      }
      case "import-legacy": {
        const state = unlocked;
        if (state === undefined) throw new Error("Vault is locked.");
        const imported = parseLegacyTasks(request.legacyRaw);
        // Retained legacy plaintext is only safe to discard after the exact
        // migration document has been read back. A later retry must never
        // overwrite tasks the user created after that migration.
        if (JSON.stringify(state.document) !== JSON.stringify(imported)) {
          const conflict = new Error("Legacy import would overwrite a newer vault document.");
          Object.assign(conflict, { code: "CONFLICT" });
          throw conflict;
        }
        return {
          id: request.id,
          ok: true,
          method: "import-legacy",
          snapshot: snapshot(state),
          syncState: state.syncState,
        };
      }
    }
  } catch (error) {
    const customCode =
      error instanceof Error && "code" in error ? (error as { readonly code?: unknown }).code : undefined;
    if (customCode === "UNAVAILABLE") {
      destroyPendingSetup();
      destroyUnlocked();
      return { id: request.id, ok: false, error: { code: "UNAVAILABLE" } };
    }
    if (customCode === "CONFLICT") return { id: request.id, ok: false, error: { code: "CONFLICT" } };
    if (
      customCode === "OWNER_MISMATCH" ||
      customCode === "SYNC_CONFLICT" ||
      customCode === "PAIRING_FAILED" ||
      customCode === "SIGNED_OUT" ||
      customCode === "NOT_READY"
    ) {
      if (customCode === "OWNER_MISMATCH" || customCode === "SYNC_CONFLICT") destroyUnlocked();
      return { id: request.id, ok: false, error: asVaultError(error) };
    }
    if (error instanceof VaultSyncProtocolError) {
      if (error.code === "ROLLBACK_DETECTED") destroyUnlocked();
      return { id: request.id, ok: false, error: asVaultError(error) };
    }
    if (request.method === "recover" && customCode === "DEVICE_ENVELOPE_LIMIT_REACHED") {
      return { id: request.id, ok: false, error: { code: "DEVICE_ENVELOPE_LIMIT_REACHED" } };
    }
    if (request.method === "recover")
      return { id: request.id, ok: false, error: { code: "AUTHENTICATION_FAILED" } };
    return { id: request.id, ok: false, error: asVaultError(error) };
  }
}

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = parseVaultRpcRequest(event.data);
  if (request === null) return;
  // A Worker can receive multiple messages before an awaited IndexedDB request
  // settles. Serializing the narrow RPC protocol makes revision CAS and lock
  // state deterministic without exposing any key material to the page.
  queue = queue.then(
    () => handle(request).then(respond),
    () => handle(request).then(respond),
  );
});

self.addEventListener("close", () => {
  destroyPendingSetup();
  destroyUnlocked();
});

export {};
