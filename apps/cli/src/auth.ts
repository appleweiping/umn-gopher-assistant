import { CliError } from "./errors.js";
import { ExitCode } from "./exit-codes.js";
import { type DeviceAuthorization, type OidcClient, type TokenBundle } from "./oidc.js";
import type { SecretStore, SecretStoreAvailability } from "./secret-store.js";

const expirationSkewMilliseconds = 30_000;

interface StoredAuthentication {
  readonly issuer: string;
  readonly token: TokenBundle;
  readonly version: 1;
}

export type AuthenticationSource = "environment" | "keychain" | "missing";

export interface AuthenticationStatus {
  readonly available: boolean;
  readonly expired: boolean | null;
  readonly expiresAt: number | null;
  readonly keychain: SecretStoreAvailability;
  readonly refreshable: boolean;
  readonly scope: readonly string[];
  readonly source: AuthenticationSource;
}

export interface LoginResult {
  readonly expiresAt: number;
  readonly persisted: "keychain";
  readonly scope: readonly string[];
}

export interface LoginHooks {
  readonly signal?: AbortSignal;
  readonly verification: (authorization: DeviceAuthorization) => void;
}

export interface LogoutResult {
  readonly deletion: "absent" | "deleted";
  readonly environmentTokenStillSet: boolean;
  readonly removed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseToken(value: unknown): TokenBundle | undefined {
  if (
    !isRecord(value) ||
    typeof value["accessToken"] !== "string" ||
    value["accessToken"].length === 0 ||
    value["accessToken"].length > 65_536 ||
    typeof value["expiresAt"] !== "number" ||
    !Number.isFinite(value["expiresAt"]) ||
    !Array.isArray(value["scope"]) ||
    !value["scope"].every((scope) => typeof scope === "string" && scope.length <= 256) ||
    (value["refreshToken"] !== undefined &&
      (typeof value["refreshToken"] !== "string" || value["refreshToken"].length > 65_536))
  ) {
    return undefined;
  }
  return {
    accessToken: value["accessToken"],
    expiresAt: value["expiresAt"],
    ...(value["refreshToken"] === undefined ? {} : { refreshToken: value["refreshToken"] }),
    scope: value["scope"],
  };
}

function parseStored(value: string | undefined): StoredAuthentication | undefined {
  if (value === undefined || value.length > 196_608) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed) || parsed["version"] !== 1 || typeof parsed["issuer"] !== "string") {
      return undefined;
    }
    const token = parseToken(parsed["token"]);
    return token === undefined ? undefined : { issuer: parsed["issuer"], token, version: 1 };
  } catch {
    return undefined;
  }
}

function accountFor(profile: string): string {
  return `profile:${profile}`;
}

function issuerKey(issuer: URL): string {
  return issuer.toString().replace(/\/+$/u, "");
}

export class AuthManager {
  readonly #environment: NodeJS.ProcessEnv;
  readonly #now: () => number;
  readonly #oidc: OidcClient;
  readonly #secretStore: SecretStore;

  constructor(options: {
    readonly environment: NodeJS.ProcessEnv;
    readonly now: () => number;
    readonly oidc: OidcClient;
    readonly secretStore: SecretStore;
  }) {
    this.#environment = options.environment;
    this.#now = options.now;
    this.#oidc = options.oidc;
    this.#secretStore = options.secretStore;
  }

  #environmentToken(): string | undefined {
    const token = this.#environment["UGA_ACCESS_TOKEN"];
    return typeof token === "string" && token.length > 0 ? token : undefined;
  }

  async #persistOrFail(profile: string, serialized: string, message: string): Promise<void> {
    const account = accountFor(profile);
    let persisted = false;
    try {
      persisted = await this.#secretStore.set(account, serialized);
    } catch {
      persisted = false;
    }
    if (persisted) return;
    try {
      await this.#secretStore.delete(account);
    } catch {
      // The stable authentication failure below is more useful and safer than a
      // native keychain error, which may include account or backend details.
    }
    throw new CliError(ExitCode.auth, "secure-storage-unavailable", message);
  }

  async #stored(profile: string): Promise<{
    readonly authentication?: StoredAuthentication;
    readonly source: "keychain" | "missing";
  }> {
    const serialized = await this.#secretStore.get(accountFor(profile));
    const authentication = parseStored(serialized);
    return authentication === undefined ? { source: "missing" } : { authentication, source: "keychain" };
  }

  async status(profile: string): Promise<AuthenticationStatus> {
    const keychain = await this.#secretStore.availability();
    if (this.#environmentToken() !== undefined) {
      return {
        available: true,
        expired: null,
        expiresAt: null,
        keychain,
        refreshable: false,
        scope: [],
        source: "environment",
      };
    }
    const stored = await this.#stored(profile);
    if (stored.authentication === undefined) {
      return {
        available: false,
        expired: null,
        expiresAt: null,
        keychain,
        refreshable: false,
        scope: [],
        source: "missing",
      };
    }
    const token = stored.authentication.token;
    return {
      available: token.expiresAt > this.#now() || token.refreshToken !== undefined,
      expired: token.expiresAt <= this.#now(),
      expiresAt: token.expiresAt,
      keychain,
      refreshable: token.refreshToken !== undefined,
      scope: token.scope,
      source: stored.source,
    };
  }

  async login(profile: string, issuer: URL, hooks: LoginHooks): Promise<LoginResult> {
    let token: TokenBundle;
    try {
      const authorization = await this.#oidc.beginDeviceAuthorization(issuer, hooks.signal);
      hooks.verification(authorization);
      token = await this.#oidc.pollDeviceToken(issuer, authorization, hooks.signal);
    } catch (error) {
      if (hooks.signal?.aborted === true) {
        throw new CliError(ExitCode.auth, "device-flow-cancelled", "Device authorization was cancelled.");
      }
      throw error;
    }
    const authentication: StoredAuthentication = {
      issuer: issuerKey(issuer),
      token,
      version: 1,
    };
    const serialized = JSON.stringify(authentication);
    await this.#persistOrFail(
      profile,
      serialized,
      "The OS keychain could not securely retain authentication. No credential was kept.",
    );
    return { expiresAt: token.expiresAt, persisted: "keychain", scope: token.scope };
  }

  async logout(profile: string): Promise<LogoutResult> {
    let deletion;
    try {
      deletion = await this.#secretStore.delete(accountFor(profile));
    } catch {
      deletion = { status: "backend-error" as const };
    }
    if (deletion.status === "backend-error") {
      throw new CliError(
        ExitCode.auth,
        "secure-storage-unavailable",
        "The OS keychain could not confirm credential deletion. Stored credentials may remain.",
      );
    }
    return {
      deletion: deletion.status,
      environmentTokenStillSet: this.#environmentToken() !== undefined,
      removed: deletion.status === "deleted",
    };
  }

  async getAccessToken(profile: string, issuer: URL, signal?: AbortSignal): Promise<string> {
    const environmentToken = this.#environmentToken();
    if (environmentToken !== undefined) return environmentToken;
    const stored = await this.#stored(profile);
    const authentication = stored.authentication;
    if (authentication === undefined) {
      throw new CliError(ExitCode.auth, "authentication-required", "Run `uga auth login` first.");
    }
    if (authentication.issuer !== issuerKey(issuer)) {
      throw new CliError(
        ExitCode.auth,
        "issuer-changed",
        "Stored authentication belongs to a different OIDC issuer. Log in again.",
      );
    }
    if (authentication.token.expiresAt > this.#now() + expirationSkewMilliseconds) {
      return authentication.token.accessToken;
    }
    if (authentication.token.refreshToken === undefined) {
      throw new CliError(ExitCode.auth, "authentication-expired", "Stored authentication has expired.");
    }
    const refreshed = await this.#oidc.refresh(issuer, authentication.token.refreshToken, signal);
    const replacement: StoredAuthentication = {
      issuer: authentication.issuer,
      token: refreshed,
      version: 1,
    };
    await this.#persistOrFail(
      profile,
      JSON.stringify(replacement),
      "The OS keychain could not securely retain refreshed authentication. No credential was kept.",
    );
    return refreshed.accessToken;
  }
}
