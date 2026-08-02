"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { Locale } from "../lib/data/registry";
import {
  LEGACY_TASK_STORAGE_KEY,
  parseLegacyTasks,
  type RemoteRecoveryStageView,
  type SetupSource,
  type VaultSnapshot,
  type VaultPairingView,
  type VaultSyncState,
  type VaultTaskView,
} from "../lib/personal-vault/protocol";
import { PersonalVaultClient, PersonalVaultClientError } from "../lib/personal-vault/client";

const IDLE_LOCK_MS = 15 * 60 * 1_000;
const VAULT_WORKER_TRUSTED_TYPES_POLICY = "uga#vault-worker";
export const PERSONAL_VAULT_RECOVERY_SECRET_TIMEOUT_MS = 2 * 60 * 1_000;

interface TrustedScriptUrlFactory {
  readonly createScriptURL: (value: string) => unknown;
}

interface TrustedTypesApi {
  readonly createPolicy: (
    name: string,
    rules: { readonly createScriptURL: (value: string) => string },
  ) => TrustedScriptUrlFactory;
}

let vaultWorkerTrustedTypesPolicy: TrustedScriptUrlFactory | undefined;

function trustedVaultWorkerUrl(): unknown {
  // Next/Turbopack treats TypeScript Worker entries as opaque media in its
  // production output. The build script emits this self-contained module
  // explicitly, preserving a same-origin URL and avoiding blob/data Workers.
  const url = new URL("/__uga-vault/personal-vault.worker.mjs", window.location.origin);
  const trustedTypesApi = (window as Window & { readonly trustedTypes?: TrustedTypesApi }).trustedTypes;
  if (trustedTypesApi === undefined) return url;
  vaultWorkerTrustedTypesPolicy ??= trustedTypesApi.createPolicy(VAULT_WORKER_TRUSTED_TYPES_POLICY, {
    createScriptURL(value: string) {
      const candidate = new URL(value, window.location.origin);
      if (candidate.origin !== window.location.origin || !candidate.pathname.startsWith("/__uga-vault/")) {
        throw new TypeError("Only the same-origin bundled vault Worker is trusted.");
      }
      return candidate.href;
    },
  });
  return vaultWorkerTrustedTypesPolicy.createScriptURL(url.href);
}

export type PersonalVaultStatus =
  | "checking"
  | "unavailable"
  | "needs-setup"
  | "show-recovery-code"
  | "show-remote-recovery-code"
  | "locked"
  | "unlocked"
  | "legacy-invalid"
  | "error";

export type PersonalVaultLockReason = "manual" | "idle" | "visibility" | "write-failed";
export type PersonalVaultRecoverySecretExpiry = "display" | "input";

interface PersonalVaultValue {
  readonly status: PersonalVaultStatus;
  readonly tasks: readonly VaultTaskView[];
  readonly recoveryCode: string | null;
  readonly recoveryDeviceLimitReached: boolean;
  readonly error: string | null;
  readonly lastLockReason: PersonalVaultLockReason | null;
  readonly recoverySecretExpiry: PersonalVaultRecoverySecretExpiry | null;
  readonly legacyAvailable: boolean;
  readonly syncState: VaultSyncState;
  readonly hasPendingPairing: boolean;
  readonly pairingCode: string | null;
  readonly pairingId: string | null;
  readonly pairingExpiresAt: string | null;
  readonly pairings: readonly VaultPairingView[];
  readonly remoteRecoveryStage: RemoteRecoveryStageView | null;
  readonly beginSetup: () => Promise<void>;
  readonly confirmRecoverySaved: () => Promise<void>;
  readonly cancelSetup: () => Promise<void>;
  readonly unlock: () => Promise<void>;
  readonly recover: (code: string, allowOldestDeviceRevocation?: boolean) => Promise<void>;
  readonly expireRecoveryInput: () => void;
  readonly lock: () => void;
  readonly addTask: (title: string) => Promise<void>;
  readonly toggleTask: (id: string) => Promise<void>;
  readonly retryLegacyImport: () => Promise<void>;
  readonly exportLegacy: () => boolean;
  readonly deleteLegacy: () => boolean;
  readonly syncNow: () => Promise<void>;
  readonly enableAccountSync: (recoveryCode: string) => Promise<void>;
  readonly beginDevicePairing: () => Promise<void>;
  readonly cancelDevicePairing: () => Promise<void>;
  readonly regenerateDevicePairing: () => Promise<void>;
  readonly pollDevicePairing: () => Promise<void>;
  readonly listDevicePairings: () => Promise<void>;
  readonly approveDevicePairing: (pairingId: string, pairingCode: string) => Promise<void>;
  readonly beginRemoteRecovery: (recoveryCode: string) => Promise<void>;
  readonly resumeRemoteRecovery: () => Promise<void>;
  readonly abandonRemoteRecoveryPairing: () => Promise<void>;
  readonly prepareRemoteRecoveryRotation: () => Promise<void>;
  readonly confirmRemoteRecoveryRotation: () => Promise<void>;
}

interface LegacyState {
  readonly available: boolean;
  readonly valid: boolean;
}

const PersonalVaultContext = createContext<PersonalVaultValue | null>(null);

class LegacyStorageUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Legacy browser storage is unavailable.", { cause });
    this.name = "LegacyStorageUnavailableError";
  }
}

function noPlaintext(): readonly VaultTaskView[] {
  return [];
}

function readLegacy(): { readonly raw: string | null; readonly state: LegacyState } {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(LEGACY_TASK_STORAGE_KEY);
  } catch (cause) {
    throw new LegacyStorageUnavailableError(cause);
  }
  if (raw === null) return { raw: null, state: { available: false, valid: true } };
  try {
    parseLegacyTasks(raw);
    return { raw, state: { available: true, valid: true } };
  } catch {
    return { raw, state: { available: true, valid: false } };
  }
}

function removeLegacyIfUnchanged(expected: string): void {
  try {
    const storage = window.localStorage;
    if (storage.getItem(LEGACY_TASK_STORAGE_KEY) === expected) {
      storage.removeItem(LEGACY_TASK_STORAGE_KEY);
    }
  } catch (cause) {
    throw new LegacyStorageUnavailableError(cause);
  }
}

function removeLegacyExplicitly(): boolean {
  try {
    const storage = window.localStorage;
    if (storage.getItem(LEGACY_TASK_STORAGE_KEY) === null) return false;
    storage.removeItem(LEGACY_TASK_STORAGE_KEY);
    return true;
  } catch (cause) {
    throw new LegacyStorageUnavailableError(cause);
  }
}

function clientErrorText(error: unknown, locale: Locale): string {
  if (error instanceof PersonalVaultClientError && error.code === "DEVICE_ENVELOPE_LIMIT_REACHED") {
    return locale === "zh-CN"
      ? "恢复码有效，但受信设备槽位已满。若要继续，请明确同意撤销最早的设备访问权限，然后重新输入恢复码。"
      : "The recovery code is valid, but all trusted-device slots are full. To continue, explicitly allow revoking the oldest device access, then enter the recovery code again.";
  }
  if (error instanceof PersonalVaultClientError && error.code === "AUTHENTICATION_FAILED") {
    return locale === "zh-CN"
      ? "恢复码或加密资料无法验证。"
      : "The recovery code or encrypted vault could not be authenticated.";
  }
  if (error instanceof PersonalVaultClientError && error.code === "CONFLICT") {
    return locale === "zh-CN"
      ? "资料库已有更新；旧数据已保留，请明确导出或删除。"
      : "The vault has newer changes; legacy data was retained for explicit export or deletion.";
  }
  if (
    error instanceof PersonalVaultClientError &&
    (error.code === "OWNER_MISMATCH" || error.code === "ROLLBACK_DETECTED" || error.code === "SYNC_CONFLICT")
  ) {
    return locale === "zh-CN"
      ? "云端资料无法通过账户绑定或回滚校验。同步已锁定，本机加密数据仍保留。"
      : "The cloud vault failed account-binding or rollback checks. Sync is locked; local encrypted data remains.";
  }
  if (error instanceof PersonalVaultClientError && error.code === "PAIRING_FAILED") {
    return locale === "zh-CN"
      ? "设备配对未完成。请核对配对请求、八位代码和有效期后重试。"
      : "Device pairing did not complete. Check the selected request, eight-character code, and expiry.";
  }
  return locale === "zh-CN"
    ? "私人资料库暂时不可用；旧数据未被删除。"
    : "The private vault is unavailable; legacy data was not deleted.";
}

function writeFailureText(locale: Locale): string {
  return locale === "zh-CN"
    ? "更改未能加密保存，资料库已为保护数据而锁定。请解锁后重试；若本机解锁失败，请使用恢复码。"
    : "The change could not be encrypted and saved, so the vault was locked to protect your data. Unlock and retry; if trusted-device unlock fails, use your recovery code.";
}

function storageUnavailableText(locale: Locale): string {
  return locale === "zh-CN"
    ? "浏览器已禁用站点存储，私人资料库无法安全运行。应用未读取、更改或删除旧任务数据。"
    : "Browser site storage is disabled, so the private vault cannot run safely. The app did not read, change, or delete legacy task data.";
}

function downloadLegacy(raw: string): void {
  const blob = new Blob([raw], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "umn-gopher-assistant-legacy-tasks.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function PersonalVaultProvider({
  children,
  locale,
}: {
  readonly children: ReactNode;
  readonly locale: Locale;
}) {
  const clientRef = useRef<PersonalVaultClient | undefined>(undefined);
  const idleTimerRef = useRef<number | undefined>(undefined);
  const recoverySecretTimerRef = useRef<number | undefined>(undefined);
  const pairingSecretTimerRef = useRef<number | undefined>(undefined);
  const sessionEpochRef = useRef(0);
  const pendingLegacyMigrationRef = useRef<string | null>(null);
  const statusRef = useRef<PersonalVaultStatus>("checking");
  const [status, setStatus] = useState<PersonalVaultStatus>("checking");
  const [tasks, setTasks] = useState<readonly VaultTaskView[]>(noPlaintext);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [recoveryDeviceLimitReached, setRecoveryDeviceLimitReached] = useState(false);
  const [legacy, setLegacy] = useState<LegacyState>({ available: false, valid: true });
  const [error, setError] = useState<string | null>(null);
  const [lastLockReason, setLastLockReason] = useState<PersonalVaultLockReason | null>(null);
  const [recoverySecretExpiry, setRecoverySecretExpiry] = useState<PersonalVaultRecoverySecretExpiry | null>(
    null,
  );
  const [syncState, setSyncState] = useState<VaultSyncState>("local-only");
  const [hasPendingPairing, setHasPendingPairing] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingId, setPairingId] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [pairings, setPairings] = useState<readonly VaultPairingView[]>([]);
  const [remoteRecoveryStage, setRemoteRecoveryStage] = useState<RemoteRecoveryStageView | null>(null);

  const setVaultStatus = useCallback((next: PersonalVaultStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const refreshLegacyState = useCallback(() => {
    const next = readLegacy();
    setLegacy(next.state);
    return next;
  }, []);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== undefined) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = undefined;
    }
  }, []);

  const clearRecoverySecretTimer = useCallback(() => {
    if (recoverySecretTimerRef.current !== undefined) {
      window.clearTimeout(recoverySecretTimerRef.current);
      recoverySecretTimerRef.current = undefined;
    }
  }, []);

  const clearPairingSecretTimer = useCallback(() => {
    if (pairingSecretTimerRef.current !== undefined) {
      window.clearTimeout(pairingSecretTimerRef.current);
      pairingSecretTimerRef.current = undefined;
    }
  }, []);

  const clearRenderedPlaintext = useCallback(() => {
    setTasks(noPlaintext());
    setRecoveryCode(null);
    setPairingCode(null);
    pendingLegacyMigrationRef.current = null;
  }, []);

  /** Synchronous UI lock boundary; the isolated Worker drains a queued write before termination. */
  const terminateSession = useCallback(() => {
    sessionEpochRef.current += 1;
    clearIdleTimer();
    clearRecoverySecretTimer();
    clearPairingSecretTimer();
    clearRenderedPlaintext();
    void clientRef.current?.terminateWhenSettled();
    clientRef.current = undefined;
  }, [clearIdleTimer, clearPairingSecretTimer, clearRecoverySecretTimer, clearRenderedPlaintext]);

  const markStorageUnavailable = useCallback(() => {
    terminateSession();
    setLegacy({ available: false, valid: true });
    setError(storageUnavailableText(locale));
    setRecoverySecretExpiry(null);
    setVaultStatus("unavailable");
  }, [locale, setVaultStatus, terminateSession]);

  const armRecoverySecretTimer = useCallback(() => {
    clearRecoverySecretTimer();
    recoverySecretTimerRef.current = window.setTimeout(() => {
      recoverySecretTimerRef.current = undefined;
      if (statusRef.current !== "show-recovery-code" && statusRef.current !== "show-remote-recovery-code")
        return;
      const wasRemoteRotation = statusRef.current === "show-remote-recovery-code";
      // Terminating the dedicated Worker destroys its pending root/device keys;
      // clearing React happens synchronously inside terminateSession first.
      terminateSession();
      setError(null);
      setRecoverySecretExpiry("display");
      setVaultStatus(wasRemoteRotation ? "locked" : "needs-setup");
    }, PERSONAL_VAULT_RECOVERY_SECRET_TIMEOUT_MS);
  }, [clearRecoverySecretTimer, setVaultStatus, terminateSession]);

  const lockForReason = useCallback(
    (reason: PersonalVaultLockReason) => {
      terminateSession();
      setError(null);
      setLastLockReason(reason);
      setRecoverySecretExpiry(null);
      setVaultStatus("locked");
    },
    [setVaultStatus, terminateSession],
  );

  const lock = useCallback(() => lockForReason("manual"), [lockForReason]);

  const expireRecoveryInput = useCallback(() => {
    if (statusRef.current !== "locked") return;
    terminateSession();
    setError(null);
    setRecoverySecretExpiry("input");
    setVaultStatus("locked");
  }, [setVaultStatus, terminateSession]);

  const ensureClient = useCallback((): PersonalVaultClient => {
    const existing = clientRef.current;
    if (existing !== undefined) return existing;
    const client = new PersonalVaultClient(trustedVaultWorkerUrl());
    clientRef.current = client;
    return client;
  }, []);

  const isCurrentSession = useCallback((epoch: number) => sessionEpochRef.current === epoch, []);

  const applySnapshot = useCallback(
    (epoch: number, snapshot: VaultSnapshot, nextSyncState?: VaultSyncState): boolean => {
      if (!isCurrentSession(epoch)) return false;
      setTasks(snapshot.tasks);
      setRecoveryCode(null);
      setRecoveryDeviceLimitReached(false);
      setError(null);
      setLastLockReason(null);
      setRecoverySecretExpiry(null);
      clearRecoverySecretTimer();
      setVaultStatus("unlocked");
      if (nextSyncState !== undefined) setSyncState(nextSyncState);
      return true;
    },
    [clearRecoverySecretTimer, isCurrentSession, setVaultStatus],
  );

  useEffect(() => {
    const epoch = sessionEpochRef.current;
    let legacySnapshot: ReturnType<typeof readLegacy>;
    try {
      legacySnapshot = refreshLegacyState();
    } catch (cause) {
      if (cause instanceof LegacyStorageUnavailableError) markStorageUnavailable();
      return () => terminateSession();
    }
    if (!legacySnapshot.state.valid) {
      setVaultStatus("legacy-invalid");
      return () => terminateSession();
    }
    try {
      void ensureClient()
        .inspect()
        .then((response) => {
          if (!isCurrentSession(epoch) || response.method !== "inspect") return;
          setSyncState(response.syncState);
          setHasPendingPairing(response.hasPendingPairing);
          setPairingId(response.pairingId);
          setPairingExpiresAt(response.pairingExpiresAt);
          setRemoteRecoveryStage(response.remoteRecoveryStage);
          setVaultStatus(response.hasVault ? "locked" : "needs-setup");
        })
        .catch(() => {
          if (isCurrentSession(epoch)) setVaultStatus("unavailable");
        });
    } catch {
      setVaultStatus("unavailable");
    }
    return () => terminateSession();
  }, [
    ensureClient,
    isCurrentSession,
    markStorageUnavailable,
    refreshLegacyState,
    setVaultStatus,
    terminateSession,
  ]);

  useEffect(() => {
    const activity = () => {
      if (statusRef.current !== "unlocked") return;
      clearIdleTimer();
      idleTimerRef.current = window.setTimeout(() => lockForReason("idle"), IDLE_LOCK_MS);
    };
    const visibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      const priorStatus = statusRef.current;
      terminateSession();
      if (priorStatus === "unlocked") {
        setError(null);
        setLastLockReason("visibility");
        setVaultStatus("locked");
      } else if (priorStatus === "show-recovery-code" || priorStatus === "show-remote-recovery-code") {
        setRecoverySecretExpiry(null);
        setVaultStatus(priorStatus === "show-remote-recovery-code" ? "locked" : "needs-setup");
      }
    };
    // `pagehide` is also dispatched for a bfcache transition, where the
    // document visibility state is not a reliable guard. Destroy every Worker,
    // but only expose a locked state when a decrypted session actually existed.
    const pagehide = () => {
      const priorStatus = statusRef.current;
      terminateSession();
      if (priorStatus === "unlocked") {
        setError(null);
        setLastLockReason("visibility");
        setVaultStatus("locked");
      } else if (priorStatus === "show-recovery-code" || priorStatus === "show-remote-recovery-code") {
        setRecoverySecretExpiry(null);
        setVaultStatus(priorStatus === "show-remote-recovery-code" ? "locked" : "needs-setup");
      }
    };
    const events = ["keydown", "mousedown", "pointerdown", "scroll", "touchstart"] as const;
    events.forEach((event) => window.addEventListener(event, activity, { passive: true }));
    window.addEventListener("pagehide", pagehide);
    document.addEventListener("visibilitychange", visibilityChange);
    if (status === "unlocked") activity();
    return () => {
      events.forEach((event) => window.removeEventListener(event, activity));
      window.removeEventListener("pagehide", pagehide);
      document.removeEventListener("visibilitychange", visibilityChange);
      clearIdleTimer();
    };
  }, [clearIdleTimer, lockForReason, setVaultStatus, status, terminateSession]);

  const beginSetup = useCallback(async () => {
    let legacySnapshot: ReturnType<typeof readLegacy>;
    try {
      legacySnapshot = refreshLegacyState();
    } catch (cause) {
      if (cause instanceof LegacyStorageUnavailableError) markStorageUnavailable();
      return;
    }
    if (!legacySnapshot.state.valid) {
      setVaultStatus("legacy-invalid");
      return;
    }
    const epoch = sessionEpochRef.current;
    const source: SetupSource = legacySnapshot.raw === null ? "seed" : "legacy";
    // The raw legacy text is intentionally held only during this migration
    // transaction. It never enters React state and is cleared on lock/cancel.
    pendingLegacyMigrationRef.current = legacySnapshot.raw;
    setRecoverySecretExpiry(null);
    try {
      const response = await ensureClient().beginSetup(source, legacySnapshot.raw);
      if (!isCurrentSession(epoch) || response.method !== "begin-setup") return;
      setRecoveryCode(response.recoveryCode);
      setError(null);
      setVaultStatus("show-recovery-code");
      armRecoverySecretTimer();
    } catch (cause) {
      pendingLegacyMigrationRef.current = null;
      setRecoveryCode(null);
      if (!isCurrentSession(epoch)) return;
      setError(clientErrorText(cause, locale));
      terminateSession();
      // A setup record may already be durable when its required independent
      // read-back fails. Re-inspect that retained ciphertext instead of
      // exposing a fresh-create loop which would only collide with it.
      const inspectionEpoch = sessionEpochRef.current;
      try {
        const inspection = await ensureClient().inspect();
        if (!isCurrentSession(inspectionEpoch) || inspection.method !== "inspect") return;
        setVaultStatus(inspection.hasVault ? "locked" : "needs-setup");
      } catch {
        if (isCurrentSession(inspectionEpoch)) setVaultStatus("unavailable");
      }
    }
  }, [
    armRecoverySecretTimer,
    ensureClient,
    isCurrentSession,
    locale,
    markStorageUnavailable,
    refreshLegacyState,
    setVaultStatus,
    terminateSession,
  ]);

  const confirmRecoverySaved = useCallback(async () => {
    const epoch = sessionEpochRef.current;
    const expectedLegacy = pendingLegacyMigrationRef.current;
    try {
      const response = await ensureClient().confirmSetup();
      if (!isCurrentSession(epoch) || response.method !== "confirm-setup") return;
      // Both crypto and exact read-back verification completed in the Worker.
      // Compare exact raw text again before deleting the source plaintext.
      if (expectedLegacy !== null) removeLegacyIfUnchanged(expectedLegacy);
      pendingLegacyMigrationRef.current = null;
      refreshLegacyState();
      applySnapshot(epoch, response.snapshot, response.syncState);
    } catch (cause) {
      pendingLegacyMigrationRef.current = null;
      setRecoveryCode(null);
      if (!isCurrentSession(epoch)) return;
      if (cause instanceof LegacyStorageUnavailableError) {
        markStorageUnavailable();
        return;
      }
      setError(clientErrorText(cause, locale));
      terminateSession();
      // A create can fail before the transaction commits or after a durable
      // record was written but before its independent read-back. Re-inspect
      // rather than trapping either state behind the wrong next action.
      const inspectionEpoch = sessionEpochRef.current;
      try {
        const inspection = await ensureClient().inspect();
        if (!isCurrentSession(inspectionEpoch) || inspection.method !== "inspect") return;
        setVaultStatus(inspection.hasVault ? "locked" : "needs-setup");
      } catch {
        if (isCurrentSession(inspectionEpoch)) setVaultStatus("unavailable");
      }
    }
  }, [
    applySnapshot,
    ensureClient,
    isCurrentSession,
    locale,
    markStorageUnavailable,
    refreshLegacyState,
    setVaultStatus,
    terminateSession,
  ]);

  const cancelSetup = useCallback(async () => {
    const epoch = sessionEpochRef.current;
    clearRecoverySecretTimer();
    setRecoverySecretExpiry(null);
    try {
      await ensureClient().cancelSetup();
    } finally {
      pendingLegacyMigrationRef.current = null;
      if (isCurrentSession(epoch)) {
        clearRenderedPlaintext();
        setVaultStatus("needs-setup");
      }
    }
  }, [clearRecoverySecretTimer, clearRenderedPlaintext, ensureClient, isCurrentSession, setVaultStatus]);

  const unlock = useCallback(async () => {
    const epoch = sessionEpochRef.current;
    setRecoverySecretExpiry(null);
    try {
      const response = await ensureClient().unlock();
      if (response.method !== "unlock") throw new Error("Unexpected vault response.");
      applySnapshot(epoch, response.snapshot, response.syncState);
    } catch (cause) {
      if (!isCurrentSession(epoch)) return;
      setError(clientErrorText(cause, locale));
      terminateSession();
      // A missing or invalid local device envelope can still be recovered from
      // the encrypted keyring. Keep the recovery path reachable rather than
      // presenting this as a fresh-vault setup screen.
      setVaultStatus("locked");
    }
  }, [applySnapshot, ensureClient, isCurrentSession, locale, setVaultStatus, terminateSession]);

  const recover = useCallback(
    async (code: string, allowOldestDeviceRevocation?: boolean) => {
      const epoch = sessionEpochRef.current;
      setRecoverySecretExpiry(null);
      setRecoveryDeviceLimitReached(false);
      try {
        const response = await ensureClient().recover(code, allowOldestDeviceRevocation === true);
        if (response.method !== "recover") throw new Error("Unexpected vault response.");
        applySnapshot(epoch, response.snapshot, response.syncState);
      } catch (cause) {
        setRecoveryCode(null);
        if (!isCurrentSession(epoch)) return;
        setRecoveryDeviceLimitReached(
          cause instanceof PersonalVaultClientError && cause.code === "DEVICE_ENVELOPE_LIMIT_REACHED",
        );
        setError(clientErrorText(cause, locale));
        terminateSession();
        setVaultStatus("locked");
      }
    },
    [applySnapshot, ensureClient, isCurrentSession, locale, setVaultStatus, terminateSession],
  );

  const addTask = useCallback(
    async (title: string) => {
      const epoch = sessionEpochRef.current;
      if (syncState === "synced" || syncState === "deferred") setSyncState("syncing");
      try {
        const response = await ensureClient().addTask(title);
        if (response.method !== "add-task") throw new Error("Unexpected vault response.");
        applySnapshot(epoch, response.snapshot, response.syncState);
      } catch (error) {
        if (isCurrentSession(epoch)) {
          setSyncState("deferred");
          terminateSession();
          setError(writeFailureText(locale));
          setLastLockReason("write-failed");
          setVaultStatus("locked");
        }
        throw error;
      }
    },
    [applySnapshot, ensureClient, isCurrentSession, locale, setVaultStatus, syncState, terminateSession],
  );

  const toggleTask = useCallback(
    async (id: string) => {
      const epoch = sessionEpochRef.current;
      if (syncState === "synced" || syncState === "deferred") setSyncState("syncing");
      try {
        const response = await ensureClient().toggleTask(id);
        if (response.method !== "toggle-task") throw new Error("Unexpected vault response.");
        applySnapshot(epoch, response.snapshot, response.syncState);
      } catch (error) {
        if (isCurrentSession(epoch)) {
          setSyncState("deferred");
          terminateSession();
          setError(writeFailureText(locale));
          setLastLockReason("write-failed");
          setVaultStatus("locked");
        }
        throw error;
      }
    },
    [applySnapshot, ensureClient, isCurrentSession, locale, setVaultStatus, syncState, terminateSession],
  );

  const retryLegacyImport = useCallback(async () => {
    let legacySnapshot: ReturnType<typeof readLegacy>;
    try {
      legacySnapshot = refreshLegacyState();
    } catch (cause) {
      if (cause instanceof LegacyStorageUnavailableError) markStorageUnavailable();
      return;
    }
    if (legacySnapshot.raw === null || !legacySnapshot.state.valid) return;
    const epoch = sessionEpochRef.current;
    try {
      const response = await ensureClient().importLegacy(legacySnapshot.raw);
      if (!isCurrentSession(epoch) || response.method !== "import-legacy") return;
      removeLegacyIfUnchanged(legacySnapshot.raw);
      refreshLegacyState();
      applySnapshot(epoch, response.snapshot, response.syncState);
    } catch (cause) {
      if (!isCurrentSession(epoch)) return;
      if (cause instanceof LegacyStorageUnavailableError) {
        markStorageUnavailable();
        return;
      }
      setError(clientErrorText(cause, locale));
      terminateSession();
      // A retry targets an existing vault; preserve its unlock/recovery UI
      // rather than turning a conflict into a second setup attempt.
      setVaultStatus("locked");
    }
  }, [
    applySnapshot,
    ensureClient,
    isCurrentSession,
    locale,
    markStorageUnavailable,
    refreshLegacyState,
    setVaultStatus,
    terminateSession,
  ]);

  const exportLegacy = useCallback(() => {
    try {
      const { raw } = readLegacy();
      if (raw === null) return false;
      downloadLegacy(raw);
      return true;
    } catch (cause) {
      if (cause instanceof LegacyStorageUnavailableError) markStorageUnavailable();
      return false;
    }
  }, [markStorageUnavailable]);

  const deleteLegacy = useCallback(() => {
    let deleted: boolean;
    try {
      deleted = removeLegacyExplicitly();
    } catch (cause) {
      if (cause instanceof LegacyStorageUnavailableError) markStorageUnavailable();
      return false;
    }
    if (!deleted) return false;
    pendingLegacyMigrationRef.current = null;
    setLegacy({ available: false, valid: true });
    if (statusRef.current === "legacy-invalid") setVaultStatus("needs-setup");
    return true;
  }, [markStorageUnavailable, setVaultStatus]);

  const syncNow = useCallback(async () => {
    const epoch = sessionEpochRef.current;
    setSyncState("syncing");
    try {
      const response = await ensureClient().syncNow();
      if (!isCurrentSession(epoch) || response.method !== "sync-now") return;
      setSyncState(response.syncState);
      if (response.snapshot !== null) applySnapshot(epoch, response.snapshot, response.syncState);
    } catch (cause) {
      if (!isCurrentSession(epoch)) return;
      setError(clientErrorText(cause, locale));
      if (
        cause instanceof PersonalVaultClientError &&
        (cause.code === "OWNER_MISMATCH" ||
          cause.code === "ROLLBACK_DETECTED" ||
          cause.code === "SYNC_CONFLICT")
      ) {
        setSyncState(cause.code === "ROLLBACK_DETECTED" ? "rollback" : "conflict");
        terminateSession();
        setVaultStatus("locked");
      } else {
        setSyncState("deferred");
      }
    }
  }, [applySnapshot, ensureClient, isCurrentSession, locale, setVaultStatus, terminateSession]);

  const enableAccountSync = useCallback(
    async (code: string) => {
      const epoch = sessionEpochRef.current;
      const previousSyncState = syncState;
      setSyncState("syncing");
      try {
        const response = await ensureClient().enableAccountSync(code);
        if (!isCurrentSession(epoch) || response.method !== "enable-account-sync") return;
        applySnapshot(epoch, response.snapshot, response.syncState);
      } catch (cause) {
        if (isCurrentSession(epoch)) {
          setSyncState(previousSyncState);
          setError(clientErrorText(cause, locale));
        }
        throw cause;
      }
    },
    [applySnapshot, ensureClient, isCurrentSession, locale, syncState],
  );

  const beginDevicePairing = useCallback(async () => {
    const epoch = sessionEpochRef.current;
    try {
      const response = await ensureClient().beginDevicePairing();
      if (!isCurrentSession(epoch) || response.method !== "begin-device-pairing") return;
      setPairingCode(response.pairingCode);
      setPairingId(response.pairingId);
      setPairingExpiresAt(response.expiresAt);
      setHasPendingPairing(true);
      setSyncState("pairing");
      setError(null);
      clearPairingSecretTimer();
      pairingSecretTimerRef.current = window.setTimeout(() => {
        pairingSecretTimerRef.current = undefined;
        setPairingCode(null);
      }, PERSONAL_VAULT_RECOVERY_SECRET_TIMEOUT_MS);
    } catch (cause) {
      if (!isCurrentSession(epoch)) return;
      setError(clientErrorText(cause, locale));
      try {
        const inspection = await ensureClient().inspect();
        if (!isCurrentSession(epoch) || inspection.method !== "inspect") return;
        setHasPendingPairing(inspection.hasPendingPairing);
        setPairingId(inspection.pairingId);
        setPairingExpiresAt(inspection.pairingExpiresAt);
        setSyncState(inspection.syncState);
      } catch {
        // The original pairing error remains actionable; reload can re-inspect.
      }
    }
  }, [clearPairingSecretTimer, ensureClient, isCurrentSession, locale]);

  const cancelDevicePairing = useCallback(async () => {
    const epoch = sessionEpochRef.current;
    try {
      const response = await ensureClient().cancelDevicePairing();
      if (!isCurrentSession(epoch) || response.method !== "cancel-device-pairing") return;
      clearPairingSecretTimer();
      setPairingCode(null);
      setPairingId(null);
      setPairingExpiresAt(null);
      setHasPendingPairing(false);
      setSyncState(response.syncState);
      setError(null);
    } catch (cause) {
      if (!isCurrentSession(epoch)) return;
      setError(clientErrorText(cause, locale));
      try {
        const inspection = await ensureClient().inspect();
        if (!isCurrentSession(epoch) || inspection.method !== "inspect") return;
        setHasPendingPairing(inspection.hasPendingPairing);
        setPairingId(inspection.pairingId);
        setPairingExpiresAt(inspection.pairingExpiresAt);
        setSyncState(inspection.syncState);
      } catch {
        // Keep the durable cancellation/create intent for a later retry.
      }
    }
  }, [clearPairingSecretTimer, ensureClient, isCurrentSession, locale]);

  const regenerateDevicePairing = useCallback(async () => {
    const epoch = sessionEpochRef.current;
    try {
      const cancelled = await ensureClient().cancelDevicePairing();
      if (!isCurrentSession(epoch) || cancelled.method !== "cancel-device-pairing") return;
      clearPairingSecretTimer();
      setPairingCode(null);
      setPairingId(null);
      setPairingExpiresAt(null);
      setHasPendingPairing(false);
      const created = await ensureClient().beginDevicePairing();
      if (!isCurrentSession(epoch) || created.method !== "begin-device-pairing") return;
      setPairingCode(created.pairingCode);
      setPairingId(created.pairingId);
      setPairingExpiresAt(created.expiresAt);
      setHasPendingPairing(true);
      setSyncState("pairing");
      setError(null);
      pairingSecretTimerRef.current = window.setTimeout(() => {
        pairingSecretTimerRef.current = undefined;
        setPairingCode(null);
      }, PERSONAL_VAULT_RECOVERY_SECRET_TIMEOUT_MS);
    } catch (cause) {
      if (!isCurrentSession(epoch)) return;
      setError(clientErrorText(cause, locale));
      try {
        const inspection = await ensureClient().inspect();
        if (!isCurrentSession(epoch) || inspection.method !== "inspect") return;
        setHasPendingPairing(inspection.hasPendingPairing);
        setPairingId(inspection.pairingId);
        setPairingExpiresAt(inspection.pairingExpiresAt);
        setSyncState(inspection.syncState);
      } catch {
        // Keep any durable request for a later retry or page-load inspection.
      }
    }
  }, [clearPairingSecretTimer, ensureClient, isCurrentSession, locale]);

  const pollDevicePairing = useCallback(async () => {
    const epoch = sessionEpochRef.current;
    try {
      const response = await ensureClient().pollDevicePairing();
      if (!isCurrentSession(epoch) || response.method !== "poll-device-pairing") return;
      setSyncState(response.syncState);
      if (!response.pending && response.snapshot !== null) {
        setPairingCode(null);
        setPairingId(null);
        setPairingExpiresAt(null);
        setHasPendingPairing(false);
        clearPairingSecretTimer();
        applySnapshot(epoch, response.snapshot, response.syncState);
      }
    } catch (cause) {
      if (!isCurrentSession(epoch)) return;
      setError(clientErrorText(cause, locale));
    }
  }, [applySnapshot, clearPairingSecretTimer, ensureClient, isCurrentSession, locale]);

  const listDevicePairings = useCallback(async () => {
    const epoch = sessionEpochRef.current;
    try {
      const response = await ensureClient().listDevicePairings();
      if (!isCurrentSession(epoch) || response.method !== "list-device-pairings") return;
      setPairings(response.items);
      setSyncState(response.syncState);
      setError(null);
    } catch (cause) {
      if (!isCurrentSession(epoch)) return;
      setError(clientErrorText(cause, locale));
    }
  }, [ensureClient, isCurrentSession, locale]);

  const approveDevicePairing = useCallback(
    async (selectedPairingId: string, code: string) => {
      const epoch = sessionEpochRef.current;
      try {
        const response = await ensureClient().approveDevicePairing(selectedPairingId, code);
        if (!isCurrentSession(epoch) || response.method !== "approve-device-pairing") return;
        setPairings((current) => current.filter((pairing) => pairing.id !== selectedPairingId));
        applySnapshot(epoch, response.snapshot, response.syncState);
      } catch (cause) {
        if (!isCurrentSession(epoch)) return;
        setError(clientErrorText(cause, locale));
      }
    },
    [applySnapshot, ensureClient, isCurrentSession, locale],
  );

  const beginRemoteRecovery = useCallback(
    async (code: string) => {
      const epoch = sessionEpochRef.current;
      setRecoverySecretExpiry(null);
      try {
        const response = await ensureClient().beginRemoteRecovery(code);
        if (!isCurrentSession(epoch) || response.method !== "begin-remote-recovery") return;
        setRemoteRecoveryStage("hardening-required");
        applySnapshot(epoch, response.snapshot, response.syncState);
      } catch (cause) {
        if (!isCurrentSession(epoch)) return;
        setError(clientErrorText(cause, locale));
        try {
          const inspection = await ensureClient().inspect();
          if (!isCurrentSession(epoch) || inspection.method !== "inspect") return;
          setRemoteRecoveryStage(inspection.remoteRecoveryStage);
          setSyncState(inspection.syncState);
          setVaultStatus(inspection.hasVault ? "locked" : "needs-setup");
        } catch {
          setVaultStatus("unavailable");
        }
        throw cause;
      }
    },
    [applySnapshot, ensureClient, isCurrentSession, locale, setVaultStatus],
  );

  const resumeRemoteRecovery = useCallback(async () => {
    const epoch = sessionEpochRef.current;
    try {
      const response = await ensureClient().resumeRemoteRecovery();
      if (!isCurrentSession(epoch) || response.method !== "resume-remote-recovery") return;
      setRemoteRecoveryStage(response.syncState === "synced" ? null : "hardening-required");
      applySnapshot(epoch, response.snapshot, response.syncState);
    } catch (cause) {
      if (!isCurrentSession(epoch)) return;
      setError(clientErrorText(cause, locale));
      try {
        const inspection = await ensureClient().inspect();
        if (!isCurrentSession(epoch) || inspection.method !== "inspect") return;
        setRemoteRecoveryStage(inspection.remoteRecoveryStage);
        setSyncState(inspection.syncState);
        setVaultStatus(inspection.hasVault ? "locked" : "needs-setup");
      } catch {
        // The durable recovery intent remains available after reload.
      }
      throw cause;
    }
  }, [applySnapshot, ensureClient, isCurrentSession, locale, setVaultStatus]);

  const abandonRemoteRecoveryPairing = useCallback(async () => {
    const epoch = sessionEpochRef.current;
    let response: Awaited<ReturnType<PersonalVaultClient["abandonRemoteRecoveryPairing"]>>;
    try {
      response = await ensureClient().abandonRemoteRecoveryPairing();
    } catch (cause) {
      if (!isCurrentSession(epoch)) return;
      setError(clientErrorText(cause, locale));
      throw cause;
    }
    if (!isCurrentSession(epoch) || response.method !== "abandon-remote-recovery-pairing") return;
    terminateSession();
    const inspectionEpoch = sessionEpochRef.current;
    try {
      const inspection = await ensureClient().inspect();
      if (!isCurrentSession(inspectionEpoch) || inspection.method !== "inspect") return;
      setRemoteRecoveryStage(inspection.remoteRecoveryStage);
      setSyncState(inspection.syncState);
      setError(null);
      setVaultStatus(inspection.hasVault ? "locked" : "needs-setup");
    } catch {
      if (isCurrentSession(inspectionEpoch)) setVaultStatus("unavailable");
    }
  }, [ensureClient, isCurrentSession, locale, setVaultStatus, terminateSession]);

  const prepareRemoteRecoveryRotation = useCallback(async () => {
    const epoch = sessionEpochRef.current;
    const response = await ensureClient().prepareRemoteRecoveryRotation();
    if (!isCurrentSession(epoch) || response.method !== "prepare-remote-recovery-rotation") return;
    setRecoveryCode(response.recoveryCode);
    setRemoteRecoveryStage("hardening-required");
    setSyncState("hardening");
    setError(null);
    setVaultStatus("show-remote-recovery-code");
    armRecoverySecretTimer();
  }, [armRecoverySecretTimer, ensureClient, isCurrentSession, setVaultStatus]);

  const confirmRemoteRecoveryRotation = useCallback(async () => {
    const epoch = sessionEpochRef.current;
    clearRecoverySecretTimer();
    setRecoveryCode(null);
    try {
      const response = await ensureClient().confirmRemoteRecoveryRotation();
      if (!isCurrentSession(epoch) || response.method !== "confirm-remote-recovery-rotation") return;
      setRemoteRecoveryStage(null);
      applySnapshot(epoch, response.snapshot, response.syncState);
    } catch (cause) {
      if (!isCurrentSession(epoch)) return;
      setError(clientErrorText(cause, locale));
      terminateSession();
      const inspectionEpoch = sessionEpochRef.current;
      try {
        const inspection = await ensureClient().inspect();
        if (!isCurrentSession(inspectionEpoch) || inspection.method !== "inspect") return;
        setRemoteRecoveryStage(inspection.remoteRecoveryStage);
        setSyncState(inspection.syncState);
        setVaultStatus(inspection.hasVault ? "locked" : "needs-setup");
      } catch {
        setVaultStatus("unavailable");
      }
      throw cause;
    }
  }, [
    applySnapshot,
    clearRecoverySecretTimer,
    ensureClient,
    isCurrentSession,
    locale,
    setVaultStatus,
    terminateSession,
  ]);

  const value = useMemo<PersonalVaultValue>(
    () => ({
      status,
      tasks,
      recoveryCode,
      recoveryDeviceLimitReached,
      error,
      lastLockReason,
      recoverySecretExpiry,
      legacyAvailable: legacy.available,
      syncState,
      hasPendingPairing,
      pairingCode,
      pairingId,
      pairingExpiresAt,
      pairings,
      remoteRecoveryStage,
      beginSetup,
      confirmRecoverySaved,
      cancelSetup,
      unlock,
      recover,
      expireRecoveryInput,
      lock,
      addTask,
      toggleTask,
      retryLegacyImport,
      exportLegacy,
      deleteLegacy,
      syncNow,
      enableAccountSync,
      beginDevicePairing,
      cancelDevicePairing,
      regenerateDevicePairing,
      pollDevicePairing,
      listDevicePairings,
      approveDevicePairing,
      beginRemoteRecovery,
      resumeRemoteRecovery,
      abandonRemoteRecoveryPairing,
      prepareRemoteRecoveryRotation,
      confirmRemoteRecoveryRotation,
    }),
    [
      addTask,
      beginSetup,
      cancelSetup,
      confirmRecoverySaved,
      deleteLegacy,
      syncNow,
      enableAccountSync,
      beginDevicePairing,
      cancelDevicePairing,
      regenerateDevicePairing,
      pollDevicePairing,
      listDevicePairings,
      approveDevicePairing,
      beginRemoteRecovery,
      resumeRemoteRecovery,
      abandonRemoteRecoveryPairing,
      prepareRemoteRecoveryRotation,
      confirmRemoteRecoveryRotation,
      error,
      expireRecoveryInput,
      exportLegacy,
      legacy.available,
      syncState,
      hasPendingPairing,
      pairingCode,
      pairingId,
      pairingExpiresAt,
      pairings,
      remoteRecoveryStage,
      lastLockReason,
      lock,
      recover,
      recoveryCode,
      recoveryDeviceLimitReached,
      recoverySecretExpiry,
      retryLegacyImport,
      status,
      tasks,
      toggleTask,
      unlock,
    ],
  );

  return <PersonalVaultContext.Provider value={value}>{children}</PersonalVaultContext.Provider>;
}

export function usePersonalVault(): PersonalVaultValue {
  const value = useContext(PersonalVaultContext);
  if (value === null) throw new Error("usePersonalVault must be used inside PersonalVaultProvider.");
  return value;
}
