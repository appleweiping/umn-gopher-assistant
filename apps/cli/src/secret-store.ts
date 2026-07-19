import { createRequire } from "node:module";

export type SecretStoreUnavailableReason = "backend-unavailable" | "module-unavailable";

export interface SecretStoreAvailability {
  readonly available: boolean;
  readonly reason?: SecretStoreUnavailableReason;
}

export type SecretDeleteStatus = "absent" | "backend-error" | "deleted";

export interface SecretDeleteResult {
  readonly status: SecretDeleteStatus;
}

export interface SecretStore {
  availability(): Promise<SecretStoreAvailability>;
  delete(account: string): Promise<SecretDeleteResult>;
  get(account: string): Promise<string | undefined>;
  set(account: string, secret: string): Promise<boolean>;
}

interface NativeEntry {
  deletePassword(): boolean | Promise<boolean>;
  getPassword(): null | string | Promise<null | string>;
  setPassword(password: string): unknown;
}

interface KeyringModule {
  readonly Entry: new (service: string, account: string) => NativeEntry;
}

export type KeyringModuleLoader = () => unknown;

function defaultLoader(): unknown {
  return createRequire(import.meta.url)("@napi-rs/keyring") as unknown;
}

function isKeyringModule(value: unknown): value is KeyringModule {
  return (
    typeof value === "object" &&
    value !== null &&
    "Entry" in value &&
    typeof (value as { readonly Entry?: unknown }).Entry === "function"
  );
}

export class NapiKeyringSecretStore implements SecretStore {
  readonly #loader: KeyringModuleLoader;
  readonly #service: string;
  #module: KeyringModule | undefined;
  #moduleLoadAttempted = false;

  constructor(loader: KeyringModuleLoader = defaultLoader, service = "umn-gopher-assistant.uga") {
    this.#loader = loader;
    this.#service = service;
  }

  #load(): KeyringModule | undefined {
    if (this.#moduleLoadAttempted) return this.#module;
    this.#moduleLoadAttempted = true;
    try {
      const loaded = this.#loader();
      if (isKeyringModule(loaded)) this.#module = loaded;
    } catch {
      this.#module = undefined;
    }
    return this.#module;
  }

  availability(): Promise<SecretStoreAvailability> {
    return Promise.resolve(
      this.#load() === undefined ? { available: false, reason: "module-unavailable" } : { available: true },
    );
  }

  async get(account: string): Promise<string | undefined> {
    const keyring = this.#load();
    if (keyring === undefined) return undefined;
    try {
      const entry = new keyring.Entry(this.#service, account);
      const value = await entry.getPassword();
      return typeof value === "string" && value.length > 0 ? value : undefined;
    } catch {
      // Native backends normally report a missing entry by throwing. Do not expose
      // backend messages because some OS implementations include account metadata.
      return undefined;
    }
  }

  async set(account: string, secret: string): Promise<boolean> {
    const keyring = this.#load();
    if (keyring === undefined) return false;
    try {
      const entry = new keyring.Entry(this.#service, account);
      await entry.setPassword(secret);
      return true;
    } catch {
      return false;
    }
  }

  async delete(account: string): Promise<SecretDeleteResult> {
    const keyring = this.#load();
    if (keyring === undefined) return { status: "backend-error" };
    try {
      const entry = new keyring.Entry(this.#service, account);
      const deleted: unknown = await entry.deletePassword();
      if (deleted === true) return { status: "deleted" };
      if (deleted === false) return { status: "absent" };
      return { status: "backend-error" };
    } catch {
      return { status: "backend-error" };
    }
  }
}

export class MemorySecretStore implements SecretStore {
  readonly #available: boolean;
  readonly #values = new Map<string, string>();

  constructor(available = true) {
    this.#available = available;
  }

  availability(): Promise<SecretStoreAvailability> {
    return Promise.resolve(
      this.#available ? { available: true } : { available: false, reason: "backend-unavailable" },
    );
  }

  get(account: string): Promise<string | undefined> {
    return Promise.resolve(this.#available ? this.#values.get(account) : undefined);
  }

  set(account: string, secret: string): Promise<boolean> {
    if (!this.#available) return Promise.resolve(false);
    this.#values.set(account, secret);
    return Promise.resolve(true);
  }

  delete(account: string): Promise<SecretDeleteResult> {
    if (!this.#available) return Promise.resolve({ status: "backend-error" });
    return Promise.resolve({ status: this.#values.delete(account) ? "deleted" : "absent" });
  }
}
