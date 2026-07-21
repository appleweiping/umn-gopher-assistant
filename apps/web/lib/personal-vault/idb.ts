import type {
  DevicePublicKeyV1,
  EncryptedVaultPayloadEnvelopeV1,
  VaultKeyringV1,
} from "@umn-gopher-assistant/crypto";
import type { BrowserDeviceKeyEnvelopeV1 } from "@umn-gopher-assistant/crypto/browser";
import { assertBrowserDeviceWrappingKey } from "@umn-gopher-assistant/crypto/browser";
import {
  DevicePublicKeyV1Schema,
  EncryptedVaultPayloadEnvelopeV1Schema,
  VaultKeyringV1Schema,
} from "@umn-gopher-assistant/contracts";

export const PERSONAL_VAULT_DB_NAME = "uga.personal-vault";
const PERSONAL_VAULT_DB_VERSION = 1;

const META_STORE = "meta";
const KEYRING_STORE = "keyring";
const PAYLOAD_STORE = "payload";
const DEVICE_STORE = "trusted-device";

const ACTIVE_VAULT_META_KEY = "active-vault";
const ACTIVE_KEYRING_KEY = "active-keyring";
const ACTIVE_PAYLOAD_KEY = "active-payload";
const ACTIVE_DEVICE_KEY = "active-device";

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
}

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

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PERSONAL_VAULT_DB_NAME, PERSONAL_VAULT_DB_VERSION);
    request.addEventListener(
      "upgradeneeded",
      () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE);
        if (!database.objectStoreNames.contains(KEYRING_STORE)) database.createObjectStore(KEYRING_STORE);
        if (!database.objectStoreNames.contains(PAYLOAD_STORE)) database.createObjectStore(PAYLOAD_STORE);
        if (!database.objectStoreNames.contains(DEVICE_STORE)) database.createObjectStore(DEVICE_STORE);
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("Unable to open IndexedDB.")), {
      once: true,
    });
    request.addEventListener("blocked", () => reject(new Error("IndexedDB upgrade is blocked.")), {
      once: true,
    });
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
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(record["vaultId"]) &&
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
    trustedDevice.envelope.publicKeyFingerprint !== checkedPublicKey.publicKeyFingerprint
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

function validateRecoverableRecord(meta: unknown, keyring: unknown, payload: unknown): RecoverableVaultV1 {
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
  return { meta, keyring: checkedKeyring, payload: checkedPayload };
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
    const transaction = database.transaction(META_STORE, "readwrite");
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
    const transaction = database.transaction([META_STORE, KEYRING_STORE, PAYLOAD_STORE], "readonly");
    const records: readonly unknown[] = await Promise.all([
      requestResult(transaction.objectStore(META_STORE).get(ACTIVE_VAULT_META_KEY)),
      requestResult(transaction.objectStore(KEYRING_STORE).get(ACTIVE_KEYRING_KEY)),
      requestResult(transaction.objectStore(PAYLOAD_STORE).get(ACTIVE_PAYLOAD_KEY)),
    ]);
    const [meta, keyring, payload] = records;
    await transactionDone(transaction);
    if (meta === undefined && keyring === undefined && payload === undefined) return null;
    return validateRecoverableRecord(meta, keyring, payload);
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
    const transaction = database.transaction(
      [META_STORE, KEYRING_STORE, PAYLOAD_STORE, DEVICE_STORE],
      "readwrite",
    );
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
    metaStore.put(checkedRecord.meta, ACTIVE_VAULT_META_KEY);
    transaction.objectStore(KEYRING_STORE).put(checkedRecord.keyring, ACTIVE_KEYRING_KEY);
    transaction.objectStore(PAYLOAD_STORE).put(checkedRecord.payload, ACTIVE_PAYLOAD_KEY);
    transaction.objectStore(DEVICE_STORE).put(checkedRecord.trustedDevice, ACTIVE_DEVICE_KEY);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

/**
 * Atomically installs a freshly sealed local trusted-device record after a
 * successful recovery-code unlock. The recovery envelope and payload stay
 * unchanged; the keyring receives one new device envelope and increments its
 * own revision in the same transaction as the origin-bound device record. A
 * full prior-keyring compare prevents one recovery session from replacing
 * newer vault state.
 */
export async function replaceTrustedDeviceIfRevision(
  expectedPayloadRevision: number,
  expectedKeyring: VaultKeyringV1,
  keyring: VaultKeyringV1,
  trustedDevice: TrustedDeviceRecordV1,
): Promise<boolean> {
  if (!isTrustedDeviceRecord(trustedDevice)) {
    throw new Error("Trusted-device record is invalid.");
  }
  const checkedExpectedKeyring = VaultKeyringV1Schema.parse(expectedKeyring);
  const checkedKeyring = VaultKeyringV1Schema.parse(keyring);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [META_STORE, KEYRING_STORE, PAYLOAD_STORE, DEVICE_STORE],
      "readwrite",
    );
    const [meta, persistedKeyring, payload] = await Promise.all([
      requestResult(transaction.objectStore(META_STORE).get(ACTIVE_VAULT_META_KEY)),
      requestResult(transaction.objectStore(KEYRING_STORE).get(ACTIVE_KEYRING_KEY)),
      requestResult(transaction.objectStore(PAYLOAD_STORE).get(ACTIVE_PAYLOAD_KEY)),
    ]);
    let recoverable: RecoverableVaultV1;
    try {
      recoverable = validateRecoverableRecord(meta, persistedKeyring, payload);
    } catch {
      transaction.abort();
      return false;
    }
    if (recoverable.payload.revision !== expectedPayloadRevision) {
      transaction.abort();
      return false;
    }
    // The payload revision does not advance while rebuilding a device record.
    // Compare the full authenticated prior keyring to prevent two concurrent
    // recovery sessions from silently replacing each other's device repair.
    if (JSON.stringify(recoverable.keyring) !== JSON.stringify(checkedExpectedKeyring)) {
      transaction.abort();
      return false;
    }
    if (
      checkedKeyring.vaultId !== recoverable.keyring.vaultId ||
      checkedKeyring.vaultKeyId !== recoverable.keyring.vaultKeyId ||
      checkedKeyring.revision !== recoverable.keyring.revision + 1 ||
      checkedKeyring.createdAt !== recoverable.keyring.createdAt ||
      Date.parse(checkedKeyring.updatedAt) < Date.parse(recoverable.keyring.updatedAt) ||
      JSON.stringify(checkedKeyring.recoveryEnvelope) !== JSON.stringify(recoverable.keyring.recoveryEnvelope)
    ) {
      transaction.abort();
      return false;
    }
    const deviceEnvelope = checkedKeyring.deviceEnvelopes.find(
      (candidate) =>
        candidate.recipientDeviceId === trustedDevice.publicKey.deviceId &&
        candidate.recipientKeyId === trustedDevice.publicKey.deviceKeyId &&
        candidate.recipientPublicKeyFingerprint === trustedDevice.publicKey.publicKeyFingerprint,
    );
    if (deviceEnvelope === undefined) {
      transaction.abort();
      return false;
    }
    transaction.objectStore(KEYRING_STORE).put(checkedKeyring, ACTIVE_KEYRING_KEY);
    transaction.objectStore(DEVICE_STORE).put(trustedDevice, ACTIVE_DEVICE_KEY);
    await transactionDone(transaction);
    return true;
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
    const transaction = database.transaction(
      [META_STORE, KEYRING_STORE, PAYLOAD_STORE, DEVICE_STORE],
      "readwrite",
    );
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
    try {
      validatePersistedRecord(meta, keyring, currentValue, trustedDevice);
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
      checkedPayload.revision !== expectedRevision + 1
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

export function createActiveVaultMeta(vaultId: string): ActiveVaultMetaV1 {
  return Object.freeze({ formatVersion: 1, vaultId, createdAt: new Date().toISOString() });
}
