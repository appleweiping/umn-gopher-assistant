#!/usr/bin/env node

import { createPublicKey, randomBytes, randomUUID, verify as verifySignature } from "node:crypto";
import { existsSync } from "node:fs";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";

const DEVICE_CLIENT_ID = "gopher-cli";
const REQUESTED_SCOPES = ["openid", "offline_access", "campus:read", "admin:write"];
export const DEFAULT_API_AUDIENCE = "gopher-api";
export const DEFAULT_MCP_AUDIENCE = "http://127.0.0.1:4100/mcp";

const requestTimeoutMilliseconds = 10_000;
const browserActionTimeoutMilliseconds = 30_000;
const maximumPollingDurationMilliseconds = 120_000;
const browserCleanupTimeoutMilliseconds = 10_000;
const identityCleanupTimeoutMilliseconds = 60_000;
const jwtClockToleranceSeconds = 5;

const browserEnvironmentAllowlist = new Set([
  "APPDATA",
  "DBUS_SESSION_BUS_ADDRESS",
  "DISPLAY",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LD_LIBRARY_PATH",
  "LOCALAPPDATA",
  "PATH",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WAYLAND_DISPLAY",
  "WINDIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_RUNTIME_DIR",
]);

const sensitiveEnvironmentNameFragments = [
  "ADMIN",
  "APIKEY",
  "API_KEY",
  "AUTHORIZATION",
  "COOKIE",
  "CREDENTIAL",
  "DEBUG",
  "PASSWORD",
  "PASSWD",
  "PRIVATE_KEY",
  "PWDEBUG",
  "SECRET",
  "TOKEN",
];

class SmokeError extends Error {
  constructor(message) {
    super(message);
    this.name = "SmokeError";
  }
}

function invariant(condition, message) {
  if (!condition) throw new SmokeError(message);
}

function requiredEnvironmentVariable(name) {
  const value = process.env[name];
  invariant(typeof value === "string" && value.length > 0, `Set ${name} to run this opt-in smoke test`);
  return value;
}

function requiredString(record, key, label) {
  const value = record?.[key];
  invariant(typeof value === "string" && value.length > 0, `${label} is missing ${key}`);
  return value;
}

function positiveNumber(record, key, label) {
  const value = record?.[key];
  invariant(
    typeof value === "number" && Number.isFinite(value) && value > 0,
    `${label} has an invalid ${key}`,
  );
  return value;
}

function isExplicitLoopbackHostname(hostname) {
  const normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (normalized === "localhost") return true;
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) return normalized.split(".", 1)[0] === "127";
  return ipVersion === 6 && normalized === "::1";
}

export function parseIdentityBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new SmokeError("IDENTITY_BASE_URL is not a valid absolute URL");
  }
  invariant(
    url.username.length === 0 && url.password.length === 0,
    "IDENTITY_BASE_URL must not contain credentials",
  );
  invariant(
    !url.href.includes("?") && !url.href.includes("#"),
    "IDENTITY_BASE_URL must not contain a query or fragment",
  );
  invariant(
    url.protocol === "https:" || url.protocol === "http:",
    "IDENTITY_BASE_URL must use HTTPS or loopback HTTP",
  );
  if (url.protocol === "http:") {
    invariant(
      isExplicitLoopbackHostname(url.hostname),
      "IDENTITY_BASE_URL permits HTTP only for an explicit loopback host",
    );
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function assertIssuerEndpoint(candidate, issuerUrl, label) {
  let endpoint;
  try {
    endpoint = new URL(candidate);
  } catch {
    throw new SmokeError(`${label} is not a valid absolute URL`);
  }
  const issuerPathPrefix = `${issuerUrl.pathname.replace(/\/$/u, "")}/`;
  invariant(
    endpoint.username.length === 0 &&
      endpoint.password.length === 0 &&
      endpoint.origin === issuerUrl.origin &&
      endpoint.pathname.startsWith(issuerPathPrefix),
    `${label} escaped the configured issuer`,
  );
  return endpoint;
}

async function request(url, init = {}) {
  try {
    return await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(requestTimeoutMilliseconds),
    });
  } catch {
    throw new SmokeError("Identity provider request failed");
  }
}

async function readJson(response, label) {
  invariant(response.ok, `${label} returned HTTP ${String(response.status)}`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  invariant(contentType === "application/json", `${label} did not return application/json`);
  try {
    return await response.json();
  } catch {
    throw new SmokeError(`${label} returned invalid JSON`);
  }
}

async function authenticateAdmin(identityBaseUrl, adminUsername, adminPassword) {
  const response = await request(new URL("realms/master/protocol/openid-connect/token", identityBaseUrl), {
    body: new URLSearchParams({
      client_id: "admin-cli",
      grant_type: "password",
      password: adminPassword,
      username: adminUsername,
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const body = await readJson(response, "Keycloak administrator authentication");
  return requiredString(body, "access_token", "Keycloak administrator authentication");
}

function createSyntheticIdentityState() {
  const suffix = randomUUID().replaceAll("-", "");
  return {
    creationAttempted: false,
    creationConfirmed: false,
    identity: {
      email: `device-smoke-${suffix}@example.invalid`,
      password: `Sm0ke-${randomBytes(32).toString("base64url")}!`,
      username: `device-smoke-${suffix}`,
    },
    userId: undefined,
  };
}

function adminUsersUrl(identityBaseUrl, realm) {
  return new URL(`admin/realms/${encodeURIComponent(realm)}/users`, identityBaseUrl);
}

async function findSyntheticUserIds(identityBaseUrl, realm, accessToken, username) {
  const url = adminUsersUrl(identityBaseUrl, realm);
  url.search = new URLSearchParams({ exact: "true", username }).toString();
  const response = await request(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const users = await readJson(response, "Keycloak temporary-user lookup");
  invariant(Array.isArray(users), "Keycloak temporary-user lookup did not return an array");
  return users
    .filter((candidate) => candidate?.username === username)
    .map((candidate) => requiredString(candidate, "id", "Keycloak temporary-user lookup"));
}

function userIdFromLocation(location, usersUrl) {
  if (location === null) return undefined;
  let createdUrl;
  try {
    createdUrl = new URL(location, usersUrl);
  } catch {
    return undefined;
  }
  const usersPathPrefix = `${usersUrl.pathname.replace(/\/$/u, "")}/`;
  if (createdUrl.origin !== usersUrl.origin || !createdUrl.pathname.startsWith(usersPathPrefix)) {
    return undefined;
  }
  const id = createdUrl.pathname.slice(usersPathPrefix.length);
  return id.length > 0 && !id.includes("/") ? decodeURIComponent(id) : undefined;
}

async function createSyntheticUser(identityBaseUrl, realm, accessToken, identityState) {
  const usersUrl = adminUsersUrl(identityBaseUrl, realm);
  identityState.creationAttempted = true;
  const response = await request(usersUrl, {
    body: JSON.stringify({
      credentials: [{ temporary: false, type: "password", value: identityState.identity.password }],
      email: identityState.identity.email,
      emailVerified: true,
      enabled: true,
      firstName: "Synthetic",
      lastName: "Device Smoke",
      requiredActions: [],
      username: identityState.identity.username,
    }),
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  invariant(
    response.status === 201,
    `Keycloak temporary-user creation returned HTTP ${String(response.status)}`,
  );
  identityState.creationConfirmed = true;
  identityState.userId = userIdFromLocation(response.headers.get("location"), usersUrl);
  if (identityState.userId === undefined) {
    const matches = await findSyntheticUserIds(
      identityBaseUrl,
      realm,
      accessToken,
      identityState.identity.username,
    );
    invariant(matches.length === 1, "Keycloak temporary-user creation did not resolve one exact user");
    [identityState.userId] = matches;
  }
}

async function deleteUserId(identityBaseUrl, realm, accessToken, userId) {
  const response = await request(
    new URL(
      `${adminUsersUrl(identityBaseUrl, realm).pathname.replace(/\/$/u, "")}/${encodeURIComponent(userId)}`,
      identityBaseUrl,
    ),
    {
      headers: { authorization: `Bearer ${accessToken}` },
      method: "DELETE",
    },
  );
  invariant(
    response.status === 204 || response.status === 404,
    `Keycloak temporary-user deletion returned HTTP ${String(response.status)}`,
  );
}

async function deleteAndAuditSyntheticIdentity(identityBaseUrl, realm, accessToken, identityState) {
  const matchingIds = await findSyntheticUserIds(
    identityBaseUrl,
    realm,
    accessToken,
    identityState.identity.username,
  );
  const idsToDelete = new Set(matchingIds);
  if (identityState.userId !== undefined) idsToDelete.add(identityState.userId);
  for (const userId of idsToDelete) {
    await deleteUserId(identityBaseUrl, realm, accessToken, userId);
  }
  const remainingIds = await findSyntheticUserIds(
    identityBaseUrl,
    realm,
    accessToken,
    identityState.identity.username,
  );
  invariant(remainingIds.length === 0, "Keycloak temporary-user post-delete audit was not empty");
}

export async function cleanupIdentityWithReauthentication(accessToken, cleanupWithToken, reauthenticate) {
  try {
    await cleanupWithToken(accessToken);
  } catch {
    const refreshedAccessToken = await reauthenticate();
    await cleanupWithToken(refreshedAccessToken);
  }
}

async function discoverDeviceEndpoints(issuerUrl) {
  const discoveryUrl = new URL(
    `${issuerUrl.toString().replace(/\/$/u, "")}/.well-known/openid-configuration`,
  );
  const response = await request(discoveryUrl);
  const discovery = await readJson(response, "OIDC discovery");
  const exactIssuer = issuerUrl.toString().replace(/\/$/u, "");
  invariant(discovery.issuer === exactIssuer, "OIDC discovery issuer is not exact");
  return {
    deviceEndpoint: assertIssuerEndpoint(
      requiredString(discovery, "device_authorization_endpoint", "OIDC discovery"),
      issuerUrl,
      "OIDC device endpoint",
    ),
    jwksEndpoint: assertIssuerEndpoint(
      requiredString(discovery, "jwks_uri", "OIDC discovery"),
      issuerUrl,
      "OIDC JWKS endpoint",
    ),
    tokenEndpoint: assertIssuerEndpoint(
      requiredString(discovery, "token_endpoint", "OIDC discovery"),
      issuerUrl,
      "OIDC token endpoint",
    ),
  };
}

async function readJwks(jwksEndpoint) {
  const jwks = await readJson(await request(jwksEndpoint), "OIDC JWKS");
  invariant(Array.isArray(jwks?.keys), "OIDC JWKS is missing keys");
  return jwks;
}

async function requestDeviceAuthorization(deviceEndpoint, issuerUrl) {
  const response = await request(deviceEndpoint, {
    body: new URLSearchParams({
      client_id: DEVICE_CLIENT_ID,
      scope: REQUESTED_SCOPES.join(" "),
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const body = await readJson(response, "RFC 8628 device authorization");
  const expiresIn = positiveNumber(body, "expires_in", "RFC 8628 device authorization");
  const interval =
    body.interval === undefined ? 5 : positiveNumber(body, "interval", "RFC 8628 device authorization");
  const verificationUri = assertIssuerEndpoint(
    requiredString(body, "verification_uri", "RFC 8628 device authorization"),
    issuerUrl,
    "RFC 8628 verification URI",
  );
  return {
    deviceCode: requiredString(body, "device_code", "RFC 8628 device authorization"),
    expiresIn,
    interval,
    userCode: requiredString(body, "user_code", "RFC 8628 device authorization"),
    verificationUri,
  };
}

function installedChromeCandidates() {
  if (process.platform === "win32") {
    return [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      process.env.LOCALAPPDATA === undefined
        ? undefined
        : `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    ];
  }
  if (process.platform === "darwin") {
    return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  }
  return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome"];
}

function isSensitiveEnvironmentName(name) {
  const normalized = name.toUpperCase().replace(/[^A-Z0-9]+/gu, "_");
  return sensitiveEnvironmentNameFragments.some((fragment) => normalized.includes(fragment));
}

export function sanitizeBrowserEnvironment(environment) {
  const sanitized = {};
  for (const [name, value] of Object.entries(environment)) {
    const normalizedName = name.toUpperCase();
    if (
      typeof value === "string" &&
      browserEnvironmentAllowlist.has(normalizedName) &&
      !isSensitiveEnvironmentName(name)
    ) {
      sanitized[name] = value;
    }
  }
  return sanitized;
}

function clearPlaywrightDebugEnvironment() {
  for (const name of Object.keys(process.env)) {
    const normalizedName = name.toUpperCase();
    if (normalizedName === "DEBUG" || normalizedName === "PWDEBUG") {
      Reflect.deleteProperty(process.env, name);
    }
  }
}

async function launchHeadlessBrowser() {
  clearPlaywrightDebugEnvironment();
  const { chromium } = await import("@playwright/test");
  const browserEnvironment = sanitizeBrowserEnvironment(process.env);
  const launchOptions = { env: browserEnvironment, headless: true };
  const configuredExecutable = process.env.PLAYWRIGHT_CHROME_EXECUTABLE;
  if (configuredExecutable !== undefined) {
    invariant(existsSync(configuredExecutable), "PLAYWRIGHT_CHROME_EXECUTABLE does not identify a file");
    try {
      return {
        browser: await chromium.launch({ ...launchOptions, executablePath: configuredExecutable }),
        runtime: "configured Chrome",
      };
    } catch {
      throw new SmokeError("Configured Chrome could not be launched");
    }
  }

  try {
    return {
      browser: await chromium.launch(launchOptions),
      runtime: "Playwright Chromium",
    };
  } catch {
    const installedChrome = installedChromeCandidates().find(
      (candidate) => candidate !== undefined && existsSync(candidate),
    );
    invariant(
      installedChrome !== undefined,
      "No Playwright Chromium or installed Chrome executable is available",
    );
    try {
      return {
        browser: await chromium.launch({ ...launchOptions, executablePath: installedChrome }),
        runtime: "installed Chrome",
      };
    } catch {
      throw new SmokeError("Installed Chrome could not be launched");
    }
  }
}

async function completeBrowserAuthorization(browser, verificationUri, userCode, identity) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(browserActionTimeoutMilliseconds);
  try {
    await page.goto(verificationUri.toString(), { waitUntil: "domcontentloaded" });
    const codeInput = page
      .locator('#device-user-code, input[name="device_user_code"], input[name="user_code"]')
      .first();
    await codeInput.fill(userCode);
    await page.locator('#kc-user-verify-device-user-code-form [type="submit"]').click();

    await page.locator('#username, input[name="username"]').first().fill(identity.username);
    await page.locator('#password, input[name="password"]').first().fill(identity.password);
    await page.locator('#kc-login, button[type="submit"], input[type="submit"]').first().click();

    const consentButton = page
      .locator(
        '#kc-oauth #kc-login[name="accept"], #kc-oauth button[name="accept"], #kc-oauth input[name="accept"]',
      )
      .first();
    try {
      await consentButton.waitFor({ state: "visible", timeout: 10_000 });
      await consentButton.click();
    } catch {
      // A realm may suppress consent. Signed token polling still proves authorization completed.
    }
  } catch {
    throw new SmokeError("Headless browser login or consent failed");
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function pollTokenEndpoint(tokenEndpoint, deviceAuthorization) {
  const deadline =
    Date.now() + Math.min(deviceAuthorization.expiresIn * 1_000, maximumPollingDurationMilliseconds);
  let intervalMilliseconds = deviceAuthorization.interval * 1_000;

  while (Date.now() < deadline) {
    const response = await request(tokenEndpoint, {
      body: new URLSearchParams({
        client_id: DEVICE_CLIENT_ID,
        device_code: deviceAuthorization.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    if (response.ok) return readJson(response, "OIDC token polling");

    invariant(response.status === 400, `OIDC token polling returned HTTP ${String(response.status)}`);
    let body;
    try {
      body = await response.json();
    } catch {
      throw new SmokeError("OIDC token polling returned invalid JSON");
    }
    if (body?.error === "slow_down") intervalMilliseconds += 5_000;
    else invariant(body?.error === "authorization_pending", "OIDC token polling was denied or expired");
    await delay(Math.min(intervalMilliseconds, Math.max(0, deadline - Date.now())));
  }

  throw new SmokeError("RFC 8628 device authorization expired before a token was issued");
}

function decodeJwtJsonSegment(segment, label) {
  invariant(/^[A-Za-z0-9_-]+$/u.test(segment), `OIDC access token has an invalid ${label}`);
  try {
    const value = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    invariant(
      value !== null && typeof value === "object" && !Array.isArray(value),
      `OIDC access token has an invalid ${label}`,
    );
    return value;
  } catch (error) {
    if (error instanceof SmokeError) throw error;
    throw new SmokeError(`OIDC access token has an invalid ${label}`);
  }
}

function decodeJwt(accessToken) {
  invariant(
    typeof accessToken === "string" && accessToken.length > 0,
    "OIDC token response is missing access_token",
  );
  const parts = accessToken.split(".");
  invariant(parts.length === 3 && parts.every((part) => part.length > 0), "OIDC access token is not a JWT");
  return {
    header: decodeJwtJsonSegment(parts[0], "header"),
    payload: decodeJwtJsonSegment(parts[1], "payload"),
    signature: parts[2],
    signingInput: `${parts[0]}.${parts[1]}`,
  };
}

export function assertAccessTokenClaims(
  payload,
  { apiAudience = DEFAULT_API_AUDIENCE, mcpAudience = DEFAULT_MCP_AUDIENCE } = {},
) {
  invariant(typeof payload.scope === "string", "OIDC access token is missing its scope claim");
  const scopes = new Set(payload.scope.split(/\s+/u).filter(Boolean));
  invariant(scopes.has("campus:read"), "OIDC access token is missing campus:read");
  invariant(!scopes.has("admin:write"), "OIDC access token contains the unapproved admin:write scope");

  const audiences = typeof payload.aud === "string" ? [payload.aud] : payload.aud;
  invariant(
    Array.isArray(audiences) && audiences.every((audience) => typeof audience === "string"),
    "OIDC access token has an invalid audience claim",
  );
  invariant(audiences.includes(apiAudience), "OIDC access token is missing the exact API audience");
  invariant(!audiences.includes(mcpAudience), "OIDC access token contains the MCP audience");

  return {
    adminWriteAbsent: true,
    apiAudiencePresent: true,
    campusReadPresent: true,
    mcpAudienceAbsent: true,
  };
}

export function verifyAccessToken(
  accessToken,
  { jwks, issuer, nowSeconds = Math.floor(Date.now() / 1_000) },
) {
  const { header, payload, signature, signingInput } = decodeJwt(accessToken);
  invariant(header.alg === "RS256", "OIDC access token does not use RS256");
  const keyId = requiredString(header, "kid", "OIDC access token header");
  invariant(Array.isArray(jwks?.keys), "OIDC JWKS is missing keys");
  const matchingKeys = jwks.keys.filter((candidate) => candidate?.kid === keyId);
  invariant(matchingKeys.length === 1, "OIDC JWKS did not contain one exact signing key");
  const [jwk] = matchingKeys;
  invariant(jwk?.kty === "RSA", "OIDC signing key is not RSA");
  invariant(jwk.alg === undefined || jwk.alg === "RS256", "OIDC signing key has the wrong algorithm");
  invariant(jwk.use === undefined || jwk.use === "sig", "OIDC signing key is not for signatures");
  invariant(
    jwk.key_ops === undefined || (Array.isArray(jwk.key_ops) && jwk.key_ops.includes("verify")),
    "OIDC signing key cannot verify signatures",
  );

  let signatureIsValid;
  try {
    const publicKey = createPublicKey({ format: "jwk", key: jwk });
    signatureIsValid = verifySignature(
      "RSA-SHA256",
      Buffer.from(signingInput, "ascii"),
      publicKey,
      Buffer.from(signature, "base64url"),
    );
  } catch {
    throw new SmokeError("OIDC access token signature verification failed");
  }
  invariant(signatureIsValid, "OIDC access token signature verification failed");
  invariant(payload.iss === issuer, "OIDC access token issuer is not exact");

  const clientClaims = [payload.azp, payload.client_id].filter((value) => value !== undefined);
  invariant(
    clientClaims.length > 0 && clientClaims.every((value) => value === DEVICE_CLIENT_ID),
    "OIDC access token client is not gopher-cli",
  );
  invariant(
    typeof payload.exp === "number" &&
      Number.isFinite(payload.exp) &&
      nowSeconds <= payload.exp + jwtClockToleranceSeconds,
    "OIDC access token is expired or missing exp",
  );
  if (payload.nbf !== undefined) {
    invariant(
      typeof payload.nbf === "number" &&
        Number.isFinite(payload.nbf) &&
        nowSeconds + jwtClockToleranceSeconds >= payload.nbf,
      "OIDC access token is not active",
    );
  }

  return {
    ...assertAccessTokenClaims(payload),
    clientExact: true,
    issuerExact: true,
    signatureVerified: true,
  };
}

function withTimeout(operation, timeoutMilliseconds, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new SmokeError(`${label} timed out`)), timeoutMilliseconds);
  });
  return Promise.race([Promise.resolve().then(operation), timeout]).finally(() => {
    clearTimeout(timeoutId);
  });
}

async function boundedOutcome(operation, timeoutMilliseconds, label) {
  try {
    await withTimeout(operation, timeoutMilliseconds, label);
    return true;
  } catch {
    return false;
  }
}

export async function runBoundedCleanup({
  browserCleanupRequired,
  browserTimeoutMilliseconds = browserCleanupTimeoutMilliseconds,
  closeBrowser,
  deleteIdentity,
  identityCleanupRequired,
  identityTimeoutMilliseconds = identityCleanupTimeoutMilliseconds,
}) {
  const browserTask = browserCleanupRequired
    ? boundedOutcome(closeBrowser, browserTimeoutMilliseconds, "Browser cleanup")
    : Promise.resolve(true);
  const identityTask = identityCleanupRequired
    ? boundedOutcome(deleteIdentity, identityTimeoutMilliseconds, "Temporary-user cleanup")
    : Promise.resolve(true);
  const [browserClosed, temporaryUserDeleted] = await Promise.all([browserTask, identityTask]);
  return { browserClosed, temporaryUserDeleted };
}

export async function runIdentityDeviceSmoke() {
  const identityBaseUrl = parseIdentityBaseUrl(process.env.IDENTITY_BASE_URL ?? "http://127.0.0.1:8080/");
  const adminUsername = requiredEnvironmentVariable("KEYCLOAK_ADMIN");
  const adminPassword = requiredEnvironmentVariable("KEYCLOAK_ADMIN_PASSWORD");
  const realm = process.env.IDENTITY_REALM ?? "gopher-assistant-dev";
  const issuerUrl = new URL(`realms/${encodeURIComponent(realm)}`, identityBaseUrl);
  const exactIssuer = issuerUrl.toString().replace(/\/$/u, "");
  const identityState = createSyntheticIdentityState();

  let adminAccessToken;
  let browser;
  let browserRuntime;
  let result;
  let primaryFailure;
  let cleanupResult = { browserClosed: true, temporaryUserDeleted: true };

  try {
    adminAccessToken = await authenticateAdmin(identityBaseUrl, adminUsername, adminPassword);
    await createSyntheticUser(identityBaseUrl, realm, adminAccessToken, identityState);
    invariant(
      identityState.userId !== undefined,
      "Keycloak temporary-user creation did not return an identifier",
    );

    const { deviceEndpoint, jwksEndpoint, tokenEndpoint } = await discoverDeviceEndpoints(issuerUrl);
    const deviceAuthorization = await requestDeviceAuthorization(deviceEndpoint, issuerUrl);
    const launch = await launchHeadlessBrowser();
    browser = launch.browser;
    browserRuntime = launch.runtime;
    await completeBrowserAuthorization(
      browser,
      deviceAuthorization.verificationUri,
      deviceAuthorization.userCode,
      identityState.identity,
    );
    const tokenResponse = await pollTokenEndpoint(tokenEndpoint, deviceAuthorization);
    const accessToken = requiredString(tokenResponse, "access_token", "OIDC token response");
    const jwks = await readJwks(jwksEndpoint);
    const assertions = verifyAccessToken(accessToken, { issuer: exactIssuer, jwks });
    result = { assertions, browser: browserRuntime, status: "passed" };
  } catch (error) {
    primaryFailure =
      error instanceof SmokeError ? error : new SmokeError("Identity device smoke failed unexpectedly");
  } finally {
    cleanupResult = await runBoundedCleanup({
      browserCleanupRequired: browser !== undefined,
      closeBrowser: async () => browser.close(),
      deleteIdentity: async () => {
        invariant(adminAccessToken !== undefined, "Temporary-user cleanup has no administrator token");
        await cleanupIdentityWithReauthentication(
          adminAccessToken,
          async (accessToken) =>
            deleteAndAuditSyntheticIdentity(identityBaseUrl, realm, accessToken, identityState),
          async () => authenticateAdmin(identityBaseUrl, adminUsername, adminPassword),
        );
      },
      identityCleanupRequired: identityState.creationAttempted,
    });
    if (!cleanupResult.browserClosed || !cleanupResult.temporaryUserDeleted) {
      primaryFailure = new SmokeError(
        primaryFailure === undefined
          ? "Identity device smoke cleanup failed"
          : "Identity device smoke failed and cleanup also failed",
      );
    }
  }

  if (primaryFailure !== undefined) throw primaryFailure;
  invariant(result !== undefined, "Identity device smoke produced no result");
  return { ...result, ...cleanupResult };
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  try {
    console.log(JSON.stringify(await runIdentityDeviceSmoke(), null, 2));
  } catch (error) {
    console.error(error instanceof SmokeError ? error.message : "Identity device smoke failed unexpectedly");
    process.exitCode = 1;
  }
}
