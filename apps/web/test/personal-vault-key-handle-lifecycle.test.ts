import { describe, expect, it, vi } from "vitest";

import { VaultSyncProtocolError } from "../lib/personal-vault/sync-protocol";
import {
  destroyVaultStateHandles,
  destroyVaultStateOnFailure,
  prepareVaultStateForPublication,
} from "../lib/personal-vault/key-handle-lifecycle";

describe("remote recovery key-handle lifecycle", () => {
  it("destroys reopened device and root handles when a response-loss replay fails", async () => {
    const deviceDestroy = vi.fn();
    const rootDestroy = vi.fn();
    const responseLoss = new Error("rotation response lost");
    const state = {
      deviceKey: { destroy: deviceDestroy },
      vaultKey: { destroy: rootDestroy },
    };

    await expect(destroyVaultStateOnFailure(state, () => Promise.reject(responseLoss))).rejects.toBe(
      responseLoss,
    );
    expect(deviceDestroy).toHaveBeenCalledOnce();
    expect(rootDestroy).toHaveBeenCalledOnce();
  });

  it("retains both handles only after successful replay convergence", async () => {
    const deviceDestroy = vi.fn();
    const rootDestroy = vi.fn();
    const state = {
      deviceKey: { destroy: deviceDestroy },
      vaultKey: { destroy: rootDestroy },
    };

    await expect(destroyVaultStateOnFailure(state, () => Promise.resolve("synced"))).resolves.toBe("synced");
    expect(deviceDestroy).not.toHaveBeenCalled();
    expect(rootDestroy).not.toHaveBeenCalled();
  });

  it("attempts root destruction even when device destruction throws", () => {
    const rootDestroy = vi.fn();
    const deviceFailure = new Error("device destroy failed");
    const state = {
      deviceKey: {
        destroy: vi.fn(() => {
          throw deviceFailure;
        }),
      },
      vaultKey: { destroy: rootDestroy },
    };

    expect(() => destroyVaultStateHandles(state)).toThrow(deviceFailure);
    expect(rootDestroy).toHaveBeenCalledOnce();
  });

  it.each([
    ["an integrity failure", new VaultSyncProtocolError("INTEGRITY_FAILED")],
    ["a generic synchronization failure", new Error("sync transport failed")],
  ])("does not publish reopened plaintext or handles after %s", async (_name, failure) => {
    const deviceDestroy = vi.fn();
    const rootDestroy = vi.fn();
    const candidate = {
      deviceKey: { destroy: deviceDestroy },
      vaultKey: { destroy: rootDestroy },
      document: { tasks: [{ id: "private", title: "Private task" }] },
    };
    let unlocked: typeof candidate | undefined;

    await expect(
      prepareVaultStateForPublication(candidate, () => Promise.reject(failure)).then((prepared) => {
        unlocked = prepared;
      }),
    ).rejects.toBe(failure);

    expect(unlocked).toBeUndefined();
    expect(deviceDestroy).toHaveBeenCalledOnce();
    expect(rootDestroy).toHaveBeenCalledOnce();
  });

  it("does not publish setup read-back state when the initial upload fails", async () => {
    const deviceDestroy = vi.fn();
    const rootDestroy = vi.fn();
    const uploadFailure = new Error("initial sync upload failed");
    const readBack = {
      deviceKey: { destroy: deviceDestroy },
      vaultKey: { destroy: rootDestroy },
      document: { tasks: [{ id: "setup", title: "Setup task" }] },
    };
    let unlocked: typeof readBack | undefined;

    await expect(
      prepareVaultStateForPublication(readBack, () => Promise.reject(uploadFailure)).then((prepared) => {
        unlocked = prepared;
      }),
    ).rejects.toBe(uploadFailure);

    expect(unlocked).toBeUndefined();
    expect(deviceDestroy).toHaveBeenCalledOnce();
    expect(rootDestroy).toHaveBeenCalledOnce();
  });
});
