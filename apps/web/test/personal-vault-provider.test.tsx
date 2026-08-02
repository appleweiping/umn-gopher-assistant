import { createElement } from "react";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PersonalVaultProvider, usePersonalVault } from "../components/personal-vault-provider";

const client = vi.hoisted(() => ({
  addTask: vi.fn<() => Promise<never>>(),
  abandonRemoteRecoveryPairing: vi.fn<
    () => Promise<{
      method: "abandon-remote-recovery-pairing";
    }>
  >(),
  beginSetup: vi.fn<
    () => Promise<{
      method: "begin-setup";
      recoveryCode: string;
    }>
  >(),
  confirmSetup: vi.fn<
    () => Promise<{
      method: "confirm-setup";
      syncState: "synced";
      snapshot: { revision: number; tasks: readonly [] };
    }>
  >(),
  inspect: vi.fn<
    () => Promise<{
      method: "inspect";
      hasVault: boolean;
      hasPendingPairing: boolean;
      pairingId: string | null;
      pairingExpiresAt: string | null;
      remoteRecoveryStage: "available" | "pairing-pending" | "hardening-required" | "rotation-pending" | null;
      syncState:
        | "signed-out"
        | "local-only"
        | "syncing"
        | "synced"
        | "deferred"
        | "conflict"
        | "pairing"
        | "recovery"
        | "hardening"
        | "rollback";
    }>
  >(),
  terminateWhenSettled: vi.fn<() => Promise<void>>(),
  unlock: vi.fn<
    () => Promise<{
      method: "unlock";
      syncState: "synced";
      snapshot: { revision: number; tasks: readonly [] };
    }>
  >(),
}));

vi.mock("../lib/personal-vault/client", () => {
  class PersonalVaultClientError extends Error {
    readonly code: string;

    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }

  class PersonalVaultClient {
    inspect() {
      return client.inspect();
    }

    beginSetup() {
      return client.beginSetup();
    }

    confirmSetup() {
      return client.confirmSetup();
    }

    unlock() {
      return client.unlock();
    }

    addTask() {
      return client.addTask();
    }

    abandonRemoteRecoveryPairing() {
      return client.abandonRemoteRecoveryPairing();
    }

    terminateWhenSettled() {
      return client.terminateWhenSettled();
    }
  }

  return { PersonalVaultClient, PersonalVaultClientError };
});

function Probe() {
  const vault = usePersonalVault();
  return (
    <div>
      <output data-testid="vault-status">{vault.status}</output>
      <output data-testid="lock-reason">{vault.lastLockReason}</output>
      <output data-testid="recovery-expiry">{vault.recoverySecretExpiry}</output>
      <output data-testid="recovery-code">{vault.recoveryCode}</output>
      <output data-testid="remote-recovery-stage">{vault.remoteRecoveryStage}</output>
      {vault.error === null ? null : <p role="alert">{vault.error}</p>}
      <button onClick={() => void vault.unlock()} type="button">
        Unlock
      </button>
      <button onClick={() => void vault.addTask("Write failure").catch(() => undefined)} type="button">
        Add
      </button>
      <button onClick={() => void vault.beginSetup()} type="button">
        Begin
      </button>
      <button onClick={() => void vault.confirmRecoverySaved()} type="button">
        Confirm
      </button>
      <button onClick={vault.deleteLegacy} type="button">
        Delete legacy
      </button>
      <button onClick={() => void vault.abandonRemoteRecoveryPairing()} type="button">
        Abandon remote recovery
      </button>
    </div>
  );
}

describe("personal vault provider UX state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.inspect.mockResolvedValue({
      method: "inspect",
      hasVault: true,
      hasPendingPairing: false,
      pairingId: null,
      pairingExpiresAt: null,
      remoteRecoveryStage: null,
      syncState: "synced",
    });
    client.terminateWhenSettled.mockResolvedValue(undefined);
    client.abandonRemoteRecoveryPairing.mockResolvedValue({
      method: "abandon-remote-recovery-pairing",
    });
    client.beginSetup.mockResolvedValue({
      method: "begin-setup",
      recoveryCode: "UGA1-0000-0000-0000-0000-0000-0000-0000-0000",
    });
    client.confirmSetup.mockResolvedValue({
      method: "confirm-setup",
      syncState: "synced",
      snapshot: { revision: 1, tasks: [] },
    });
  });

  it("retains actionable write-failure guidance after locking and terminating the session", async () => {
    const user = userEvent.setup();
    client.inspect.mockResolvedValue({
      method: "inspect",
      hasVault: true,
      hasPendingPairing: false,
      pairingId: null,
      pairingExpiresAt: null,
      remoteRecoveryStage: null,
      syncState: "synced",
    });
    client.unlock.mockResolvedValue({
      method: "unlock",
      syncState: "synced",
      snapshot: { revision: 1, tasks: [] },
    });
    client.addTask.mockRejectedValue(new Error("storage failed"));

    render(
      createElement(PersonalVaultProvider, {
        children: createElement(Probe),
        locale: "en",
      }),
    );

    await waitFor(() => expect(screen.getByTestId("vault-status")).toHaveTextContent("locked"));
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(screen.getByTestId("vault-status")).toHaveTextContent("unlocked"));
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(screen.getByTestId("vault-status")).toHaveTextContent("locked"));
    expect(screen.getByTestId("lock-reason")).toHaveTextContent("write-failed");
    expect(screen.getByRole("alert")).toHaveTextContent("Unlock and retry");
    expect(screen.getByRole("alert")).toHaveTextContent("use your recovery code");
    expect(client.terminateWhenSettled).toHaveBeenCalled();
  });

  it("clears the one-time recovery display and terminates its Worker after the short timeout", async () => {
    client.inspect.mockResolvedValue({
      method: "inspect",
      hasVault: false,
      hasPendingPairing: false,
      pairingId: null,
      pairingExpiresAt: null,
      remoteRecoveryStage: null,
      syncState: "synced",
    });
    render(
      createElement(PersonalVaultProvider, {
        children: createElement(Probe),
        locale: "en",
      }),
    );
    await waitFor(() => expect(screen.getByTestId("vault-status")).toHaveTextContent("needs-setup"));

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Begin" }));
        await Promise.resolve();
      });
      expect(screen.getByTestId("vault-status")).toHaveTextContent("show-recovery-code");
      expect(screen.getByTestId("recovery-code")).toHaveTextContent("UGA1-0000");

      await act(async () => {
        vi.advanceTimersByTime(2 * 60 * 1_000);
      });

      expect(screen.getByTestId("vault-status")).toHaveTextContent("needs-setup");
      expect(screen.getByTestId("recovery-code")).toBeEmptyDOMElement();
      expect(screen.getByTestId("recovery-expiry")).toHaveTextContent("display");
      expect(client.terminateWhenSettled).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains legacy plaintext when the strict encrypted commit fails before verified reopen", async () => {
    const legacyRaw = '[{"id":"legacy","title":"Preserve me","done":false}]';
    window.localStorage.setItem("uga.tasks", legacyRaw);
    client.inspect.mockResolvedValue({
      method: "inspect",
      hasVault: false,
      hasPendingPairing: false,
      pairingId: null,
      pairingExpiresAt: null,
      remoteRecoveryStage: null,
      syncState: "synced",
    });
    client.confirmSetup.mockRejectedValueOnce(new Error("Injected strict-durability write failure"));
    const user = userEvent.setup();

    render(
      createElement(PersonalVaultProvider, {
        children: createElement(Probe),
        locale: "en",
      }),
    );
    await waitFor(() => expect(screen.getByTestId("vault-status")).toHaveTextContent("needs-setup"));
    await user.click(screen.getByRole("button", { name: "Begin" }));
    await waitFor(() => expect(screen.getByTestId("vault-status")).toHaveTextContent("show-recovery-code"));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(screen.getByTestId("vault-status")).toHaveTextContent("needs-setup"));
    expect(window.localStorage.getItem("uga.tasks")).toBe(legacyRaw);
    expect(client.terminateWhenSettled).toHaveBeenCalled();
  });

  it("re-inspects after explicitly abandoning only a pairing-stage remote recovery", async () => {
    client.inspect
      .mockResolvedValueOnce({
        method: "inspect",
        hasVault: false,
        hasPendingPairing: false,
        pairingId: null,
        pairingExpiresAt: null,
        remoteRecoveryStage: "pairing-pending",
        syncState: "recovery",
      })
      .mockResolvedValueOnce({
        method: "inspect",
        hasVault: false,
        hasPendingPairing: false,
        pairingId: null,
        pairingExpiresAt: null,
        remoteRecoveryStage: "available",
        syncState: "recovery",
      });
    const user = userEvent.setup();
    render(
      createElement(PersonalVaultProvider, {
        children: createElement(Probe),
        locale: "en",
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("remote-recovery-stage")).toHaveTextContent("pairing-pending"),
    );

    await user.click(screen.getByRole("button", { name: "Abandon remote recovery" }));

    await waitFor(() => expect(screen.getByTestId("remote-recovery-stage")).toHaveTextContent("available"));
    expect(client.abandonRemoteRecoveryPairing).toHaveBeenCalledOnce();
    expect(client.terminateWhenSettled).toHaveBeenCalled();
  });

  it.each(["getter", "getItem"] as const)(
    "fails closed without touching legacy data when localStorage %s throws SecurityError",
    async (failure) => {
      const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
      const backingStorage = window.localStorage;
      backingStorage.setItem("uga.tasks", '[{"id":"legacy","title":"Preserve me","done":false}]');
      const unavailable = () => {
        throw new DOMException("Site storage disabled", "SecurityError");
      };
      if (failure === "getter") {
        Object.defineProperty(window, "localStorage", { configurable: true, get: unavailable });
      } else {
        Object.defineProperty(window, "localStorage", {
          configurable: true,
          value: { getItem: unavailable },
        });
      }

      try {
        render(
          createElement(PersonalVaultProvider, {
            children: createElement(Probe),
            locale: "en",
          }),
        );
        await waitFor(() => expect(screen.getByTestId("vault-status")).toHaveTextContent("unavailable"));
        expect(screen.getByRole("alert")).toHaveTextContent("Browser site storage is disabled");
        expect(client.inspect).not.toHaveBeenCalled();
        expect(backingStorage.getItem("uga.tasks")).toContain("Preserve me");
      } finally {
        cleanup();
        if (descriptor !== undefined) Object.defineProperty(window, "localStorage", descriptor);
        else Reflect.deleteProperty(window, "localStorage");
      }
    },
  );

  it("fails closed and preserves legacy data when localStorage.removeItem throws SecurityError", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    const backingStorage = window.localStorage;
    backingStorage.setItem("uga.tasks", '[{"id":"legacy","title":"Preserve me","done":false}]');
    const storageWithDeniedRemoval = {
      getItem: backingStorage.getItem.bind(backingStorage),
      removeItem: () => {
        throw new DOMException("Site storage disabled", "SecurityError");
      },
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: storageWithDeniedRemoval,
    });

    try {
      render(
        createElement(PersonalVaultProvider, {
          children: createElement(Probe),
          locale: "en",
        }),
      );
      await waitFor(() => expect(screen.getByTestId("vault-status")).toHaveTextContent("locked"));
      fireEvent.click(screen.getByRole("button", { name: "Delete legacy" }));
      await waitFor(() => expect(screen.getByTestId("vault-status")).toHaveTextContent("unavailable"));
      expect(screen.getByRole("alert")).toHaveTextContent("Browser site storage is disabled");
      expect(backingStorage.getItem("uga.tasks")).toContain("Preserve me");
    } finally {
      cleanup();
      if (descriptor !== undefined) Object.defineProperty(window, "localStorage", descriptor);
      else Reflect.deleteProperty(window, "localStorage");
    }
  });
});
