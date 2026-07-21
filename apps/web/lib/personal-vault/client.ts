"use client";

import type { SetupSource, VaultRpcFailure, VaultRpcResponse, VaultRpcSuccess } from "./protocol";

const RPC_TIMEOUT_MS = 45_000;

export class PersonalVaultClientError extends Error {
  readonly code: VaultRpcFailure["error"]["code"];

  constructor(code: VaultRpcFailure["error"]["code"]) {
    super(
      code === "AUTHENTICATION_FAILED"
        ? "Authentication failed."
        : "The private vault could not complete that action.",
    );
    this.name = "PersonalVaultClientError";
    this.code = code;
  }
}

type RequestWithoutId =
  | { readonly method: "inspect" }
  | { readonly method: "begin-setup"; readonly source: SetupSource; readonly legacyRaw: string | null }
  | { readonly method: "confirm-setup" }
  | { readonly method: "cancel-setup" }
  | { readonly method: "unlock" }
  | { readonly method: "recover"; readonly recoveryCode: string }
  | { readonly method: "lock" }
  | { readonly method: "add-task"; readonly title: string }
  | { readonly method: "toggle-task"; readonly taskId: string }
  | { readonly method: "import-legacy"; readonly legacyRaw: string };

export class PersonalVaultClient {
  #worker: Worker | undefined;
  #pending = new Map<
    string,
    {
      readonly resolve: (response: VaultRpcSuccess) => void;
      readonly reject: (error: Error) => void;
      readonly timeout: number;
    }
  >();

  constructor(
    workerUrl: unknown = new URL("/__uga-vault/personal-vault.worker.mjs", window.location.origin),
  ) {
    if (typeof Worker === "undefined") throw new PersonalVaultClientError("UNAVAILABLE");
    // The browser's Trusted Types sink accepts TrustedScriptURL. TypeScript's
    // DOM declarations currently model only string | URL, so keep the cast at
    // this narrow boundary rather than converting the trusted value to text.
    const worker = new Worker(workerUrl as URL, {
      type: "module",
      name: "uga-personal-vault",
    });
    worker.addEventListener("message", this.#receive);
    worker.addEventListener("error", this.#workerFailed);
    worker.addEventListener("messageerror", this.#workerFailed);
    this.#worker = worker;
  }

  #receive = (event: MessageEvent<unknown>): void => {
    const response = event.data as VaultRpcResponse;
    if (typeof response !== "object" || typeof response.id !== "string" || typeof response.ok !== "boolean") {
      return;
    }
    const pending = this.#pending.get(response.id);
    if (pending === undefined) return;
    this.#pending.delete(response.id);
    window.clearTimeout(pending.timeout);
    if (response.ok) pending.resolve(response);
    else pending.reject(new PersonalVaultClientError(response.error.code));
  };

  #workerFailed = (): void => {
    const worker = this.#worker;
    this.#worker = undefined;
    if (worker !== undefined) {
      worker.removeEventListener("message", this.#receive);
      worker.removeEventListener("error", this.#workerFailed);
      worker.removeEventListener("messageerror", this.#workerFailed);
      worker.terminate();
    }
    this.#rejectAll(new PersonalVaultClientError("UNAVAILABLE"));
  };

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  request(request: RequestWithoutId): Promise<VaultRpcSuccess> {
    const worker = this.#worker;
    if (worker === undefined) return Promise.reject(new PersonalVaultClientError("UNAVAILABLE"));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.#pending.delete(id);
        reject(new PersonalVaultClientError("STORAGE_FAILED"));
      }, RPC_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timeout });
      worker.postMessage({ ...request, id });
    });
  }

  inspect() {
    return this.request({ method: "inspect" });
  }

  beginSetup(source: SetupSource, legacyRaw: string | null) {
    return this.request({ method: "begin-setup", source, legacyRaw });
  }

  confirmSetup() {
    return this.request({ method: "confirm-setup" });
  }

  cancelSetup() {
    return this.request({ method: "cancel-setup" });
  }

  unlock() {
    return this.request({ method: "unlock" });
  }

  recover(recoveryCode: string) {
    return this.request({ method: "recover", recoveryCode });
  }

  lock() {
    return this.request({ method: "lock" });
  }

  addTask(title: string) {
    return this.request({ method: "add-task", title });
  }

  toggleTask(taskId: string) {
    return this.request({ method: "toggle-task", taskId });
  }

  importLegacy(legacyRaw: string) {
    return this.request({ method: "import-legacy", legacyRaw });
  }

  terminate(): void {
    const worker = this.#worker;
    this.#worker = undefined;
    if (worker !== undefined) {
      worker.removeEventListener("message", this.#receive);
      worker.removeEventListener("error", this.#workerFailed);
      worker.removeEventListener("messageerror", this.#workerFailed);
      worker.terminate();
    }
    this.#rejectAll(new PersonalVaultClientError("UNAVAILABLE"));
  }
}
