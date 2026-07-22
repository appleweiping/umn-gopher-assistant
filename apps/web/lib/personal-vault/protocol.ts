/**
 * The only plaintext shape accepted by the local personal vault.  This module
 * is deliberately dependency-free so the same strict parser runs before a
 * legacy value enters the worker and after encrypted payloads leave it.
 */

export const LEGACY_TASK_STORAGE_KEY = "uga.tasks";
export const PERSONAL_VAULT_DOCUMENT_FORMAT = 1 as const;
export const PERSONAL_VAULT_MAX_TASKS = 2_000;
export const PERSONAL_VAULT_MAX_TASK_TITLE_LENGTH = 512;
export const PERSONAL_VAULT_MAX_DOCUMENT_BYTES = 1_024 * 1_024;
export const PERSONAL_VAULT_MAX_RECOVERY_CODE_LENGTH = 128;

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

export interface VaultTaskView {
  readonly id: string;
  readonly title: string;
  readonly done: boolean;
}

export interface PersonalVaultDocumentV1 {
  readonly formatVersion: typeof PERSONAL_VAULT_DOCUMENT_FORMAT;
  readonly tasks: readonly VaultTaskView[];
}

export interface VaultSnapshot {
  readonly revision: number;
  readonly tasks: readonly VaultTaskView[];
}

export type SetupSource = "empty" | "legacy" | "seed";

export interface VaultRpcError {
  readonly code:
    | "AUTHENTICATION_FAILED"
    | "CONFLICT"
    | "DEVICE_ENVELOPE_LIMIT_REACHED"
    | "INVALID_LEGACY"
    | "NOT_READY"
    | "STORAGE_FAILED"
    | "UNAVAILABLE";
}

export type VaultRpcRequest =
  | { readonly id: string; readonly method: "inspect" }
  | {
      readonly id: string;
      readonly method: "begin-setup";
      readonly source: SetupSource;
      readonly legacyRaw: string | null;
    }
  | { readonly id: string; readonly method: "confirm-setup" }
  | { readonly id: string; readonly method: "cancel-setup" }
  | { readonly id: string; readonly method: "unlock" }
  | {
      readonly id: string;
      readonly method: "recover";
      readonly recoveryCode: string;
      readonly allowOldestDeviceRevocation: boolean;
    }
  | { readonly id: string; readonly method: "lock" }
  | { readonly id: string; readonly method: "add-task"; readonly title: string }
  | { readonly id: string; readonly method: "toggle-task"; readonly taskId: string }
  | { readonly id: string; readonly method: "import-legacy"; readonly legacyRaw: string };

export type VaultRpcSuccess =
  | {
      readonly id: string;
      readonly ok: true;
      readonly method: "inspect";
      readonly hasVault: boolean;
    }
  | {
      readonly id: string;
      readonly ok: true;
      readonly method: "begin-setup";
      readonly recoveryCode: string;
      readonly source: SetupSource;
    }
  | {
      readonly id: string;
      readonly ok: true;
      readonly method: "confirm-setup" | "unlock" | "recover" | "add-task" | "toggle-task" | "import-legacy";
      readonly snapshot: VaultSnapshot;
    }
  | { readonly id: string; readonly ok: true; readonly method: "cancel-setup" | "lock" };

export interface VaultRpcFailure {
  readonly id: string;
  readonly ok: false;
  readonly error: VaultRpcError;
}

export type VaultRpcResponse = VaultRpcSuccess | VaultRpcFailure;

const MAX_RPC_ID_LENGTH = 128;
const VAULT_RPC_ERROR_CODES = new Set<VaultRpcError["code"]>([
  "AUTHENTICATION_FAILED",
  "CONFLICT",
  "DEVICE_ENVELOPE_LIMIT_REACHED",
  "INVALID_LEGACY",
  "NOT_READY",
  "STORAGE_FAILED",
  "UNAVAILABLE",
]);

/**
 * Strictly accepts the page-to-Worker protocol before any vault operation is
 * queued. This is intentionally structural only: task and recovery semantic
 * validation remains inside the Worker operation that owns the key handles.
 */
export function parseVaultRpcRequest(value: unknown): VaultRpcRequest | null {
  if (!isPlainRecord(value)) return null;
  const id = ownValue(value, "id");
  const method = ownValue(value, "method");
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    id.length > MAX_RPC_ID_LENGTH ||
    typeof method !== "string"
  ) {
    return null;
  }
  const base = { id } as const;
  switch (method) {
    case "inspect":
    case "confirm-setup":
    case "cancel-setup":
    case "unlock":
    case "lock":
      return hasExactKeys(value, ["id", "method"]) ? { ...base, method } : null;
    case "begin-setup": {
      if (!hasExactKeys(value, ["id", "legacyRaw", "method", "source"])) return null;
      const source = ownValue(value, "source");
      const legacyRaw = ownValue(value, "legacyRaw");
      if (
        (source !== "empty" && source !== "legacy" && source !== "seed") ||
        (legacyRaw !== null &&
          (typeof legacyRaw !== "string" || legacyRaw.length > PERSONAL_VAULT_MAX_DOCUMENT_BYTES)) ||
        (source === "legacy" && typeof legacyRaw !== "string")
      )
        return null;
      return { ...base, method, source, legacyRaw };
    }
    case "recover": {
      if (!hasExactKeys(value, ["allowOldestDeviceRevocation", "id", "method", "recoveryCode"])) return null;
      const allowOldestDeviceRevocation = ownValue(value, "allowOldestDeviceRevocation");
      const recoveryCode = ownValue(value, "recoveryCode");
      return typeof recoveryCode === "string" &&
        recoveryCode.length <= PERSONAL_VAULT_MAX_RECOVERY_CODE_LENGTH &&
        typeof allowOldestDeviceRevocation === "boolean"
        ? { ...base, method, recoveryCode, allowOldestDeviceRevocation }
        : null;
    }
    case "add-task": {
      if (!hasExactKeys(value, ["id", "method", "title"])) return null;
      const title = ownValue(value, "title");
      return typeof title === "string" && title.length <= PERSONAL_VAULT_MAX_TASK_TITLE_LENGTH
        ? { ...base, method, title }
        : null;
    }
    case "toggle-task": {
      if (!hasExactKeys(value, ["id", "method", "taskId"])) return null;
      const taskId = ownValue(value, "taskId");
      return typeof taskId === "string" && taskId.length <= 128 ? { ...base, method, taskId } : null;
    }
    case "import-legacy": {
      if (!hasExactKeys(value, ["id", "legacyRaw", "method"])) return null;
      const legacyRaw = ownValue(value, "legacyRaw");
      return typeof legacyRaw === "string" && legacyRaw.length <= PERSONAL_VAULT_MAX_DOCUMENT_BYTES
        ? { ...base, method, legacyRaw }
        : null;
    }
    default:
      return null;
  }
}

function parseSnapshot(value: unknown): VaultSnapshot | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["revision", "tasks"])) return null;
  const revision = ownValue(value, "revision");
  const tasks = ownValue(value, "tasks");
  if (!Number.isSafeInteger(revision) || (revision as number) < 1 || !Array.isArray(tasks)) return null;
  try {
    return createSnapshot(
      revision as number,
      ensureDocument({ formatVersion: PERSONAL_VAULT_DOCUMENT_FORMAT, tasks }),
    );
  } catch {
    return null;
  }
}

/** Strictly validates Worker-to-page messages before resolving an RPC. */
export function parseVaultRpcResponse(value: unknown): VaultRpcResponse | null {
  if (!isPlainRecord(value)) return null;
  const id = ownValue(value, "id");
  const ok = ownValue(value, "ok");
  if (typeof id !== "string" || id.length === 0 || id.length > MAX_RPC_ID_LENGTH || typeof ok !== "boolean")
    return null;

  if (!ok) {
    if (!hasExactKeys(value, ["error", "id", "ok"])) return null;
    const error = ownValue(value, "error");
    if (!isPlainRecord(error) || !hasExactKeys(error, ["code"])) return null;
    const code = ownValue(error, "code");
    return typeof code === "string" && VAULT_RPC_ERROR_CODES.has(code as VaultRpcError["code"])
      ? { id, ok: false, error: { code: code as VaultRpcError["code"] } }
      : null;
  }

  const method = ownValue(value, "method");
  if (typeof method !== "string") return null;
  if (method === "inspect") {
    const hasVault = ownValue(value, "hasVault");
    return hasExactKeys(value, ["hasVault", "id", "method", "ok"]) && typeof hasVault === "boolean"
      ? { id, ok: true, method, hasVault }
      : null;
  }
  if (method === "begin-setup") {
    const recoveryCode = ownValue(value, "recoveryCode");
    const source = ownValue(value, "source");
    return hasExactKeys(value, ["id", "method", "ok", "recoveryCode", "source"]) &&
      typeof recoveryCode === "string" &&
      recoveryCode.length <= PERSONAL_VAULT_MAX_RECOVERY_CODE_LENGTH &&
      (source === "empty" || source === "legacy" || source === "seed")
      ? { id, ok: true, method, recoveryCode, source }
      : null;
  }
  if (method === "cancel-setup" || method === "lock") {
    return hasExactKeys(value, ["id", "method", "ok"]) ? { id, ok: true, method } : null;
  }
  if (
    method === "confirm-setup" ||
    method === "unlock" ||
    method === "recover" ||
    method === "add-task" ||
    method === "toggle-task" ||
    method === "import-legacy"
  ) {
    if (!hasExactKeys(value, ["id", "method", "ok", "snapshot"])) return null;
    const snapshot = parseSnapshot(ownValue(value, "snapshot"));
    return snapshot === null ? null : { id, ok: true, method, snapshot };
  }
  return null;
}

export class PersonalVaultSchemaError extends Error {
  constructor() {
    super("The personal vault document is not valid.");
    this.name = "PersonalVaultSchemaError";
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownValue(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function ensureTask(value: unknown, seenIds: Set<string>): VaultTaskView {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["done", "id", "title"])) {
    throw new PersonalVaultSchemaError();
  }
  const done = ownValue(value, "done");
  const id = ownValue(value, "id");
  const title = ownValue(value, "title");
  if (
    typeof id !== "string" ||
    !TASK_ID_PATTERN.test(id) ||
    typeof title !== "string" ||
    title.length === 0 ||
    title.length > PERSONAL_VAULT_MAX_TASK_TITLE_LENGTH ||
    title.trim() !== title ||
    Array.from(title).some(
      (character) => character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f,
    ) ||
    typeof done !== "boolean" ||
    seenIds.has(id)
  ) {
    throw new PersonalVaultSchemaError();
  }
  seenIds.add(id);
  return Object.freeze({ id, title, done });
}

function ensureDocument(value: unknown): PersonalVaultDocumentV1 {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["formatVersion", "tasks"])) {
    throw new PersonalVaultSchemaError();
  }
  if (value["formatVersion"] !== PERSONAL_VAULT_DOCUMENT_FORMAT || !Array.isArray(value["tasks"])) {
    throw new PersonalVaultSchemaError();
  }
  const tasks = value["tasks"];
  if (tasks.length > PERSONAL_VAULT_MAX_TASKS) throw new PersonalVaultSchemaError();
  const seenIds = new Set<string>();
  const normalized = tasks.map((task) => ensureTask(task, seenIds));
  return Object.freeze({
    formatVersion: PERSONAL_VAULT_DOCUMENT_FORMAT,
    tasks: Object.freeze(normalized),
  });
}

function assertSerializedSize(value: string): void {
  if (new TextEncoder().encode(value).byteLength > PERSONAL_VAULT_MAX_DOCUMENT_BYTES) {
    throw new PersonalVaultSchemaError();
  }
}

/** Validates a v1 decrypted document and returns detached, immutable task views. */
export function parsePersonalVaultDocument(value: unknown): PersonalVaultDocumentV1 {
  return ensureDocument(value);
}

/** Canonical plaintext bytes used as the encrypted payload input. */
export function serializePersonalVaultDocument(document: PersonalVaultDocumentV1): Uint8Array {
  const checked = ensureDocument(document);
  const serialized = JSON.stringify(checked);
  assertSerializedSize(serialized);
  return new TextEncoder().encode(serialized);
}

export function parsePersonalVaultDocumentBytes(bytes: Uint8Array): PersonalVaultDocumentV1 {
  if (!ArrayBuffer.isView(bytes) || bytes.byteLength > PERSONAL_VAULT_MAX_DOCUMENT_BYTES) {
    throw new PersonalVaultSchemaError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new PersonalVaultSchemaError();
  }
  return ensureDocument(parsed);
}

/**
 * Legacy values had a bare task array.  Do not loosen this parser: malformed
 * old data remains in localStorage for explicit export or deletion.
 */
export function parseLegacyTasks(raw: string): PersonalVaultDocumentV1 {
  if (typeof raw !== "string" || raw.length === 0) throw new PersonalVaultSchemaError();
  assertSerializedSize(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PersonalVaultSchemaError();
  }
  if (!Array.isArray(parsed)) throw new PersonalVaultSchemaError();
  return ensureDocument({ formatVersion: PERSONAL_VAULT_DOCUMENT_FORMAT, tasks: parsed });
}

export function createTaskDocument(tasks: readonly VaultTaskView[]): PersonalVaultDocumentV1 {
  return ensureDocument({ formatVersion: PERSONAL_VAULT_DOCUMENT_FORMAT, tasks });
}

export function cloneTaskViews(tasks: readonly VaultTaskView[]): readonly VaultTaskView[] {
  return createTaskDocument(tasks).tasks;
}

export function createSnapshot(revision: number, document: PersonalVaultDocumentV1): VaultSnapshot {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new PersonalVaultSchemaError();
  return Object.freeze({ revision, tasks: cloneTaskViews(document.tasks) });
}
