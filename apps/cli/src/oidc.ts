import { CliError } from "./errors.js";
import { ExitCode } from "./exit-codes.js";
import { fetchNoRedirect, readJson, type HttpDependencies } from "./http.js";
import { normalizeIssuerUrl, validateRemoteHttpsUrl } from "./url-policy.js";

export const DEVICE_CLIENT_ID = "gopher-cli";
export const DEVICE_SCOPES = ["openid", "offline_access", "campus:read"] as const;

export interface OidcDiscovery {
  readonly deviceAuthorizationEndpoint: URL;
  readonly issuer: URL;
  readonly tokenEndpoint: URL;
}

export interface DeviceAuthorization {
  readonly deviceCode: string;
  readonly expiresIn: number;
  readonly interval: number;
  readonly userCode: string;
  readonly verificationUri: URL;
  readonly verificationUriComplete?: URL;
}

export interface TokenBundle {
  readonly accessToken: string;
  readonly expiresAt: number;
  readonly refreshToken?: string;
  readonly scope: readonly string[];
}

export type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

export interface OidcClientDependencies extends HttpDependencies {
  readonly now: () => number;
  readonly sleep: Sleep;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum = 65_536): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : undefined;
}

function positiveInteger(value: unknown, maximum: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= maximum
    ? value
    : undefined;
}

function endpointFromDiscovery(value: unknown, label: string): URL {
  const endpoint = boundedString(value, 2048);
  if (endpoint === undefined) {
    throw new CliError(ExitCode.protocol, "invalid-oidc-discovery", `OIDC discovery omitted ${label}.`);
  }
  return validateRemoteHttpsUrl(endpoint, label);
}

function canonicalIssuer(url: URL): string {
  return url.toString().replace(/\/+$/u, "");
}

function parseToken(value: unknown, now: number, previousRefreshToken?: string): TokenBundle {
  if (!isRecord(value)) {
    throw new CliError(ExitCode.protocol, "invalid-token-response", "The token response was malformed.");
  }
  const accessToken = boundedString(value["access_token"]);
  const tokenType = boundedString(value["token_type"], 32);
  const expiresIn = positiveInteger(value["expires_in"], 86_400);
  if (accessToken === undefined || tokenType?.toLowerCase() !== "bearer" || expiresIn === undefined) {
    throw new CliError(ExitCode.protocol, "invalid-token-response", "The token response was malformed.");
  }
  const newRefreshToken = boundedString(value["refresh_token"]);
  const refreshToken = newRefreshToken ?? previousRefreshToken;
  const scopeValue = boundedString(value["scope"], 4096);
  return {
    accessToken,
    expiresAt: now + expiresIn * 1000,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    scope: scopeValue === undefined ? [] : scopeValue.split(/\s+/u).filter(Boolean),
  };
}

function oauthError(value: unknown): string | undefined {
  return isRecord(value) ? boundedString(value["error"], 128) : undefined;
}

export async function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) {
    throw new CliError(ExitCode.auth, "device-flow-cancelled", "Device authorization was cancelled.");
  }
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => signal?.removeEventListener("abort", cancel);
    const cancel = (): void => {
      clearTimeout(timer);
      cleanup();
      reject(new CliError(ExitCode.auth, "device-flow-cancelled", "Device authorization was cancelled."));
    };
    const finish = (): void => {
      cleanup();
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

export class OidcClient {
  readonly #dependencies: OidcClientDependencies;
  readonly #discoveryCache = new Map<string, OidcDiscovery>();

  constructor(dependencies: OidcClientDependencies) {
    this.#dependencies = dependencies;
  }

  async discover(issuer: URL, signal?: AbortSignal): Promise<OidcDiscovery> {
    const normalizedIssuer = normalizeIssuerUrl(issuer.toString());
    const key = canonicalIssuer(normalizedIssuer);
    const cached = this.#discoveryCache.get(key);
    if (cached !== undefined) return cached;
    const discoveryUrl = new URL(".well-known/openid-configuration", normalizedIssuer);
    const response = await fetchNoRedirect(
      this.#dependencies,
      discoveryUrl,
      { headers: { Accept: "application/json" }, method: "GET" },
      signal,
    );
    const value = await readJson(response);
    if (!response.ok) {
      throw new CliError(
        ExitCode.unavailable,
        "oidc-discovery-unavailable",
        "OIDC discovery is unavailable.",
        { status: response.status },
      );
    }
    if (!isRecord(value) || typeof value["issuer"] !== "string") {
      throw new CliError(ExitCode.protocol, "invalid-oidc-discovery", "OIDC discovery was malformed.");
    }
    const discoveredIssuer = validateRemoteHttpsUrl(value["issuer"], "discovered issuer");
    if (canonicalIssuer(discoveredIssuer) !== key) {
      throw new CliError(ExitCode.protocol, "issuer-mismatch", "OIDC discovery returned a different issuer.");
    }
    const discovered: OidcDiscovery = {
      deviceAuthorizationEndpoint: endpointFromDiscovery(
        value["device_authorization_endpoint"],
        "device authorization endpoint",
      ),
      issuer: discoveredIssuer,
      tokenEndpoint: endpointFromDiscovery(value["token_endpoint"], "token endpoint"),
    };
    this.#discoveryCache.set(key, discovered);
    return discovered;
  }

  async beginDeviceAuthorization(issuer: URL, signal?: AbortSignal): Promise<DeviceAuthorization> {
    const discovery = await this.discover(issuer, signal);
    const body = new URLSearchParams({
      client_id: DEVICE_CLIENT_ID,
      scope: DEVICE_SCOPES.join(" "),
    });
    const response = await fetchNoRedirect(
      this.#dependencies,
      discovery.deviceAuthorizationEndpoint,
      {
        body,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        method: "POST",
      },
      signal,
    );
    const value = await readJson(response);
    if (!response.ok) {
      throw new CliError(
        response.status === 401 || response.status === 403 ? ExitCode.auth : ExitCode.unavailable,
        "device-authorization-failed",
        "The identity provider rejected device authorization.",
        { status: response.status },
      );
    }
    if (!isRecord(value)) {
      throw new CliError(ExitCode.protocol, "invalid-device-response", "Device authorization was malformed.");
    }
    const deviceCode = boundedString(value["device_code"]);
    const userCode = boundedString(value["user_code"], 256);
    const verificationUriValue = boundedString(value["verification_uri"], 2048);
    const expiresIn = positiveInteger(value["expires_in"], 3600);
    const interval = value["interval"] === undefined ? 5 : positiveInteger(value["interval"], 60);
    if (
      deviceCode === undefined ||
      userCode === undefined ||
      verificationUriValue === undefined ||
      expiresIn === undefined ||
      interval === undefined
    ) {
      throw new CliError(ExitCode.protocol, "invalid-device-response", "Device authorization was malformed.");
    }
    const complete = boundedString(value["verification_uri_complete"], 2048);
    return {
      deviceCode,
      expiresIn,
      interval,
      userCode,
      verificationUri: validateRemoteHttpsUrl(verificationUriValue, "verification URI"),
      ...(complete === undefined
        ? {}
        : { verificationUriComplete: validateRemoteHttpsUrl(complete, "complete verification URI") }),
    };
  }

  async pollDeviceToken(
    issuer: URL,
    authorization: DeviceAuthorization,
    signal?: AbortSignal,
  ): Promise<TokenBundle> {
    const discovery = await this.discover(issuer, signal);
    const deadline = this.#dependencies.now() + authorization.expiresIn * 1000;
    let intervalMilliseconds = authorization.interval * 1000;
    while (this.#dependencies.now() < deadline) {
      if (signal?.aborted === true) {
        throw new CliError(ExitCode.auth, "device-flow-cancelled", "Device authorization was cancelled.");
      }
      const response = await fetchNoRedirect(
        this.#dependencies,
        discovery.tokenEndpoint,
        {
          body: new URLSearchParams({
            client_id: DEVICE_CLIENT_ID,
            device_code: authorization.deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        },
        signal,
      );
      const value = await readJson(response);
      if (response.ok) return parseToken(value, this.#dependencies.now());
      const code = oauthError(value);
      if (code === "authorization_pending") {
        await this.#dependencies.sleep(intervalMilliseconds, signal);
        continue;
      }
      if (code === "slow_down") {
        intervalMilliseconds += 5000;
        await this.#dependencies.sleep(intervalMilliseconds, signal);
        continue;
      }
      if (code === "access_denied") {
        throw new CliError(ExitCode.auth, "device-access-denied", "Device authorization was denied.");
      }
      if (code === "expired_token") {
        throw new CliError(ExitCode.auth, "device-code-expired", "The device authorization code expired.");
      }
      throw new CliError(
        response.status >= 500 ? ExitCode.unavailable : ExitCode.protocol,
        "device-token-failed",
        "The identity provider rejected the device token request.",
        { status: response.status },
      );
    }
    throw new CliError(ExitCode.auth, "device-code-expired", "The device authorization code expired.");
  }

  async refresh(issuer: URL, refreshToken: string, signal?: AbortSignal): Promise<TokenBundle> {
    const discovery = await this.discover(issuer, signal);
    const response = await fetchNoRedirect(
      this.#dependencies,
      discovery.tokenEndpoint,
      {
        body: new URLSearchParams({
          client_id: DEVICE_CLIENT_ID,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        method: "POST",
      },
      signal,
    );
    const value = await readJson(response);
    if (!response.ok) {
      const code = oauthError(value);
      if (code === "invalid_grant" || code === "invalid_token") {
        throw new CliError(ExitCode.auth, "refresh-token-rejected", "Stored authentication has expired.");
      }
      throw new CliError(
        response.status >= 500 ? ExitCode.unavailable : ExitCode.auth,
        "token-refresh-failed",
        "The identity provider rejected token refresh.",
        { status: response.status },
      );
    }
    return parseToken(value, this.#dependencies.now(), refreshToken);
  }
}
