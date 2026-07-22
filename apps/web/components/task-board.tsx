"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useMemo, useRef, useState, type SubmitEventHandler } from "react";

import type { Locale } from "../lib/data/registry";
import {
  PERSONAL_VAULT_RECOVERY_SECRET_TIMEOUT_MS,
  usePersonalVault,
  type PersonalVaultStatus,
} from "./personal-vault-provider";

const builtInTaskTitles: Record<string, Record<Locale, string>> = {
  "reading-response": { en: "Draft reading response", "zh-CN": "起草阅读回应" },
  "transit-check": { en: "Review transit notes", "zh-CN": "核对交通记录" },
};

function text(locale: Locale) {
  return locale === "zh-CN"
    ? {
        acknowledge: "我已安全保存恢复码",
        add: "添加任务",
        busyCancel: "正在安全取消资料库设置…",
        busyConfirm: "正在验证加密资料并完成设置…",
        busyCreate: "正在创建加密资料库…",
        busyImport: "正在加密并验证旧数据…",
        busyRecover: "正在验证恢复码…",
        busySave: "正在加密保存更改…",
        busyUnlock: "正在解锁私人资料库…",
        cancel: "取消",
        checking: "正在检查私人资料库…",
        create: "创建私人资料库",
        delete: "删除旧数据",
        deleteDescription:
          "这会永久删除此浏览器中未加密的旧任务数据。私人加密资料库不会被删除。若仍需这些数据，请先导出副本。",
        deleteFailed: "无法删除旧数据；浏览器中的原始数据仍保留。请取消并检查站点存储权限。",
        deletePermanently: "永久删除旧数据",
        deleteTitle: "删除旧任务数据？",
        details: "恢复码只显示这一次。请离线保存，不要截图上传或发送给他人。",
        empty: "还没有任务。",
        export: "导出旧数据",
        exportComplete: "旧数据副本已开始下载。请确认保存后再决定是否删除。",
        exportFailed: "无法导出旧数据；浏览器中的原始数据仍保留。请检查站点存储权限。",
        exportFirst: "先导出副本",
        formRequired: "请输入任务名称。",
        legacy: "检测到旧任务数据。导入前会先加密并验证；数据不合规时不会自动删除。",
        legacyDeleted: "旧任务数据已从此浏览器永久删除。",
        lock: "锁定资料库",
        lockIdle: "私人资料库因十五分钟无操作而自动锁定。",
        lockManual: "私人资料库已锁定。",
        lockVisibility: "页面隐藏后，私人资料库已自动锁定。",
        lockWriteFailed: "保存失败后，私人资料库已为保护数据而锁定。",
        locked: "每次页面会话都需明确解锁。此按钮只使用本浏览器的受信设备密钥，不是身份验证。",
        newTask: "新任务",
        recover: "使用恢复码解锁",
        recovery: "恢复码（仅显示一次）",
        recoveryDisplayExpired: "恢复码显示已超时并被清除。请重新开始设置以生成新的恢复码。",
        recoveryInput: "恢复码",
        recoveryInputExpired: "恢复码输入已超时并被清除。请重新输入。",
        recoveryReady: "恢复码已生成。请先离线保存，再继续设置。",
        revokeOldestDevice: "撤销最早的受信设备访问权限以腾出槽位",
        revokeOldestDeviceWarning:
          "这会使最早加入的设备无法再用其本机密钥解锁。只有在你确认可以撤销该设备时才勾选。",
        retry: "重试导入旧数据",
        saveError: "无法保存更改。请按错误提示解锁后重试。",
        saveSuccess: "任务已加密保存。",
        setup:
          "创建前，请了解：清除站点数据或丢失本机密文将使任务无法恢复。当前本地版本的恢复码不能在其他设备上恢复这些任务。",
        setupReady: "私人资料库可以开始设置。",
        tasks: "任务",
        unavailable: "此浏览器不能安全运行私人资料库。旧任务数据保持不变，且不会降级为明文存储。",
        unavailableAnnounce: "此浏览器不支持安全的私人资料库。",
        unlock: "解锁私人资料库",
        unlockedAnnounce: "私人资料库已解锁。",
      }
    : {
        acknowledge: "I saved this recovery code securely",
        add: "Add task",
        busyCancel: "Safely cancelling vault setup…",
        busyConfirm: "Verifying encrypted data and finishing setup…",
        busyCreate: "Creating encrypted vault…",
        busyImport: "Encrypting and verifying legacy data…",
        busyRecover: "Verifying recovery code…",
        busySave: "Encrypting and saving the change…",
        busyUnlock: "Unlocking private vault…",
        cancel: "Cancel",
        checking: "Checking private vault…",
        create: "Create private vault",
        delete: "Delete legacy data",
        deleteDescription:
          "This permanently deletes unencrypted legacy task data from this browser. It does not delete the encrypted private vault. Export a copy first if you may still need this data.",
        deleteFailed:
          "Legacy data could not be deleted and remains in this browser. Cancel and check site-storage permissions.",
        deletePermanently: "Permanently delete legacy data",
        deleteTitle: "Delete legacy task data?",
        details:
          "This recovery code is shown once. Save it offline; do not upload, screenshot-share, or send it to anyone.",
        empty: "No tasks yet.",
        export: "Export legacy data",
        exportComplete:
          "The legacy-data download has started. Confirm that it is saved before deleting anything.",
        exportFailed:
          "Legacy data could not be exported and remains in this browser. Check site-storage permissions.",
        exportFirst: "Export a copy first",
        formRequired: "Enter a task name.",
        legacy:
          "Legacy task data was found. It is encrypted and verified before import; invalid data is never deleted automatically.",
        legacyDeleted: "Legacy task data was permanently deleted from this browser.",
        lock: "Lock vault",
        lockIdle: "The private vault locked after fifteen minutes without activity.",
        lockManual: "The private vault is locked.",
        lockVisibility: "The private vault locked because the page was hidden.",
        lockWriteFailed: "The private vault locked to protect data after a save failed.",
        locked:
          "Every page session requires an explicit unlock. This button uses this browser's trusted-device key; it is not identity verification.",
        newTask: "New task",
        recover: "Unlock with recovery code",
        recovery: "Recovery code (shown once)",
        recoveryDisplayExpired:
          "The recovery-code display expired and was cleared. Start setup again to create a new code.",
        recoveryInput: "Recovery code",
        recoveryInputExpired: "The recovery-code input expired and was cleared. Enter it again.",
        recoveryReady: "Your recovery code is ready. Save it offline before continuing setup.",
        revokeOldestDevice: "Revoke the oldest trusted-device access to free a slot",
        revokeOldestDeviceWarning:
          "That device will no longer unlock with its local key. Select this only when you confirm that its access may be revoked.",
        retry: "Retry legacy import",
        saveError: "The change could not be saved. Follow the error guidance, unlock, and retry.",
        saveSuccess: "Task encrypted and saved.",
        setup:
          "Before creating: clearing site data or losing local ciphertext will make these tasks unrecoverable. In this local version, a recovery code cannot recover these tasks on another device.",
        setupReady: "The private vault is ready to set up.",
        tasks: "Tasks",
        unavailable:
          "This browser cannot safely run the private vault. Legacy task data is unchanged and there is no plaintext fallback.",
        unavailableAnnounce: "This browser does not support the secure private vault.",
        unlock: "Unlock private vault",
        unlockedAnnounce: "The private vault is unlocked.",
      };
}

type Labels = ReturnType<typeof text>;
type PendingOperation = "setup" | "confirm" | "cancel" | "unlock" | "recover" | "save" | "import";

function pendingText(labels: Labels, operation: PendingOperation): string {
  switch (operation) {
    case "setup":
      return labels.busyCreate;
    case "confirm":
      return labels.busyConfirm;
    case "cancel":
      return labels.busyCancel;
    case "unlock":
      return labels.busyUnlock;
    case "recover":
      return labels.busyRecover;
    case "save":
      return labels.busySave;
    case "import":
      return labels.busyImport;
  }
}

function statusAnnouncement(
  labels: Labels,
  status: PersonalVaultStatus,
  lockReason: ReturnType<typeof usePersonalVault>["lastLockReason"],
  recoverySecretExpiry: ReturnType<typeof usePersonalVault>["recoverySecretExpiry"],
): string {
  if (recoverySecretExpiry === "display") return labels.recoveryDisplayExpired;
  if (recoverySecretExpiry === "input") return labels.recoveryInputExpired;
  switch (status) {
    case "checking":
      return labels.checking;
    case "unavailable":
      return labels.unavailableAnnounce;
    case "needs-setup":
    case "error":
      return labels.setupReady;
    case "show-recovery-code":
      return labels.recoveryReady;
    case "unlocked":
      return labels.unlockedAnnounce;
    case "legacy-invalid":
      return labels.legacy;
    case "locked":
      switch (lockReason) {
        case "idle":
          return labels.lockIdle;
        case "visibility":
          return labels.lockVisibility;
        case "write-failed":
          return labels.lockWriteFailed;
        case "manual":
        default:
          return labels.lockManual;
      }
  }
}

export function TaskBoard({ locale }: { readonly locale: Locale }) {
  const vault = usePersonalVault();
  const labels = useMemo(() => text(locale), [locale]);
  const [draft, setDraft] = useState("");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [recoveryInvalid, setRecoveryInvalid] = useState(false);
  const [allowOldestDeviceRevocation, setAllowOldestDeviceRevocation] = useState(false);
  const [announcement, setAnnouncement] = useState(() =>
    statusAnnouncement(labels, vault.status, vault.lastLockReason, vault.recoverySecretExpiry),
  );
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteDialogStatus, setDeleteDialogStatus] = useState("");
  const pendingRef = useRef<PendingOperation | null>(null);
  const recoveryInputRef = useRef<HTMLInputElement>(null);
  const recoveryInputTimerRef = useRef<number | undefined>(undefined);
  const recoveryAttemptedRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const deleteConfirmedRef = useRef(false);
  const previousStatusRef = useRef(vault.status);
  const previousLockReasonRef = useRef(vault.lastLockReason);
  const previousRecoveryExpiryRef = useRef(vault.recoverySecretExpiry);

  const clearRecoveryInputTimer = useCallback(() => {
    if (recoveryInputTimerRef.current === undefined) return;
    window.clearTimeout(recoveryInputTimerRef.current);
    recoveryInputTimerRef.current = undefined;
  }, []);

  const clearRecoveryInputSecret = useCallback(() => {
    clearRecoveryInputTimer();
    if (recoveryInputRef.current !== null) recoveryInputRef.current.value = "";
    setRecoveryInput("");
    setRecoveryInvalid(false);
    setAllowOldestDeviceRevocation(false);
    recoveryAttemptedRef.current = false;
  }, [clearRecoveryInputTimer]);

  const armRecoveryInputTimer = useCallback(() => {
    if (recoveryInputTimerRef.current !== undefined) return;
    recoveryInputTimerRef.current = window.setTimeout(() => {
      recoveryInputTimerRef.current = undefined;
      if (recoveryInputRef.current !== null) recoveryInputRef.current.value = "";
      setRecoveryInput("");
      setRecoveryInvalid(false);
      recoveryAttemptedRef.current = false;
      setAnnouncement(labels.recoveryInputExpired);
      vault.expireRecoveryInput();
    }, PERSONAL_VAULT_RECOVERY_SECRET_TIMEOUT_MS);
  }, [labels.recoveryInputExpired, vault.expireRecoveryInput]);

  const runOperation = useCallback(
    async (operation: PendingOperation, action: () => Promise<void>): Promise<void> => {
      if (pendingRef.current !== null) return;
      pendingRef.current = operation;
      setPending(operation);
      setAnnouncement(pendingText(labels, operation));
      try {
        await action();
      } finally {
        if (pendingRef.current === operation) {
          pendingRef.current = null;
          setPending(null);
        }
      }
    },
    [labels],
  );

  useEffect(() => {
    if (vault.status !== "unlocked") {
      setDraft("");
      setFormMessage("");
      setFormError(null);
    }
    if (vault.status !== "locked") {
      clearRecoveryInputSecret();
    }
  }, [clearRecoveryInputSecret, vault.status]);

  useEffect(() => {
    if (!recoveryAttemptedRef.current || vault.error === null || vault.status !== "locked") return;
    recoveryAttemptedRef.current = false;
    setRecoveryInvalid(!vault.recoveryDeviceLimitReached);
  }, [vault.error, vault.recoveryDeviceLimitReached, vault.status]);

  useEffect(() => {
    const statusChanged = previousStatusRef.current !== vault.status;
    const lockReasonChanged = previousLockReasonRef.current !== vault.lastLockReason;
    const recoveryExpiryChanged = previousRecoveryExpiryRef.current !== vault.recoverySecretExpiry;
    if (!statusChanged && !lockReasonChanged && !recoveryExpiryChanged) return;

    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = vault.status;
    previousLockReasonRef.current = vault.lastLockReason;
    previousRecoveryExpiryRef.current = vault.recoverySecretExpiry;
    setAnnouncement(
      statusAnnouncement(labels, vault.status, vault.lastLockReason, vault.recoverySecretExpiry),
    );

    if ((!statusChanged && !recoveryExpiryChanged) || previousStatus === "checking") return;
    const frame = window.requestAnimationFrame(() => headingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [labels, vault.lastLockReason, vault.recoverySecretExpiry, vault.status]);

  useEffect(() => {
    const clearWhenHidden = () => {
      if (document.visibilityState === "hidden") clearRecoveryInputSecret();
    };

    window.addEventListener("pagehide", clearRecoveryInputSecret);
    document.addEventListener("visibilitychange", clearWhenHidden);
    return () => {
      window.removeEventListener("pagehide", clearRecoveryInputSecret);
      document.removeEventListener("visibilitychange", clearWhenHidden);
    };
  }, [clearRecoveryInputSecret]);

  useEffect(() => clearRecoveryInputTimer, [clearRecoveryInputTimer]);

  const submitTask: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const title = draft.trim();
    if (title.length === 0) {
      setFormMessage("");
      setFormError(labels.formRequired);
      setAnnouncement(labels.formRequired);
      return;
    }

    setFormError(null);
    setFormMessage("");
    void runOperation("save", async () => {
      await vault.addTask(title);
      setDraft("");
      setFormMessage(labels.saveSuccess);
      setAnnouncement(labels.saveSuccess);
    }).catch(() => {
      setFormError(labels.saveError);
      setAnnouncement(labels.saveError);
    });
  };

  const busy = pending !== null;
  const heading = vault.status === "show-recovery-code" ? labels.recovery : labels.tasks;
  const progress = pending === null ? null : pendingText(labels, pending);

  const deleteTrigger = () => (
    <Dialog.Trigger asChild>
      <button className="button button-quiet button-danger-quiet" disabled={busy} type="button">
        {labels.delete}
      </button>
    </Dialog.Trigger>
  );

  let content;
  if (vault.status === "checking") {
    content = <p>{labels.checking}</p>;
  } else if (vault.status === "unavailable") {
    content = (
      <>
        <p className="notice notice-danger" role="status">
          {vault.error ?? labels.unavailable}
        </p>
        {vault.legacyAvailable ? (
          <div className="vault-actions">
            <button
              className="button button-quiet"
              disabled={busy}
              onClick={vault.exportLegacy}
              type="button"
            >
              {labels.export}
            </button>
            {deleteTrigger()}
          </div>
        ) : null}
      </>
    );
  } else if (vault.status === "legacy-invalid") {
    content = (
      <>
        <p className="notice notice-danger" role="alert">
          {labels.legacy}
        </p>
        <div className="vault-actions">
          <button className="button button-quiet" disabled={busy} onClick={vault.exportLegacy} type="button">
            {labels.export}
          </button>
          {deleteTrigger()}
        </div>
      </>
    );
  } else if (vault.status === "needs-setup" || vault.status === "error") {
    content = (
      <>
        <p id="vault-setup-description">{labels.setup}</p>
        {vault.legacyAvailable ? <p className="notice notice-warning">{labels.legacy}</p> : null}
        {vault.error === null ? null : (
          <p className="notice notice-danger" id="vault-error" role="alert">
            {vault.error}
          </p>
        )}
        <button
          aria-describedby="vault-setup-description"
          className="button"
          disabled={busy}
          onClick={() => void runOperation("setup", vault.beginSetup)}
          type="button"
        >
          {labels.create}
        </button>
        {vault.legacyAvailable ? (
          <div className="vault-actions">
            <button
              className="button button-quiet"
              disabled={busy}
              onClick={vault.exportLegacy}
              type="button"
            >
              {labels.export}
            </button>
            {deleteTrigger()}
          </div>
        ) : null}
      </>
    );
  } else if (vault.status === "show-recovery-code") {
    content = (
      <>
        <p aria-labelledby="tasks-title" className="vault-recovery-code">
          {vault.recoveryCode}
        </p>
        <p className="notice notice-warning" id="vault-recovery-warning">
          {labels.details}
        </p>
        <div className="vault-actions">
          <button
            aria-describedby="vault-recovery-warning"
            className="button"
            disabled={busy}
            onClick={() => void runOperation("confirm", vault.confirmRecoverySaved)}
            type="button"
          >
            {labels.acknowledge}
          </button>
          <button
            className="button button-quiet"
            disabled={busy}
            onClick={() => void runOperation("cancel", vault.cancelSetup)}
            type="button"
          >
            {labels.cancel}
          </button>
        </div>
      </>
    );
  } else if (vault.status === "locked") {
    content = (
      <>
        <p>{labels.locked}</p>
        {vault.error === null ? null : (
          <p className="notice notice-danger" id="vault-error" role="alert">
            {vault.error}
          </p>
        )}
        <button
          className="button"
          disabled={busy}
          onClick={() => void runOperation("unlock", vault.unlock)}
          type="button"
        >
          {labels.unlock}
        </button>
        <details className="vault-recovery">
          <summary>{labels.recover}</summary>
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              const submittedCode = recoveryInput;
              const submittedRevocationConsent = allowOldestDeviceRevocation;
              clearRecoveryInputSecret();
              recoveryAttemptedRef.current = true;
              void runOperation("recover", () => vault.recover(submittedCode, submittedRevocationConsent));
            }}
          >
            <label htmlFor="vault-recovery-code">{labels.recoveryInput}</label>
            <input
              aria-describedby={vault.error === null ? undefined : "vault-error"}
              aria-invalid={recoveryInvalid ? true : undefined}
              autoComplete="off"
              disabled={busy}
              id="vault-recovery-code"
              onChange={(event) => {
                const next = event.target.value;
                setRecoveryInput(next);
                if (next.length === 0) clearRecoveryInputTimer();
                else armRecoveryInputTimer();
                if (recoveryInvalid) setRecoveryInvalid(false);
              }}
              ref={recoveryInputRef}
              spellCheck={false}
              type="password"
              value={recoveryInput}
            />
            {vault.recoveryDeviceLimitReached ? (
              <label className="check-row" htmlFor="vault-revoke-oldest-device">
                <input
                  aria-describedby="vault-revoke-oldest-device-warning"
                  checked={allowOldestDeviceRevocation}
                  disabled={busy}
                  id="vault-revoke-oldest-device"
                  onChange={(event) => setAllowOldestDeviceRevocation(event.target.checked)}
                  type="checkbox"
                />
                <span>{labels.revokeOldestDevice}</span>
              </label>
            ) : null}
            {vault.recoveryDeviceLimitReached ? (
              <p className="fine-print" id="vault-revoke-oldest-device-warning">
                {labels.revokeOldestDeviceWarning}
              </p>
            ) : null}
            <button className="button button-quiet" disabled={busy} type="submit">
              {labels.recover}
            </button>
          </form>
        </details>
      </>
    );
  } else {
    content = (
      <>
        {vault.tasks.length === 0 ? <p className="fine-print">{labels.empty}</p> : null}
        <ul className="task-list">
          {vault.tasks.map((task) => {
            const title = builtInTaskTitles[task.id]?.[locale] ?? task.title;
            return (
              <li key={task.id}>
                <label className="check-row">
                  <input
                    aria-label={title}
                    checked={task.done}
                    disabled={busy}
                    onChange={() => {
                      setFormError(null);
                      setFormMessage("");
                      void runOperation("save", () => vault.toggleTask(task.id)).catch(() => {
                        setFormError(labels.saveError);
                        setAnnouncement(labels.saveError);
                      });
                    }}
                    type="checkbox"
                  />
                  <span className={task.done ? "task-done" : undefined}>{title}</span>
                </label>
              </li>
            );
          })}
        </ul>
        <form className="inline-form" onSubmit={submitTask}>
          <label htmlFor="new-task">{labels.newTask}</label>
          <input
            aria-describedby="task-form-feedback"
            aria-invalid={formError === null ? undefined : true}
            disabled={busy}
            id="new-task"
            onChange={(event) => {
              setDraft(event.target.value);
              if (formError !== null) setFormError(null);
            }}
            value={draft}
          />
          <button className="button" disabled={busy} type="submit">
            {labels.add}
          </button>
        </form>
        <p className={`form-status${formError === null ? "" : " form-error"}`} id="task-form-feedback">
          {formError === null ? (
            <span aria-live="polite" role="status">
              {formMessage}
            </span>
          ) : (
            <span role="alert">{formError}</span>
          )}
        </p>
        {vault.legacyAvailable ? (
          <div className="vault-actions">
            <p className="fine-print">{labels.legacy}</p>
            <button
              className="button button-quiet"
              disabled={busy}
              onClick={() => void runOperation("import", vault.retryLegacyImport)}
              type="button"
            >
              {labels.retry}
            </button>
            <button
              className="button button-quiet"
              disabled={busy}
              onClick={vault.exportLegacy}
              type="button"
            >
              {labels.export}
            </button>
            {deleteTrigger()}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <Dialog.Root
      onOpenChange={(open) => {
        setDeleteDialogOpen(open);
        setDeleteDialogStatus("");
      }}
      open={deleteDialogOpen}
    >
      <p
        aria-atomic="true"
        aria-live="polite"
        className="sr-only"
        data-testid="vault-live-region"
        role="status"
      >
        {announcement}
      </p>
      <section
        aria-busy={busy || vault.status === "checking"}
        aria-labelledby="tasks-title"
        className="task-board"
        data-vault-status={vault.status}
      >
        <div className="section-heading">
          <h2 id="tasks-title" ref={headingRef} tabIndex={-1}>
            {heading}
          </h2>
          {vault.status === "unlocked" ? (
            <button className="button button-quiet" disabled={busy} onClick={vault.lock} type="button">
              {labels.lock}
            </button>
          ) : null}
        </div>
        {progress === null ? null : <p className="vault-progress">{progress}</p>}
        {content}
      </section>

      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog-content vault-delete-dialog"
          onCloseAutoFocus={(event) => {
            if (!deleteConfirmedRef.current) return;
            event.preventDefault();
            deleteConfirmedRef.current = false;
            window.requestAnimationFrame(() => headingRef.current?.focus());
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelDeleteRef.current?.focus();
          }}
        >
          <Dialog.Title>{labels.deleteTitle}</Dialog.Title>
          <Dialog.Description>{labels.deleteDescription}</Dialog.Description>
          <div className="vault-actions">
            <button
              className="button button-quiet"
              onClick={() => {
                const exported = vault.exportLegacy();
                const result = exported ? labels.exportComplete : labels.exportFailed;
                setDeleteDialogStatus(result);
              }}
              type="button"
            >
              {labels.exportFirst}
            </button>
            <Dialog.Close asChild>
              <button className="button button-quiet" ref={cancelDeleteRef} type="button">
                {labels.cancel}
              </button>
            </Dialog.Close>
            <button
              className="button button-danger"
              onClick={() => {
                const deleted = vault.deleteLegacy();
                if (!deleted) {
                  setDeleteDialogStatus(labels.deleteFailed);
                  return;
                }
                deleteConfirmedRef.current = true;
                setDeleteDialogOpen(false);
                setAnnouncement(labels.legacyDeleted);
              }}
              type="button"
            >
              {labels.deletePermanently}
            </button>
          </div>
          <p aria-live="polite" className="form-status" role="status">
            {deleteDialogStatus}
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
