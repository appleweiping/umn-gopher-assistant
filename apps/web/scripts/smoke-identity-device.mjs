#!/usr/bin/env node

import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign as signData,
  verify as verifySignature,
} from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";

const DEVICE_CLIENT_ID = "gopher-cli";
const WEB_CLIENT_ID = "gopher-web";
const WEB_REDIRECT_URI = "http://127.0.0.1:3000/auth/callback";
const MCP_CLIENT_ID = "gopher-mcp";
const MCP_REDIRECT_URI = "http://127.0.0.1:4100/oauth/callback";
const REQUESTED_SCOPES = ["openid", "offline_access", "campus:read", "admin:write"];
export const DEFAULT_API_AUDIENCE = "gopher-api";
export const DEFAULT_MCP_AUDIENCE = "http://127.0.0.1:4100/mcp";

const requestTimeoutMilliseconds = 10_000;
const browserActionTimeoutMilliseconds = 30_000;
const maximumPollingDurationMilliseconds = 120_000;
const browserContextCleanupTimeoutMilliseconds = 5_000;
const browserCleanupTimeoutMilliseconds = 20_000;
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

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function createDpopKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicJwk = publicKey.export({ format: "jwk" });
  invariant(
    publicJwk.kty === "EC" &&
      publicJwk.crv === "P-256" &&
      typeof publicJwk.x === "string" &&
      typeof publicJwk.y === "string" &&
      publicJwk.d === undefined,
    "Generated DPoP public key is not a public P-256 JWK",
  );
  const thumbprint = createHash("sha256")
    .update(
      JSON.stringify({
        crv: publicJwk.crv,
        kty: publicJwk.kty,
        x: publicJwk.x,
        y: publicJwk.y,
      }),
      "utf8",
    )
    .digest("base64url");
  return { privateKey, publicJwk, thumbprint };
}

function canonicalDpopHtu(value) {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  return url.toString();
}

export function createDpopProof({ key, method, nonce, url }) {
  const header = {
    alg: "ES256",
    jwk: key.publicJwk,
    typ: "dpop+jwt",
  };
  const payload = {
    htm: method.toUpperCase(),
    htu: canonicalDpopHtu(url),
    iat: Math.floor(Date.now() / 1_000),
    jti: randomUUID(),
    ...(nonce === undefined ? {} : { nonce }),
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = signData(null, Buffer.from(signingInput, "ascii"), {
    dsaEncoding: "ieee-p1363",
    key: key.privateKey,
  });
  invariant(signature.length === 64, "Generated DPoP proof does not have a raw ES256 signature");
  return `${signingInput}.${signature.toString("base64url")}`;
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
  invariant(
    Array.isArray(discovery.dpop_signing_alg_values_supported) &&
      discovery.dpop_signing_alg_values_supported.includes("ES256"),
    "OIDC discovery does not advertise ES256 DPoP proofs",
  );
  return {
    authorizationEndpoint: assertIssuerEndpoint(
      requiredString(discovery, "authorization_endpoint", "OIDC discovery"),
      issuerUrl,
      "OIDC authorization endpoint",
    ),
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

async function readOauthError(response, label) {
  invariant(
    response.status === 400 || response.status === 401,
    `${label} returned unexpected HTTP ${String(response.status)}`,
  );
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  invariant(contentType === "application/json", `${label} did not return an OAuth JSON error`);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new SmokeError(`${label} returned an invalid OAuth JSON error`);
  }
  const error = requiredString(body, "error", label);
  invariant(
    error === "invalid_dpop_proof" ||
      error === "invalid_grant" ||
      error === "invalid_request" ||
      error === "authorization_pending" ||
      error === "slow_down",
    `${label} returned an unexpected OAuth error`,
  );
  return {
    code: error,
    dpopRelated: typeof body.error_description === "string" && /\bdpop\b/iu.test(body.error_description),
  };
}

async function tokenRequestWithDpop(tokenEndpoint, parameters, key, label) {
  let nonce;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request(tokenEndpoint, {
      body: new URLSearchParams(parameters),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        dpop: createDpopProof({
          key,
          method: "POST",
          nonce,
          url: tokenEndpoint,
        }),
      },
      method: "POST",
    });
    if (response.ok) return readJson(response, label);
    const challengedNonce = response.headers.get("dpop-nonce");
    if (attempt === 0 && challengedNonce !== null && challengedNonce.length > 0) {
      nonce = challengedNonce;
      continue;
    }
    const { code: error } = await readOauthError(response, label);
    throw new SmokeError(`${label} was rejected with ${error}`);
  }
  throw new SmokeError(`${label} exhausted its DPoP nonce retry`);
}

async function assertTokenRequestWithoutDpopFails(tokenEndpoint, parameters, label) {
  const response = await request(tokenEndpoint, {
    body: new URLSearchParams(parameters),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  invariant(!response.ok, `${label} unexpectedly issued a token without a DPoP proof`);
  const error = await readOauthError(response, label);
  invariant(
    (error.code === "invalid_dpop_proof" || error.code === "invalid_request") && error.dpopRelated,
    `${label} did not fail specifically because its DPoP proof was absent`,
  );
}

function assertDpopTokenResponse(tokenResponse, key, label) {
  invariant(tokenResponse?.token_type === "DPoP", `${label} did not return token_type DPoP`);
  const accessToken = requiredString(tokenResponse, "access_token", label);
  const refreshToken = requiredString(tokenResponse, "refresh_token", label);
  const { payload } = decodeJwt(accessToken);
  invariant(
    payload.cnf !== null &&
      typeof payload.cnf === "object" &&
      !Array.isArray(payload.cnf) &&
      payload.cnf.jkt === key.thumbprint,
    `${label} access token is not bound to the expected DPoP key`,
  );
  return { accessToken, refreshToken };
}

async function verifyRefreshRotation(tokenEndpoint, clientId, initialRefreshToken, key, label) {
  const refreshParameters = {
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: initialRefreshToken,
  };
  const wrongKeyResponse = await request(tokenEndpoint, {
    body: new URLSearchParams(refreshParameters),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      dpop: createDpopProof({
        key: createDpopKey(),
        method: "POST",
        url: tokenEndpoint,
      }),
    },
    method: "POST",
  });
  invariant(!wrongKeyResponse.ok, `${label} accepted a refresh proof from the wrong DPoP key`);
  const { code: wrongKeyError } = await readOauthError(wrongKeyResponse, `${label} wrong-key refresh`);
  invariant(
    wrongKeyError === "invalid_dpop_proof" ||
      wrongKeyError === "invalid_grant" ||
      wrongKeyError === "invalid_request",
    `${label} wrong-key refresh returned an unexpected OAuth error`,
  );

  const refreshed = await tokenRequestWithDpop(
    tokenEndpoint,
    refreshParameters,
    key,
    `${label} same-key refresh`,
  );
  const { refreshToken: rotatedRefreshToken } = assertDpopTokenResponse(
    refreshed,
    key,
    `${label} same-key refresh`,
  );
  invariant(
    rotatedRefreshToken !== initialRefreshToken,
    `${label} did not rotate its one-time refresh token`,
  );

  const replayResponse = await request(tokenEndpoint, {
    body: new URLSearchParams(refreshParameters),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      dpop: createDpopProof({ key, method: "POST", url: tokenEndpoint }),
    },
    method: "POST",
  });
  invariant(!replayResponse.ok, `${label} accepted a replayed refresh token`);
  const { code: replayError } = await readOauthError(replayResponse, `${label} old refresh-token replay`);
  invariant(
    replayError === "invalid_dpop_proof" ||
      replayError === "invalid_grant" ||
      replayError === "invalid_request",
    `${label} old refresh-token replay returned an unexpected OAuth error`,
  );
  return true;
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
  } finally {
    try {
      await withTimeout(
        () => context.close(),
        browserContextCleanupTimeoutMilliseconds,
        "Browser context cleanup",
      );
    } catch {
      // The outer cleanup still owns the browser process and will make one
      // bounded attempt to close it even when a context is wedged.
    }
  }
}

function createPkceMaterial() {
  const verifier = randomBytes(48).toString("base64url");
  return {
    challenge: createHash("sha256").update(verifier, "ascii").digest("base64url"),
    verifier,
  };
}

function webAuthorizationUrl(
  authorizationEndpoint,
  key,
  pkce,
  state,
  { clientId = WEB_CLIENT_ID, includeDpopJkt = true, redirectUri = WEB_REDIRECT_URI } = {},
) {
  const url = new URL(authorizationEndpoint);
  url.search = new URLSearchParams({
    client_id: clientId,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    nonce: randomUUID(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid campus:read",
    state,
    ...(includeDpopJkt ? { dpop_jkt: key.thumbprint } : {}),
  }).toString();
  return url;
}

async function assertMissingDpopJktRejected(
  authorizationEndpoint,
  { clientId = WEB_CLIENT_ID, redirectUri = WEB_REDIRECT_URI } = {},
) {
  const key = createDpopKey();
  const state = randomUUID();
  const url = webAuthorizationUrl(authorizationEndpoint, key, createPkceMaterial(), state, {
    clientId,
    includeDpopJkt: false,
    redirectUri,
  });
  url.searchParams.set("prompt", "none");
  let response;
  try {
    response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(requestTimeoutMilliseconds),
    });
  } catch {
    throw new SmokeError("DPoP authorization-code binding check could not reach the identity provider");
  }
  invariant(response.status === 302, "Authorization without dpop_jkt was not rejected by redirect");
  const location = response.headers.get("location");
  invariant(location !== null, "Authorization without dpop_jkt did not return an error redirect");
  const callback = new URL(location, redirectUri);
  invariant(
    callback.origin === new URL(redirectUri).origin && callback.pathname === new URL(redirectUri).pathname,
    "Authorization without dpop_jkt escaped the registered callback",
  );
  invariant(
    callback.searchParams.get("error") === "invalid_request" &&
      callback.searchParams.get("error_description")?.includes("dpop_jkt") === true &&
      callback.searchParams.get("state") === state,
    "Authorization without dpop_jkt was not rejected by the strict DPoP client policy",
  );
}

async function startWebCallbackServer(redirectUri) {
  let resolveCallback;
  const callbackPromise = new Promise((resolve) => {
    resolveCallback = resolve;
  });
  const expected = new URL(redirectUri);
  const server = createServer((incoming, response) => {
    let target;
    try {
      target = new URL(incoming.url ?? "/", expected.origin);
    } catch {
      response.writeHead(400, { "content-type": "text/plain" });
      response.end("Invalid callback.");
      return;
    }
    if (incoming.method !== "GET" || target.pathname !== expected.pathname) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("Not found.");
      return;
    }
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/plain",
    });
    response.end("Authorization callback captured by the isolated smoke test.");
    resolveCallback(target);
  });
  await new Promise((resolve, reject) => {
    server.once("error", () => reject(new SmokeError("Loopback web callback listener could not start")));
    server.listen(Number(expected.port), expected.hostname, resolve);
  });
  return {
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(new SmokeError("Loopback web callback listener could not stop"));
        });
      }),
    waitForCallback: () => callbackPromise,
  };
}

async function obtainWebAuthorizationCode(
  browser,
  authorizationEndpoint,
  identity,
  key,
  { clientId = WEB_CLIENT_ID, redirectUri = WEB_REDIRECT_URI } = {},
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(browserActionTimeoutMilliseconds);
  const pkce = createPkceMaterial();
  const state = randomUUID();
  const authorizationUrl = webAuthorizationUrl(authorizationEndpoint, key, pkce, state, {
    clientId,
    redirectUri,
  });
  let callbackServer;
  let phase = "callback listener";
  try {
    callbackServer = await startWebCallbackServer(redirectUri);
    phase = "authorization navigation";
    await page.goto(authorizationUrl.toString(), { waitUntil: "domcontentloaded" });
    phase = "synthetic login";
    await page.locator('#username, input[name="username"]').first().fill(identity.username);
    await page.locator('#password, input[name="password"]').first().fill(identity.password);
    await page.locator('#kc-login, button[type="submit"], input[type="submit"]').first().click();

    const consentButton = page
      .locator(
        '#kc-oauth #kc-login[name="accept"], #kc-oauth button[name="accept"], #kc-oauth input[name="accept"]',
      )
      .first();
    try {
      await consentButton.waitFor({ state: "visible", timeout: 2_000 });
      await consentButton.click();
    } catch {
      // Consent is disabled in the synthetic local realm.
    }

    phase = "authorization callback";
    const callback = await withTimeout(
      () => callbackServer.waitForCallback(),
      browserActionTimeoutMilliseconds,
      "Web authorization callback",
    );
    invariant(callback.searchParams.get("error") === null, "Web authorization returned an OAuth error");
    invariant(callback.searchParams.get("state") === state, "Web authorization state did not round-trip");
    return {
      code: requiredString(Object.fromEntries(callback.searchParams), "code", "Web authorization callback"),
      verifier: pkce.verifier,
    };
  } catch (error) {
    if (error instanceof SmokeError) throw error;
    let pageState = "unknown page";
    try {
      const callback = new URL(redirectUri);
      const current = new URL(page.url());
      if (current.origin === callback.origin && current.pathname === callback.pathname) {
        pageState = "callback page";
      } else if (await page.locator("#kc-oauth").isVisible()) {
        pageState = "consent page";
      } else if (await page.locator("#username").isVisible()) {
        pageState = "login page";
      } else if (await page.locator("#kc-error-message").isVisible()) {
        pageState = "identity-provider error page";
      } else {
        const visibleForm = page.locator("form:visible").first();
        const formId = (await visibleForm.count()) === 0 ? "none" : await visibleForm.getAttribute("id");
        pageState = `identity path ${current.pathname} with form ${formId ?? "unnamed"}`;
      }
    } catch {
      // Diagnostic classification is intentionally best-effort and secret-free.
    }
    throw new SmokeError(`Headless web authorization-code flow failed during ${phase} (${pageState})`);
  } finally {
    await Promise.all([
      withTimeout(() => context.close(), browserContextCleanupTimeoutMilliseconds, "Web context cleanup"),
      callbackServer === undefined
        ? Promise.resolve()
        : withTimeout(
            () => callbackServer.close(),
            browserContextCleanupTimeoutMilliseconds,
            "Web callback cleanup",
          ),
    ]);
  }
}

async function verifyAuthorizationCodeDpopFlow(
  browser,
  authorizationEndpoint,
  tokenEndpoint,
  identity,
  jwks,
  issuer,
  { clientId, label, redirectUri, resource },
) {
  await assertMissingDpopJktRejected(authorizationEndpoint, { clientId, redirectUri });
  const key = createDpopKey();

  const unprovedCode = await obtainWebAuthorizationCode(browser, authorizationEndpoint, identity, key, {
    clientId,
    redirectUri,
  });
  await assertTokenRequestWithoutDpopFails(
    tokenEndpoint,
    {
      client_id: clientId,
      code: unprovedCode.code,
      code_verifier: unprovedCode.verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    },
    `${label} authorization-code token request without DPoP`,
  );

  const provedCode = await obtainWebAuthorizationCode(browser, authorizationEndpoint, identity, key, {
    clientId,
    redirectUri,
  });
  const tokenResponse = await tokenRequestWithDpop(
    tokenEndpoint,
    {
      client_id: clientId,
      code: provedCode.code,
      code_verifier: provedCode.verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    },
    key,
    `${label} authorization-code token request`,
  );
  const { accessToken, refreshToken } = assertDpopTokenResponse(
    tokenResponse,
    key,
    `${label} authorization-code token request`,
  );
  verifyAccessToken(accessToken, {
    clientId,
    issuer,
    jwks,
    resource,
  });
  await verifyRefreshRotation(tokenEndpoint, clientId, refreshToken, key, `${label} client`);
  return {
    audience: resource === "mcp" ? DEFAULT_MCP_AUDIENCE : DEFAULT_API_AUDIENCE,
    authorizationCodeBound: true,
    missingProofRejected: true,
    refreshRotated: true,
    tokenType: "DPoP",
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function pollTokenEndpoint(tokenEndpoint, deviceAuthorization, key) {
  const deadline =
    Date.now() + Math.min(deviceAuthorization.expiresIn * 1_000, maximumPollingDurationMilliseconds);
  let intervalMilliseconds = deviceAuthorization.interval * 1_000;
  let nonce;

  while (Date.now() < deadline) {
    const response = await request(tokenEndpoint, {
      body: new URLSearchParams({
        client_id: DEVICE_CLIENT_ID,
        device_code: deviceAuthorization.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        dpop: createDpopProof({ key, method: "POST", nonce, url: tokenEndpoint }),
      },
      method: "POST",
    });
    if (response.ok) return readJson(response, "OIDC token polling");

    const challengedNonce = response.headers.get("dpop-nonce");
    if (challengedNonce !== null && challengedNonce.length > 0 && challengedNonce !== nonce) {
      nonce = challengedNonce;
      continue;
    }
    const { code: error } = await readOauthError(response, "OIDC token polling");
    if (error === "slow_down") intervalMilliseconds += 5_000;
    else invariant(error === "authorization_pending", "OIDC token polling was denied or expired");
    await delay(Math.min(intervalMilliseconds, Math.max(0, deadline - Date.now())));
  }

  throw new SmokeError("RFC 8628 device authorization expired before a token was issued");
}

async function assertDeviceTokenWithoutDpopFails(tokenEndpoint, deviceAuthorization) {
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
    invariant(!response.ok, "CLI device token endpoint issued a token without a DPoP proof");
    const error = await readOauthError(response, "CLI device token request without DPoP");
    if ((error.code === "invalid_dpop_proof" || error.code === "invalid_request") && error.dpopRelated) {
      return true;
    }
    if (error.code === "slow_down") intervalMilliseconds += 5_000;
    else invariant(error.code === "authorization_pending", "CLI device token request was denied or expired");
    await delay(Math.min(intervalMilliseconds, Math.max(0, deadline - Date.now())));
  }
  throw new SmokeError("CLI device token request did not reach its DPoP enforcement decision");
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
  invariant(
    audiences.length === 1 && audiences[0] === apiAudience,
    "OIDC access token does not have one exact API audience",
  );
  invariant(!audiences.includes(mcpAudience), "OIDC access token contains the MCP audience");

  return {
    adminWriteAbsent: true,
    apiAudiencePresent: true,
    campusReadPresent: true,
    mcpAudienceAbsent: true,
  };
}

function assertMcpAccessTokenClaims(
  payload,
  { apiAudience = DEFAULT_API_AUDIENCE, mcpAudience = DEFAULT_MCP_AUDIENCE } = {},
) {
  invariant(typeof payload.scope === "string", "MCP access token is missing its scope claim");
  const scopes = new Set(payload.scope.split(/\s+/u).filter(Boolean));
  invariant(scopes.has("campus:read"), "MCP access token is missing campus:read");
  invariant(!scopes.has("admin:write"), "MCP access token contains the unapproved admin:write scope");
  const audiences = typeof payload.aud === "string" ? [payload.aud] : payload.aud;
  invariant(
    Array.isArray(audiences) && audiences.every((audience) => typeof audience === "string"),
    "MCP access token has an invalid audience claim",
  );
  invariant(
    audiences.length === 1 && audiences[0] === mcpAudience,
    "MCP access token does not have one exact MCP audience",
  );
  invariant(!audiences.includes(apiAudience), "MCP access token contains the Core API audience");
  return {
    adminWriteAbsent: true,
    apiAudienceAbsent: true,
    campusReadPresent: true,
    mcpAudiencePresent: true,
  };
}

export function verifyAccessToken(
  accessToken,
  {
    clientId = DEVICE_CLIENT_ID,
    jwks,
    issuer,
    nowSeconds = Math.floor(Date.now() / 1_000),
    resource = "api",
  },
) {
  invariant(resource === "api" || resource === "mcp", "OIDC access token has an unknown resource");
  const { header, payload, signature, signingInput } = decodeJwt(accessToken);
  invariant(header.alg === "RS256", "OIDC access token does not use RS256");
  invariant(header.typ === "at+jwt", "OIDC access token does not use the RFC 9068 at+jwt type");
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
    clientClaims.length > 0 && clientClaims.every((value) => value === clientId),
    "OIDC access token client is not the expected public client",
  );
  invariant(
    typeof payload.exp === "number" &&
      Number.isFinite(payload.exp) &&
      nowSeconds <= payload.exp + jwtClockToleranceSeconds,
    "OIDC access token is expired or missing exp",
  );
  invariant(
    typeof payload.iat === "number" &&
      Number.isSafeInteger(payload.iat) &&
      payload.exp > payload.iat &&
      payload.exp - payload.iat <= 300,
    "OIDC access token has an invalid or excessive declared lifetime",
  );
  invariant(
    typeof payload.jti === "string" && /^[A-Za-z0-9._~:-]{8,128}$/u.test(payload.jti),
    "OIDC access token is missing a bounded URI-safe token ID",
  );
  invariant(
    typeof payload.sub === "string" && payload.sub.length > 0 && payload.sub.length <= 512,
    "OIDC access token is missing a bounded subject",
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
    ...(resource === "mcp" ? assertMcpAccessTokenClaims(payload) : assertAccessTokenClaims(payload)),
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

    const { authorizationEndpoint, deviceEndpoint, jwksEndpoint, tokenEndpoint } =
      await discoverDeviceEndpoints(issuerUrl);
    const jwks = await readJwks(jwksEndpoint);
    const launch = await launchHeadlessBrowser();
    browser = launch.browser;
    browserRuntime = launch.runtime;

    const web = await verifyAuthorizationCodeDpopFlow(
      browser,
      authorizationEndpoint,
      tokenEndpoint,
      identityState.identity,
      jwks,
      exactIssuer,
      {
        clientId: WEB_CLIENT_ID,
        label: "Web",
        redirectUri: WEB_REDIRECT_URI,
        resource: "api",
      },
    );
    const mcp = await verifyAuthorizationCodeDpopFlow(
      browser,
      authorizationEndpoint,
      tokenEndpoint,
      identityState.identity,
      jwks,
      exactIssuer,
      {
        clientId: MCP_CLIENT_ID,
        label: "MCP",
        redirectUri: MCP_REDIRECT_URI,
        resource: "mcp",
      },
    );

    const unprovedDeviceAuthorization = await requestDeviceAuthorization(deviceEndpoint, issuerUrl);
    await completeBrowserAuthorization(
      browser,
      unprovedDeviceAuthorization.verificationUri,
      unprovedDeviceAuthorization.userCode,
      identityState.identity,
    );
    await assertDeviceTokenWithoutDpopFails(tokenEndpoint, unprovedDeviceAuthorization);

    const deviceAuthorization = await requestDeviceAuthorization(deviceEndpoint, issuerUrl);
    await completeBrowserAuthorization(
      browser,
      deviceAuthorization.verificationUri,
      deviceAuthorization.userCode,
      identityState.identity,
    );
    const deviceKey = createDpopKey();
    const tokenResponse = await pollTokenEndpoint(tokenEndpoint, deviceAuthorization, deviceKey);
    const { accessToken, refreshToken } = assertDpopTokenResponse(
      tokenResponse,
      deviceKey,
      "CLI device token request",
    );
    const assertions = verifyAccessToken(accessToken, { issuer: exactIssuer, jwks });
    await verifyRefreshRotation(
      tokenEndpoint,
      DEVICE_CLIENT_ID,
      refreshToken,
      deviceKey,
      "CLI device client",
    );
    result = {
      assertions,
      browser: browserRuntime,
      cli: {
        missingProofRejected: true,
        refreshRotated: true,
        tokenType: "DPoP",
      },
      mcp,
      status: "passed",
      web,
    };
  } catch (error) {
    primaryFailure =
      error instanceof SmokeError ? error : new SmokeError("Identity device smoke failed unexpectedly");
  } finally {
    cleanupResult = await runBoundedCleanup({
      browserCleanupRequired: browser !== undefined,
      closeBrowser: async () => {
        try {
          await withTimeout(() => browser.close(), 15_000, "Browser close");
        } catch {
          // On Windows, Playwright can close the browser process and emit the
          // disconnect event before its close Promise settles. Treat the
          // observable disconnected state as successful cleanup, never merely
          // the elapsed timeout.
          invariant(!browser.isConnected(), "Browser remained connected after close timed out");
        }
      },
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
      const failedCleanup = [
        ...(cleanupResult.browserClosed ? [] : ["browser"]),
        ...(cleanupResult.temporaryUserDeleted ? [] : ["temporary user"]),
      ].join(" and ");
      primaryFailure = new SmokeError(
        primaryFailure === undefined
          ? `Identity device smoke ${failedCleanup} cleanup failed`
          : `${primaryFailure.message}; ${failedCleanup} cleanup also failed`,
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
