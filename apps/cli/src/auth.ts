import {
  generateDpopPrivateJwk,
  parseDpopPrivateJwk,
  validateDpopCredential,
  type DpopCredential,
  type DpopPrivateJwk,
} from "@umn-gopher-assistant/sdk";

import { CliError } from "./errors.js";
import { ExitCode } from "./exit-codes.js";
import { type DeviceAuthorization, type OidcClient, type TokenBundle } from "./oidc.js";
import type { SecretStore, SecretStoreAvailability } from "./secret-store.js";
import {
  defaultCredentialLockNamespace,
  SocketCredentialRefreshLock,
  type CredentialRefreshLock,
} from "./refresh-lock.js";

const expirationSkewMilliseconds = 30_000;
const dpopNoncePattern = /^[\x21\x23-\x5B\x5D-\x7E]{1,512}$/u;
const credentialMutationLockScope = "urn:umn-gopher-assistant:cli:credential-mutation:v2";

interface StoredAuthentication {
  readonly dpopPrivateJwk: DpopPrivateJwk;
  readonly issuer: string;
  readonly token: TokenBundle;
  readonly version: 2;
}

export type AuthenticationSource = "environment" | "keychain" | "legacy-keychain" | "missing";

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
      (typeof value["refreshToken"] !== "string" || value["refreshToken"].length > 65_536)) ||
    (value["authorizationServerDpopNonce"] !== undefined &&
      (typeof value["authorizationServerDpopNonce"] !== "string" ||
        !dpopNoncePattern.test(value["authorizationServerDpopNonce"])))
  ) {
    return undefined;
  }
  return {
    accessToken: value["accessToken"],
    ...(value["authorizationServerDpopNonce"] === undefined
      ? {}
      : { authorizationServerDpopNonce: value["authorizationServerDpopNonce"] }),
    expiresAt: value["expiresAt"],
    ...(value["refreshToken"] === undefined ? {} : { refreshToken: value["refreshToken"] }),
    scope: value["scope"],
  };
}

function parseStored(value: string | undefined): StoredAuthentication | undefined {
  if (value === undefined || value.length > 196_608) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed) || parsed["version"] !== 2 || typeof parsed["issuer"] !== "string") {
      return undefined;
    }
    const token = parseToken(parsed["token"]);
    const dpopPrivateJwk = parseDpopPrivateJwk(parsed["dpopPrivateJwk"]);
    return token === undefined || dpopPrivateJwk === undefined
      ? undefined
      : { dpopPrivateJwk, issuer: parsed["issuer"], token, version: 2 };
  } catch {
    return undefined;
  }
}

function isLegacyStored(value: string | undefined): boolean {
  if (value === undefined || value.length > 196_608) return false;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) && parsed["version"] === 1;
  } catch {
    return false;
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
  readonly #generateDpopPrivateJwk: () => Promise<DpopPrivateJwk>;
  readonly #refreshLock: CredentialRefreshLock;

  constructor(options: {
    readonly environment: NodeJS.ProcessEnv;
    readonly now: () => number;
    readonly oidc: OidcClient;
    readonly secretStore: SecretStore;
    readonly generateDpopPrivateJwk?: () => Promise<DpopPrivateJwk>;
    readonly refreshLock?: CredentialRefreshLock;
  }) {
    this.#environment = options.environment;
    this.#now = options.now;
    this.#oidc = options.oidc;
    this.#secretStore = options.secretStore;
    this.#generateDpopPrivateJwk = options.generateDpopPrivateJwk ?? generateDpopPrivateJwk;
    this.#refreshLock =
      options.refreshLock ??
      new SocketCredentialRefreshLock(defaultCredentialLockNamespace(options.environment));
  }

  #environmentToken(): string | undefined {
    const token = this.#environment["UGA_ACCESS_TOKEN"];
    return typeof token === "string" && token.length > 0 ? token : undefined;
  }

  async #environmentCredential(): Promise<DpopCredential | undefined> {
    const accessToken = this.#environmentToken();
    const serializedKey = this.#environment["UGA_DPOP_PRIVATE_JWK"];
    if (accessToken === undefined && serializedKey === undefined) return undefined;
    if (accessToken === undefined || serializedKey === undefined) {
      throw new CliError(
        ExitCode.auth,
        "environment-dpop-credential-incomplete",
        "UGA_ACCESS_TOKEN and UGA_DPOP_PRIVATE_JWK must be supplied together.",
      );
    }
    let privateJwk: DpopPrivateJwk | undefined;
    try {
      privateJwk = parseDpopPrivateJwk(JSON.parse(serializedKey) as unknown);
    } catch {
      privateJwk = undefined;
    }
    if (privateJwk === undefined) {
      throw new CliError(
        ExitCode.auth,
        "environment-dpop-credential-invalid",
        "UGA_DPOP_PRIVATE_JWK is not a canonical private P-256 JWK.",
      );
    }
    try {
      return await validateDpopCredential({ accessToken, privateJwk });
    } catch {
      throw new CliError(
        ExitCode.auth,
        "environment-dpop-credential-invalid",
        "The environment access token is not bound to UGA_DPOP_PRIVATE_JWK.",
      );
    }
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
    readonly source: "keychain" | "legacy-keychain" | "missing";
  }> {
    const serialized = await this.#secretStore.get(accountFor(profile));
    const authentication = parseStored(serialized);
    if (authentication !== undefined) return { authentication, source: "keychain" };
    return { source: isLegacyStored(serialized) ? "legacy-keychain" : "missing" };
  }

  async status(profile: string): Promise<AuthenticationStatus> {
    const keychain = await this.#secretStore.availability();
    if ((await this.#environmentCredential()) !== undefined) {
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
        source: stored.source,
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
    const dpopPrivateJwk = await this.#generateDpopPrivateJwk();
    try {
      const authorization = await this.#oidc.beginDeviceAuthorization(issuer, hooks.signal);
      hooks.verification(authorization);
      token = await this.#oidc.pollDeviceToken(issuer, authorization, dpopPrivateJwk, hooks.signal);
    } catch (error) {
      if (hooks.signal?.aborted === true) {
        throw new CliError(ExitCode.auth, "device-flow-cancelled", "Device authorization was cancelled.");
      }
      throw error;
    }
    const authentication: StoredAuthentication = {
      dpopPrivateJwk,
      issuer: issuerKey(issuer),
      token,
      version: 2,
    };
    const serialized = JSON.stringify(authentication);
    await this.#refreshLock.withLock(profile, credentialMutationLockScope, hooks.signal, () =>
      this.#persistOrFail(
        profile,
        serialized,
        "The OS keychain could not securely retain authentication. No credential was kept.",
      ),
    );
    return { expiresAt: token.expiresAt, persisted: "keychain", scope: token.scope };
  }

  async logout(profile: string): Promise<LogoutResult> {
    return this.#refreshLock.withLock(profile, credentialMutationLockScope, undefined, async () => {
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
    });
  }

  async getDpopCredential(profile: string, issuer: URL, signal?: AbortSignal): Promise<DpopCredential> {
    const environmentCredential = await this.#environmentCredential();
    if (environmentCredential !== undefined) return environmentCredential;
    const stored = await this.#stored(profile);
    const authentication = stored.authentication;
    if (authentication === undefined) {
      if (stored.source === "legacy-keychain") {
        throw new CliError(
          ExitCode.auth,
          "dpop-key-missing",
          "Stored authentication predates DPoP key binding. Run `uga auth login` again.",
        );
      }
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
      try {
        return await validateDpopCredential({
          accessToken: authentication.token.accessToken,
          privateJwk: authentication.dpopPrivateJwk,
        });
      } catch {
        throw new CliError(
          ExitCode.auth,
          "dpop-key-mismatch",
          "Stored authentication is not bound to its DPoP key. Log in again.",
        );
      }
    }
    return this.#refreshLock.withLock(profile, credentialMutationLockScope, signal, async () => {
      // Another process may have rotated the refresh token while this process
      // waited. Re-read only after acquiring the cross-process lease.
      const latestStored = await this.#stored(profile);
      const latest = latestStored.authentication;
      if (latest?.issuer !== issuerKey(issuer)) {
        throw new CliError(
          ExitCode.auth,
          "authentication-required",
          "Stored authentication changed while waiting. Run `uga auth login` again.",
        );
      }
      if (latest.token.expiresAt > this.#now() + expirationSkewMilliseconds) {
        try {
          return await validateDpopCredential({
            accessToken: latest.token.accessToken,
            privateJwk: latest.dpopPrivateJwk,
          });
        } catch {
          throw new CliError(
            ExitCode.auth,
            "dpop-key-mismatch",
            "Stored authentication is not bound to its DPoP key. Log in again.",
          );
        }
      }
      if (latest.token.refreshToken === undefined) {
        throw new CliError(ExitCode.auth, "authentication-expired", "Stored authentication has expired.");
      }
      const refreshed = await this.#oidc.refresh(
        issuer,
        latest.token.refreshToken,
        latest.dpopPrivateJwk,
        latest.token.authorizationServerDpopNonce,
        signal,
      );
      const replacement: StoredAuthentication = {
        dpopPrivateJwk: latest.dpopPrivateJwk,
        issuer: latest.issuer,
        token: refreshed,
        version: 2,
      };
      await this.#persistOrFail(
        profile,
        JSON.stringify(replacement),
        "The OS keychain could not securely retain refreshed authentication. No credential was kept.",
      );
      return {
        accessToken: refreshed.accessToken,
        privateJwk: latest.dpopPrivateJwk,
      };
    });
  }
}
