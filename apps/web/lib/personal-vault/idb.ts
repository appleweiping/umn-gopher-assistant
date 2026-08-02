import type {
  DeviceKeyEnvelopeV1,
  DevicePublicKeyV1,
  EncryptedVaultPayloadEnvelopeV1,
  VaultKeyringV1,
} from "@umn-gopher-assistant/crypto";
import type { BrowserDeviceKeyEnvelopeV1 } from "@umn-gopher-assistant/crypto/browser";
import { assertBrowserDeviceWrappingKey } from "@umn-gopher-assistant/crypto/browser";
import {
  DevicePublicKeyV1Schema,
  DeviceKeyEnvelopeV1Schema,
  DevicePairingRequestV2Schema,
  EncryptedVaultPayloadEnvelopeV1Schema,
  PairingApprovalRequestV2Schema,
  VAULT_MAX_DEVICE_ENVELOPES,
  VaultCreateCommandV2Schema,
  VaultKeyringV1Schema,
  VaultRotateKeyCommandV2Schema,
  VaultSyncSnapshotV2Schema,
  VaultUpdatePayloadCommandV2Schema,
  type VaultCreateCommandV2,
  type DevicePairingRequestV2,
  type PairingApprovalRequestV2,
  type VaultRotateKeyCommandV2,
  type VaultSyncSnapshotV2,
  type VaultUpdatePayloadCommandV2,
} from "@umn-gopher-assistant/contracts";

import type { VaultSyncHighWater } from "./sync-protocol";
import { classifyVerifiedPendingUpdateHead } from "./ordinary-sync-retry";

export const PERSONAL_VAULT_DB_NAME = "uga.personal-vault";
const PERSONAL_VAULT_DB_VERSION = 4;

const META_STORE = "meta";
const KEYRING_STORE = "keyring";
const PAYLOAD_STORE = "payload";
const DEVICE_STORE = "trusted-device";
const SYNC_STORE = "sync-v2";
const PAIRING_STORE = "pairing-v2";
const RECOVERY_STORE = "recovery-v2";

const ACTIVE_VAULT_META_KEY = "active-vault";
const ACTIVE_KEYRING_KEY = "active-keyring";
const ACTIVE_PAYLOAD_KEY = "active-payload";
const ACTIVE_DEVICE_KEY = "active-device";
const ACTIVE_SYNC_KEY = "active-sync";
const ACTIVE_PAIRING_KEY = "active-pairing";
const ACTIVE_RECOVERY_KEY = "active-recovery";

type PendingVaultSyncCommandV2 =
  | { readonly kind: "create"; readonly command: VaultCreateCommandV2 }
  | { readonly kind: "update"; readonly command: VaultUpdatePayloadCommandV2 };

export interface PersistedVaultSyncV2 {
  readonly formatVersion: 2;
  readonly ownerBinding: string;
  readonly vaultId: string;
  readonly authorizationKeyId: string;
  readonly etag: string | null;
  readonly highWater: VaultSyncHighWater | null;
  readonly snapshot: VaultSyncSnapshotV2 | null;
  readonly pending: PendingVaultSyncCommandV2 | null;
  readonly updatedAt: string;
}

export interface PersistedPendingPairingV2 {
  readonly formatVersion: 2;
  readonly ownerBinding: string;
  readonly vaultId: string;
  readonly authorizationKeyId: string;
  readonly requestOperationId: string;
  readonly cancelOperationId: string | null;
  readonly request: DevicePairingRequestV2;
  readonly pairingId: string | null;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly trustedDevice: TrustedDeviceRecordV1;
}

export type RemoteRecoveryStageV2 = "pairing-pending" | "hardening-required" | "rotation-pending";

export interface PersistedRemoteRecoveryPairingV2 {
  readonly formatVersion: 2;
  readonly stage: "pairing-pending";
  readonly ownerBinding: string;
  readonly vaultId: string;
  readonly baseEtag: string;
  readonly authorizationKeyId: string;
  readonly request: DevicePairingRequestV2;
  readonly approval: PairingApprovalRequestV2;
  readonly pairingId: string | null;
  readonly trustedDevice: TrustedDeviceRecordV1;
  /** Temporary old-root envelope addressed only to the origin-bound replacement key. */
  readonly recoveredVaultEnvelope: DeviceKeyEnvelopeV1;
  readonly sourceSnapshot: VaultSyncSnapshotV2;
  readonly localPayload: EncryptedVaultPayloadEnvelopeV1;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PersistedRemoteRecoveryHardeningV2 {
  readonly formatVersion: 2;
  readonly stage: "hardening-required";
  readonly ownerBinding: string;
  readonly vaultId: string;
  readonly etag: string;
  readonly authorizationKeyId: string;
  readonly pairedCommitHash: string;
  readonly replacementDeviceId: string;
  readonly updatedAt: string;
}

export interface PersistedRemoteRecoveryRotationV2 {
  readonly formatVersion: 2;
  readonly stage: "rotation-pending";
  readonly ownerBinding: string;
  readonly vaultId: string;
  readonly baseEtag: string;
  readonly authorizationKeyId: string;
  readonly baseCommitHash: string;
  readonly replacementDeviceId: string;
  readonly command: VaultRotateKeyCommandV2;
  readonly confirmedAt: string;
  readonly updatedAt: string;
}

export type PersistedRemoteRecoveryV2 =
  | PersistedRemoteRecoveryPairingV2
  | PersistedRemoteRecoveryHardeningV2
  | PersistedRemoteRecoveryRotationV2;

interface ActiveVaultMetaV1 {
  readonly formatVersion: 1;
  readonly vaultId: string;
  readonly createdAt: string;
}

export interface TrustedDeviceRecordV1 {
  readonly formatVersion: 1;
  readonly publicKey: DevicePublicKeyV1;
  readonly envelope: BrowserDeviceKeyEnvelopeV1;
  readonly wrappingKey: CryptoKey;
}

export interface PersistedVaultV1 {
  readonly meta: ActiveVaultMetaV1;
  readonly keyring: VaultKeyringV1;
  readonly payload: EncryptedVaultPayloadEnvelopeV1;
  readonly trustedDevice: TrustedDeviceRecordV1;
}

export interface RecoverableVaultV1 {
  readonly meta: ActiveVaultMetaV1;
  readonly keyring: VaultKeyringV1;
  readonly payload: EncryptedVaultPayloadEnvelopeV1;
  /** A usable local descriptor when one still agrees with the keyring. */
  readonly trustedDevice: TrustedDeviceRecordV1 | null;
}

export type VaultRotationResult = "capacity" | "conflict" | "persisted" | "unavailable";

export type DeviceRecipientRotationPlan =
  | { readonly status: "capacity" }
  | { readonly status: "unavailable" }
  | { readonly recipients: DevicePublicKeyV1[]; readonly status: "ready" };

function requestResult(request: IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB request failed.")), {
      once: true,
    });
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("IndexedDB transaction aborted.")),
      {
        once: true,
      },
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("IndexedDB transaction failed.")),
      {
        once: true,
      },
    );
  });
}

/**
 * Opens a security-sensitive write transaction with an explicit crash-durability
 * requirement. Older engines which ignore the options argument fail closed:
 * falling back to their user-agent default would make `complete` insufficient
 * proof for deleting a legacy plaintext source.
 */
export function createStrictReadwriteTransaction(
  database: IDBDatabase,
  storeNames: string | string[],
): IDBTransaction {
  let transaction: IDBTransaction;
  try {
    transaction = database.transaction(storeNames, "readwrite", { durability: "strict" });
  } catch (cause) {
    throw new Error("IndexedDB strict durability is unavailable.", { cause });
  }
  if (transaction.durability !== "strict") {
    try {
      transaction.abort();
    } catch {
      // The capability failure below is authoritative even if abort races a
      // browser which already auto-committed an otherwise empty transaction.
    }
    throw new Error("IndexedDB did not honor strict durability.");
  }
  return transaction;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(PERSONAL_VAULT_DB_NAME, PERSONAL_VAULT_DB_VERSION);
    request.addEventListener(
      "upgradeneeded",
      () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE);
        if (!database.objectStoreNames.contains(KEYRING_STORE)) database.createObjectStore(KEYRING_STORE);
        if (!database.objectStoreNames.contains(PAYLOAD_STORE)) database.createObjectStore(PAYLOAD_STORE);
        if (!database.objectStoreNames.contains(DEVICE_STORE)) database.createObjectStore(DEVICE_STORE);
        if (!database.objectStoreNames.contains(SYNC_STORE)) database.createObjectStore(SYNC_STORE);
        if (!database.objectStoreNames.contains(PAIRING_STORE)) database.createObjectStore(PAIRING_STORE);
        if (!database.objectStoreNames.contains(RECOVERY_STORE)) {
          database.createObjectStore(RECOVERY_STORE);
        }
      },
      { once: true },
    );
    request.addEventListener(
      "success",
      () => {
        // A blocked request can later succeed after this Promise has already
        // rejected. Close that late connection instead of leaking it.
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        resolve(request.result);
      },
      { once: true },
    );
    request.addEventListener(
      "error",
      () => {
        if (settled) return;
        settled = true;
        reject(request.error ?? new Error("Unable to open IndexedDB."));
      },
      { once: true },
    );
    request.addEventListener(
      "blocked",
      () => {
        if (settled) return;
        settled = true;
        reject(new Error("IndexedDB upgrade is blocked."));
      },
      { once: true },
    );
  });
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
    ? record
    : null;
}

function isActiveMeta(value: unknown): value is ActiveVaultMetaV1 {
  const record = exactRecord(value, ["createdAt", "formatVersion", "vaultId"]);
  return (
    record !== null &&
    record["formatVersion"] === 1 &&
    typeof record["vaultId"] === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(record["vaultId"]) &&
    typeof record["createdAt"] === "string" &&
    Number.isFinite(Date.parse(record["createdAt"])) &&
    new Date(record["createdAt"]).toISOString() === record["createdAt"]
  );
}

function isTrustedDeviceRecord(value: unknown): value is TrustedDeviceRecordV1 {
  const record = exactRecord(value, ["envelope", "formatVersion", "publicKey", "wrappingKey"]);
  if (record === null) return false;
  if (record["formatVersion"] !== 1 || !(record["wrappingKey"] instanceof CryptoKey)) {
    return false;
  }
  try {
    DevicePublicKeyV1Schema.parse(record["publicKey"]);
    assertBrowserDeviceWrappingKey(record["wrappingKey"]);
    const envelope = exactRecord(record["envelope"], [
      "cipherSuite",
      "ciphertext",
      "deviceId",
      "deviceKeyId",
      "formatVersion",
      "iv",
      "publicKeyFingerprint",
    ]);
    if (envelope === null) return false;
    if (
      envelope["formatVersion"] !== 1 ||
      envelope["cipherSuite"] !== "AES_256_GCM" ||
      typeof envelope["deviceId"] !== "string" ||
      typeof envelope["deviceKeyId"] !== "string" ||
      typeof envelope["publicKeyFingerprint"] !== "string" ||
      typeof envelope["iv"] !== "string" ||
      typeof envelope["ciphertext"] !== "string"
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function envelopeMatchesPublicKey(envelope: DeviceKeyEnvelopeV1, publicKey: DevicePublicKeyV1): boolean {
  return (
    envelope.recipientDeviceId === publicKey.deviceId &&
    envelope.recipientKeyId === publicKey.deviceKeyId &&
    envelope.recipientPublicKeyFingerprint === publicKey.publicKeyFingerprint
  );
}

function trustedDeviceForKeyring(value: unknown, keyring: VaultKeyringV1): TrustedDeviceRecordV1 | null {
  if (!isTrustedDeviceRecord(value)) return null;
  return keyring.deviceEnvelopes.some((envelope) => envelopeMatchesPublicKey(envelope, value.publicKey))
    ? value
    : null;
}

function oldestEnvelopeIndex(envelopes: readonly DeviceKeyEnvelopeV1[]): number {
  let oldest = 0;
  for (let index = 1; index < envelopes.length; index += 1) {
    const candidate = envelopes[index];
    const current = envelopes[oldest];
    if (candidate === undefined || current === undefined) continue;
    const candidateOrder = `${candidate.createdAt}\u0000${candidate.recipientDeviceId}\u0000${candidate.recipientKeyId}`;
    const currentOrder = `${current.createdAt}\u0000${current.recipientDeviceId}\u0000${current.recipientKeyId}`;
    if (candidateOrder < currentOrder) oldest = index;
  }
  return oldest;
}

/**
 * Selects recipients for a new root key. Retaining an old envelope is not
 * sufficient: root-key rotation must have the corresponding public descriptor
 * so it can create a fresh cryptographic envelope. Legacy one-device records
 * can use the origin-bound descriptor while it is still available; all other
 * missing descriptors fail closed.
 */
export function planDeviceRecipientRotation(
  keyring: VaultKeyringV1,
  currentTrustedDevice: TrustedDeviceRecordV1 | null,
  replacement: DevicePublicKeyV1,
  allowOldestRevocation: boolean,
): DeviceRecipientRotationPlan {
  const currentIndex =
    currentTrustedDevice === null
      ? -1
      : keyring.deviceEnvelopes.findIndex((envelope) =>
          envelopeMatchesPublicKey(envelope, currentTrustedDevice.publicKey),
        );
  let removeIndex = currentIndex;
  if (removeIndex < 0 && keyring.deviceEnvelopes.length >= VAULT_MAX_DEVICE_ENVELOPES) {
    if (!allowOldestRevocation) return { status: "capacity" };
    removeIndex = oldestEnvelopeIndex(keyring.deviceEnvelopes);
  }
  const retained = keyring.deviceEnvelopes.filter((_, index) => index !== removeIndex);
  if (retained.length >= VAULT_MAX_DEVICE_ENVELOPES) return { status: "capacity" };

  const recipients: DevicePublicKeyV1[] = [];
  for (const envelope of retained) {
    const registered = keyring.devicePublicKeys?.find((candidate) =>
      envelopeMatchesPublicKey(envelope, candidate),
    );
    const localFallback =
      currentTrustedDevice !== null && envelopeMatchesPublicKey(envelope, currentTrustedDevice.publicKey)
        ? currentTrustedDevice.publicKey
        : undefined;
    const recipient = registered ?? localFallback;
    if (recipient?.revokedAt !== null) return { status: "unavailable" };
    recipients.push(recipient);
  }

  if (
    replacement.revokedAt !== null ||
    recipients.some(
      (recipient) =>
        recipient.deviceId === replacement.deviceId || recipient.deviceKeyId === replacement.deviceKeyId,
    )
  ) {
    return { status: "unavailable" };
  }
  return { status: "ready", recipients: [...recipients, replacement] };
}

function validatePersistedRecord(
  meta: ActiveVaultMetaV1,
  keyring: unknown,
  payload: unknown,
  trustedDevice: TrustedDeviceRecordV1,
): PersistedVaultV1 {
  if (!isActiveMeta(meta) || !isTrustedDeviceRecord(trustedDevice)) {
    throw new Error("Personal vault records are incomplete.");
  }
  const checkedKeyring = VaultKeyringV1Schema.parse(keyring);
  const checkedPayload = EncryptedVaultPayloadEnvelopeV1Schema.parse(payload);
  const checkedPublicKey = DevicePublicKeyV1Schema.parse(trustedDevice.publicKey);
  if (
    meta.vaultId !== checkedKeyring.vaultId ||
    checkedPayload.vaultId !== meta.vaultId ||
    checkedPayload.vaultKeyId !== checkedKeyring.vaultKeyId ||
    trustedDevice.envelope.deviceId !== checkedPublicKey.deviceId ||
    trustedDevice.envelope.deviceKeyId !== checkedPublicKey.deviceKeyId ||
    trustedDevice.envelope.publicKeyFingerprint !== checkedPublicKey.publicKeyFingerprint ||
    !checkedKeyring.deviceEnvelopes.some((envelope) => envelopeMatchesPublicKey(envelope, checkedPublicKey))
  ) {
    throw new Error("Personal vault records do not agree.");
  }
  return {
    meta,
    keyring: checkedKeyring,
    payload: checkedPayload,
    trustedDevice: { ...trustedDevice, publicKey: checkedPublicKey },
  };
}

function validateRecoverableRecord(
  meta: unknown,
  keyring: unknown,
  payload: unknown,
  trustedDevice: unknown,
): RecoverableVaultV1 {
  if (!isActiveMeta(meta)) throw new Error("Personal vault records are incomplete.");
  const checkedKeyring = VaultKeyringV1Schema.parse(keyring);
  const checkedPayload = EncryptedVaultPayloadEnvelopeV1Schema.parse(payload);
  if (
    meta.vaultId !== checkedKeyring.vaultId ||
    checkedPayload.vaultId !== meta.vaultId ||
    checkedPayload.vaultKeyId !== checkedKeyring.vaultKeyId
  ) {
    throw new Error("Personal vault records do not agree.");
  }
  return {
    meta,
    keyring: checkedKeyring,
    payload: checkedPayload,
    trustedDevice: trustedDeviceForKeyring(trustedDevice, checkedKeyring),
  };
}

export async function probePersonalVaultStorage(): Promise<void> {
  const database = await openDatabase();
  const probeKey = `probe-${crypto.randomUUID()}`;
  let wrappingKey: CryptoKey | undefined;
  try {
    wrappingKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    const transaction = createStrictReadwriteTransaction(database, META_STORE);
    transaction.objectStore(META_STORE).put(wrappingKey, probeKey);
    await transactionDone(transaction);
    const readTransaction = database.transaction(META_STORE, "readonly");
    const restored: unknown = await requestResult(readTransaction.objectStore(META_STORE).get(probeKey));
    await transactionDone(readTransaction);
    if (!(restored instanceof CryptoKey)) {
      throw new Error("IndexedDB cannot persist the required non-extractable CryptoKey.");
    }
    assertBrowserDeviceWrappingKey(restored);
    // Structured clone support alone is insufficient. Exercise the restored
    // key in the same Worker context before accepting this browser.
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new Uint8Array([85, 71, 65, 49]);
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, restored, plaintext);
    const roundTrip = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv }, restored, ciphertext),
    );
    if (
      roundTrip.length !== plaintext.length ||
      roundTrip.some((value, index) => value !== plaintext[index])
    ) {
      throw new Error("IndexedDB-persisted CryptoKey is not usable.");
    }
  } finally {
    // Keep a failed feature probe from leaving even a non-extractable test key
    // in the metadata store. Cleanup is best effort because the original error
    // is the relevant unsupported-storage signal.
    try {
      const cleanup = database.transaction(META_STORE, "readwrite");
      cleanup.objectStore(META_STORE).delete(probeKey);
      await transactionDone(cleanup);
    } catch {
      // Best effort only: the original unsupported-storage error is actionable.
    }
    database.close();
  }
}

export async function readPersistedVault(): Promise<PersistedVaultV1 | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [META_STORE, KEYRING_STORE, PAYLOAD_STORE, DEVICE_STORE],
      "readonly",
    );
    const records: readonly unknown[] = await Promise.all([
      requestResult(transaction.objectStore(META_STORE).get(ACTIVE_VAULT_META_KEY)),
      requestResult(transaction.objectStore(KEYRING_STORE).get(ACTIVE_KEYRING_KEY)),
      requestResult(transaction.objectStore(PAYLOAD_STORE).get(ACTIVE_PAYLOAD_KEY)),
      requestResult(transaction.objectStore(DEVICE_STORE).get(ACTIVE_DEVICE_KEY)),
    ]);
    const [meta, keyring, payload, trustedDevice] = records;
    await transactionDone(transaction);
    if (meta === undefined && keyring === undefined && payload === undefined && trustedDevice === undefined)
      return null;
    if (!isActiveMeta(meta) || !isTrustedDeviceRecord(trustedDevice)) {
      throw new Error("Personal vault records are incomplete.");
    }
    return validatePersistedRecord(meta, keyring, payload, trustedDevice);
  } finally {
    database.close();
  }
}

/**
 * Recovery deliberately does not depend on the trusted-device record. A
 * retained encrypted payload and keyring remain recoverable if the local
 * device envelope or origin-bound CryptoKey is lost/corrupt.
 */
export async function readRecoverableVault(): Promise<RecoverableVaultV1 | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [META_STORE, KEYRING_STORE, PAYLOAD_STORE, DEVICE_STORE],
      "readonly",
    );
    const records: readonly unknown[] = await Promise.all([
      requestResult(transaction.objectStore(META_STORE).get(ACTIVE_VAULT_META_KEY)),
      requestResult(transaction.objectStore(KEYRING_STORE).get(ACTIVE_KEYRING_KEY)),
      requestResult(transaction.objectStore(PAYLOAD_STORE).get(ACTIVE_PAYLOAD_KEY)),
      requestResult(transaction.objectStore(DEVICE_STORE).get(ACTIVE_DEVICE_KEY)),
    ]);
    const [meta, keyring, payload, trustedDevice] = records;
    await transactionDone(transaction);
    if (meta === undefined && keyring === undefined && payload === undefined) return null;
    return validateRecoverableRecord(meta, keyring, payload, trustedDevice);
  } finally {
    database.close();
  }
}

export async function createPersistedVault(record: PersistedVaultV1): Promise<void> {
  const checkedRecord = validatePersistedRecord(
    record.meta,
    record.keyring,
    record.payload,
    record.trustedDevice,
  );
  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, [
      META_STORE,
      KEYRING_STORE,
      PAYLOAD_STORE,
      DEVICE_STORE,
    ]);
    const metaStore = transaction.objectStore(META_STORE);
    const existing = await Promise.all([
      requestResult(metaStore.get(ACTIVE_VAULT_META_KEY)),
      requestResult(transaction.objectStore(KEYRING_STORE).get(ACTIVE_KEYRING_KEY)),
      requestResult(transaction.objectStore(PAYLOAD_STORE).get(ACTIVE_PAYLOAD_KEY)),
      requestResult(transaction.objectStore(DEVICE_STORE).get(ACTIVE_DEVICE_KEY)),
    ]);
    if (existing.some((value) => value !== undefined)) {
      transaction.abort();
      throw new Error("Personal vault records already exist or are incomplete.");
    }
    try {
      // Queue the CryptoKey structured clone first: it is the most likely
      // synchronous failure and every later write shares this transaction.
      transaction.objectStore(DEVICE_STORE).put(checkedRecord.trustedDevice, ACTIVE_DEVICE_KEY);
      metaStore.put(checkedRecord.meta, ACTIVE_VAULT_META_KEY);
      transaction.objectStore(PAYLOAD_STORE).put(checkedRecord.payload, ACTIVE_PAYLOAD_KEY);
      transaction.objectStore(KEYRING_STORE).put(checkedRecord.keyring, ACTIVE_KEYRING_KEY);
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // Preserve the structured-clone/write failure as the useful cause.
      }
      throw error;
    }
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

/**
 * Genesis durability boundary for signed-in setup: the locally recoverable v1
 * vault and the signed opaque cloud-create intent become visible together.
 */
export async function createPersistedVaultAndBeginSyncV2(
  record: PersistedVaultV1,
  authorizationKeyId: string,
  commandValue: VaultCreateCommandV2,
): Promise<PersistedVaultSyncV2> {
  const checkedRecord = validatePersistedRecord(
    record.meta,
    record.keyring,
    record.payload,
    record.trustedDevice,
  );
  const command = VaultCreateCommandV2Schema.parse(commandValue);
  const sync = validateSyncRecord({
    formatVersion: 2,
    ownerBinding: command.ownerBinding,
    vaultId: command.vaultId,
    authorizationKeyId,
    etag: null,
    highWater: null,
    snapshot: null,
    pending: { kind: "create", command },
    updatedAt: new Date().toISOString(),
  });
  if (checkedRecord.meta.vaultId !== command.vaultId) {
    throw new Error("Local and account-bound vault identifiers differ.");
  }
  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, [
      META_STORE,
      KEYRING_STORE,
      PAYLOAD_STORE,
      DEVICE_STORE,
      SYNC_STORE,
    ]);
    const stores = {
      meta: transaction.objectStore(META_STORE),
      keyring: transaction.objectStore(KEYRING_STORE),
      payload: transaction.objectStore(PAYLOAD_STORE),
      device: transaction.objectStore(DEVICE_STORE),
      sync: transaction.objectStore(SYNC_STORE),
    };
    const existing = await Promise.all([
      requestResult(stores.meta.get(ACTIVE_VAULT_META_KEY)),
      requestResult(stores.keyring.get(ACTIVE_KEYRING_KEY)),
      requestResult(stores.payload.get(ACTIVE_PAYLOAD_KEY)),
      requestResult(stores.device.get(ACTIVE_DEVICE_KEY)),
      requestResult(stores.sync.get(ACTIVE_SYNC_KEY)),
    ]);
    if (existing.some((value) => value !== undefined)) {
      transaction.abort();
      throw new Error("Personal vault or sync records already exist.");
    }
    writeVaultGenesisAndSyncRecords(transaction, checkedRecord, sync);
    await transactionDone(transaction);
    return structuredClone(sync);
  } finally {
    database.close();
  }
}

/**
 * Queues all mutable root-key state in one transaction and aborts on a
 * synchronous structured-clone/write failure. IndexedDB request failures also
 * abort the transaction by default, so no committed keyring can point at a
 * payload or local device created by a different rotation.
 */
export function writeVaultRotationRecords(
  transaction: IDBTransaction,
  keyring: VaultKeyringV1,
  payload: EncryptedVaultPayloadEnvelopeV1,
  trustedDevice: TrustedDeviceRecordV1,
): void {
  try {
    transaction.objectStore(DEVICE_STORE).put(trustedDevice, ACTIVE_DEVICE_KEY);
    transaction.objectStore(PAYLOAD_STORE).put(payload, ACTIVE_PAYLOAD_KEY);
    transaction.objectStore(KEYRING_STORE).put(keyring, ACTIVE_KEYRING_KEY);
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // Preserve the original write failure.
    }
    throw error;
  }
}

export function writeSyncAndPayloadRecords(
  transaction: IDBTransaction,
  payload: EncryptedVaultPayloadEnvelopeV1,
  sync: PersistedVaultSyncV2,
): void {
  try {
    transaction.objectStore(PAYLOAD_STORE).put(payload, ACTIVE_PAYLOAD_KEY);
    transaction.objectStore(SYNC_STORE).put(sync, ACTIVE_SYNC_KEY);
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // Preserve the first structured-clone/write failure.
    }
    throw error;
  }
}

export function writePairedVaultCompletionRecords(
  transaction: IDBTransaction,
  record: PersistedVaultV1,
  sync: PersistedVaultSyncV2,
): void {
  try {
    transaction.objectStore(DEVICE_STORE).put(record.trustedDevice, ACTIVE_DEVICE_KEY);
    transaction.objectStore(META_STORE).put(record.meta, ACTIVE_VAULT_META_KEY);
    transaction.objectStore(PAYLOAD_STORE).put(record.payload, ACTIVE_PAYLOAD_KEY);
    transaction.objectStore(KEYRING_STORE).put(record.keyring, ACTIVE_KEYRING_KEY);
    transaction.objectStore(SYNC_STORE).put(sync, ACTIVE_SYNC_KEY);
    transaction.objectStore(PAIRING_STORE).delete(ACTIVE_PAIRING_KEY);
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // Preserve the first structured-clone/write failure.
    }
    throw error;
  }
}

export function writeVaultGenesisAndSyncRecords(
  transaction: IDBTransaction,
  record: PersistedVaultV1,
  sync: PersistedVaultSyncV2,
): void {
  try {
    transaction.objectStore(DEVICE_STORE).put(record.trustedDevice, ACTIVE_DEVICE_KEY);
    transaction.objectStore(META_STORE).put(record.meta, ACTIVE_VAULT_META_KEY);
    transaction.objectStore(PAYLOAD_STORE).put(record.payload, ACTIVE_PAYLOAD_KEY);
    transaction.objectStore(KEYRING_STORE).put(record.keyring, ACTIVE_KEYRING_KEY);
    transaction.objectStore(SYNC_STORE).put(sync, ACTIVE_SYNC_KEY);
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // Preserve the first structured-clone/write failure.
    }
    throw error;
  }
}

/**
 * The local-only -> account-sync boundary writes only the opaque signed
 * create intent, but does so while the existing v1 records are locked in the
 * same strict transaction. A crash therefore leaves either no account
 * binding or a complete, replayable create command.
 */
export function writeExistingVaultSyncDraftRecord(
  transaction: IDBTransaction,
  sync: PersistedVaultSyncV2,
): void {
  try {
    transaction.objectStore(SYNC_STORE).put(sync, ACTIVE_SYNC_KEY);
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // Preserve the first structured-clone/write failure.
    }
    throw error;
  }
}

export function writeVaultSyncProofRenewalRecord(
  transaction: IDBTransaction,
  sync: PersistedVaultSyncV2,
): void {
  try {
    transaction.objectStore(SYNC_STORE).put(sync, ACTIVE_SYNC_KEY);
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // Preserve the first IndexedDB renewal failure.
    }
    throw error;
  }
}

export function writeRemoteRecoveryPairingIntentRecord(
  transaction: IDBTransaction,
  recovery: PersistedRemoteRecoveryPairingV2,
): void {
  try {
    transaction.objectStore(RECOVERY_STORE).put(recovery, ACTIVE_RECOVERY_KEY);
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // Preserve the first structured-clone/write failure.
    }
    throw error;
  }
}

export function writeRemoteRecoveryPairingAbandonRecord(transaction: IDBTransaction): void {
  try {
    transaction.objectStore(RECOVERY_STORE).delete(ACTIVE_RECOVERY_KEY);
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // Preserve the first IndexedDB delete failure.
    }
    throw error;
  }
}

export function writeRemoteRecoveryHardeningRecords(
  transaction: IDBTransaction,
  record: PersistedVaultV1,
  sync: PersistedVaultSyncV2,
  recovery: PersistedRemoteRecoveryHardeningV2,
): void {
  try {
    transaction.objectStore(DEVICE_STORE).put(record.trustedDevice, ACTIVE_DEVICE_KEY);
    transaction.objectStore(META_STORE).put(record.meta, ACTIVE_VAULT_META_KEY);
    transaction.objectStore(PAYLOAD_STORE).put(record.payload, ACTIVE_PAYLOAD_KEY);
    transaction.objectStore(KEYRING_STORE).put(record.keyring, ACTIVE_KEYRING_KEY);
    transaction.objectStore(SYNC_STORE).put(sync, ACTIVE_SYNC_KEY);
    transaction.objectStore(RECOVERY_STORE).put(recovery, ACTIVE_RECOVERY_KEY);
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // Preserve the first structured-clone/write failure.
    }
    throw error;
  }
}

export function writeRemoteRecoveryRotationStageRecords(
  transaction: IDBTransaction,
  keyring: VaultKeyringV1,
  payload: EncryptedVaultPayloadEnvelopeV1,
  trustedDevice: TrustedDeviceRecordV1,
  recovery: PersistedRemoteRecoveryRotationV2,
): void {
  try {
    transaction.objectStore(DEVICE_STORE).put(trustedDevice, ACTIVE_DEVICE_KEY);
    transaction.objectStore(PAYLOAD_STORE).put(payload, ACTIVE_PAYLOAD_KEY);
    transaction.objectStore(KEYRING_STORE).put(keyring, ACTIVE_KEYRING_KEY);
    transaction.objectStore(RECOVERY_STORE).put(recovery, ACTIVE_RECOVERY_KEY);
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // Preserve the first structured-clone/write failure.
    }
    throw error;
  }
}

export function writeRemoteRecoveryRotationCommitRecords(
  transaction: IDBTransaction,
  sync: PersistedVaultSyncV2,
): void {
  try {
    transaction.objectStore(SYNC_STORE).put(sync, ACTIVE_SYNC_KEY);
    transaction.objectStore(RECOVERY_STORE).delete(ACTIVE_RECOVERY_KEY);
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // Preserve the first structured-clone/write failure.
    }
    throw error;
  }
}

export function writeRemoteRecoveryRotationRebaseRecords(
  transaction: IDBTransaction,
  payload: EncryptedVaultPayloadEnvelopeV1,
  sync: PersistedVaultSyncV2,
  recovery: PersistedRemoteRecoveryRotationV2,
): void {
  try {
    transaction.objectStore(PAYLOAD_STORE).put(payload, ACTIVE_PAYLOAD_KEY);
    transaction.objectStore(SYNC_STORE).put(sync, ACTIVE_SYNC_KEY);
    transaction.objectStore(RECOVERY_STORE).put(recovery, ACTIVE_RECOVERY_KEY);
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // Preserve the first structured-clone/write failure.
    }
    throw error;
  }
}

export function writeRemoteRecoveryRotationRenewalRecord(
  transaction: IDBTransaction,
  recovery: PersistedRemoteRecoveryRotationV2,
): void {
  try {
    transaction.objectStore(RECOVERY_STORE).put(recovery, ACTIVE_RECOVERY_KEY);
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // Preserve the first IndexedDB renewal failure.
    }
    throw error;
  }
}

/**
 * Atomically rotates the vault root key after recovery. A full prior-keyring
 * compare and payload revision CAS prevent concurrent sessions from replacing
 * newer state. The next keyring, re-encrypted payload, and origin-bound device
 * record are committed together or not at all.
 */
export async function replaceVaultAfterRotationIfRevision(
  expectedPayloadRevision: number,
  expectedKeyring: VaultKeyringV1,
  keyring: VaultKeyringV1,
  payload: EncryptedVaultPayloadEnvelopeV1,
  trustedDevice: TrustedDeviceRecordV1,
  allowOldestRevocation: boolean,
): Promise<VaultRotationResult> {
  if (!isTrustedDeviceRecord(trustedDevice)) {
    throw new Error("Trusted-device record is invalid.");
  }
  const checkedExpectedKeyring = VaultKeyringV1Schema.parse(expectedKeyring);
  const checkedKeyring = VaultKeyringV1Schema.parse(keyring);
  const checkedPayload = EncryptedVaultPayloadEnvelopeV1Schema.parse(payload);
  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, [
      META_STORE,
      KEYRING_STORE,
      PAYLOAD_STORE,
      DEVICE_STORE,
    ]);
    const [meta, persistedKeyring, persistedPayload, persistedTrustedDevice] = await Promise.all([
      requestResult(transaction.objectStore(META_STORE).get(ACTIVE_VAULT_META_KEY)),
      requestResult(transaction.objectStore(KEYRING_STORE).get(ACTIVE_KEYRING_KEY)),
      requestResult(transaction.objectStore(PAYLOAD_STORE).get(ACTIVE_PAYLOAD_KEY)),
      requestResult(transaction.objectStore(DEVICE_STORE).get(ACTIVE_DEVICE_KEY)),
    ]);
    let recoverable: RecoverableVaultV1;
    try {
      recoverable = validateRecoverableRecord(
        meta,
        persistedKeyring,
        persistedPayload,
        persistedTrustedDevice,
      );
    } catch {
      transaction.abort();
      return "conflict";
    }
    if (recoverable.payload.revision !== expectedPayloadRevision) {
      transaction.abort();
      return "conflict";
    }
    // Compare the full authenticated prior keyring to prevent two concurrent
    // recovery sessions from silently replacing each other's key rotation.
    if (JSON.stringify(recoverable.keyring) !== JSON.stringify(checkedExpectedKeyring)) {
      transaction.abort();
      return "conflict";
    }
    if (
      checkedKeyring.vaultId !== recoverable.keyring.vaultId ||
      checkedKeyring.vaultKeyId === recoverable.keyring.vaultKeyId ||
      checkedKeyring.revision !== recoverable.keyring.revision + 1 ||
      checkedPayload.vaultId !== recoverable.meta.vaultId ||
      checkedPayload.vaultKeyId !== checkedKeyring.vaultKeyId ||
      checkedPayload.baseRevision !== recoverable.payload.revision ||
      checkedPayload.revision !== recoverable.payload.revision + 1
    ) {
      transaction.abort();
      return "conflict";
    }
    const deviceEnvelope = checkedKeyring.deviceEnvelopes.find(
      (candidate) =>
        candidate.recipientDeviceId === trustedDevice.publicKey.deviceId &&
        candidate.recipientKeyId === trustedDevice.publicKey.deviceKeyId &&
        candidate.recipientPublicKeyFingerprint === trustedDevice.publicKey.publicKeyFingerprint,
    );
    if (deviceEnvelope === undefined) {
      transaction.abort();
      return "conflict";
    }
    const plan = planDeviceRecipientRotation(
      recoverable.keyring,
      recoverable.trustedDevice,
      trustedDevice.publicKey,
      allowOldestRevocation,
    );
    if (plan.status === "capacity") {
      transaction.abort();
      return "capacity";
    }
    if (plan.status === "unavailable") {
      transaction.abort();
      return "unavailable";
    }
    if (JSON.stringify(checkedKeyring.devicePublicKeys) !== JSON.stringify(plan.recipients)) {
      transaction.abort();
      return "conflict";
    }
    writeVaultRotationRecords(transaction, checkedKeyring, checkedPayload, trustedDevice);
    await transactionDone(transaction);
    return "persisted";
  } finally {
    database.close();
  }
}

/** CAS update: the encrypted record must advance exactly one revision. */
export async function replacePayloadIfRevision(
  expectedRevision: number,
  payload: EncryptedVaultPayloadEnvelopeV1,
): Promise<boolean> {
  const checkedPayload = EncryptedVaultPayloadEnvelopeV1Schema.parse(payload);
  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, [
      META_STORE,
      KEYRING_STORE,
      PAYLOAD_STORE,
      DEVICE_STORE,
    ]);
    const store = transaction.objectStore(PAYLOAD_STORE);
    const [meta, keyring, currentValue, trustedDevice] = await Promise.all([
      requestResult(transaction.objectStore(META_STORE).get(ACTIVE_VAULT_META_KEY)),
      requestResult(transaction.objectStore(KEYRING_STORE).get(ACTIVE_KEYRING_KEY)),
      requestResult(store.get(ACTIVE_PAYLOAD_KEY)),
      requestResult(transaction.objectStore(DEVICE_STORE).get(ACTIVE_DEVICE_KEY)),
    ]);
    if (!isActiveMeta(meta) || !isTrustedDeviceRecord(trustedDevice)) {
      transaction.abort();
      return false;
    }
    let persisted: PersistedVaultV1;
    try {
      persisted = validatePersistedRecord(meta, keyring, currentValue, trustedDevice);
    } catch {
      transaction.abort();
      return false;
    }
    const currentParse =
      currentValue === undefined ? undefined : EncryptedVaultPayloadEnvelopeV1Schema.safeParse(currentValue);
    const current = currentParse?.success ? currentParse.data : undefined;
    if (
      current?.revision !== expectedRevision ||
      checkedPayload.baseRevision !== expectedRevision ||
      checkedPayload.revision !== expectedRevision + 1 ||
      checkedPayload.vaultId !== persisted.meta.vaultId ||
      checkedPayload.vaultKeyId !== persisted.keyring.vaultKeyId
    ) {
      transaction.abort();
      return false;
    }
    store.put(checkedPayload, ACTIVE_PAYLOAD_KEY);
    await transactionDone(transaction);
    return true;
  } finally {
    database.close();
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OWNER_BINDING_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const STRONG_ETAG_PATTERN = /^"[\x21\x23-\x7e]+"$/u;

function isCanonicalTime(value: unknown): value is string {
  return (
    typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
  );
}

function validateHighWater(value: unknown): VaultSyncHighWater {
  const record = exactRecord(value, ["commitHash", "epoch", "ownerBinding", "sequence", "vaultId"]);
  if (
    record === null ||
    typeof record["commitHash"] !== "string" ||
    !OWNER_BINDING_PATTERN.test(record["commitHash"]) ||
    typeof record["ownerBinding"] !== "string" ||
    !OWNER_BINDING_PATTERN.test(record["ownerBinding"]) ||
    typeof record["vaultId"] !== "string" ||
    !UUID_PATTERN.test(record["vaultId"]) ||
    typeof record["epoch"] !== "number" ||
    !Number.isSafeInteger(record["epoch"]) ||
    record["epoch"] < 1 ||
    typeof record["sequence"] !== "number" ||
    !Number.isSafeInteger(record["sequence"]) ||
    record["sequence"] < 1
  ) {
    throw new Error("Personal vault sync high-water mark is invalid.");
  }
  return {
    commitHash: record["commitHash"],
    epoch: record["epoch"],
    ownerBinding: record["ownerBinding"],
    sequence: record["sequence"],
    vaultId: record["vaultId"],
  };
}

function activeAuthorizationKey(snapshot: VaultSyncSnapshotV2, keyId: string): boolean {
  return snapshot.authorizationManifest.devices.some(
    (device) => device.revokedAt === null && device.authorizationKey.keyId === keyId,
  );
}

function validatePendingSyncCommand(value: unknown): PendingVaultSyncCommandV2 {
  const record = exactRecord(value, ["command", "kind"]);
  if (record?.["kind"] === "create") {
    return { kind: "create", command: VaultCreateCommandV2Schema.parse(record["command"]) };
  }
  if (record?.["kind"] === "update") {
    return { kind: "update", command: VaultUpdatePayloadCommandV2Schema.parse(record["command"]) };
  }
  throw new Error("Personal vault pending sync command is invalid.");
}

function validateSyncRecord(value: unknown): PersistedVaultSyncV2 {
  const record = exactRecord(value, [
    "authorizationKeyId",
    "etag",
    "formatVersion",
    "highWater",
    "ownerBinding",
    "pending",
    "snapshot",
    "updatedAt",
    "vaultId",
  ]);
  if (
    record?.["formatVersion"] !== 2 ||
    typeof record["ownerBinding"] !== "string" ||
    !OWNER_BINDING_PATTERN.test(record["ownerBinding"]) ||
    typeof record["vaultId"] !== "string" ||
    !UUID_PATTERN.test(record["vaultId"]) ||
    typeof record["authorizationKeyId"] !== "string" ||
    !UUID_PATTERN.test(record["authorizationKeyId"]) ||
    !isCanonicalTime(record["updatedAt"])
  ) {
    throw new Error("Personal vault sync record is invalid.");
  }
  const ownerBinding = record["ownerBinding"];
  const vaultId = record["vaultId"];
  const authorizationKeyId = record["authorizationKeyId"];
  const pending = record["pending"] === null ? null : validatePendingSyncCommand(record["pending"]);
  const snapshot = record["snapshot"] === null ? null : VaultSyncSnapshotV2Schema.parse(record["snapshot"]);
  const highWater = record["highWater"] === null ? null : validateHighWater(record["highWater"]);
  const etag = record["etag"];
  if (
    (etag !== null && (typeof etag !== "string" || !STRONG_ETAG_PATTERN.test(etag))) ||
    (snapshot === null) !== (highWater === null) ||
    (snapshot === null) !== (etag === null)
  ) {
    throw new Error("Personal vault sync state is incomplete.");
  }
  if (snapshot === null) {
    if (
      pending?.kind !== "create" ||
      pending.command.ownerBinding !== ownerBinding ||
      pending.command.vaultId !== vaultId ||
      pending.command.proof.signer.kind !== "DEVICE" ||
      pending.command.proof.signer.keyId !== authorizationKeyId ||
      !activeAuthorizationKey(pending.command.snapshot, authorizationKeyId)
    ) {
      throw new Error("Personal vault create draft is inconsistent.");
    }
  } else {
    if (
      snapshot.ownerBinding !== ownerBinding ||
      snapshot.vaultId !== vaultId ||
      etag !== `"pv2:${snapshot.commitHash}"` ||
      highWater?.ownerBinding !== ownerBinding ||
      highWater.vaultId !== vaultId ||
      highWater.epoch !== snapshot.commit.epoch ||
      highWater.sequence !== snapshot.commit.sequence ||
      highWater.commitHash !== snapshot.commitHash ||
      !activeAuthorizationKey(snapshot, authorizationKeyId) ||
      pending?.kind === "create"
    ) {
      throw new Error("Personal vault active sync state is inconsistent.");
    }
    if (
      pending?.kind === "update" &&
      (pending.command.ownerBinding !== ownerBinding ||
        pending.command.vaultId !== vaultId ||
        pending.command.expectedParentCommitHash !== snapshot.commitHash ||
        pending.command.proof.signer.kind !== "DEVICE" ||
        pending.command.proof.signer.keyId !== authorizationKeyId)
    ) {
      throw new Error("Personal vault pending update is inconsistent.");
    }
  }
  return {
    formatVersion: 2,
    ownerBinding,
    vaultId,
    authorizationKeyId,
    etag,
    highWater,
    snapshot,
    pending,
    updatedAt: record["updatedAt"],
  };
}

function commandOperationId(command: PendingVaultSyncCommandV2): string {
  return command.command.operationId;
}

function pendingVaultSyncSnapshot(command: PendingVaultSyncCommandV2): VaultSyncSnapshotV2 {
  return command.kind === "create" ? command.command.snapshot : command.command.nextSnapshot;
}

type RenewableVaultSyncCommandV2 = VaultCreateCommandV2 | VaultUpdatePayloadCommandV2;

function parseRenewableVaultSyncCommand(value: RenewableVaultSyncCommandV2): RenewableVaultSyncCommandV2 {
  return value.commandType === "CREATE_VAULT"
    ? VaultCreateCommandV2Schema.parse(value)
    : VaultUpdatePayloadCommandV2Schema.parse(value);
}

function immutableVaultSyncCommandIntent(command: RenewableVaultSyncCommandV2): string {
  return command.commandType === "CREATE_VAULT"
    ? JSON.stringify({
        formatVersion: command.formatVersion,
        commandType: command.commandType,
        ownerBinding: command.ownerBinding,
        vaultId: command.vaultId,
        operationId: command.operationId,
        snapshot: command.snapshot,
      })
    : JSON.stringify({
        formatVersion: command.formatVersion,
        commandType: command.commandType,
        ownerBinding: command.ownerBinding,
        vaultId: command.vaultId,
        operationId: command.operationId,
        expectedParentCommitHash: command.expectedParentCommitHash,
        nextSnapshot: command.nextSnapshot,
      });
}

/**
 * Pure compare-and-swap plan used by the IndexedDB transaction below. The
 * expected full command must still be the durable intent and the replacement
 * may change only its proof. Requiring a strictly newer lifetime prevents a
 * second tab from rolling the durable proof backwards.
 */
export function buildPersistedVaultSyncProofRenewalV2(
  persistedValue: PersistedVaultSyncV2,
  expectedCommandValue: RenewableVaultSyncCommandV2,
  renewedCommandValue: RenewableVaultSyncCommandV2,
  updatedAt = new Date().toISOString(),
): PersistedVaultSyncV2 {
  const persisted = validateSyncRecord(persistedValue);
  const expectedCommand = parseRenewableVaultSyncCommand(expectedCommandValue);
  const renewedCommand = parseRenewableVaultSyncCommand(renewedCommandValue);
  if (
    persisted.pending === null ||
    persisted.pending.command.commandType !== expectedCommand.commandType ||
    JSON.stringify(persisted.pending.command) !== JSON.stringify(expectedCommand) ||
    expectedCommand.commandType !== renewedCommand.commandType ||
    immutableVaultSyncCommandIntent(expectedCommand) !== immutableVaultSyncCommandIntent(renewedCommand) ||
    renewedCommand.proof.signer.kind !== "DEVICE" ||
    renewedCommand.proof.signer.keyId !== persisted.authorizationKeyId ||
    Date.parse(renewedCommand.proof.issuedAt) <= Date.parse(expectedCommand.proof.issuedAt) ||
    Date.parse(renewedCommand.proof.expiresAt) <= Date.parse(expectedCommand.proof.expiresAt)
  ) {
    throw new Error("Personal vault sync proof renewal no longer matches the durable intent.");
  }
  return validateSyncRecord({
    ...persisted,
    pending: {
      kind: persisted.pending.kind,
      command: renewedCommand,
    },
    updatedAt,
  });
}

function activeSyncRecord(
  prior: PersistedVaultSyncV2,
  etag: string,
  snapshotValue: unknown,
): PersistedVaultSyncV2 {
  const snapshot = VaultSyncSnapshotV2Schema.parse(snapshotValue);
  return validateSyncRecord({
    formatVersion: 2,
    ownerBinding: prior.ownerBinding,
    vaultId: prior.vaultId,
    authorizationKeyId: prior.authorizationKeyId,
    etag,
    highWater: {
      ownerBinding: snapshot.ownerBinding,
      vaultId: snapshot.vaultId,
      epoch: snapshot.commit.epoch,
      sequence: snapshot.commit.sequence,
      commitHash: snapshot.commitHash,
    },
    snapshot,
    pending: null,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Promotes only the exact staged successor. An operation id alone is not
 * sufficient: another valid encrypted successor can deliberately reuse it,
 * and accepting that response would violate the durable-intent boundary.
 */
export function buildPersistedVaultSyncCommitV2(
  persistedValue: PersistedVaultSyncV2,
  operationId: string,
  etag: string,
  snapshotValue: VaultSyncSnapshotV2,
): PersistedVaultSyncV2 {
  const persisted = validateSyncRecord(persistedValue);
  if (persisted.pending === null || commandOperationId(persisted.pending) !== operationId) {
    throw new Error("Personal vault sync operation is no longer pending.");
  }
  const expectedSnapshot = pendingVaultSyncSnapshot(persisted.pending);
  const next = activeSyncRecord(persisted, etag, snapshotValue);
  if (next.snapshot === null || JSON.stringify(next.snapshot) !== JSON.stringify(expectedSnapshot)) {
    throw new Error("Personal vault server result does not match the exact staged successor.");
  }
  return next;
}

function exactOrDirectVaultSuccessor(current: VaultSyncSnapshotV2, candidate: VaultSyncSnapshotV2): boolean {
  if (JSON.stringify(candidate) === JSON.stringify(current)) return true;
  return (
    candidate.ownerBinding === current.ownerBinding &&
    candidate.vaultId === current.vaultId &&
    candidate.commit.sequence === current.commit.sequence + 1 &&
    candidate.commit.parentCommitHash === current.commitHash &&
    (candidate.commit.epoch === current.commit.epoch || candidate.commit.epoch === current.commit.epoch + 1)
  );
}

/**
 * Transaction-local adoption guard. Crypto verification happens in the
 * Worker, but the IndexedDB CAS independently rejects skipped or forked
 * ancestry so a future caller cannot bypass the trusted high-water boundary.
 */
export function buildPersistedRemoteVaultAdoptionV2(
  persistedValue: PersistedVaultSyncV2,
  expectedCommitHash: string,
  etag: string,
  snapshotValue: VaultSyncSnapshotV2,
): PersistedVaultSyncV2 {
  const persisted = validateSyncRecord(persistedValue);
  const snapshot = VaultSyncSnapshotV2Schema.parse(snapshotValue);
  if (
    persisted.snapshot === null ||
    persisted.pending !== null ||
    persisted.snapshot.commitHash !== expectedCommitHash ||
    !exactOrDirectVaultSuccessor(persisted.snapshot, snapshot)
  ) {
    throw new Error("Personal vault remote head is not the current head or its direct successor.");
  }
  return activeSyncRecord(persisted, etag, snapshot);
}

export async function readPersistedVaultSyncV2(): Promise<PersistedVaultSyncV2 | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SYNC_STORE, "readonly");
    const value = await requestResult(transaction.objectStore(SYNC_STORE).get(ACTIVE_SYNC_KEY));
    await transactionDone(transaction);
    return value === undefined ? null : structuredClone(validateSyncRecord(value));
  } finally {
    database.close();
  }
}

/** Persist a signed, encrypted create command before its first network attempt. */
export async function beginPersistedVaultSyncV2(
  authorizationKeyId: string,
  command: VaultCreateCommandV2,
): Promise<PersistedVaultSyncV2> {
  const candidate = validateSyncRecord({
    formatVersion: 2,
    ownerBinding: command.ownerBinding,
    vaultId: command.vaultId,
    authorizationKeyId,
    etag: null,
    highWater: null,
    snapshot: null,
    pending: { kind: "create", command },
    updatedAt: new Date().toISOString(),
  });
  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, SYNC_STORE);
    const store = transaction.objectStore(SYNC_STORE);
    const existing = await requestResult(store.get(ACTIVE_SYNC_KEY));
    if (existing !== undefined) {
      const persisted = validateSyncRecord(existing);
      if (
        persisted.pending === null ||
        commandOperationId(persisted.pending) !== command.operationId ||
        JSON.stringify(persisted.pending.command) !== JSON.stringify(command)
      ) {
        transaction.abort();
        throw new Error("A different personal vault sync binding already exists.");
      }
      transaction.abort();
      return structuredClone(persisted);
    }
    store.put(candidate, ACTIVE_SYNC_KEY);
    await transactionDone(transaction);
    return structuredClone(candidate);
  } finally {
    database.close();
  }
}

/**
 * Binds an already-existing local vault to an account only if every encrypted
 * local record still matches the state whose recovery code and plaintext were
 * authenticated by the Worker. The signed create command is made durable in
 * that same transaction before its first upload.
 */
export async function beginExistingVaultSyncV2(
  expectedValue: PersistedVaultV1,
  authorizationKeyId: string,
  commandValue: VaultCreateCommandV2,
): Promise<PersistedVaultSyncV2> {
  const expected = validatePersistedRecord(
    expectedValue.meta,
    expectedValue.keyring,
    expectedValue.payload,
    expectedValue.trustedDevice,
  );
  const command = VaultCreateCommandV2Schema.parse(commandValue);
  const sync = validateSyncRecord({
    formatVersion: 2,
    ownerBinding: command.ownerBinding,
    vaultId: command.vaultId,
    authorizationKeyId,
    etag: null,
    highWater: null,
    snapshot: null,
    pending: { kind: "create", command },
    updatedAt: new Date().toISOString(),
  });
  if (
    expected.meta.vaultId !== command.vaultId ||
    command.snapshot.keyring.vaultKeyId !== expected.keyring.vaultKeyId ||
    JSON.stringify(command.snapshot.keyring) !== JSON.stringify(expected.keyring)
  ) {
    throw new Error("Local and account-bound vault genesis records differ.");
  }

  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, [
      META_STORE,
      KEYRING_STORE,
      PAYLOAD_STORE,
      DEVICE_STORE,
      SYNC_STORE,
    ]);
    const stores = {
      meta: transaction.objectStore(META_STORE),
      keyring: transaction.objectStore(KEYRING_STORE),
      payload: transaction.objectStore(PAYLOAD_STORE),
      device: transaction.objectStore(DEVICE_STORE),
      sync: transaction.objectStore(SYNC_STORE),
    };
    const [metaValue, keyringValue, payloadValue, deviceValue, syncValue] = await Promise.all([
      requestResult(stores.meta.get(ACTIVE_VAULT_META_KEY)),
      requestResult(stores.keyring.get(ACTIVE_KEYRING_KEY)),
      requestResult(stores.payload.get(ACTIVE_PAYLOAD_KEY)),
      requestResult(stores.device.get(ACTIVE_DEVICE_KEY)),
      requestResult(stores.sync.get(ACTIVE_SYNC_KEY)),
    ]);
    if (syncValue !== undefined || !isActiveMeta(metaValue) || !isTrustedDeviceRecord(deviceValue)) {
      transaction.abort();
      throw new Error("Personal vault changed before account sync was enabled.");
    }
    const current = validatePersistedRecord(metaValue, keyringValue, payloadValue, deviceValue);
    const localRecordsUnchanged =
      JSON.stringify(current.meta) === JSON.stringify(expected.meta) &&
      JSON.stringify(current.keyring) === JSON.stringify(expected.keyring) &&
      JSON.stringify(current.payload) === JSON.stringify(expected.payload) &&
      JSON.stringify(current.trustedDevice.publicKey) === JSON.stringify(expected.trustedDevice.publicKey) &&
      JSON.stringify(current.trustedDevice.envelope) === JSON.stringify(expected.trustedDevice.envelope);
    if (!localRecordsUnchanged) {
      transaction.abort();
      throw new Error("Personal vault changed before account sync was enabled.");
    }
    writeExistingVaultSyncDraftRecord(transaction, sync);
    await transactionDone(transaction);
    return structuredClone(sync);
  } finally {
    database.close();
  }
}

/** Stage an opaque signed update before sending it, making retries crash-safe. */
export async function stagePersistedVaultSyncUpdateV2(
  expectedEtag: string,
  command: VaultUpdatePayloadCommandV2,
): Promise<PersistedVaultSyncV2> {
  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, SYNC_STORE);
    const store = transaction.objectStore(SYNC_STORE);
    const existing = await requestResult(store.get(ACTIVE_SYNC_KEY));
    const persisted = validateSyncRecord(existing);
    if (
      persisted.snapshot === null ||
      persisted.etag !== expectedEtag ||
      persisted.pending !== null ||
      command.expectedParentCommitHash !== persisted.snapshot.commitHash
    ) {
      transaction.abort();
      throw new Error("Personal vault sync state changed before the update was staged.");
    }
    const next = validateSyncRecord({
      ...persisted,
      pending: { kind: "update", command },
      updatedAt: new Date().toISOString(),
    });
    store.put(next, ACTIVE_SYNC_KEY);
    await transactionDone(transaction);
    return structuredClone(next);
  } finally {
    database.close();
  }
}

/**
 * Atomically replaces only the proof on the exact durable create/update
 * intent. A concurrent commit, rebase or second renewal causes the
 * compare-and-swap to fail without overwriting the newer state.
 */
export async function renewPersistedVaultSyncCommandProofV2(
  expectedCommand: RenewableVaultSyncCommandV2,
  renewedCommand: RenewableVaultSyncCommandV2,
): Promise<PersistedVaultSyncV2> {
  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, SYNC_STORE);
    const store = transaction.objectStore(SYNC_STORE);
    const existing = await requestResult(store.get(ACTIVE_SYNC_KEY));
    let next: PersistedVaultSyncV2;
    try {
      next = buildPersistedVaultSyncProofRenewalV2(
        validateSyncRecord(existing),
        expectedCommand,
        renewedCommand,
      );
    } catch (error) {
      transaction.abort();
      throw error;
    }
    writeVaultSyncProofRenewalRecord(transaction, next);
    await transactionDone(transaction);
    return structuredClone(next);
  } finally {
    database.close();
  }
}

/** Promote exactly the pending idempotent operation to its authenticated server result. */
export async function commitPersistedVaultSyncV2(
  operationId: string,
  etag: string,
  snapshot: unknown,
): Promise<PersistedVaultSyncV2> {
  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, SYNC_STORE);
    const store = transaction.objectStore(SYNC_STORE);
    const existing = await requestResult(store.get(ACTIVE_SYNC_KEY));
    let next: PersistedVaultSyncV2;
    try {
      next = buildPersistedVaultSyncCommitV2(
        validateSyncRecord(existing),
        operationId,
        etag,
        VaultSyncSnapshotV2Schema.parse(snapshot),
      );
    } catch (error) {
      transaction.abort();
      throw error;
    }
    store.put(next, ACTIVE_SYNC_KEY);
    await transactionDone(transaction);
    return structuredClone(next);
  } finally {
    database.close();
  }
}

/** Adopt a newer client-authenticated remote head only when no local command is pending. */
export async function adoptPersistedRemoteVaultSyncV2(
  expectedCommitHash: string,
  etag: string,
  snapshot: VaultSyncSnapshotV2,
): Promise<PersistedVaultSyncV2> {
  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, SYNC_STORE);
    const store = transaction.objectStore(SYNC_STORE);
    const existing = await requestResult(store.get(ACTIVE_SYNC_KEY));
    let next: PersistedVaultSyncV2;
    try {
      next = buildPersistedRemoteVaultAdoptionV2(
        validateSyncRecord(existing),
        expectedCommitHash,
        etag,
        snapshot,
      );
    } catch (error) {
      transaction.abort();
      throw error;
    }
    store.put(next, ACTIVE_SYNC_KEY);
    await transactionDone(transaction);
    return structuredClone(next);
  } finally {
    database.close();
  }
}

/**
 * Atomically replaces a stale, already-durable update intent with a
 * client-authenticated remote base and a three-way-merged successor. The old
 * operation identifier is required so a second tab cannot rebase a different
 * command that happened to observe the same remote ETag.
 */
export async function rebasePersistedVaultSyncUpdateV2(
  staleOperationId: string,
  remoteEtag: string,
  remoteSnapshotValue: VaultSyncSnapshotV2,
  rebasedCommandValue: VaultUpdatePayloadCommandV2,
): Promise<PersistedVaultSyncV2> {
  const remoteSnapshot = VaultSyncSnapshotV2Schema.parse(remoteSnapshotValue);
  const rebasedCommand = VaultUpdatePayloadCommandV2Schema.parse(rebasedCommandValue);
  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, SYNC_STORE);
    const store = transaction.objectStore(SYNC_STORE);
    const existing = await requestResult(store.get(ACTIVE_SYNC_KEY));
    const persisted = validateSyncRecord(existing);
    if (
      persisted.snapshot === null ||
      persisted.highWater === null ||
      persisted.pending?.kind !== "update" ||
      persisted.pending.command.operationId !== staleOperationId ||
      classifyVerifiedPendingUpdateHead({
        base: persisted.snapshot,
        intended: persisted.pending.command.nextSnapshot,
        remote: remoteSnapshot,
      }) !== "payload-child" ||
      remoteSnapshot.ownerBinding !== persisted.ownerBinding ||
      remoteSnapshot.vaultId !== persisted.vaultId ||
      rebasedCommand.ownerBinding !== persisted.ownerBinding ||
      rebasedCommand.vaultId !== persisted.vaultId ||
      rebasedCommand.expectedParentCommitHash !== remoteSnapshot.commitHash ||
      rebasedCommand.proof.signer.kind !== "DEVICE" ||
      rebasedCommand.proof.signer.keyId !== persisted.authorizationKeyId
    ) {
      transaction.abort();
      throw new Error("Personal vault sync update could not be safely rebased.");
    }
    const rebased = validateSyncRecord({
      formatVersion: 2,
      ownerBinding: persisted.ownerBinding,
      vaultId: persisted.vaultId,
      authorizationKeyId: persisted.authorizationKeyId,
      etag: remoteEtag,
      highWater: {
        ownerBinding: remoteSnapshot.ownerBinding,
        vaultId: remoteSnapshot.vaultId,
        epoch: remoteSnapshot.commit.epoch,
        sequence: remoteSnapshot.commit.sequence,
        commitHash: remoteSnapshot.commitHash,
      },
      snapshot: remoteSnapshot,
      pending: { kind: "update", command: rebasedCommand },
      updatedAt: new Date().toISOString(),
    });
    store.put(rebased, ACTIVE_SYNC_KEY);
    await transactionDone(transaction);
    return structuredClone(rebased);
  } finally {
    database.close();
  }
}

async function atomicallyAdvanceSyncAndLocalPayload(
  expectedLocalRevision: number,
  payloadValue: EncryptedVaultPayloadEnvelopeV1,
  buildNextSync: (persisted: PersistedVaultSyncV2) => PersistedVaultSyncV2,
): Promise<PersistedVaultSyncV2> {
  const checkedPayload = EncryptedVaultPayloadEnvelopeV1Schema.parse(payloadValue);
  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, [
      META_STORE,
      KEYRING_STORE,
      PAYLOAD_STORE,
      DEVICE_STORE,
      SYNC_STORE,
    ]);
    const metaStore = transaction.objectStore(META_STORE);
    const keyringStore = transaction.objectStore(KEYRING_STORE);
    const payloadStore = transaction.objectStore(PAYLOAD_STORE);
    const deviceStore = transaction.objectStore(DEVICE_STORE);
    const syncStore = transaction.objectStore(SYNC_STORE);
    const [meta, keyring, payload, device, sync] = await Promise.all([
      requestResult(metaStore.get(ACTIVE_VAULT_META_KEY)),
      requestResult(keyringStore.get(ACTIVE_KEYRING_KEY)),
      requestResult(payloadStore.get(ACTIVE_PAYLOAD_KEY)),
      requestResult(deviceStore.get(ACTIVE_DEVICE_KEY)),
      requestResult(syncStore.get(ACTIVE_SYNC_KEY)),
    ]);
    let local: PersistedVaultV1;
    let persistedSync: PersistedVaultSyncV2;
    try {
      if (!isActiveMeta(meta) || !isTrustedDeviceRecord(device)) {
        throw new Error("Local vault metadata is invalid.");
      }
      local = validatePersistedRecord(meta, keyring, payload, device);
      persistedSync = validateSyncRecord(sync);
    } catch (error) {
      transaction.abort();
      throw error;
    }
    if (
      local.payload.revision !== expectedLocalRevision ||
      checkedPayload.baseRevision !== expectedLocalRevision ||
      checkedPayload.revision !== expectedLocalRevision + 1 ||
      checkedPayload.vaultId !== local.meta.vaultId ||
      checkedPayload.vaultKeyId !== local.keyring.vaultKeyId
    ) {
      transaction.abort();
      throw new Error("Local vault changed before the authenticated sync head could be adopted.");
    }
    let nextSync: PersistedVaultSyncV2;
    try {
      nextSync = validateSyncRecord(buildNextSync(persistedSync));
    } catch (error) {
      transaction.abort();
      throw error;
    }
    writeSyncAndPayloadRecords(transaction, checkedPayload, nextSync);
    await transactionDone(transaction);
    return structuredClone(nextSync);
  } finally {
    database.close();
  }
}

export async function commitPersistedVaultSyncAndPayloadV2(
  operationId: string,
  expectedLocalRevision: number,
  payload: EncryptedVaultPayloadEnvelopeV1,
  etag: string,
  snapshotValue: VaultSyncSnapshotV2,
): Promise<PersistedVaultSyncV2> {
  const snapshot = VaultSyncSnapshotV2Schema.parse(snapshotValue);
  return atomicallyAdvanceSyncAndLocalPayload(expectedLocalRevision, payload, (persisted) =>
    buildPersistedVaultSyncCommitV2(persisted, operationId, etag, snapshot),
  );
}

export async function adoptPersistedRemoteVaultSyncAndPayloadV2(
  expectedCommitHash: string,
  expectedLocalRevision: number,
  payload: EncryptedVaultPayloadEnvelopeV1,
  etag: string,
  snapshotValue: VaultSyncSnapshotV2,
): Promise<PersistedVaultSyncV2> {
  const snapshot = VaultSyncSnapshotV2Schema.parse(snapshotValue);
  return atomicallyAdvanceSyncAndLocalPayload(expectedLocalRevision, payload, (persisted) =>
    buildPersistedRemoteVaultAdoptionV2(persisted, expectedCommitHash, etag, snapshot),
  );
}

export async function rebasePersistedVaultSyncUpdateAndPayloadV2(
  staleOperationId: string,
  expectedLocalRevision: number,
  payload: EncryptedVaultPayloadEnvelopeV1,
  remoteEtag: string,
  remoteSnapshotValue: VaultSyncSnapshotV2,
  rebasedCommandValue: VaultUpdatePayloadCommandV2,
): Promise<PersistedVaultSyncV2> {
  const remoteSnapshot = VaultSyncSnapshotV2Schema.parse(remoteSnapshotValue);
  const rebasedCommand = VaultUpdatePayloadCommandV2Schema.parse(rebasedCommandValue);
  return atomicallyAdvanceSyncAndLocalPayload(expectedLocalRevision, payload, (persisted) => {
    if (
      persisted.snapshot === null ||
      persisted.highWater === null ||
      persisted.pending?.kind !== "update" ||
      persisted.pending.command.operationId !== staleOperationId ||
      classifyVerifiedPendingUpdateHead({
        base: persisted.snapshot,
        intended: persisted.pending.command.nextSnapshot,
        remote: remoteSnapshot,
      }) !== "payload-child" ||
      remoteSnapshot.ownerBinding !== persisted.ownerBinding ||
      remoteSnapshot.vaultId !== persisted.vaultId ||
      rebasedCommand.ownerBinding !== persisted.ownerBinding ||
      rebasedCommand.vaultId !== persisted.vaultId ||
      rebasedCommand.expectedParentCommitHash !== remoteSnapshot.commitHash ||
      rebasedCommand.proof.signer.kind !== "DEVICE" ||
      rebasedCommand.proof.signer.keyId !== persisted.authorizationKeyId
    ) {
      throw new Error("Personal vault sync update could not be safely rebased.");
    }
    return validateSyncRecord({
      formatVersion: 2,
      ownerBinding: persisted.ownerBinding,
      vaultId: persisted.vaultId,
      authorizationKeyId: persisted.authorizationKeyId,
      etag: remoteEtag,
      highWater: {
        ownerBinding: remoteSnapshot.ownerBinding,
        vaultId: remoteSnapshot.vaultId,
        epoch: remoteSnapshot.commit.epoch,
        sequence: remoteSnapshot.commit.sequence,
        commitHash: remoteSnapshot.commitHash,
      },
      snapshot: remoteSnapshot,
      pending: { kind: "update", command: rebasedCommand },
      updatedAt: new Date().toISOString(),
    });
  });
}

/** Establishes the active sync head after a newly approved device authenticates it. */
export async function initializePairedVaultSyncV2(
  authorizationKeyId: string,
  etag: string,
  snapshotValue: VaultSyncSnapshotV2,
): Promise<PersistedVaultSyncV2> {
  const snapshot = VaultSyncSnapshotV2Schema.parse(snapshotValue);
  const candidate = validateSyncRecord({
    formatVersion: 2,
    ownerBinding: snapshot.ownerBinding,
    vaultId: snapshot.vaultId,
    authorizationKeyId,
    etag,
    highWater: {
      ownerBinding: snapshot.ownerBinding,
      vaultId: snapshot.vaultId,
      epoch: snapshot.commit.epoch,
      sequence: snapshot.commit.sequence,
      commitHash: snapshot.commitHash,
    },
    snapshot,
    pending: null,
    updatedAt: new Date().toISOString(),
  });
  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, SYNC_STORE);
    const store = transaction.objectStore(SYNC_STORE);
    if ((await requestResult(store.get(ACTIVE_SYNC_KEY))) !== undefined) {
      transaction.abort();
      throw new Error("A personal vault sync binding already exists.");
    }
    store.put(candidate, ACTIVE_SYNC_KEY);
    await transactionDone(transaction);
    return structuredClone(candidate);
  } finally {
    database.close();
  }
}

function validatePendingPairing(value: unknown): PersistedPendingPairingV2 {
  const currentRecord = exactRecord(value, [
    "authorizationKeyId",
    "cancelOperationId",
    "expiresAt",
    "formatVersion",
    "ownerBinding",
    "pairingId",
    "request",
    "requestOperationId",
    "requestedAt",
    "trustedDevice",
    "vaultId",
  ]);
  // v3 records predate cancellation replay. They are normalized in memory and
  // become current on the next pairing write without discarding a live request.
  const legacyRecord = exactRecord(value, [
    "authorizationKeyId",
    "expiresAt",
    "formatVersion",
    "ownerBinding",
    "pairingId",
    "request",
    "requestOperationId",
    "requestedAt",
    "trustedDevice",
    "vaultId",
  ]);
  const record =
    currentRecord ?? (legacyRecord === null ? null : { ...legacyRecord, cancelOperationId: null });
  if (
    record?.["formatVersion"] !== 2 ||
    typeof record["ownerBinding"] !== "string" ||
    !OWNER_BINDING_PATTERN.test(record["ownerBinding"]) ||
    typeof record["vaultId"] !== "string" ||
    !UUID_PATTERN.test(record["vaultId"]) ||
    typeof record["authorizationKeyId"] !== "string" ||
    !UUID_PATTERN.test(record["authorizationKeyId"]) ||
    typeof record["requestOperationId"] !== "string" ||
    !UUID_PATTERN.test(record["requestOperationId"]) ||
    (record["cancelOperationId"] !== null &&
      (typeof record["cancelOperationId"] !== "string" || !UUID_PATTERN.test(record["cancelOperationId"]))) ||
    (record["pairingId"] !== null &&
      (typeof record["pairingId"] !== "string" || !UUID_PATTERN.test(record["pairingId"]))) ||
    !isCanonicalTime(record["requestedAt"]) ||
    !isCanonicalTime(record["expiresAt"]) ||
    !DevicePairingRequestV2Schema.safeParse(record["request"]).success ||
    Date.parse(record["expiresAt"]) <= Date.parse(record["requestedAt"]) ||
    !isTrustedDeviceRecord(record["trustedDevice"])
  ) {
    throw new Error("Pending personal vault pairing is invalid.");
  }
  const trustedDevice = record["trustedDevice"];
  const request = DevicePairingRequestV2Schema.parse(record["request"]);
  if (
    request.operationId !== record["requestOperationId"] ||
    request.ownerBinding !== record["ownerBinding"] ||
    request.vaultId !== record["vaultId"] ||
    request.expiresAt !== record["expiresAt"] ||
    request.issuedAt !== record["requestedAt"] ||
    request.requestingDevice.deviceId !== trustedDevice.publicKey.deviceId ||
    request.requestingDevice.authorizationKey.keyId !== record["authorizationKeyId"]
  ) {
    throw new Error("Pending personal vault pairing request is inconsistent.");
  }
  return {
    formatVersion: 2,
    ownerBinding: record["ownerBinding"],
    vaultId: record["vaultId"],
    authorizationKeyId: record["authorizationKeyId"],
    requestOperationId: record["requestOperationId"],
    cancelOperationId: record["cancelOperationId"],
    request,
    pairingId: record["pairingId"],
    requestedAt: record["requestedAt"],
    expiresAt: record["expiresAt"],
    trustedDevice,
  };
}

/** The origin-bound private key is durable before the pairing request is considered created. */
export async function persistPendingPairingV2(value: PersistedPendingPairingV2): Promise<void> {
  const checked = validatePendingPairing(value);
  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, PAIRING_STORE);
    const store = transaction.objectStore(PAIRING_STORE);
    const existing = await requestResult(store.get(ACTIVE_PAIRING_KEY));
    if (existing !== undefined) {
      const prior = validatePendingPairing(existing);
      if (
        prior.requestOperationId !== checked.requestOperationId ||
        JSON.stringify(prior.request) !== JSON.stringify(checked.request) ||
        prior.ownerBinding !== checked.ownerBinding ||
        prior.vaultId !== checked.vaultId ||
        prior.authorizationKeyId !== checked.authorizationKeyId ||
        prior.trustedDevice.publicKey.deviceId !== checked.trustedDevice.publicKey.deviceId ||
        prior.cancelOperationId !== checked.cancelOperationId ||
        (prior.pairingId !== null && checked.pairingId !== null && prior.pairingId !== checked.pairingId)
      ) {
        transaction.abort();
        throw new Error("A different personal vault pairing is already pending.");
      }
    }
    store.put(checked, ACTIVE_PAIRING_KEY);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

/**
 * Persists cancellation intent before DELETE. A retry must use the exact same
 * operation identifier; a second tab cannot replace an in-flight intent.
 */
export async function stagePendingPairingCancellationV2(
  expectedPairingId: string,
  cancelOperationId: string,
): Promise<PersistedPendingPairingV2> {
  if (!UUID_PATTERN.test(expectedPairingId) || !UUID_PATTERN.test(cancelOperationId)) {
    throw new Error("Personal vault pairing cancellation identifiers are invalid.");
  }
  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, PAIRING_STORE);
    const store = transaction.objectStore(PAIRING_STORE);
    const value = await requestResult(store.get(ACTIVE_PAIRING_KEY));
    const pending = validatePendingPairing(value);
    if (
      pending.pairingId !== expectedPairingId ||
      (pending.cancelOperationId !== null && pending.cancelOperationId !== cancelOperationId)
    ) {
      transaction.abort();
      throw new Error("Personal vault pairing changed before cancellation.");
    }
    if (pending.cancelOperationId !== null) {
      transaction.abort();
      return structuredClone(pending);
    }
    const staged = validatePendingPairing({ ...pending, cancelOperationId });
    writePendingPairingCancellationRecord(transaction, staged);
    await transactionDone(transaction);
    return structuredClone(staged);
  } finally {
    database.close();
  }
}

export function writePendingPairingCancellationRecord(
  transaction: IDBTransaction,
  pending: PersistedPendingPairingV2,
): void {
  try {
    transaction.objectStore(PAIRING_STORE).put(pending, ACTIVE_PAIRING_KEY);
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // Preserve the original write failure.
    }
    throw error;
  }
}

export async function readPendingPairingV2(): Promise<PersistedPendingPairingV2 | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PAIRING_STORE, "readonly");
    const value = await requestResult(transaction.objectStore(PAIRING_STORE).get(ACTIVE_PAIRING_KEY));
    await transactionDone(transaction);
    return value === undefined ? null : structuredClone(validatePendingPairing(value));
  } finally {
    database.close();
  }
}

export async function clearPendingPairingV2(
  expectedPairingId: string | null,
  expectedCancelOperationId?: string,
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, PAIRING_STORE);
    const store = transaction.objectStore(PAIRING_STORE);
    const value = await requestResult(store.get(ACTIVE_PAIRING_KEY));
    if (value === undefined) {
      transaction.abort();
      return;
    }
    const pending = validatePendingPairing(value);
    if (
      pending.pairingId !== expectedPairingId ||
      (expectedCancelOperationId !== undefined && pending.cancelOperationId !== expectedCancelOperationId)
    ) {
      transaction.abort();
      throw new Error("Personal vault pairing changed before cleanup.");
    }
    store.delete(ACTIVE_PAIRING_KEY);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

/**
 * Completes a consumed pairing without an observable half-state. A crash can
 * leave either the original pending record or the fully usable local+sync
 * vault, never local ciphertext that cannot be retried.
 */
export async function completePairedVaultSetupV2(
  expectedPairingId: string,
  record: PersistedVaultV1,
  authorizationKeyId: string,
  etag: string,
  snapshotValue: VaultSyncSnapshotV2,
): Promise<PersistedVaultSyncV2> {
  const checkedRecord = validatePersistedRecord(
    record.meta,
    record.keyring,
    record.payload,
    record.trustedDevice,
  );
  const snapshot = VaultSyncSnapshotV2Schema.parse(snapshotValue);
  const sync = validateSyncRecord({
    formatVersion: 2,
    ownerBinding: snapshot.ownerBinding,
    vaultId: snapshot.vaultId,
    authorizationKeyId,
    etag,
    highWater: {
      ownerBinding: snapshot.ownerBinding,
      vaultId: snapshot.vaultId,
      epoch: snapshot.commit.epoch,
      sequence: snapshot.commit.sequence,
      commitHash: snapshot.commitHash,
    },
    snapshot,
    pending: null,
    updatedAt: new Date().toISOString(),
  });
  if (
    checkedRecord.meta.vaultId !== snapshot.vaultId ||
    JSON.stringify(checkedRecord.keyring) !== JSON.stringify(snapshot.keyring)
  ) {
    throw new Error("Paired local vault does not match the authenticated remote snapshot.");
  }
  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, [
      META_STORE,
      KEYRING_STORE,
      PAYLOAD_STORE,
      DEVICE_STORE,
      SYNC_STORE,
      PAIRING_STORE,
    ]);
    const meta = transaction.objectStore(META_STORE);
    const keyring = transaction.objectStore(KEYRING_STORE);
    const payload = transaction.objectStore(PAYLOAD_STORE);
    const device = transaction.objectStore(DEVICE_STORE);
    const syncStore = transaction.objectStore(SYNC_STORE);
    const pairingStore = transaction.objectStore(PAIRING_STORE);
    const [metaValue, keyringValue, payloadValue, deviceValue, syncValue, pairingValue] = await Promise.all([
      requestResult(meta.get(ACTIVE_VAULT_META_KEY)),
      requestResult(keyring.get(ACTIVE_KEYRING_KEY)),
      requestResult(payload.get(ACTIVE_PAYLOAD_KEY)),
      requestResult(device.get(ACTIVE_DEVICE_KEY)),
      requestResult(syncStore.get(ACTIVE_SYNC_KEY)),
      requestResult(pairingStore.get(ACTIVE_PAIRING_KEY)),
    ]);
    const pending = validatePendingPairing(pairingValue);
    if (
      [metaValue, keyringValue, payloadValue, deviceValue, syncValue].some((value) => value !== undefined) ||
      pending.pairingId !== expectedPairingId ||
      pending.ownerBinding !== snapshot.ownerBinding ||
      pending.vaultId !== snapshot.vaultId ||
      pending.authorizationKeyId !== authorizationKeyId ||
      pending.trustedDevice.publicKey.deviceId !== checkedRecord.trustedDevice.publicKey.deviceId
    ) {
      transaction.abort();
      throw new Error("Paired vault completion precondition changed.");
    }
    writePairedVaultCompletionRecords(transaction, checkedRecord, sync);
    await transactionDone(transaction);
    return structuredClone(sync);
  } finally {
    database.close();
  }
}

function validateRemoteRecovery(value: unknown): PersistedRemoteRecoveryV2 {
  const pairing = exactRecord(value, [
    "approval",
    "authorizationKeyId",
    "baseEtag",
    "createdAt",
    "formatVersion",
    "localPayload",
    "ownerBinding",
    "pairingId",
    "recoveredVaultEnvelope",
    "request",
    "sourceSnapshot",
    "stage",
    "trustedDevice",
    "updatedAt",
    "vaultId",
  ]);
  if (pairing?.["formatVersion"] === 2 && pairing["stage"] === "pairing-pending") {
    const request = DevicePairingRequestV2Schema.parse(pairing["request"]);
    const approval = PairingApprovalRequestV2Schema.parse(pairing["approval"]);
    const sourceSnapshot = VaultSyncSnapshotV2Schema.parse(pairing["sourceSnapshot"]);
    const recoveredVaultEnvelope = DeviceKeyEnvelopeV1Schema.parse(pairing["recoveredVaultEnvelope"]);
    const localPayload = EncryptedVaultPayloadEnvelopeV1Schema.parse(pairing["localPayload"]);
    const trustedDevice = pairing["trustedDevice"];
    if (
      typeof pairing["ownerBinding"] !== "string" ||
      !OWNER_BINDING_PATTERN.test(pairing["ownerBinding"]) ||
      typeof pairing["vaultId"] !== "string" ||
      !UUID_PATTERN.test(pairing["vaultId"]) ||
      typeof pairing["baseEtag"] !== "string" ||
      !STRONG_ETAG_PATTERN.test(pairing["baseEtag"]) ||
      typeof pairing["authorizationKeyId"] !== "string" ||
      !UUID_PATTERN.test(pairing["authorizationKeyId"]) ||
      (pairing["pairingId"] !== null &&
        (typeof pairing["pairingId"] !== "string" || !UUID_PATTERN.test(pairing["pairingId"]))) ||
      !isCanonicalTime(pairing["createdAt"]) ||
      !isCanonicalTime(pairing["updatedAt"]) ||
      Date.parse(pairing["updatedAt"]) < Date.parse(pairing["createdAt"]) ||
      !isTrustedDeviceRecord(trustedDevice) ||
      sourceSnapshot.ownerBinding !== pairing["ownerBinding"] ||
      sourceSnapshot.vaultId !== pairing["vaultId"] ||
      pairing["baseEtag"] !== `"pv2:${sourceSnapshot.commitHash}"` ||
      request.ownerBinding !== pairing["ownerBinding"] ||
      request.vaultId !== pairing["vaultId"] ||
      request.requestingDevice.deviceId !== trustedDevice.publicKey.deviceId ||
      request.requestingDevice.authorizationKey.keyId !== pairing["authorizationKeyId"] ||
      approval.pairingCodeCommitment !== request.pairingCodeCommitment ||
      approval.command.ownerBinding !== pairing["ownerBinding"] ||
      approval.command.vaultId !== pairing["vaultId"] ||
      approval.command.expectedParentCommitHash !== sourceSnapshot.commitHash ||
      approval.command.pairedDevice.deviceId !== request.requestingDevice.deviceId ||
      JSON.stringify(approval.command.pairedDevice) !== JSON.stringify(request.requestingDevice) ||
      recoveredVaultEnvelope.vaultId !== pairing["vaultId"] ||
      recoveredVaultEnvelope.vaultKeyId !== sourceSnapshot.keyring.vaultKeyId ||
      recoveredVaultEnvelope.recipientDeviceId !== trustedDevice.publicKey.deviceId ||
      recoveredVaultEnvelope.recipientKeyId !== trustedDevice.publicKey.deviceKeyId ||
      recoveredVaultEnvelope.recipientPublicKeyFingerprint !== trustedDevice.publicKey.publicKeyFingerprint ||
      localPayload.vaultId !== pairing["vaultId"] ||
      localPayload.vaultKeyId !== sourceSnapshot.keyring.vaultKeyId ||
      localPayload.revision !== 1 ||
      localPayload.baseRevision !== null
    ) {
      throw new Error("Pending remote recovery pairing is invalid.");
    }
    return {
      formatVersion: 2,
      stage: "pairing-pending",
      ownerBinding: pairing["ownerBinding"],
      vaultId: pairing["vaultId"],
      baseEtag: pairing["baseEtag"],
      authorizationKeyId: pairing["authorizationKeyId"],
      request,
      approval,
      pairingId: pairing["pairingId"],
      trustedDevice,
      recoveredVaultEnvelope,
      sourceSnapshot,
      localPayload,
      createdAt: pairing["createdAt"],
      updatedAt: pairing["updatedAt"],
    };
  }

  const hardening = exactRecord(value, [
    "authorizationKeyId",
    "etag",
    "formatVersion",
    "ownerBinding",
    "pairedCommitHash",
    "replacementDeviceId",
    "stage",
    "updatedAt",
    "vaultId",
  ]);
  if (
    hardening?.["formatVersion"] === 2 &&
    hardening["stage"] === "hardening-required" &&
    typeof hardening["ownerBinding"] === "string" &&
    OWNER_BINDING_PATTERN.test(hardening["ownerBinding"]) &&
    typeof hardening["vaultId"] === "string" &&
    UUID_PATTERN.test(hardening["vaultId"]) &&
    typeof hardening["etag"] === "string" &&
    STRONG_ETAG_PATTERN.test(hardening["etag"]) &&
    typeof hardening["authorizationKeyId"] === "string" &&
    UUID_PATTERN.test(hardening["authorizationKeyId"]) &&
    typeof hardening["pairedCommitHash"] === "string" &&
    OWNER_BINDING_PATTERN.test(hardening["pairedCommitHash"]) &&
    hardening["etag"] === `"pv2:${hardening["pairedCommitHash"]}"` &&
    typeof hardening["replacementDeviceId"] === "string" &&
    UUID_PATTERN.test(hardening["replacementDeviceId"]) &&
    isCanonicalTime(hardening["updatedAt"])
  ) {
    return hardening as unknown as PersistedRemoteRecoveryHardeningV2;
  }

  const rotation = exactRecord(value, [
    "authorizationKeyId",
    "baseCommitHash",
    "baseEtag",
    "command",
    "confirmedAt",
    "formatVersion",
    "ownerBinding",
    "replacementDeviceId",
    "stage",
    "updatedAt",
    "vaultId",
  ]);
  if (rotation?.["formatVersion"] === 2 && rotation["stage"] === "rotation-pending") {
    const command = VaultRotateKeyCommandV2Schema.parse(rotation["command"]);
    if (
      typeof rotation["ownerBinding"] !== "string" ||
      !OWNER_BINDING_PATTERN.test(rotation["ownerBinding"]) ||
      typeof rotation["vaultId"] !== "string" ||
      !UUID_PATTERN.test(rotation["vaultId"]) ||
      typeof rotation["baseEtag"] !== "string" ||
      !STRONG_ETAG_PATTERN.test(rotation["baseEtag"]) ||
      typeof rotation["baseCommitHash"] !== "string" ||
      !OWNER_BINDING_PATTERN.test(rotation["baseCommitHash"]) ||
      rotation["baseEtag"] !== `"pv2:${rotation["baseCommitHash"]}"` ||
      typeof rotation["authorizationKeyId"] !== "string" ||
      !UUID_PATTERN.test(rotation["authorizationKeyId"]) ||
      typeof rotation["replacementDeviceId"] !== "string" ||
      !UUID_PATTERN.test(rotation["replacementDeviceId"]) ||
      !isCanonicalTime(rotation["confirmedAt"]) ||
      !isCanonicalTime(rotation["updatedAt"]) ||
      Date.parse(rotation["updatedAt"]) < Date.parse(rotation["confirmedAt"]) ||
      command.ownerBinding !== rotation["ownerBinding"] ||
      command.vaultId !== rotation["vaultId"] ||
      command.expectedParentCommitHash !== rotation["baseCommitHash"] ||
      command.reason !== "RECOVERY_ROTATED" ||
      command.proof.signer.kind !== "DEVICE" ||
      command.proof.signer.deviceId !== rotation["replacementDeviceId"] ||
      command.proof.signer.keyId !== rotation["authorizationKeyId"]
    ) {
      throw new Error("Pending remote recovery rotation is invalid.");
    }
    return {
      formatVersion: 2,
      stage: "rotation-pending",
      ownerBinding: rotation["ownerBinding"],
      vaultId: rotation["vaultId"],
      baseEtag: rotation["baseEtag"],
      authorizationKeyId: rotation["authorizationKeyId"],
      baseCommitHash: rotation["baseCommitHash"],
      replacementDeviceId: rotation["replacementDeviceId"],
      command,
      confirmedAt: rotation["confirmedAt"],
      updatedAt: rotation["updatedAt"],
    };
  }
  throw new Error("Remote recovery state is invalid.");
}

export async function readPersistedRemoteRecoveryV2(): Promise<PersistedRemoteRecoveryV2 | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(RECOVERY_STORE, "readonly");
    const value = await requestResult(transaction.objectStore(RECOVERY_STORE).get(ACTIVE_RECOVERY_KEY));
    await transactionDone(transaction);
    return value === undefined ? null : structuredClone(validateRemoteRecovery(value));
  } finally {
    database.close();
  }
}

/**
 * Persists the replacement private key and both signed pairing intents before
 * the first network mutation. No active vault or sync head is created here.
 */
export async function persistRemoteRecoveryPairingV2(
  value: PersistedRemoteRecoveryPairingV2,
): Promise<PersistedRemoteRecoveryPairingV2> {
  const checked = validateRemoteRecovery(value);
  if (checked.stage !== "pairing-pending") throw new Error("Expected a recovery pairing intent.");
  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, [
      META_STORE,
      KEYRING_STORE,
      PAYLOAD_STORE,
      DEVICE_STORE,
      SYNC_STORE,
      PAIRING_STORE,
      RECOVERY_STORE,
    ]);
    const existing = await Promise.all([
      requestResult(transaction.objectStore(META_STORE).get(ACTIVE_VAULT_META_KEY)),
      requestResult(transaction.objectStore(KEYRING_STORE).get(ACTIVE_KEYRING_KEY)),
      requestResult(transaction.objectStore(PAYLOAD_STORE).get(ACTIVE_PAYLOAD_KEY)),
      requestResult(transaction.objectStore(DEVICE_STORE).get(ACTIVE_DEVICE_KEY)),
      requestResult(transaction.objectStore(SYNC_STORE).get(ACTIVE_SYNC_KEY)),
      requestResult(transaction.objectStore(PAIRING_STORE).get(ACTIVE_PAIRING_KEY)),
      requestResult(transaction.objectStore(RECOVERY_STORE).get(ACTIVE_RECOVERY_KEY)),
    ]);
    if (existing.some((candidate) => candidate !== undefined)) {
      transaction.abort();
      throw new Error("A local vault or recovery is already present.");
    }
    writeRemoteRecoveryPairingIntentRecord(transaction, checked);
    await transactionDone(transaction);
    return structuredClone(checked);
  } finally {
    database.close();
  }
}

export async function persistRemoteRecoveryPairingIdV2(
  requestOperationId: string,
  pairingId: string,
): Promise<PersistedRemoteRecoveryPairingV2> {
  if (!UUID_PATTERN.test(requestOperationId) || !UUID_PATTERN.test(pairingId)) {
    throw new Error("Remote recovery pairing identifiers are invalid.");
  }
  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, RECOVERY_STORE);
    const store = transaction.objectStore(RECOVERY_STORE);
    const current = validateRemoteRecovery(await requestResult(store.get(ACTIVE_RECOVERY_KEY)));
    if (
      current.stage !== "pairing-pending" ||
      current.request.operationId !== requestOperationId ||
      (current.pairingId !== null && current.pairingId !== pairingId)
    ) {
      transaction.abort();
      throw new Error("Remote recovery pairing changed.");
    }
    if (current.pairingId !== null) {
      transaction.abort();
      return structuredClone(current);
    }
    const next = validateRemoteRecovery({
      ...current,
      pairingId,
      updatedAt: new Date().toISOString(),
    });
    if (next.stage !== "pairing-pending") throw new Error("Remote recovery pairing changed.");
    store.put(next, ACTIVE_RECOVERY_KEY);
    await transactionDone(transaction);
    return structuredClone(next);
  } finally {
    database.close();
  }
}

/**
 * Explicitly abandons only the pre-promotion recovery pairing. Active vault,
 * sync, normal pairing, hardening, and rotation records make this operation
 * fail closed. The requesting device key is discarded with the one recovery
 * record, so a later attempt must authenticate the old recovery code again.
 */
export async function abandonRemoteRecoveryPairingV2(expectedRequestOperationId: string): Promise<void> {
  if (!UUID_PATTERN.test(expectedRequestOperationId)) {
    throw new Error("Remote recovery pairing operation identifier is invalid.");
  }
  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, [
      META_STORE,
      KEYRING_STORE,
      PAYLOAD_STORE,
      DEVICE_STORE,
      SYNC_STORE,
      PAIRING_STORE,
      RECOVERY_STORE,
    ]);
    const stores = {
      meta: transaction.objectStore(META_STORE),
      keyring: transaction.objectStore(KEYRING_STORE),
      payload: transaction.objectStore(PAYLOAD_STORE),
      device: transaction.objectStore(DEVICE_STORE),
      sync: transaction.objectStore(SYNC_STORE),
      pairing: transaction.objectStore(PAIRING_STORE),
      recovery: transaction.objectStore(RECOVERY_STORE),
    };
    const [meta, keyring, payload, device, sync, pairing, recoveryValue] = await Promise.all([
      requestResult(stores.meta.get(ACTIVE_VAULT_META_KEY)),
      requestResult(stores.keyring.get(ACTIVE_KEYRING_KEY)),
      requestResult(stores.payload.get(ACTIVE_PAYLOAD_KEY)),
      requestResult(stores.device.get(ACTIVE_DEVICE_KEY)),
      requestResult(stores.sync.get(ACTIVE_SYNC_KEY)),
      requestResult(stores.pairing.get(ACTIVE_PAIRING_KEY)),
      requestResult(stores.recovery.get(ACTIVE_RECOVERY_KEY)),
    ]);
    const recovery = validateRemoteRecovery(recoveryValue);
    if (
      recovery.stage !== "pairing-pending" ||
      recovery.request.operationId !== expectedRequestOperationId ||
      [meta, keyring, payload, device, sync, pairing].some((candidate) => candidate !== undefined)
    ) {
      transaction.abort();
      throw new Error("Only an isolated remote recovery pairing may be abandoned.");
    }
    writeRemoteRecoveryPairingAbandonRecord(transaction);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

/**
 * Promotes a server-approved pairing into active local V1/V2 state and marks
 * it hardening-required in the same transaction. The pre-signed pending
 * snapshot alone can never reach this boundary.
 */
export async function completeRemoteRecoveryPairingV2(
  expectedPairingId: string,
  record: PersistedVaultV1,
  etag: string,
  approvedSnapshotValue: VaultSyncSnapshotV2,
): Promise<PersistedRemoteRecoveryHardeningV2> {
  if (!UUID_PATTERN.test(expectedPairingId)) throw new Error("Pairing identifier is invalid.");
  const checkedRecord = validatePersistedRecord(
    record.meta,
    record.keyring,
    record.payload,
    record.trustedDevice,
  );
  const approvedSnapshot = VaultSyncSnapshotV2Schema.parse(approvedSnapshotValue);
  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, [
      META_STORE,
      KEYRING_STORE,
      PAYLOAD_STORE,
      DEVICE_STORE,
      SYNC_STORE,
      RECOVERY_STORE,
    ]);
    const stores = {
      meta: transaction.objectStore(META_STORE),
      keyring: transaction.objectStore(KEYRING_STORE),
      payload: transaction.objectStore(PAYLOAD_STORE),
      device: transaction.objectStore(DEVICE_STORE),
      sync: transaction.objectStore(SYNC_STORE),
      recovery: transaction.objectStore(RECOVERY_STORE),
    };
    const [meta, keyring, payload, device, sync, recoveryValue] = await Promise.all([
      requestResult(stores.meta.get(ACTIVE_VAULT_META_KEY)),
      requestResult(stores.keyring.get(ACTIVE_KEYRING_KEY)),
      requestResult(stores.payload.get(ACTIVE_PAYLOAD_KEY)),
      requestResult(stores.device.get(ACTIVE_DEVICE_KEY)),
      requestResult(stores.sync.get(ACTIVE_SYNC_KEY)),
      requestResult(stores.recovery.get(ACTIVE_RECOVERY_KEY)),
    ]);
    const recovery = validateRemoteRecovery(recoveryValue);
    if (
      recovery.stage !== "pairing-pending" ||
      [meta, keyring, payload, device, sync].some((candidate) => candidate !== undefined) ||
      recovery.pairingId !== expectedPairingId ||
      etag !== `"pv2:${approvedSnapshot.commitHash}"` ||
      JSON.stringify(approvedSnapshot) !== JSON.stringify(recovery.approval.command.nextSnapshot) ||
      JSON.stringify(checkedRecord.keyring) !== JSON.stringify(approvedSnapshot.keyring) ||
      checkedRecord.meta.vaultId !== recovery.vaultId ||
      checkedRecord.trustedDevice.publicKey.deviceId !== recovery.trustedDevice.publicKey.deviceId
    ) {
      transaction.abort();
      throw new Error("Remote recovery pairing approval did not match its durable intent.");
    }
    const syncRecord = validateSyncRecord({
      formatVersion: 2,
      ownerBinding: recovery.ownerBinding,
      vaultId: recovery.vaultId,
      authorizationKeyId: recovery.authorizationKeyId,
      etag,
      highWater: {
        ownerBinding: approvedSnapshot.ownerBinding,
        vaultId: approvedSnapshot.vaultId,
        epoch: approvedSnapshot.commit.epoch,
        sequence: approvedSnapshot.commit.sequence,
        commitHash: approvedSnapshot.commitHash,
      },
      snapshot: approvedSnapshot,
      pending: null,
      updatedAt: new Date().toISOString(),
    });
    const hardening = validateRemoteRecovery({
      formatVersion: 2,
      stage: "hardening-required",
      ownerBinding: recovery.ownerBinding,
      vaultId: recovery.vaultId,
      etag,
      authorizationKeyId: recovery.authorizationKeyId,
      pairedCommitHash: approvedSnapshot.commitHash,
      replacementDeviceId: checkedRecord.trustedDevice.publicKey.deviceId,
      updatedAt: new Date().toISOString(),
    });
    if (hardening.stage !== "hardening-required") {
      transaction.abort();
      throw new Error("Remote recovery hardening state is invalid.");
    }
    writeRemoteRecoveryHardeningRecords(transaction, checkedRecord, syncRecord, hardening);
    await transactionDone(transaction);
    return structuredClone(hardening);
  } finally {
    database.close();
  }
}

/**
 * Confirmation durability boundary: the exact rotate command and every local
 * successor record become durable together before the first POST.
 */
export async function stageRemoteRecoveryRotationV2(
  expectedPairedCommitHash: string,
  nextRecord: PersistedVaultV1,
  commandValue: VaultRotateKeyCommandV2,
): Promise<PersistedRemoteRecoveryRotationV2> {
  const checkedNext = validatePersistedRecord(
    nextRecord.meta,
    nextRecord.keyring,
    nextRecord.payload,
    nextRecord.trustedDevice,
  );
  const command = VaultRotateKeyCommandV2Schema.parse(commandValue);
  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, [
      META_STORE,
      KEYRING_STORE,
      PAYLOAD_STORE,
      DEVICE_STORE,
      SYNC_STORE,
      RECOVERY_STORE,
    ]);
    const stores = {
      meta: transaction.objectStore(META_STORE),
      keyring: transaction.objectStore(KEYRING_STORE),
      payload: transaction.objectStore(PAYLOAD_STORE),
      device: transaction.objectStore(DEVICE_STORE),
      sync: transaction.objectStore(SYNC_STORE),
      recovery: transaction.objectStore(RECOVERY_STORE),
    };
    const [meta, keyring, payload, device, syncValue, recoveryValue] = await Promise.all([
      requestResult(stores.meta.get(ACTIVE_VAULT_META_KEY)),
      requestResult(stores.keyring.get(ACTIVE_KEYRING_KEY)),
      requestResult(stores.payload.get(ACTIVE_PAYLOAD_KEY)),
      requestResult(stores.device.get(ACTIVE_DEVICE_KEY)),
      requestResult(stores.sync.get(ACTIVE_SYNC_KEY)),
      requestResult(stores.recovery.get(ACTIVE_RECOVERY_KEY)),
    ]);
    if (!isActiveMeta(meta) || !isTrustedDeviceRecord(device)) {
      transaction.abort();
      throw new Error("Remote recovery local state is invalid.");
    }
    const currentLocal = validatePersistedRecord(meta, keyring, payload, device);
    const sync = validateSyncRecord(syncValue);
    const recovery = validateRemoteRecovery(recoveryValue);
    if (
      recovery.stage !== "hardening-required" ||
      recovery.pairedCommitHash !== expectedPairedCommitHash ||
      sync.snapshot === null ||
      sync.pending !== null ||
      sync.snapshot.commitHash !== expectedPairedCommitHash ||
      sync.etag !== recovery.etag ||
      command.expectedParentCommitHash !== expectedPairedCommitHash ||
      command.ownerBinding !== recovery.ownerBinding ||
      command.vaultId !== recovery.vaultId ||
      command.proof.signer.keyId !== recovery.authorizationKeyId ||
      command.proof.signer.deviceId !== recovery.replacementDeviceId ||
      checkedNext.meta.vaultId !== currentLocal.meta.vaultId ||
      checkedNext.trustedDevice.publicKey.deviceId !== recovery.replacementDeviceId ||
      JSON.stringify(checkedNext.trustedDevice.publicKey) !==
        JSON.stringify(currentLocal.trustedDevice.publicKey) ||
      JSON.stringify(checkedNext.trustedDevice.envelope) !==
        JSON.stringify(currentLocal.trustedDevice.envelope) ||
      JSON.stringify(checkedNext.keyring) !== JSON.stringify(command.nextSnapshot.keyring) ||
      checkedNext.payload.vaultKeyId !== command.nextSnapshot.keyring.vaultKeyId ||
      checkedNext.payload.baseRevision !== currentLocal.payload.revision ||
      checkedNext.payload.revision !== currentLocal.payload.revision + 1
    ) {
      transaction.abort();
      throw new Error("Remote recovery rotation precondition changed.");
    }
    const confirmedAt = new Date().toISOString();
    const pending = validateRemoteRecovery({
      formatVersion: 2,
      stage: "rotation-pending",
      ownerBinding: recovery.ownerBinding,
      vaultId: recovery.vaultId,
      baseEtag: recovery.etag,
      authorizationKeyId: recovery.authorizationKeyId,
      baseCommitHash: recovery.pairedCommitHash,
      replacementDeviceId: recovery.replacementDeviceId,
      command,
      confirmedAt,
      updatedAt: confirmedAt,
    });
    if (pending.stage !== "rotation-pending") {
      transaction.abort();
      throw new Error("Remote recovery rotation intent is invalid.");
    }
    writeRemoteRecoveryRotationStageRecords(
      transaction,
      checkedNext.keyring,
      checkedNext.payload,
      currentLocal.trustedDevice,
      pending,
    );
    await transactionDone(transaction);
    return structuredClone(pending);
  } finally {
    database.close();
  }
}

/**
 * Re-bases a confirmed recovery rotation only after the Worker proves that the
 * remote change preserved the old root key and authorization manifest. Normal
 * writes stay blocked, so the authenticated remote document is the sole new
 * plaintext input. The old command, new base, successor local payload, and
 * sync high-water change atomically.
 */
export async function rebaseRemoteRecoveryRotationV2(
  expectedOperationId: string,
  remoteEtag: string,
  remoteSnapshotValue: VaultSyncSnapshotV2,
  rebasedCommandValue: VaultRotateKeyCommandV2,
  nextLocalPayloadValue: EncryptedVaultPayloadEnvelopeV1,
): Promise<PersistedRemoteRecoveryRotationV2> {
  if (!UUID_PATTERN.test(expectedOperationId)) {
    throw new Error("Recovery rotation operation identifier is invalid.");
  }
  const remoteSnapshot = VaultSyncSnapshotV2Schema.parse(remoteSnapshotValue);
  const rebasedCommand = VaultRotateKeyCommandV2Schema.parse(rebasedCommandValue);
  const nextLocalPayload = EncryptedVaultPayloadEnvelopeV1Schema.parse(nextLocalPayloadValue);
  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, [
      META_STORE,
      KEYRING_STORE,
      PAYLOAD_STORE,
      DEVICE_STORE,
      SYNC_STORE,
      RECOVERY_STORE,
    ]);
    const stores = {
      meta: transaction.objectStore(META_STORE),
      keyring: transaction.objectStore(KEYRING_STORE),
      payload: transaction.objectStore(PAYLOAD_STORE),
      device: transaction.objectStore(DEVICE_STORE),
      sync: transaction.objectStore(SYNC_STORE),
      recovery: transaction.objectStore(RECOVERY_STORE),
    };
    const [meta, keyring, payload, device, syncValue, recoveryValue] = await Promise.all([
      requestResult(stores.meta.get(ACTIVE_VAULT_META_KEY)),
      requestResult(stores.keyring.get(ACTIVE_KEYRING_KEY)),
      requestResult(stores.payload.get(ACTIVE_PAYLOAD_KEY)),
      requestResult(stores.device.get(ACTIVE_DEVICE_KEY)),
      requestResult(stores.sync.get(ACTIVE_SYNC_KEY)),
      requestResult(stores.recovery.get(ACTIVE_RECOVERY_KEY)),
    ]);
    if (!isActiveMeta(meta) || !isTrustedDeviceRecord(device)) {
      transaction.abort();
      throw new Error("Recovery rotation local state is invalid.");
    }
    const local = validatePersistedRecord(meta, keyring, payload, device);
    const sync = validateSyncRecord(syncValue);
    const recovery = validateRemoteRecovery(recoveryValue);
    if (
      recovery.stage !== "rotation-pending" ||
      recovery.command.operationId !== expectedOperationId ||
      sync.snapshot === null ||
      sync.highWater === null ||
      sync.pending !== null ||
      sync.snapshot.commitHash !== recovery.baseCommitHash ||
      sync.etag !== recovery.baseEtag ||
      classifyVerifiedPendingUpdateHead({
        base: sync.snapshot,
        intended: recovery.command.nextSnapshot,
        remote: remoteSnapshot,
      }) !== "payload-child" ||
      remoteSnapshot.ownerBinding !== recovery.ownerBinding ||
      remoteSnapshot.vaultId !== recovery.vaultId ||
      remoteEtag !== `"pv2:${remoteSnapshot.commitHash}"` ||
      JSON.stringify(remoteSnapshot.keyring) !== JSON.stringify(sync.snapshot.keyring) ||
      JSON.stringify(remoteSnapshot.authorizationManifest) !==
        JSON.stringify(sync.snapshot.authorizationManifest) ||
      rebasedCommand.ownerBinding !== recovery.ownerBinding ||
      rebasedCommand.vaultId !== recovery.vaultId ||
      rebasedCommand.expectedParentCommitHash !== remoteSnapshot.commitHash ||
      rebasedCommand.proof.signer.keyId !== recovery.authorizationKeyId ||
      rebasedCommand.proof.signer.deviceId !== recovery.replacementDeviceId ||
      JSON.stringify(rebasedCommand.nextSnapshot.keyring) !== JSON.stringify(local.keyring) ||
      JSON.stringify(rebasedCommand.nextSnapshot.authorizationManifest.recoveryAuthorization) !==
        JSON.stringify(recovery.command.nextSnapshot.authorizationManifest.recoveryAuthorization) ||
      nextLocalPayload.vaultId !== local.meta.vaultId ||
      nextLocalPayload.vaultKeyId !== local.keyring.vaultKeyId ||
      nextLocalPayload.baseRevision !== local.payload.revision ||
      nextLocalPayload.revision !== local.payload.revision + 1
    ) {
      transaction.abort();
      throw new Error("Recovery rotation cannot be safely rebased.");
    }
    const nextSync = activeSyncRecord(sync, remoteEtag, remoteSnapshot);
    const nextRecovery = validateRemoteRecovery({
      ...recovery,
      baseEtag: remoteEtag,
      baseCommitHash: remoteSnapshot.commitHash,
      command: rebasedCommand,
      updatedAt: new Date().toISOString(),
    });
    if (nextRecovery.stage !== "rotation-pending") {
      transaction.abort();
      throw new Error("Rebased recovery rotation is invalid.");
    }
    writeRemoteRecoveryRotationRebaseRecords(transaction, nextLocalPayload, nextSync, nextRecovery);
    await transactionDone(transaction);
    return structuredClone(nextRecovery);
  } finally {
    database.close();
  }
}

export async function renewRemoteRecoveryRotationProofV2(
  staleOperationId: string,
  renewedCommandValue: VaultRotateKeyCommandV2,
): Promise<PersistedRemoteRecoveryRotationV2> {
  if (!UUID_PATTERN.test(staleOperationId)) {
    throw new Error("Recovery rotation operation identifier is invalid.");
  }
  const renewedCommand = VaultRotateKeyCommandV2Schema.parse(renewedCommandValue);
  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, RECOVERY_STORE);
    const store = transaction.objectStore(RECOVERY_STORE);
    const current = validateRemoteRecovery(await requestResult(store.get(ACTIVE_RECOVERY_KEY)));
    if (
      current.stage !== "rotation-pending" ||
      current.command.operationId !== staleOperationId ||
      renewedCommand.operationId !== staleOperationId
    ) {
      transaction.abort();
      throw new Error("Recovery rotation proof is no longer renewable.");
    }
    if (
      JSON.stringify({ ...current.command, proof: null }) !==
        JSON.stringify({ ...renewedCommand, proof: null }) ||
      renewedCommand.proof.signer.kind !== "DEVICE" ||
      renewedCommand.proof.signer.keyId !== current.authorizationKeyId ||
      renewedCommand.proof.signer.deviceId !== current.replacementDeviceId ||
      Date.parse(renewedCommand.proof.issuedAt) <= Date.parse(current.command.proof.issuedAt)
    ) {
      transaction.abort();
      throw new Error("Recovery rotation renewal changed its durable intent.");
    }
    const next = validateRemoteRecovery({
      ...current,
      command: renewedCommand,
      updatedAt: renewedCommand.proof.issuedAt,
    });
    if (next.stage !== "rotation-pending") {
      transaction.abort();
      throw new Error("Recovery rotation renewal is invalid.");
    }
    writeRemoteRecoveryRotationRenewalRecord(transaction, next);
    await transactionDone(transaction);
    return structuredClone(next);
  } finally {
    database.close();
  }
}

/**
 * Finalizes only a fresh replacement-device read-back of the exact staged
 * rotation head. The rotation response itself is insufficient.
 */
export async function commitRemoteRecoveryRotationV2(
  operationId: string,
  etag: string,
  readBackSnapshotValue: VaultSyncSnapshotV2,
): Promise<PersistedVaultSyncV2> {
  if (!UUID_PATTERN.test(operationId)) throw new Error("Rotation operation identifier is invalid.");
  const readBackSnapshot = VaultSyncSnapshotV2Schema.parse(readBackSnapshotValue);
  const database = await openDatabase();
  try {
    const transaction = createStrictReadwriteTransaction(database, [
      META_STORE,
      KEYRING_STORE,
      PAYLOAD_STORE,
      DEVICE_STORE,
      SYNC_STORE,
      RECOVERY_STORE,
    ]);
    const stores = {
      meta: transaction.objectStore(META_STORE),
      keyring: transaction.objectStore(KEYRING_STORE),
      payload: transaction.objectStore(PAYLOAD_STORE),
      device: transaction.objectStore(DEVICE_STORE),
      sync: transaction.objectStore(SYNC_STORE),
      recovery: transaction.objectStore(RECOVERY_STORE),
    };
    const [meta, keyring, payload, device, syncValue, recoveryValue] = await Promise.all([
      requestResult(stores.meta.get(ACTIVE_VAULT_META_KEY)),
      requestResult(stores.keyring.get(ACTIVE_KEYRING_KEY)),
      requestResult(stores.payload.get(ACTIVE_PAYLOAD_KEY)),
      requestResult(stores.device.get(ACTIVE_DEVICE_KEY)),
      requestResult(stores.sync.get(ACTIVE_SYNC_KEY)),
      requestResult(stores.recovery.get(ACTIVE_RECOVERY_KEY)),
    ]);
    if (!isActiveMeta(meta) || !isTrustedDeviceRecord(device)) {
      transaction.abort();
      throw new Error("Remote recovery local state is invalid.");
    }
    const local = validatePersistedRecord(meta, keyring, payload, device);
    const sync = validateSyncRecord(syncValue);
    const recovery = validateRemoteRecovery(recoveryValue);
    if (
      recovery.stage !== "rotation-pending" ||
      recovery.command.operationId !== operationId ||
      sync.snapshot === null ||
      sync.pending !== null ||
      sync.snapshot.commitHash !== recovery.baseCommitHash ||
      sync.etag !== recovery.baseEtag ||
      readBackSnapshot.commitHash !== recovery.command.nextSnapshot.commitHash ||
      JSON.stringify(readBackSnapshot) !== JSON.stringify(recovery.command.nextSnapshot) ||
      etag !== `"pv2:${readBackSnapshot.commitHash}"` ||
      JSON.stringify(local.keyring) !== JSON.stringify(recovery.command.nextSnapshot.keyring) ||
      local.payload.vaultKeyId !== readBackSnapshot.keyring.vaultKeyId ||
      local.trustedDevice.publicKey.deviceId !== recovery.replacementDeviceId
    ) {
      transaction.abort();
      throw new Error("Remote recovery rotation read-back did not match the staged intent.");
    }
    const nextSync = activeSyncRecord(sync, etag, readBackSnapshot);
    writeRemoteRecoveryRotationCommitRecords(transaction, nextSync);
    await transactionDone(transaction);
    return structuredClone(nextSync);
  } finally {
    database.close();
  }
}

export function createActiveVaultMeta(vaultId: string): ActiveVaultMetaV1 {
  return Object.freeze({ formatVersion: 1, vaultId, createdAt: new Date().toISOString() });
}
