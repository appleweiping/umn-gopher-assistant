/// <reference lib="webworker" />

import {
  createVaultCrypto,
  type DeviceKeyHandle,
  type EncryptedVaultPayloadEnvelopeV1,
  type VaultCrypto,
  type VaultKeyHandle,
  type VaultKeyringV1,
} from "@umn-gopher-assistant/crypto";
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
} from "../lib/personal-vault/protocol";
import {
  createActiveVaultMeta,
  createPersistedVault,
  probePersonalVaultStorage,
  readRecoverableVault,
  readPersistedVault,
  replacePayloadIfRevision,
  replaceTrustedDeviceIfRevision,
} from "../lib/personal-vault/idb";

const DEFAULT_TASKS = [
  { id: "reading-response", title: "Draft reading response", done: false },
  { id: "transit-check", title: "Review transit notes", done: false },
] as const;

const INITIAL_DOCUMENT_REVISION = 1;

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
}

let pendingSetup: PendingSetup | undefined;
let unlocked: UnlockedVault | undefined;
let queue = Promise.resolve();

function generateId(): string {
  return crypto.randomUUID();
}

function destroyPendingSetup(): void {
  if (pendingSetup === undefined) return;
  pendingSetup.deviceKey.destroy();
  pendingSetup.vaultKey.destroy();
  pendingSetup = undefined;
}

function destroyUnlocked(): void {
  if (unlocked === undefined) return;
  unlocked.deviceKey?.destroy();
  unlocked.vaultKey.destroy();
  unlocked = undefined;
}

function asVaultError(error: unknown): VaultRpcError {
  if (error instanceof Error && "code" in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (code === "AUTHENTICATION_FAILED") return { code: "AUTHENTICATION_FAILED" };
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

async function confirmSetup(): Promise<VaultSnapshot> {
  const setup = pendingSetup;
  if (setup === undefined) throw new Error("No pending setup.");
  const bytes = serializePersonalVaultDocument(setup.document);
  try {
    const payload = setup.crypto.encryptPayload({
      key: setup.vaultKey,
      plaintext: bytes,
      revision: INITIAL_DOCUMENT_REVISION,
      baseRevision: null,
    });
    const wrappingKey = await createBrowserDeviceWrappingKey();
    const deviceEnvelope = await sealBrowserDeviceKey({ deviceKey: setup.deviceKey, wrappingKey });
    await createPersistedVault({
      meta: createActiveVaultMeta(setup.vaultKey.vaultId),
      keyring: setup.keyring,
      payload,
      trustedDevice: {
        formatVersion: 1,
        publicKey: setup.deviceKey.publicKey,
        envelope: deviceEnvelope,
        wrappingKey,
      },
    });
    const readBack = await unlockPersistedVault();
    try {
      const expected = JSON.stringify(setup.document);
      const actual = JSON.stringify(readBack.document);
      if (expected !== actual || readBack.revision !== INITIAL_DOCUMENT_REVISION)
        throw new Error("Vault read-back verification failed.");
      // The pending creator handles are no longer needed after a durable,
      // independently reopened record verified the exact plaintext.
      setup.deviceKey.destroy();
      setup.vaultKey.destroy();
      pendingSetup = undefined;
      destroyUnlocked();
      unlocked = readBack;
      return snapshot(readBack);
    } catch (error) {
      readBack.deviceKey?.destroy();
      readBack.vaultKey.destroy();
      throw error;
    }
  } finally {
    bytes.fill(0);
    destroyPendingSetup();
  }
}

async function writeDocument(nextDocument: PersonalVaultDocumentV1): Promise<VaultSnapshot> {
  const state = unlocked;
  if (state === undefined) throw new Error("Vault is locked.");
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
      destroyUnlocked();
      const conflict = new Error("Concurrent vault modification.");
      Object.assign(conflict, { code: "CONFLICT" });
      throw conflict;
    }
    // Read the committed ciphertext back through the active key before any
    // caller receives a snapshot or deletes a legacy plaintext source.
    // A recovery-code session deliberately has no trusted-device record. Its
    // successful writes must still be read back from the recoverable encrypted
    // records; ordinary device unlocks get the same metadata validation here.
    const committed =
      state.deviceKey === undefined ? await readRecoverableVault() : await readPersistedVault();
    if (committed === null || committed.payload.revision !== envelope.revision) {
      throw new Error("Vault read-back verification failed.");
    }
    const verified = decodeDocument(state.crypto, state.vaultKey, committed.payload);
    if (JSON.stringify(verified) !== JSON.stringify(nextDocument)) {
      throw new Error("Vault read-back verification failed.");
    }
    state.revision = envelope.revision;
    state.document = verified;
    return snapshot(state);
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

async function handle(request: VaultRpcRequest): Promise<VaultRpcResponse> {
  try {
    switch (request.method) {
      case "inspect": {
        await probePersonalVaultStorage();
        // A lost origin-bound trusted-device key must not make the encrypted
        // keyring/payload look like an unsupported browser. `unlock` will
        // correctly fail closed, while the UI retains its recovery-code path.
        const record = await readRecoverableVault();
        return { id: request.id, ok: true, method: "inspect", hasVault: record !== null };
      }
      case "begin-setup": {
        const result = await beginSetup(request.source, request.legacyRaw);
        return { id: request.id, ok: true, method: "begin-setup", ...result };
      }
      case "confirm-setup":
        return { id: request.id, ok: true, method: "confirm-setup", snapshot: await confirmSetup() };
      case "cancel-setup":
        destroyPendingSetup();
        return { id: request.id, ok: true, method: "cancel-setup" };
      case "unlock": {
        destroyUnlocked();
        unlocked = await unlockPersistedVault();
        return { id: request.id, ok: true, method: "unlock", snapshot: snapshot(unlocked) };
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
        let readBack: UnlockedVault | undefined;
        try {
          const document = decodeDocument(cryptoFacade, vaultKey, record.payload);
          // Recovery repairs the origin-bound local access path before any
          // plaintext is published. This remains a single-device local vault:
          // one new device envelope replaces an unreachable prior envelope.
          replacementDevice = cryptoFacade.generateDeviceKey({ deviceId: generateId() });
          const wrappingKey = await createBrowserDeviceWrappingKey();
          const localEnvelope = await sealBrowserDeviceKey({ deviceKey: replacementDevice, wrappingKey });
          const deviceEnvelope = cryptoFacade.wrapVaultKeyForDevice({
            key: vaultKey,
            recipient: replacementDevice.publicKey,
          });
          if (record.keyring.revision === Number.MAX_SAFE_INTEGER) {
            throw new Error("Trusted-device keyring revision cannot advance.");
          }
          const rebuiltKeyring: VaultKeyringV1 = {
            ...record.keyring,
            deviceEnvelopes: [deviceEnvelope],
            revision: record.keyring.revision + 1,
            // Keyring schema requires a newly created envelope not to follow
            // its update timestamp. Preserve monotonicity even after a local
            // system-clock rollback.
            updatedAt: new Date(Math.max(Date.now(), Date.parse(record.keyring.updatedAt))).toISOString(),
          };
          const persisted = await replaceTrustedDeviceIfRevision(
            record.payload.revision,
            record.keyring,
            rebuiltKeyring,
            {
              formatVersion: 1,
              publicKey: replacementDevice.publicKey,
              envelope: localEnvelope,
              wrappingKey,
            },
          );
          if (!persisted) throw new Error("Vault changed while rebuilding the trusted device.");

          // Independently open the atomic replacement through the ordinary
          // device route and compare plaintext before returning a snapshot.
          readBack = await unlockPersistedVault();
          if (
            readBack.revision !== record.payload.revision ||
            JSON.stringify(readBack.document) !== JSON.stringify(document)
          ) {
            throw new Error("Trusted-device recovery read-back verification failed.");
          }
          unlocked = readBack;
          readBack = undefined;
          return { id: request.id, ok: true, method: "recover", snapshot: snapshot(unlocked) };
        } finally {
          vaultKey.destroy();
          replacementDevice?.destroy();
          if (readBack !== undefined) {
            readBack.deviceKey?.destroy();
            readBack.vaultKey.destroy();
          }
        }
      }
      case "lock":
        destroyPendingSetup();
        destroyUnlocked();
        return { id: request.id, ok: true, method: "lock" };
      case "add-task": {
        const state = unlocked;
        if (state === undefined) throw new Error("Vault is locked.");
        const title = request.title.trim();
        if (title.length === 0) throw new Error("Task title is required.");
        return {
          id: request.id,
          ok: true,
          method: "add-task",
          snapshot: await writeDocument(
            createTaskDocument([
              ...state.document.tasks,
              { id: `local-${generateId()}`, title, done: false },
            ]),
          ),
        };
      }
      case "toggle-task": {
        const state = unlocked;
        if (state === undefined) throw new Error("Vault is locked.");
        const found = state.document.tasks.some((task) => task.id === request.taskId);
        if (!found) throw new Error("Unknown task.");
        return {
          id: request.id,
          ok: true,
          method: "toggle-task",
          snapshot: await writeDocument(
            createTaskDocument(
              state.document.tasks.map((task) =>
                task.id === request.taskId ? { ...task, done: !task.done } : task,
              ),
            ),
          ),
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
        };
      }
    }
  } catch (error) {
    const customCode =
      error instanceof Error && "code" in error ? (error as { readonly code?: unknown }).code : undefined;
    if (customCode === "CONFLICT") return { id: request.id, ok: false, error: { code: "CONFLICT" } };
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
