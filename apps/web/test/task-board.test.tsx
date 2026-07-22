import { createElement } from "react";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskBoard } from "../components/task-board";
import type { PersonalVaultLockReason, PersonalVaultStatus } from "../components/personal-vault-provider";

const vault = {
  addTask: vi.fn<(title: string) => Promise<void>>().mockResolvedValue(undefined),
  beginSetup: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  cancelSetup: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  confirmRecoverySaved: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  deleteLegacy: vi.fn<() => boolean>().mockReturnValue(true),
  error: null as string | null,
  expireRecoveryInput: vi.fn(),
  exportLegacy: vi.fn<() => boolean>().mockReturnValue(true),
  lastLockReason: null as PersonalVaultLockReason | null,
  legacyAvailable: false,
  lock: vi.fn(),
  recover: vi
    .fn<(code: string, allowOldestDeviceRevocation?: boolean) => Promise<void>>()
    .mockResolvedValue(undefined),
  recoveryCode: null as string | null,
  recoveryDeviceLimitReached: false,
  recoverySecretExpiry: null as "display" | "input" | null,
  retryLegacyImport: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  status: "unlocked" as PersonalVaultStatus,
  tasks: [{ id: "reading-response", title: "Draft reading response", done: false }],
  toggleTask: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
  unlock: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
};

vi.mock("../components/personal-vault-provider", () => ({
  PERSONAL_VAULT_RECOVERY_SECRET_TIMEOUT_MS: 2 * 60 * 1_000,
  usePersonalVault: () => vault,
}));

function resetVault(): void {
  vi.clearAllMocks();
  vault.addTask.mockResolvedValue(undefined);
  vault.beginSetup.mockResolvedValue(undefined);
  vault.cancelSetup.mockResolvedValue(undefined);
  vault.confirmRecoverySaved.mockResolvedValue(undefined);
  vault.deleteLegacy.mockReturnValue(true);
  vault.exportLegacy.mockReturnValue(true);
  vault.recover.mockResolvedValue(undefined);
  vault.retryLegacyImport.mockResolvedValue(undefined);
  vault.toggleTask.mockResolvedValue(undefined);
  vault.unlock.mockResolvedValue(undefined);
  vault.error = null;
  vault.lastLockReason = null;
  vault.legacyAvailable = false;
  vault.recoveryCode = null;
  vault.recoveryDeviceLimitReached = false;
  vault.recoverySecretExpiry = null;
  vault.status = "unlocked";
  vault.tasks = [{ id: "reading-response", title: "Draft reading response", done: false }];
}

describe("task board", () => {
  beforeEach(resetVault);

  it("renders only vault-backed tasks and never writes task plaintext to localStorage", async () => {
    const user = userEvent.setup();
    render(createElement(TaskBoard, { locale: "en" }));

    await user.click(screen.getByRole("checkbox", { name: /reading response/u }));
    expect(vault.toggleTask).toHaveBeenCalledWith("reading-response");

    await user.type(screen.getByRole("textbox", { name: "New task" }), "Book tutoring");
    await user.click(screen.getByRole("button", { name: "Add task" }));

    expect(vault.addTask).toHaveBeenCalledWith("Book tutoring");
    expect(window.localStorage.getItem("uga.tasks")).toBeNull();
    expect(screen.getByRole("button", { name: "Lock vault" })).toBeVisible();
  });

  it("requires an accessible confirmation before deleting legacy data and defaults focus to cancel", async () => {
    const user = userEvent.setup();
    vault.legacyAvailable = true;
    render(createElement(TaskBoard, { locale: "en" }));
    const trigger = screen.getByRole("button", { name: "Delete legacy data" });

    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Delete legacy task data?" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(vault.deleteLegacy).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Export a copy first" }));
    expect(vault.exportLegacy).toHaveBeenCalledOnce();
    expect(vault.deleteLegacy).not.toHaveBeenCalled();
    expect(screen.getByText(/The legacy-data download has started/u)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Delete legacy task data?" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Permanently delete legacy data" }));
    expect(vault.deleteLegacy).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Delete legacy task data?" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Tasks" })).toHaveFocus());
  });

  it("keeps the confirmation open and never claims deletion when browser storage rejects removal", async () => {
    const user = userEvent.setup();
    vault.legacyAvailable = true;
    vault.deleteLegacy.mockReturnValue(false);
    render(createElement(TaskBoard, { locale: "en" }));

    await user.click(screen.getByRole("button", { name: "Delete legacy data" }));
    await user.click(screen.getByRole("button", { name: "Permanently delete legacy data" }));

    expect(screen.getByRole("dialog", { name: "Delete legacy task data?" })).toBeVisible();
    expect(screen.getByText(/Legacy data could not be deleted/u)).toBeVisible();
  });

  it("marks an empty task name invalid and clears the error when the user corrects it", async () => {
    const user = userEvent.setup();
    render(createElement(TaskBoard, { locale: "en" }));
    const input = screen.getByRole("textbox", { name: "New task" });

    await user.click(screen.getByRole("button", { name: "Add task" }));
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "task-form-feedback");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a task name.");

    await user.type(input, "Corrected task");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("keeps one operation in flight, exposes busy state, and disables duplicate submission", async () => {
    const user = userEvent.setup();
    let resolveSave: (() => void) | undefined;
    vault.addTask.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    render(createElement(TaskBoard, { locale: "en" }));

    await user.type(screen.getByRole("textbox", { name: "New task" }), "One write");
    const submit = screen.getByRole("button", { name: "Add task" });
    await user.click(submit);

    expect(vault.addTask).toHaveBeenCalledOnce();
    expect(submit).toBeDisabled();
    expect(submit.closest("section")).toHaveAttribute("aria-busy", "true");
    expect(document.querySelector(".vault-progress")).toHaveTextContent("Encrypting and saving the change…");
    fireEvent.click(submit);
    expect(vault.addTask).toHaveBeenCalledOnce();

    resolveSave?.();
    await waitFor(() => expect(submit).not.toBeDisabled());
  });

  it("renders write-failure guidance as an alert while the vault is locked", () => {
    vault.status = "locked";
    vault.lastLockReason = "write-failed";
    vault.error =
      "The change could not be encrypted and saved, so the vault was locked to protect your data. Unlock and retry; if trusted-device unlock fails, use your recovery code.";
    render(createElement(TaskBoard, { locale: "en" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Unlock and retry");
    expect(screen.getByRole("button", { name: "Unlock private vault" })).toBeVisible();
    expect(screen.getByText(/Every page session requires an explicit unlock\./u)).toBeVisible();
  });

  it("associates a failed recovery attempt with the recovery field", async () => {
    const user = userEvent.setup();
    vault.status = "locked";
    const view = render(createElement(TaskBoard, { locale: "en" }));

    await user.click(screen.getByText("Unlock with recovery code", { selector: "summary" }));
    const recoveryInput = screen.getByLabelText("Recovery code");
    await user.type(recoveryInput, "wrong-code");
    await user.click(screen.getByRole("button", { name: "Unlock with recovery code" }));
    expect(vault.recover).toHaveBeenCalledWith("wrong-code", false);
    expect(recoveryInput).toHaveValue("");

    vault.error = "The recovery code or encrypted vault could not be authenticated.";
    view.rerender(createElement(TaskBoard, { locale: "en" }));
    await waitFor(() => expect(recoveryInput).toHaveAttribute("aria-invalid", "true"));
    expect(recoveryInput).toHaveAttribute("aria-describedby", "vault-error");
    expect(screen.getByRole("alert")).toHaveTextContent("could not be authenticated");
  });

  it("requires explicit consent before revoking the oldest device at recovery capacity", async () => {
    const user = userEvent.setup();
    vault.status = "locked";
    vault.error =
      "The recovery code is valid, but all trusted-device slots are full. To continue, explicitly allow revoking the oldest device access, then enter the recovery code again.";
    vault.recoveryDeviceLimitReached = true;
    render(createElement(TaskBoard, { locale: "en" }));

    await user.click(screen.getByText("Unlock with recovery code", { selector: "summary" }));
    const recoveryInput = screen.getByLabelText("Recovery code");
    const consent = screen.getByRole("checkbox", {
      name: "Revoke the oldest trusted-device access to free a slot",
    });
    expect(recoveryInput).not.toHaveAttribute("aria-invalid");
    expect(consent).not.toBeChecked();
    await user.type(recoveryInput, "UGA1-valid-code");
    await user.click(consent);
    await user.click(screen.getByRole("button", { name: "Unlock with recovery code" }));

    expect(vault.recover).toHaveBeenCalledWith("UGA1-valid-code", true);
    expect(recoveryInput).toHaveValue("");
  });

  it("clears recovery-code input and terminates its vault session after the independent timeout", async () => {
    vi.useFakeTimers();
    try {
      vault.status = "locked";
      render(createElement(TaskBoard, { locale: "en" }));

      fireEvent.click(screen.getByText("Unlock with recovery code", { selector: "summary" }));
      const recoveryInput = screen.getByLabelText("Recovery code");
      fireEvent.change(recoveryInput, { target: { value: "UGA1-sensitive-input" } });
      expect(recoveryInput).toHaveValue("UGA1-sensitive-input");

      await act(async () => {
        vi.advanceTimersByTime(2 * 60 * 1_000);
      });

      expect(recoveryInput).toHaveValue("");
      expect(vault.expireRecoveryInput).toHaveBeenCalledOnce();
      expect(screen.getByTestId("vault-live-region")).toHaveTextContent(
        "recovery-code input expired and was cleared",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("focuses the step heading and announces recovery and lock transitions", async () => {
    vault.status = "needs-setup";
    const view = render(createElement(TaskBoard, { locale: "en" }));

    vault.status = "show-recovery-code";
    vault.recoveryCode = "UGA1-0000-0000-0000-0000-0000-0000-0000-0000";
    view.rerender(createElement(TaskBoard, { locale: "en" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Recovery code (shown once)" })).toHaveFocus(),
    );
    expect(screen.getByTestId("vault-live-region")).toHaveTextContent("recovery code is ready");

    vault.status = "locked";
    vault.lastLockReason = "idle";
    view.rerender(createElement(TaskBoard, { locale: "en" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Tasks" })).toHaveFocus());
    expect(screen.getByTestId("vault-live-region")).toHaveTextContent(
      "locked after fifteen minutes without activity",
    );
  });
});
