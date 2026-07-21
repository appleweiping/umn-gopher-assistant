"use client";

import { createElement, useEffect, useRef, useState, type SubmitEventHandler } from "react";

import type { Locale } from "../lib/data/registry";
import { usePersonalVault } from "./personal-vault-provider";

const builtInTaskTitles: Record<string, Record<Locale, string>> = {
  "reading-response": { en: "Draft reading response", "zh-CN": "起草阅读回应" },
  "transit-check": { en: "Review transit notes", "zh-CN": "核对交通记录" },
};

function text(locale: Locale) {
  return locale === "zh-CN"
    ? {
        acknowledge: "我已安全保存恢复码",
        add: "添加任务",
        create: "创建私人资料库",
        delete: "删除旧数据",
        details: "恢复码只显示这一次。请离线保存，不要截图上传或发送给他人。",
        export: "导出旧数据",
        legacy: "检测到旧任务数据。导入前会先加密并验证；数据不合规时不会自动删除。",
        lock: "锁定资料库",
        locked: "每次页面会话都需明确解锁。",
        newTask: "新任务",
        recover: "使用恢复码解锁",
        recovery: "一次性恢复码",
        retry: "重试导入旧数据",
        setup:
          "创建前，请了解：清除站点数据或丢失本机密文将使任务无法恢复。恢复码不能在其他设备上恢复这些任务。",
        tasks: "任务",
        unavailable: "此浏览器不能安全运行私人资料库。旧任务数据保持不变，且不会降级为明文存储。",
        unlock: "解锁私人资料库",
      }
    : {
        acknowledge: "I saved this recovery code securely",
        add: "Add task",
        create: "Create private vault",
        delete: "Delete legacy data",
        details:
          "This recovery code is shown once. Save it offline; do not upload, screenshot-share, or send it to anyone.",
        export: "Export legacy data",
        legacy:
          "Legacy task data was found. It is encrypted and verified before import; invalid data is never deleted automatically.",
        lock: "Lock vault",
        locked: "Every page session requires an explicit unlock.",
        newTask: "New task",
        recover: "Unlock with recovery code",
        recovery: "One-time recovery code",
        retry: "Retry legacy import",
        setup:
          "Before creating: clearing site data or losing local ciphertext will make these tasks unrecoverable. A recovery code cannot recover these tasks on another device.",
        tasks: "Tasks",
        unavailable:
          "This browser cannot safely run the private vault. Legacy task data is unchanged and there is no plaintext fallback.",
        unlock: "Unlock private vault",
      };
}

export function TaskBoard({ locale }: { readonly locale: Locale }) {
  const vault = usePersonalVault();
  const labels = text(locale);
  const [draft, setDraft] = useState("");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [status, setStatus] = useState("");
  const recoveryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (vault.status !== "unlocked") setDraft("");
    if (vault.status !== "locked") setRecoveryInput("");
  }, [vault.status]);

  useEffect(() => {
    const clearRecoveryInput = () => {
      // State clearing removes the controlled value on the next render; direct
      // assignment additionally removes it synchronously at a lifecycle edge.
      if (recoveryInputRef.current !== null) recoveryInputRef.current.value = "";
      setRecoveryInput("");
    };
    const clearWhenHidden = () => {
      if (document.visibilityState === "hidden") clearRecoveryInput();
    };

    window.addEventListener("pagehide", clearRecoveryInput);
    document.addEventListener("visibilitychange", clearWhenHidden);
    return () => {
      window.removeEventListener("pagehide", clearRecoveryInput);
      document.removeEventListener("visibilitychange", clearWhenHidden);
    };
  }, []);

  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const title = draft.trim();
    if (title.length === 0) {
      setStatus(locale === "zh-CN" ? "请输入任务名称" : "Enter a task name");
      return;
    }
    void vault
      .addTask(title)
      .then(() => {
        setDraft("");
        setStatus(locale === "zh-CN" ? "任务已加密保存" : "Task encrypted and saved");
      })
      .catch(() => setStatus(vault.error ?? (locale === "zh-CN" ? "无法保存任务" : "Could not save task")));
  };

  if (vault.status === "checking") {
    return createElement(
      "section",
      { className: "task-board", "aria-busy": true },
      createElement("p", null, locale === "zh-CN" ? "正在检查私人资料库…" : "Checking private vault…"),
    );
  }

  if (vault.status === "unavailable") {
    return createElement(
      "section",
      { className: "task-board", "aria-labelledby": "tasks-title" },
      createElement("h2", { id: "tasks-title" }, labels.tasks),
      createElement("p", { className: "notice notice-danger", role: "status" }, labels.unavailable),
      vault.legacyAvailable
        ? createElement(
            "div",
            { className: "vault-actions" },
            createElement(
              "button",
              { className: "button button-quiet", onClick: vault.exportLegacy, type: "button" },
              labels.export,
            ),
            createElement(
              "button",
              { className: "button button-quiet", onClick: vault.deleteLegacy, type: "button" },
              labels.delete,
            ),
          )
        : null,
    );
  }

  if (vault.status === "legacy-invalid") {
    return createElement(
      "section",
      { className: "task-board", "aria-labelledby": "tasks-title" },
      createElement("h2", { id: "tasks-title" }, labels.tasks),
      createElement("p", { className: "notice notice-danger", role: "alert" }, labels.legacy),
      createElement(
        "div",
        { className: "vault-actions" },
        createElement(
          "button",
          { className: "button button-quiet", onClick: vault.exportLegacy, type: "button" },
          labels.export,
        ),
        createElement(
          "button",
          { className: "button button-quiet", onClick: vault.deleteLegacy, type: "button" },
          labels.delete,
        ),
      ),
    );
  }

  if (vault.status === "needs-setup" || vault.status === "error") {
    return createElement(
      "section",
      { className: "task-board", "aria-labelledby": "tasks-title" },
      createElement("h2", { id: "tasks-title" }, labels.tasks),
      createElement("p", null, labels.setup),
      vault.legacyAvailable
        ? createElement("p", { className: "notice notice-warning" }, labels.legacy)
        : null,
      vault.error === null
        ? null
        : createElement("p", { className: "notice notice-danger", role: "alert" }, vault.error),
      createElement(
        "button",
        { className: "button", onClick: () => void vault.beginSetup(), type: "button" },
        labels.create,
      ),
      vault.legacyAvailable
        ? createElement(
            "div",
            { className: "vault-actions" },
            createElement(
              "button",
              { className: "button button-quiet", onClick: vault.exportLegacy, type: "button" },
              labels.export,
            ),
            createElement(
              "button",
              { className: "button button-quiet", onClick: vault.deleteLegacy, type: "button" },
              labels.delete,
            ),
          )
        : null,
    );
  }

  if (vault.status === "show-recovery-code") {
    return createElement(
      "section",
      { className: "task-board", "aria-labelledby": "tasks-title" },
      createElement("h2", { id: "tasks-title" }, labels.recovery),
      createElement("p", { className: "vault-recovery-code" }, vault.recoveryCode),
      createElement("p", { className: "notice notice-warning" }, labels.details),
      createElement(
        "div",
        { className: "vault-actions" },
        createElement(
          "button",
          { className: "button", onClick: () => void vault.confirmRecoverySaved(), type: "button" },
          labels.acknowledge,
        ),
        createElement(
          "button",
          { className: "button button-quiet", onClick: () => void vault.cancelSetup(), type: "button" },
          locale === "zh-CN" ? "取消" : "Cancel",
        ),
      ),
    );
  }

  if (vault.status === "locked") {
    return createElement(
      "section",
      { className: "task-board", "aria-labelledby": "tasks-title" },
      createElement("h2", { id: "tasks-title" }, labels.tasks),
      createElement("p", null, labels.locked),
      vault.error === null
        ? null
        : createElement("p", { className: "notice notice-danger", role: "alert" }, vault.error),
      createElement(
        "button",
        { className: "button", onClick: () => void vault.unlock(), type: "button" },
        labels.unlock,
      ),
      createElement(
        "details",
        { className: "vault-recovery" },
        createElement("summary", null, labels.recover),
        createElement(
          "form",
          {
            className: "inline-form",
            onSubmit: (event: SubmitEvent) => {
              event.preventDefault();
              const submittedCode = recoveryInput;
              if (recoveryInputRef.current !== null) recoveryInputRef.current.value = "";
              // Never retain an attempted recovery secret while the Worker is
              // calculating Argon2 or after any authentication result.
              setRecoveryInput("");
              void vault.recover(submittedCode);
            },
          },
          createElement("label", { htmlFor: "vault-recovery-code" }, labels.recovery),
          createElement("input", {
            autoComplete: "off",
            id: "vault-recovery-code",
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => setRecoveryInput(event.target.value),
            ref: recoveryInputRef,
            spellCheck: false,
            type: "password",
            value: recoveryInput,
          }),
          createElement("button", { className: "button button-quiet", type: "submit" }, labels.recover),
        ),
      ),
    );
  }

  return createElement(
    "section",
    { className: "task-board", "aria-labelledby": "tasks-title" },
    createElement(
      "div",
      { className: "section-heading" },
      createElement("h2", { id: "tasks-title" }, labels.tasks),
      createElement(
        "button",
        { className: "button button-quiet", onClick: vault.lock, type: "button" },
        labels.lock,
      ),
    ),
    createElement(
      "ul",
      { className: "task-list" },
      vault.tasks.map((task) => {
        const title = builtInTaskTitles[task.id]?.[locale] ?? task.title;
        return createElement(
          "li",
          { key: task.id },
          createElement(
            "label",
            { className: "check-row" },
            createElement("input", {
              "aria-label": title,
              checked: task.done,
              onChange: () =>
                void vault
                  .toggleTask(task.id)
                  .catch(() => setStatus(locale === "zh-CN" ? "无法保存任务" : "Could not save task")),
              type: "checkbox",
            }),
            createElement("span", { className: task.done ? "task-done" : undefined }, title),
          ),
        );
      }),
    ),
    createElement(
      "form",
      { className: "inline-form", onSubmit: submit },
      createElement("label", { htmlFor: "new-task" }, labels.newTask),
      createElement("input", {
        id: "new-task",
        onChange: (event) => setDraft(event.target.value),
        value: draft,
      }),
      createElement("button", { className: "button", type: "submit" }, labels.add),
    ),
    vault.legacyAvailable
      ? createElement(
          "div",
          { className: "vault-actions" },
          createElement("p", { className: "fine-print" }, labels.legacy),
          createElement(
            "button",
            {
              className: "button button-quiet",
              onClick: () => void vault.retryLegacyImport(),
              type: "button",
            },
            labels.retry,
          ),
          createElement(
            "button",
            { className: "button button-quiet", onClick: vault.exportLegacy, type: "button" },
            labels.export,
          ),
          createElement(
            "button",
            { className: "button button-quiet", onClick: vault.deleteLegacy, type: "button" },
            labels.delete,
          ),
        )
      : null,
    createElement("p", { className: "form-status", role: "status", "aria-live": "polite" }, status),
  );
}
