"use client";

import {
  parseVaultRpcResponse,
  type SetupSource,
  type VaultRpcFailure,
  type VaultRpcSuccess,
} from "./protocol";

const RPC_TIMEOUT_MS = 45_000;
const GRACEFUL_TERMINATION_TIMEOUT_MS = 5_000;

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
  | {
      readonly method: "recover";
      readonly recoveryCode: string;
      readonly allowOldestDeviceRevocation: boolean;
    }
  | { readonly method: "lock" }
  | { readonly method: "add-task"; readonly title: string }
  | { readonly method: "toggle-task"; readonly taskId: string }
  | { readonly method: "import-legacy"; readonly legacyRaw: string };

export class PersonalVaultClient {
  #worker: Worker | undefined;
  #closing:
    | {
        readonly promise: Promise<void>;
        readonly resolve: () => void;
      }
    | undefined;
  #terminationTimeout: number | undefined;
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
    const response = parseVaultRpcResponse(event.data);
    if (response === null) {
      // Dedicated Worker messages are not ambient page events. A malformed
      // response means the trusted worker boundary failed; terminate it and
      // reject every pending call instead of leaving promises to time out.
      this.#workerFailed();
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
    this.#finishTermination();
  };

  #destroyWorker(): void {
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

  #finishTermination(): void {
    if (this.#terminationTimeout !== undefined) {
      window.clearTimeout(this.#terminationTimeout);
      this.#terminationTimeout = undefined;
    }
    this.#destroyWorker();
    const closing = this.#closing;
    this.#closing = undefined;
    closing?.resolve();
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  request(request: RequestWithoutId): Promise<VaultRpcSuccess> {
    const worker = this.#worker;
    if (worker === undefined || this.#closing !== undefined)
      return Promise.reject(new PersonalVaultClientError("UNAVAILABLE"));
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

  recover(recoveryCode: string, allowOldestDeviceRevocation = false) {
    return this.request({ method: "recover", recoveryCode, allowOldestDeviceRevocation });
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
    this.#finishTermination();
  }

  /**
   * Queue a lock behind all already-posted Worker operations, then terminate.
   * React plaintext can be cleared immediately by the caller while an in-flight
   * strict IndexedDB transaction is allowed to settle in the isolated Worker.
   * A bounded fallback still guarantees eventual key-handle destruction.
   */
  terminateWhenSettled(timeoutMs = GRACEFUL_TERMINATION_TIMEOUT_MS): Promise<void> {
    if (this.#closing !== undefined) return this.#closing.promise;
    if (this.#worker === undefined) return Promise.resolve();

    // Post `lock` before marking the client as closing. Worker RPC is strictly
    // serialized, so its acknowledgement follows every prior mutation.
    const lockRequest = this.request({ method: "lock" });
    let resolveClosing = (): void => undefined;
    const promise = new Promise<void>((resolve) => {
      resolveClosing = resolve;
    });
    this.#closing = { promise, resolve: resolveClosing };
    this.#terminationTimeout = window.setTimeout(() => this.#finishTermination(), Math.max(0, timeoutMs));
    void lockRequest.then(
      () => this.#finishTermination(),
      () => this.#finishTermination(),
    );
    return promise;
  }
}
