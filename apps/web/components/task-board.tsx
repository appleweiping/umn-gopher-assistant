"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useMemo, useRef, useState, type SubmitEventHandler } from "react";

import type { Locale } from "../lib/data/registry";
import { PersonalVaultClientError } from "../lib/personal-vault/client";
import { PERSONAL_VAULT_MAX_RECOVERY_CODE_LENGTH } from "../lib/personal-vault/protocol";
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
        busySync: "正在验证并同步加密资料…",
        busyEnableSync: "正在验证恢复码并启用账户同步…",
        busyPair: "正在创建受信设备配对请求…",
        busyCancelPairing: "正在确认取消设备配对…",
        busyRegeneratePairing: "正在取消旧请求并生成新配对码…",
        busyPoll: "正在检查配对批准状态…",
        busyApprove: "正在验证并批准所选设备…",
        busyRemoteRecover: "正在验证远程资料库与恢复凭据…",
        busyRemoteResume: "正在安全重放远程恢复步骤…",
        busyRemoteAbandon: "正在放弃过期的恢复配对并清除本机临时密钥…",
        busyRemotePrepare: "正在生成新根密钥与替代恢复码…",
        busyRemoteConfirm: "正在轮换密钥并独立回读验证…",
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
        pairDevice: "将此浏览器配对为受信设备",
        pairingCode: "短期设备配对码",
        pairingCodeHelp: "请在已解锁的受信设备上选择相同请求编号，再手动输入此代码。代码不会发送给服务器。",
        pairingPoll: "检查是否已批准",
        pairingExpires: "有效期至",
        pairingCodeGone:
          "配对码已因页面隐藏、刷新或超时而清除。服务器从未收到该代码；请取消旧请求并生成新代码。",
        cancelPairing: "取消配对请求",
        regeneratePairing: "取消并生成新代码",
        pendingDevices: "待批准设备",
        refreshPairings: "刷新待批准请求",
        approvePairing: "批准所选设备",
        approvalCode: "新设备显示的八位配对码",
        noPairings: "目前没有待批准请求。",
        syncNow: "立即同步",
        enableAccountSync: "启用账户同步",
        enableAccountSyncHelp:
          "请重新输入创建当前资料库时保存的原恢复码。代码只在隔离 Worker 中验证，不会上传；错误代码不会更改本机或云端状态。",
        enableRecoveryCode: "原恢复码",
        enableSyncSuccess: "账户绑定同步已安全启用或已排队重试。",
        syncSignedOut: "仅本机：登录后才能启用账户绑定同步。",
        syncLocalOnly: "仅本机：此资料库尚未绑定云端。",
        syncSyncing: "正在同步加密资料。",
        syncSynced: "加密资料已同步。",
        syncDeferred: "更改已安全保存在本机；网络恢复后可重试同步。",
        syncConflict: "发现并发冲突；同步已锁定，未执行覆盖。",
        syncPairing: "正在等待明确的设备配对批准。",
        syncRecovery: "远程恢复尚未完成；普通同步与写入已阻止。",
        syncHardening: "恢复设备已建立，但必须立即轮换根密钥和恢复凭据。",
        syncRollback: "检测到云端回滚或篡改；同步已锁定。",
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
          "恢复码可在已认证账户边界内授权恢复或新设备，但前提是加密资料已成功同步。若状态为“仅本机”，清除站点数据或丢失本机密文后无法跨设备恢复。",
        setupReady: "私人资料库可以开始设置。",
        tasks: "任务",
        unavailable: "此浏览器不能安全运行私人资料库。旧任务数据保持不变，且不会降级为明文存储。",
        unavailableAnnounce: "此浏览器不支持安全的私人资料库。",
        unlock: "解锁私人资料库",
        unlockedAnnounce: "私人资料库已解锁。",
        remoteRecoveryTitle: "从账户加密副本恢复",
        remoteRecoveryHelp:
          "旧恢复码仅在隔离 Worker 内验证。错误代码不会读取远端密文，也不会写入本机或发起任何变更。",
        remoteRecoveryCode: "旧恢复码",
        remoteRecoveryAction: "验证并恢复此设备",
        remoteRecoveryResume: "继续安全恢复",
        remoteRecoveryAbandon: "放弃此恢复并重新开始",
        remoteRecoveryAbandonHelp:
          "仅在恢复配对过期或无法继续时使用。它只会清除尚未提升的本机临时设备；不会清除已进入密钥轮换的恢复状态。服务端请求会尽力取消，否则会自行过期。",
        remoteRecoveryPending: "恢复步骤已安全保存。可继续原样重放；普通写入在根密钥轮换完成前保持关闭。",
        hardeningPrepare: "生成新的恢复码并加固",
        hardeningResume: "继续密钥轮换与回读",
        hardeningWarning: "必须撤销旧设备和旧恢复凭据后才能编辑。此阶段不会允许普通同步或写入。",
        rotationRecoveryTitle: "新的恢复码（仅显示一次）",
        rotationRecoveryDetails:
          "请离线保存。确认前不会发送轮换；确认后若刷新，此代码不会再次显示，必须使用你保存的副本。",
        rotationRecoveryConfirm: "我已离线保存，立即轮换",
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
        busySync: "Authenticating and syncing encrypted data…",
        busyEnableSync: "Verifying the recovery code and enabling account sync…",
        busyPair: "Creating a trusted-device pairing request…",
        busyCancelPairing: "Confirming device-pairing cancellation…",
        busyRegeneratePairing: "Cancelling the old request and creating a new pairing code…",
        busyPoll: "Checking pairing approval…",
        busyApprove: "Verifying and approving the selected device…",
        busyRemoteRecover: "Authenticating the remote vault and recovery credential…",
        busyRemoteResume: "Safely replaying the remote recovery step…",
        busyRemoteAbandon: "Abandoning the expired recovery pairing and clearing its temporary local key…",
        busyRemotePrepare: "Generating a new root key and replacement recovery code…",
        busyRemoteConfirm: "Rotating keys and independently reading the vault back…",
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
        pairDevice: "Pair this browser as a trusted device",
        pairingCode: "Short-lived device pairing code",
        pairingCodeHelp:
          "On an already unlocked trusted device, select the matching request ID and manually enter this code. The code is never sent to the server.",
        pairingPoll: "Check approval",
        pairingExpires: "Expires",
        pairingCodeGone:
          "The pairing code was cleared after the page was hidden, refreshed, or timed out. The server never received it; cancel the old request and generate a new code.",
        cancelPairing: "Cancel pairing request",
        regeneratePairing: "Cancel and generate new code",
        pendingDevices: "Pending devices",
        refreshPairings: "Refresh pending requests",
        approvePairing: "Approve selected device",
        approvalCode: "Eight-character code shown on the new device",
        noPairings: "There are no pending device requests.",
        syncNow: "Sync now",
        enableAccountSync: "Enable account sync",
        enableAccountSyncHelp:
          "Re-enter the original recovery code saved when this vault was created. It is verified only inside the isolated Worker and is never uploaded; a wrong code changes neither local nor cloud state.",
        enableRecoveryCode: "Original recovery code",
        enableSyncSuccess: "Account-bound sync is enabled or safely queued for retry.",
        syncSignedOut: "Local only: sign in to enable account-bound sync.",
        syncLocalOnly: "Local only: this vault is not bound to cloud sync.",
        syncSyncing: "Encrypted data is syncing.",
        syncSynced: "Encrypted data is synced.",
        syncDeferred: "Changes are safe locally; retry sync when the network returns.",
        syncConflict: "A concurrent conflict was detected; sync is locked without overwriting data.",
        syncPairing: "Waiting for explicit trusted-device approval.",
        syncRecovery: "Remote recovery is incomplete; ordinary sync and writes are blocked.",
        syncHardening:
          "The recovered device is established, but root and recovery credentials must rotate now.",
        syncRollback: "Cloud rollback or tampering was detected; sync is locked.",
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
          "A recovery code can authorize recovery or a new device within the authenticated account boundary only after encrypted sync succeeds. While marked local only, clearing site data or losing local ciphertext prevents cross-device recovery.",
        setupReady: "The private vault is ready to set up.",
        tasks: "Tasks",
        unavailable:
          "This browser cannot safely run the private vault. Legacy task data is unchanged and there is no plaintext fallback.",
        unavailableAnnounce: "This browser does not support the secure private vault.",
        unlock: "Unlock private vault",
        unlockedAnnounce: "The private vault is unlocked.",
        remoteRecoveryTitle: "Recover from the account-encrypted copy",
        remoteRecoveryHelp:
          "The old recovery code is verified only in the isolated Worker. A wrong code neither reads remote ciphertext nor writes local state or sends a mutation.",
        remoteRecoveryCode: "Old recovery code",
        remoteRecoveryAction: "Authenticate and recover this device",
        remoteRecoveryResume: "Continue secure recovery",
        remoteRecoveryAbandon: "Abandon this recovery and start over",
        remoteRecoveryAbandonHelp:
          "Use this only when the recovery pairing expired or cannot continue. It clears only the unpromoted temporary device on this browser; a key rotation in progress can never be cleared here. The server request is cancelled when possible and otherwise expires.",
        remoteRecoveryPending:
          "The recovery step is durably staged and can be replayed exactly. Ordinary writes stay disabled until root-key rotation finishes.",
        hardeningPrepare: "Generate new recovery code and harden",
        hardeningResume: "Continue key rotation and read-back",
        hardeningWarning:
          "Old devices and recovery credentials must be revoked before editing. Ordinary sync and writes are disabled in this state.",
        rotationRecoveryTitle: "New recovery code (shown once)",
        rotationRecoveryDetails:
          "Save it offline. No rotation is sent before confirmation. After confirmation, a refresh will not show this code again; you must use your saved copy.",
        rotationRecoveryConfirm: "I saved it offline; rotate now",
      };
}

type Labels = ReturnType<typeof text>;
type PendingOperation =
  | "setup"
  | "confirm"
  | "cancel"
  | "unlock"
  | "recover"
  | "save"
  | "import"
  | "sync"
  | "enable-sync"
  | "pair"
  | "cancel-pairing"
  | "regenerate-pairing"
  | "poll"
  | "approve"
  | "remote-recover"
  | "remote-resume"
  | "remote-abandon"
  | "remote-prepare"
  | "remote-confirm";

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
    case "sync":
      return labels.busySync;
    case "enable-sync":
      return labels.busyEnableSync;
    case "pair":
      return labels.busyPair;
    case "cancel-pairing":
      return labels.busyCancelPairing;
    case "regenerate-pairing":
      return labels.busyRegeneratePairing;
    case "poll":
      return labels.busyPoll;
    case "approve":
      return labels.busyApprove;
    case "remote-recover":
      return labels.busyRemoteRecover;
    case "remote-resume":
      return labels.busyRemoteResume;
    case "remote-abandon":
      return labels.busyRemoteAbandon;
    case "remote-prepare":
      return labels.busyRemotePrepare;
    case "remote-confirm":
      return labels.busyRemoteConfirm;
  }
}

function syncText(labels: Labels, state: ReturnType<typeof usePersonalVault>["syncState"]): string {
  switch (state) {
    case "signed-out":
      return labels.syncSignedOut;
    case "local-only":
      return labels.syncLocalOnly;
    case "syncing":
      return labels.syncSyncing;
    case "synced":
      return labels.syncSynced;
    case "deferred":
      return labels.syncDeferred;
    case "conflict":
      return labels.syncConflict;
    case "pairing":
      return labels.syncPairing;
    case "recovery":
      return labels.syncRecovery;
    case "hardening":
      return labels.syncHardening;
    case "rollback":
      return labels.syncRollback;
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
    case "show-remote-recovery-code":
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
  const [syncRecoveryInput, setSyncRecoveryInput] = useState("");
  const [remoteRecoveryInput, setRemoteRecoveryInput] = useState("");
  const [remoteRecoveryInvalid, setRemoteRecoveryInvalid] = useState(false);
  const [syncRecoveryInvalid, setSyncRecoveryInvalid] = useState(false);
  const [formMessage, setFormMessage] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [recoveryInvalid, setRecoveryInvalid] = useState(false);
  const [allowOldestDeviceRevocation, setAllowOldestDeviceRevocation] = useState(false);
  const [selectedPairingId, setSelectedPairingId] = useState("");
  const [pairingApprovalCode, setPairingApprovalCode] = useState("");
  const [announcement, setAnnouncement] = useState(() =>
    statusAnnouncement(labels, vault.status, vault.lastLockReason, vault.recoverySecretExpiry),
  );
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteDialogStatus, setDeleteDialogStatus] = useState("");
  const pendingRef = useRef<PendingOperation | null>(null);
  const recoveryInputRef = useRef<HTMLInputElement>(null);
  const recoveryInputTimerRef = useRef<number | undefined>(undefined);
  const syncRecoveryInputRef = useRef<HTMLInputElement>(null);
  const remoteRecoveryInputRef = useRef<HTMLInputElement>(null);
  const syncRecoveryInputTimerRef = useRef<number | undefined>(undefined);
  const remoteRecoveryInputTimerRef = useRef<number | undefined>(undefined);
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

  const clearPairingApprovalSecret = useCallback(() => {
    setPairingApprovalCode("");
  }, []);

  const clearSyncRecoveryInputSecret = useCallback(() => {
    if (syncRecoveryInputTimerRef.current !== undefined) {
      window.clearTimeout(syncRecoveryInputTimerRef.current);
      syncRecoveryInputTimerRef.current = undefined;
    }
    if (syncRecoveryInputRef.current !== null) syncRecoveryInputRef.current.value = "";
    setSyncRecoveryInput("");
    setSyncRecoveryInvalid(false);
  }, []);

  const clearRemoteRecoveryInputSecret = useCallback(() => {
    if (remoteRecoveryInputTimerRef.current !== undefined) {
      window.clearTimeout(remoteRecoveryInputTimerRef.current);
      remoteRecoveryInputTimerRef.current = undefined;
    }
    if (remoteRecoveryInputRef.current !== null) remoteRecoveryInputRef.current.value = "";
    setRemoteRecoveryInput("");
    setRemoteRecoveryInvalid(false);
  }, []);

  const armRemoteRecoveryInputTimer = useCallback(() => {
    if (remoteRecoveryInputTimerRef.current !== undefined) return;
    remoteRecoveryInputTimerRef.current = window.setTimeout(() => {
      remoteRecoveryInputTimerRef.current = undefined;
      if (remoteRecoveryInputRef.current !== null) remoteRecoveryInputRef.current.value = "";
      setRemoteRecoveryInput("");
      setRemoteRecoveryInvalid(false);
      setAnnouncement(labels.recoveryInputExpired);
    }, PERSONAL_VAULT_RECOVERY_SECRET_TIMEOUT_MS);
  }, [labels.recoveryInputExpired]);

  const armSyncRecoveryInputTimer = useCallback(() => {
    if (syncRecoveryInputTimerRef.current !== undefined) return;
    syncRecoveryInputTimerRef.current = window.setTimeout(() => {
      syncRecoveryInputTimerRef.current = undefined;
      if (syncRecoveryInputRef.current !== null) syncRecoveryInputRef.current.value = "";
      setSyncRecoveryInput("");
      setSyncRecoveryInvalid(false);
      setAnnouncement(labels.recoveryInputExpired);
    }, PERSONAL_VAULT_RECOVERY_SECRET_TIMEOUT_MS);
  }, [labels.recoveryInputExpired]);

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
      clearSyncRecoveryInputSecret();
    }
    if (vault.status !== "needs-setup" && vault.status !== "error") {
      clearRemoteRecoveryInputSecret();
    }
    if (vault.status !== "locked") {
      clearRecoveryInputSecret();
    }
  }, [clearRecoveryInputSecret, clearRemoteRecoveryInputSecret, clearSyncRecoveryInputSecret, vault.status]);

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
      if (document.visibilityState === "hidden") {
        clearRecoveryInputSecret();
        clearSyncRecoveryInputSecret();
        clearRemoteRecoveryInputSecret();
        clearPairingApprovalSecret();
      }
    };

    const pagehide = () => {
      clearRecoveryInputSecret();
      clearSyncRecoveryInputSecret();
      clearRemoteRecoveryInputSecret();
      clearPairingApprovalSecret();
    };
    window.addEventListener("pagehide", pagehide);
    document.addEventListener("visibilitychange", clearWhenHidden);
    return () => {
      window.removeEventListener("pagehide", pagehide);
      document.removeEventListener("visibilitychange", clearWhenHidden);
    };
  }, [
    clearPairingApprovalSecret,
    clearRecoveryInputSecret,
    clearRemoteRecoveryInputSecret,
    clearSyncRecoveryInputSecret,
  ]);

  useEffect(
    () => () => {
      clearRecoveryInputTimer();
      if (syncRecoveryInputTimerRef.current !== undefined) {
        window.clearTimeout(syncRecoveryInputTimerRef.current);
      }
      if (remoteRecoveryInputTimerRef.current !== undefined) {
        window.clearTimeout(remoteRecoveryInputTimerRef.current);
      }
    },
    [clearRecoveryInputTimer],
  );

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
  const heading =
    vault.status === "show-recovery-code"
      ? labels.recovery
      : vault.status === "show-remote-recovery-code"
        ? labels.rotationRecoveryTitle
        : labels.tasks;
  const progress = pending === null ? null : pendingText(labels, pending);

  const deleteTrigger = () => (
    <Dialog.Trigger asChild>
      <button className="button button-quiet button-danger-quiet" disabled={busy} type="button">
        {labels.delete}
      </button>
    </Dialog.Trigger>
  );

  const syncPanel = (
    <section aria-labelledby="vault-sync-title" className="vault-sync-panel">
      <h3 id="vault-sync-title">{locale === "zh-CN" ? "账户绑定同步" : "Account-bound sync"}</h3>
      <p
        className={
          vault.syncState === "conflict" || vault.syncState === "rollback"
            ? "notice notice-danger"
            : vault.syncState === "deferred"
              ? "notice notice-warning"
              : "fine-print"
        }
        data-sync-state={vault.syncState}
        role="status"
      >
        {syncText(labels, vault.syncState)}
      </p>
      {vault.status === "unlocked" && vault.error !== null ? (
        <p className="notice notice-danger" id="vault-sync-error" role="alert">
          {vault.error}
        </p>
      ) : null}
      {vault.status === "unlocked" && vault.syncState === "hardening" ? (
        <div className="notice notice-warning" role="alert">
          <p>{labels.hardeningWarning}</p>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void runOperation(
                vault.remoteRecoveryStage === "rotation-pending" ? "remote-resume" : "remote-prepare",
                vault.remoteRecoveryStage === "rotation-pending"
                  ? vault.resumeRemoteRecovery
                  : vault.prepareRemoteRecoveryRotation,
              )
            }
            type="button"
          >
            {vault.remoteRecoveryStage === "rotation-pending"
              ? labels.hardeningResume
              : labels.hardeningPrepare}
          </button>
        </div>
      ) : null}
      {vault.status === "unlocked" && vault.syncState === "local-only" ? (
        <form
          className="inline-form vault-enable-sync"
          onSubmit={(event) => {
            event.preventDefault();
            const code = syncRecoveryInput;
            clearSyncRecoveryInputSecret();
            void runOperation("enable-sync", () => vault.enableAccountSync(code))
              .then(() => setAnnouncement(labels.enableSyncSuccess))
              .catch((cause: unknown) => {
                if (cause instanceof PersonalVaultClientError && cause.code === "AUTHENTICATION_FAILED") {
                  setSyncRecoveryInvalid(true);
                }
              });
          }}
        >
          <p className="fine-print" id="vault-enable-sync-help">
            {labels.enableAccountSyncHelp}
          </p>
          <label htmlFor="vault-enable-sync-recovery-code">{labels.enableRecoveryCode}</label>
          <input
            aria-describedby={`vault-enable-sync-help${vault.error === null ? "" : " vault-sync-error"}`}
            aria-invalid={syncRecoveryInvalid ? true : undefined}
            autoComplete="off"
            disabled={busy}
            id="vault-enable-sync-recovery-code"
            maxLength={PERSONAL_VAULT_MAX_RECOVERY_CODE_LENGTH}
            onChange={(event) => {
              const next = event.currentTarget.value;
              setSyncRecoveryInput(next);
              if (next.length === 0) {
                if (syncRecoveryInputTimerRef.current !== undefined) {
                  window.clearTimeout(syncRecoveryInputTimerRef.current);
                  syncRecoveryInputTimerRef.current = undefined;
                }
              } else {
                armSyncRecoveryInputTimer();
              }
              if (syncRecoveryInvalid) setSyncRecoveryInvalid(false);
            }}
            ref={syncRecoveryInputRef}
            spellCheck={false}
            type="password"
            value={syncRecoveryInput}
          />
          <button className="button" disabled={busy || syncRecoveryInput.length === 0} type="submit">
            {labels.enableAccountSync}
          </button>
        </form>
      ) : null}
      {vault.hasPendingPairing ? (
        <div className="vault-pairing-code">
          {vault.pairingCode === null ? null : (
            <>
              <p>
                <strong>{labels.pairingCode}</strong>
              </p>
              <output aria-label={labels.pairingCode}>{vault.pairingCode}</output>
            </>
          )}
          {vault.pairingCode === null ? (
            <p className="notice notice-warning">{labels.pairingCodeGone}</p>
          ) : null}
          <p className="fine-print">
            {vault.pairingCode === null ? null : (
              <>
                {labels.pairingCodeHelp}
                <br />
              </>
            )}
            {vault.pairingId === null ? null : (
              <span>
                ID: <code>{vault.pairingId}</code>
              </span>
            )}
            {vault.pairingExpiresAt === null ? null : (
              <>
                <br />
                <span>
                  {labels.pairingExpires}:{" "}
                  <time dateTime={vault.pairingExpiresAt}>{vault.pairingExpiresAt}</time>
                </span>
              </>
            )}
          </p>
          <div className="vault-actions">
            <button
              className="button button-quiet"
              disabled={busy}
              onClick={() => void runOperation("poll", vault.pollDevicePairing)}
              type="button"
            >
              {labels.pairingPoll}
            </button>
            <button
              className="button button-quiet"
              disabled={busy}
              onClick={() => void runOperation("cancel-pairing", vault.cancelDevicePairing)}
              type="button"
            >
              {labels.cancelPairing}
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => void runOperation("regenerate-pairing", vault.regenerateDevicePairing)}
              type="button"
            >
              {labels.regeneratePairing}
            </button>
          </div>
        </div>
      ) : null}
      {(vault.status === "needs-setup" || vault.status === "error") &&
      vault.syncState === "pairing" &&
      !vault.hasPendingPairing ? (
        <button
          className="button"
          disabled={busy}
          onClick={() => void runOperation("pair", vault.beginDevicePairing)}
          type="button"
        >
          {labels.pairDevice}
        </button>
      ) : null}
      {vault.status === "unlocked" ? (
        <>
          <div className="vault-actions">
            <button
              className="button button-quiet"
              disabled={
                busy ||
                vault.syncState === "rollback" ||
                vault.syncState === "conflict" ||
                vault.syncState === "hardening"
              }
              onClick={() => void runOperation("sync", vault.syncNow)}
              type="button"
            >
              {labels.syncNow}
            </button>
            <button
              className="button button-quiet"
              disabled={busy || vault.syncState === "hardening"}
              onClick={() => void runOperation("sync", vault.listDevicePairings)}
              type="button"
            >
              {labels.refreshPairings}
            </button>
          </div>
          <form
            aria-labelledby="vault-pairings-title"
            onSubmit={(event) => {
              event.preventDefault();
              const normalizedCode = pairingApprovalCode.trim().toUpperCase();
              if (selectedPairingId.length === 0 || !/^[A-Z2-9]{4}-[A-Z2-9]{4}$/u.test(normalizedCode)) {
                setAnnouncement(labels.approvalCode);
                return;
              }
              void runOperation("approve", async () => {
                await vault.approveDevicePairing(selectedPairingId, normalizedCode);
                setPairingApprovalCode("");
                setSelectedPairingId("");
              });
            }}
          >
            <fieldset disabled={vault.syncState === "hardening"}>
              <legend id="vault-pairings-title">{labels.pendingDevices}</legend>
              {vault.pairings.length === 0 ? <p className="fine-print">{labels.noPairings}</p> : null}
              {vault.pairings.map((pairing) => (
                <label className="check-row vault-pairing-request" key={pairing.id}>
                  <input
                    checked={selectedPairingId === pairing.id}
                    name="vault-pairing-request"
                    onChange={() => setSelectedPairingId(pairing.id)}
                    type="radio"
                    value={pairing.id}
                  />
                  <span>
                    <span>{pairing.deviceId}</span>
                    <small>
                      ID: {pairing.id}
                      <br />
                      {labels.pairingExpires}: {pairing.expiresAt}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
            <label htmlFor="vault-pairing-approval-code">{labels.approvalCode}</label>
            <input
              autoComplete="one-time-code"
              id="vault-pairing-approval-code"
              inputMode="text"
              maxLength={9}
              onChange={(event) => setPairingApprovalCode(event.currentTarget.value)}
              pattern="[A-Z2-9]{4}-[A-Z2-9]{4}"
              spellCheck={false}
              type="text"
              value={pairingApprovalCode}
            />
            <button
              className="button"
              disabled={busy || selectedPairingId.length === 0 || vault.pairings.length === 0}
              type="submit"
            >
              {labels.approvePairing}
            </button>
          </form>
        </>
      ) : null}
    </section>
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
        <p id="vault-setup-description">
          {vault.remoteRecoveryStage === null ? labels.setup : labels.remoteRecoveryHelp}
        </p>
        {vault.legacyAvailable ? <p className="notice notice-warning">{labels.legacy}</p> : null}
        {vault.error === null ? null : (
          <p className="notice notice-danger" id="vault-error" role="alert">
            {vault.error}
          </p>
        )}
        {vault.remoteRecoveryStage === "available" ? (
          <form
            aria-labelledby="vault-remote-recovery-title"
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              const code = remoteRecoveryInput;
              clearRemoteRecoveryInputSecret();
              void runOperation("remote-recover", () => vault.beginRemoteRecovery(code)).catch(
                (cause: unknown) => {
                  if (cause instanceof PersonalVaultClientError && cause.code === "AUTHENTICATION_FAILED") {
                    setRemoteRecoveryInvalid(true);
                  }
                },
              );
            }}
          >
            <h3 id="vault-remote-recovery-title">{labels.remoteRecoveryTitle}</h3>
            <label htmlFor="vault-remote-recovery-code">{labels.remoteRecoveryCode}</label>
            <input
              aria-describedby="vault-setup-description"
              aria-invalid={remoteRecoveryInvalid ? true : undefined}
              autoComplete="off"
              id="vault-remote-recovery-code"
              maxLength={PERSONAL_VAULT_MAX_RECOVERY_CODE_LENGTH}
              onChange={(event) => {
                const next = event.currentTarget.value;
                setRemoteRecoveryInput(next);
                if (next.length === 0) {
                  if (remoteRecoveryInputTimerRef.current !== undefined) {
                    window.clearTimeout(remoteRecoveryInputTimerRef.current);
                    remoteRecoveryInputTimerRef.current = undefined;
                  }
                } else {
                  armRemoteRecoveryInputTimer();
                }
                if (remoteRecoveryInvalid) setRemoteRecoveryInvalid(false);
              }}
              ref={remoteRecoveryInputRef}
              required
              spellCheck={false}
              type="password"
              value={remoteRecoveryInput}
            />
            <button className="button" disabled={busy || remoteRecoveryInput.length === 0} type="submit">
              {labels.remoteRecoveryAction}
            </button>
          </form>
        ) : vault.remoteRecoveryStage === "pairing-pending" ? (
          <div className="notice notice-warning">
            <p>{labels.remoteRecoveryPending}</p>
            <div className="vault-actions">
              <button
                className="button"
                disabled={busy}
                onClick={() => void runOperation("remote-resume", vault.resumeRemoteRecovery)}
                type="button"
              >
                {labels.remoteRecoveryResume}
              </button>
              <button
                aria-describedby="vault-remote-recovery-abandon-help"
                className="button button-quiet"
                disabled={busy}
                onClick={() => void runOperation("remote-abandon", vault.abandonRemoteRecoveryPairing)}
                type="button"
              >
                {labels.remoteRecoveryAbandon}
              </button>
            </div>
            <p id="vault-remote-recovery-abandon-help">{labels.remoteRecoveryAbandonHelp}</p>
          </div>
        ) : (
          <button
            aria-describedby="vault-setup-description"
            className="button"
            disabled={busy}
            onClick={() => void runOperation("setup", vault.beginSetup)}
            type="button"
          >
            {labels.create}
          </button>
        )}
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
  } else if (vault.status === "show-remote-recovery-code") {
    content = (
      <>
        <p aria-labelledby="tasks-title" className="vault-recovery-code">
          {vault.recoveryCode}
        </p>
        <p className="notice notice-warning" id="vault-rotation-recovery-warning">
          {labels.rotationRecoveryDetails}
        </p>
        <button
          aria-describedby="vault-rotation-recovery-warning"
          className="button"
          disabled={busy}
          onClick={() => void runOperation("remote-confirm", vault.confirmRemoteRecoveryRotation)}
          type="button"
        >
          {labels.rotationRecoveryConfirm}
        </button>
      </>
    );
  } else if (vault.status === "locked") {
    content = (
      <>
        <p>{labels.locked}</p>
        {vault.syncState === "hardening" ? (
          <p className="notice notice-warning" role="alert">
            {labels.hardeningWarning}
          </p>
        ) : null}
        {vault.error === null ? null : (
          <p className="notice notice-danger" id="vault-error" role="alert">
            {vault.error}
          </p>
        )}
        <button
          className="button"
          disabled={busy}
          onClick={() =>
            void runOperation(
              vault.remoteRecoveryStage === "rotation-pending" ? "remote-resume" : "unlock",
              vault.remoteRecoveryStage === "rotation-pending" ? vault.resumeRemoteRecovery : vault.unlock,
            )
          }
          type="button"
        >
          {vault.remoteRecoveryStage === "rotation-pending" ? labels.hardeningResume : labels.unlock}
        </button>
        <details className="vault-recovery" hidden={vault.syncState === "hardening"}>
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
                    disabled={busy || vault.syncState === "hardening"}
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
            disabled={busy || vault.syncState === "hardening"}
            id="new-task"
            onChange={(event) => {
              setDraft(event.target.value);
              if (formError !== null) setFormError(null);
            }}
            value={draft}
          />
          <button className="button" disabled={busy || vault.syncState === "hardening"} type="submit">
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
        {syncPanel}
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
