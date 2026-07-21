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
  type SetupSource,
  type VaultSnapshot,
  type VaultTaskView,
} from "../lib/personal-vault/protocol";
import { PersonalVaultClient, PersonalVaultClientError } from "../lib/personal-vault/client";

const IDLE_LOCK_MS = 15 * 60 * 1_000;
const VAULT_WORKER_TRUSTED_TYPES_POLICY = "uga#vault-worker";

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
  | "locked"
  | "unlocked"
  | "legacy-invalid"
  | "error";

interface PersonalVaultValue {
  readonly status: PersonalVaultStatus;
  readonly tasks: readonly VaultTaskView[];
  readonly recoveryCode: string | null;
  readonly error: string | null;
  readonly legacyAvailable: boolean;
  readonly beginSetup: () => Promise<void>;
  readonly confirmRecoverySaved: () => Promise<void>;
  readonly cancelSetup: () => Promise<void>;
  readonly unlock: () => Promise<void>;
  readonly recover: (code: string) => Promise<void>;
  readonly lock: () => void;
  readonly addTask: (title: string) => Promise<void>;
  readonly toggleTask: (id: string) => Promise<void>;
  readonly retryLegacyImport: () => Promise<void>;
  readonly exportLegacy: () => void;
  readonly deleteLegacy: () => void;
}

interface LegacyState {
  readonly available: boolean;
  readonly valid: boolean;
}

const PersonalVaultContext = createContext<PersonalVaultValue | null>(null);

function noPlaintext(): readonly VaultTaskView[] {
  return [];
}

function readLegacy(): { readonly raw: string | null; readonly state: LegacyState } {
  const raw = window.localStorage.getItem(LEGACY_TASK_STORAGE_KEY);
  if (raw === null) return { raw: null, state: { available: false, valid: true } };
  try {
    parseLegacyTasks(raw);
    return { raw, state: { available: true, valid: true } };
  } catch {
    return { raw, state: { available: true, valid: false } };
  }
}

function clientErrorText(error: unknown, locale: Locale): string {
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
  return locale === "zh-CN"
    ? "私人资料库暂时不可用；旧数据未被删除。"
    : "The private vault is unavailable; legacy data was not deleted.";
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
  const sessionEpochRef = useRef(0);
  const pendingLegacyMigrationRef = useRef<string | null>(null);
  const statusRef = useRef<PersonalVaultStatus>("checking");
  const [status, setStatus] = useState<PersonalVaultStatus>("checking");
  const [tasks, setTasks] = useState<readonly VaultTaskView[]>(noPlaintext);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [legacy, setLegacy] = useState<LegacyState>({ available: false, valid: true });
  const [error, setError] = useState<string | null>(null);

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

  const clearRenderedPlaintext = useCallback(() => {
    setTasks(noPlaintext());
    setRecoveryCode(null);
    pendingLegacyMigrationRef.current = null;
  }, []);

  /** Synchronous lock boundary: clear React first, then destroy the Worker. */
  const terminateSession = useCallback(() => {
    sessionEpochRef.current += 1;
    clearIdleTimer();
    clearRenderedPlaintext();
    clientRef.current?.terminate();
    clientRef.current = undefined;
  }, [clearIdleTimer, clearRenderedPlaintext]);

  const lock = useCallback(() => {
    terminateSession();
    setError(null);
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
    (epoch: number, snapshot: VaultSnapshot): boolean => {
      if (!isCurrentSession(epoch)) return false;
      setTasks(snapshot.tasks);
      setRecoveryCode(null);
      setError(null);
      setVaultStatus("unlocked");
      return true;
    },
    [isCurrentSession, setVaultStatus],
  );

  useEffect(() => {
    const epoch = sessionEpochRef.current;
    const legacySnapshot = refreshLegacyState();
    if (!legacySnapshot.state.valid) {
      setVaultStatus("legacy-invalid");
      return () => terminateSession();
    }
    try {
      void ensureClient()
        .inspect()
        .then((response) => {
          if (!isCurrentSession(epoch) || response.method !== "inspect") return;
          setVaultStatus(response.hasVault ? "locked" : "needs-setup");
        })
        .catch(() => {
          if (isCurrentSession(epoch)) setVaultStatus("unavailable");
        });
    } catch {
      setVaultStatus("unavailable");
    }
    return () => terminateSession();
  }, [ensureClient, isCurrentSession, refreshLegacyState, setVaultStatus, terminateSession]);

  useEffect(() => {
    const activity = () => {
      if (statusRef.current !== "unlocked") return;
      clearIdleTimer();
      idleTimerRef.current = window.setTimeout(lock, IDLE_LOCK_MS);
    };
    const visibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      const priorStatus = statusRef.current;
      terminateSession();
      if (priorStatus === "unlocked") setVaultStatus("locked");
      else if (priorStatus === "show-recovery-code") setVaultStatus("needs-setup");
    };
    // `pagehide` is also dispatched for a bfcache transition, where the
    // document visibility state is not a reliable guard. Lock unconditionally
    // so decrypted React state and the Worker never survive a hidden page.
    const pagehide = () => lock();
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
  }, [clearIdleTimer, lock, setVaultStatus, status, terminateSession]);

  const beginSetup = useCallback(async () => {
    const legacySnapshot = refreshLegacyState();
    if (!legacySnapshot.state.valid) {
      setVaultStatus("legacy-invalid");
      return;
    }
    const epoch = sessionEpochRef.current;
    const source: SetupSource = legacySnapshot.raw === null ? "seed" : "legacy";
    // The raw legacy text is intentionally held only during this migration
    // transaction. It never enters React state and is cleared on lock/cancel.
    pendingLegacyMigrationRef.current = legacySnapshot.raw;
    try {
      const response = await ensureClient().beginSetup(source, legacySnapshot.raw);
      if (!isCurrentSession(epoch) || response.method !== "begin-setup") return;
      setRecoveryCode(response.recoveryCode);
      setError(null);
      setVaultStatus("show-recovery-code");
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
  }, [ensureClient, isCurrentSession, locale, refreshLegacyState, setVaultStatus, terminateSession]);

  const confirmRecoverySaved = useCallback(async () => {
    const epoch = sessionEpochRef.current;
    const expectedLegacy = pendingLegacyMigrationRef.current;
    try {
      const response = await ensureClient().confirmSetup();
      if (!isCurrentSession(epoch) || response.method !== "confirm-setup") return;
      // Both crypto and exact read-back verification completed in the Worker.
      // Compare exact raw text again before deleting the source plaintext.
      if (
        expectedLegacy !== null &&
        window.localStorage.getItem(LEGACY_TASK_STORAGE_KEY) === expectedLegacy
      ) {
        window.localStorage.removeItem(LEGACY_TASK_STORAGE_KEY);
      }
      pendingLegacyMigrationRef.current = null;
      refreshLegacyState();
      applySnapshot(epoch, response.snapshot);
    } catch (cause) {
      pendingLegacyMigrationRef.current = null;
      setRecoveryCode(null);
      if (!isCurrentSession(epoch)) return;
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
    refreshLegacyState,
    setVaultStatus,
    terminateSession,
  ]);

  const cancelSetup = useCallback(async () => {
    const epoch = sessionEpochRef.current;
    try {
      await ensureClient().cancelSetup();
    } finally {
      pendingLegacyMigrationRef.current = null;
      if (isCurrentSession(epoch)) {
        clearRenderedPlaintext();
        setVaultStatus("needs-setup");
      }
    }
  }, [clearRenderedPlaintext, ensureClient, isCurrentSession, setVaultStatus]);

  const unlock = useCallback(async () => {
    const epoch = sessionEpochRef.current;
    try {
      const response = await ensureClient().unlock();
      if (response.method !== "unlock") throw new Error("Unexpected vault response.");
      applySnapshot(epoch, response.snapshot);
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
    async (code: string) => {
      const epoch = sessionEpochRef.current;
      try {
        const response = await ensureClient().recover(code);
        if (response.method !== "recover") throw new Error("Unexpected vault response.");
        applySnapshot(epoch, response.snapshot);
      } catch (cause) {
        setRecoveryCode(null);
        if (!isCurrentSession(epoch)) return;
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
      try {
        const response = await ensureClient().addTask(title);
        if (response.method !== "add-task") throw new Error("Unexpected vault response.");
        applySnapshot(epoch, response.snapshot);
      } catch (error) {
        if (isCurrentSession(epoch)) {
          terminateSession();
          setVaultStatus("locked");
        }
        throw error;
      }
    },
    [applySnapshot, ensureClient, isCurrentSession, setVaultStatus, terminateSession],
  );

  const toggleTask = useCallback(
    async (id: string) => {
      const epoch = sessionEpochRef.current;
      try {
        const response = await ensureClient().toggleTask(id);
        if (response.method !== "toggle-task") throw new Error("Unexpected vault response.");
        applySnapshot(epoch, response.snapshot);
      } catch (error) {
        if (isCurrentSession(epoch)) {
          terminateSession();
          setVaultStatus("locked");
        }
        throw error;
      }
    },
    [applySnapshot, ensureClient, isCurrentSession, setVaultStatus, terminateSession],
  );

  const retryLegacyImport = useCallback(async () => {
    const legacySnapshot = refreshLegacyState();
    if (legacySnapshot.raw === null || !legacySnapshot.state.valid) return;
    const epoch = sessionEpochRef.current;
    try {
      const response = await ensureClient().importLegacy(legacySnapshot.raw);
      if (!isCurrentSession(epoch) || response.method !== "import-legacy") return;
      if (window.localStorage.getItem(LEGACY_TASK_STORAGE_KEY) === legacySnapshot.raw) {
        window.localStorage.removeItem(LEGACY_TASK_STORAGE_KEY);
      }
      refreshLegacyState();
      applySnapshot(epoch, response.snapshot);
    } catch (cause) {
      if (!isCurrentSession(epoch)) return;
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
    refreshLegacyState,
    setVaultStatus,
    terminateSession,
  ]);

  const exportLegacy = useCallback(() => {
    const { raw } = readLegacy();
    if (raw !== null) downloadLegacy(raw);
  }, []);

  const deleteLegacy = useCallback(() => {
    if (window.localStorage.getItem(LEGACY_TASK_STORAGE_KEY) === null) return;
    window.localStorage.removeItem(LEGACY_TASK_STORAGE_KEY);
    pendingLegacyMigrationRef.current = null;
    setLegacy({ available: false, valid: true });
    if (statusRef.current === "legacy-invalid") setVaultStatus("needs-setup");
  }, [setVaultStatus]);

  const value = useMemo<PersonalVaultValue>(
    () => ({
      status,
      tasks,
      recoveryCode,
      error,
      legacyAvailable: legacy.available,
      beginSetup,
      confirmRecoverySaved,
      cancelSetup,
      unlock,
      recover,
      lock,
      addTask,
      toggleTask,
      retryLegacyImport,
      exportLegacy,
      deleteLegacy,
    }),
    [
      addTask,
      beginSetup,
      cancelSetup,
      confirmRecoverySaved,
      deleteLegacy,
      error,
      exportLegacy,
      legacy.available,
      lock,
      recover,
      recoveryCode,
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
