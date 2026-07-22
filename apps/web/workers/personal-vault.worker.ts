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
  planDeviceRecipientRotation,
  probePersonalVaultStorage,
  readRecoverableVault,
  readPersistedVault,
  replacePayloadIfRevision,
  replaceVaultAfterRotationIfRevision,
} from "../lib/personal-vault/idb";
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
let unlocked: UnlockedVault | undefined;
let queue = Promise.resolve();

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

async function writeMutation(mutation: VaultMutation): Promise<VaultSnapshot> {
  const state = unlocked;
  if (state === undefined) throw new Error("Vault is locked.");
  for (let attempt = 1; attempt <= MAX_MUTATION_ATTEMPTS; attempt += 1) {
    const nextDocument = applyMutation(state.document, mutation);
    if (nextDocument === state.document) return snapshot(state);
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
  throw new Error("Unreachable vault mutation state.");
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
          unlocked = readBack;
          readBack = undefined;
          return { id: request.id, ok: true, method: "recover", snapshot: snapshot(unlocked) };
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
          snapshot: await writeMutation({
            kind: "add-task",
            task: { id: `local-${generateId()}`, title, done: false },
          }),
        };
      }
      case "toggle-task": {
        const state = unlocked;
        if (state === undefined) throw new Error("Vault is locked.");
        const task = state.document.tasks.find((candidate) => candidate.id === request.taskId);
        if (task === undefined) throw new Error("Unknown task.");
        return {
          id: request.id,
          ok: true,
          method: "toggle-task",
          snapshot: await writeMutation({
            kind: "set-task-done",
            taskId: request.taskId,
            done: !task.done,
          }),
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
    if (customCode === "UNAVAILABLE") {
      destroyPendingSetup();
      destroyUnlocked();
      return { id: request.id, ok: false, error: { code: "UNAVAILABLE" } };
    }
    if (customCode === "CONFLICT") return { id: request.id, ok: false, error: { code: "CONFLICT" } };
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
