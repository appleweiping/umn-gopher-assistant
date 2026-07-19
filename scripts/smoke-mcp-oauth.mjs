#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const apiPort = 4000;
const mcpPort = 4100;
const apiBaseUrl = new URL(`http://127.0.0.1:${apiPort}/`);
const mcpResourceUrl = new URL(`http://127.0.0.1:${mcpPort}/mcp`);
const requestTimeoutMilliseconds = 10_000;
const startupTimeoutMilliseconds = 90_000;
const shutdownGraceMilliseconds = 5_000;
const shutdownKillMilliseconds = 5_000;
const expectedTools = ["campuses_list", "sources_list", "world_manifest_get"];
const expectedCampusIds = ["tc", "duluth", "crookston", "morris", "rochester"];
const expectedLeastPrivilegeScopes = ["campus:read"];
const apiAudience = "gopher-api";
const sensitiveEnvironmentFragments = [
  "apikey",
  "accesskey",
  "auth",
  "bearer",
  "authorization",
  "cookie",
  "credential",
  "passphrase",
  "passwd",
  "password",
  "privatekey",
  "pwd",
  "secret",
  "token",
];
const permittedPublicAuthConfigurationKeys = new Set([
  "MCP_AUTH_MODE",
  "MCP_OAUTH_ISSUER",
  "MCP_OAUTH_JWKS_URL",
]);
const runtimeErrors = new WeakMap();

let requestedShutdownSignal;

class SmokeError extends Error {
  constructor(message) {
    super(message);
    this.name = "SmokeError";
  }
}

function invariant(condition, message) {
  if (!condition) throw new SmokeError(message);
}

function requiredEnvironmentPair(leftName, rightName) {
  const left = process.env[leftName];
  const right = process.env[rightName];
  invariant(
    typeof left === "string" && left.length > 0 && typeof right === "string" && right.length > 0,
    `Set both ${leftName} and ${rightName} to run this opt-in smoke test`,
  );
  return [left, right];
}

function loopbackBaseUrl(value) {
  const url = new URL(value);
  invariant(
    url.protocol === "http:" || url.protocol === "https:",
    "IDENTITY_BASE_URL must use HTTP or HTTPS",
  );
  invariant(
    url.hostname === "localhost" || url.hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/u.test(url.hostname),
    "This local smoke test requires a loopback IDENTITY_BASE_URL",
  );
  invariant(
    !url.username && !url.password && !url.search && !url.hash,
    "IDENTITY_BASE_URL must not contain credentials, query, or fragment",
  );
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

async function request(url, init = {}) {
  try {
    return await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(requestTimeoutMilliseconds),
    });
  } catch {
    throw new SmokeError("A smoke-test HTTP request failed");
  }
}

async function readJson(response, label, expectedStatuses = [200]) {
  invariant(expectedStatuses.includes(response.status), `${label} returned HTTP ${String(response.status)}`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  invariant(contentType === "application/json", `${label} did not return application/json`);
  try {
    return await response.json();
  } catch {
    throw new SmokeError(`${label} returned invalid JSON`);
  }
}

function requiredString(record, key, label) {
  const value = record?.[key];
  invariant(typeof value === "string" && value.length > 0, `${label} is missing ${key}`);
  return value;
}

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", () => reject(new SmokeError(`Loopback port ${String(port)} is already in use`)));
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => (error ? reject(new SmokeError("Port preflight cleanup failed")) : resolve()));
    });
  });
}

async function assertPortEventuallyFree(port) {
  const deadline = Date.now() + shutdownKillMilliseconds;
  while (Date.now() < deadline) {
    try {
      await assertPortFree(port);
      return;
    } catch (error) {
      if (!(error instanceof SmokeError)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new SmokeError(`Loopback port ${String(port)} still has a listener after cleanup`);
}

function isSensitiveEnvironmentKey(key) {
  const normalized = key.replaceAll(/[^a-z0-9]/giu, "").toLowerCase();
  return (
    normalized === "keycloakadmin" ||
    sensitiveEnvironmentFragments.some((fragment) => normalized.includes(fragment))
  );
}

function childEnvironment(overrides, inheritedEnvironment = process.env) {
  const environment = {};
  for (const [key, value] of Object.entries(inheritedEnvironment)) {
    if (value !== undefined && !isSensitiveEnvironmentKey(key)) environment[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    invariant(
      !isSensitiveEnvironmentKey(key) || permittedPublicAuthConfigurationKeys.has(key),
      `Refusing sensitive child environment key ${key}`,
    );
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

async function spawnRuntime(relativeEntryPoint, environment) {
  const entryPoint = new URL(relativeEntryPoint, new URL("../", import.meta.url));
  await access(entryPoint);
  const child = spawn(process.execPath, [fileURLToPath(entryPoint)], {
    cwd: repositoryRoot,
    env: childEnvironment(environment),
    stdio: "ignore",
    windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    const onError = () => {
      child.off("spawn", onSpawn);
      reject(new SmokeError("A compiled smoke-test runtime could not be spawned"));
    };
    const onSpawn = () => {
      child.off("error", onError);
      child.on("error", (error) => runtimeErrors.set(child, error));
      resolve();
    };
    child.once("error", onError);
    child.once("spawn", onSpawn);
  });
  return child;
}

function assertRuntimeRunning(child) {
  invariant(!runtimeErrors.has(child), "A compiled smoke-test runtime emitted an error");
  invariant(child.exitCode === null, "A compiled smoke-test runtime exited unexpectedly");
  invariant(child.signalCode === null, "A compiled smoke-test runtime was terminated by a signal");
}

async function waitForHealthy(url, child) {
  const deadline = Date.now() + startupTimeoutMilliseconds;
  while (Date.now() < deadline) {
    assertRuntimeRunning(child);
    try {
      const response = await request(url);
      if (response.status === 200) return;
    } catch (error) {
      if (!(error instanceof SmokeError)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new SmokeError("A compiled smoke-test runtime did not become healthy");
}

async function waitForRuntimeExit(child, timeoutMilliseconds) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    let timeout;
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolve(child.exitCode !== null || child.signalCode !== null);
    }, timeoutMilliseconds);
    child.once("exit", onExit);
  });
}

async function stopRuntime(
  child,
  { graceMilliseconds = shutdownGraceMilliseconds, killMilliseconds = shutdownKillMilliseconds } = {},
) {
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
  invariant(child.kill("SIGTERM"), "A compiled smoke-test runtime rejected SIGTERM");
  if (await waitForRuntimeExit(child, graceMilliseconds)) return;
  invariant(child.kill("SIGKILL"), "A compiled smoke-test runtime rejected SIGKILL");
  invariant(
    await waitForRuntimeExit(child, killMilliseconds),
    "A compiled smoke-test runtime did not exit after SIGKILL",
  );
}

async function authenticateAdmin(identityBaseUrl, username, password) {
  const response = await request(new URL("realms/master/protocol/openid-connect/token", identityBaseUrl), {
    body: new URLSearchParams({ client_id: "admin-cli", grant_type: "password", password, username }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const body = await readJson(response, "Keycloak administrator authentication");
  return requiredString(body, "access_token", "Keycloak administrator authentication");
}

function adminHeaders(accessToken) {
  return { authorization: `Bearer ${accessToken}` };
}

function temporaryClientIdentity(purpose) {
  return {
    clientId: `mcp-oauth-smoke-${purpose}-${randomUUID().replaceAll("-", "")}`,
    clientSecret: randomBytes(48).toString("base64url"),
    internalId: undefined,
  };
}

async function createTemporaryClient(identityBaseUrl, realm, accessToken, temporaryClient) {
  const { clientId, clientSecret } = temporaryClient;
  const clientsUrl = new URL(`admin/realms/${encodeURIComponent(realm)}/clients`, identityBaseUrl);
  const createResponse = await request(clientsUrl, {
    body: JSON.stringify({
      bearerOnly: false,
      clientAuthenticatorType: "client-secret",
      clientId,
      defaultClientScopes: [],
      directAccessGrantsEnabled: false,
      enabled: true,
      fullScopeAllowed: false,
      implicitFlowEnabled: false,
      optionalClientScopes: [],
      protocol: "openid-connect",
      publicClient: false,
      secret: clientSecret,
      serviceAccountsEnabled: true,
      standardFlowEnabled: false,
    }),
    headers: { ...adminHeaders(accessToken), "content-type": "application/json" },
    method: "POST",
  });
  invariant(
    createResponse.status === 201,
    `Temporary client creation returned HTTP ${String(createResponse.status)}`,
  );

  const lookupUrl = new URL(clientsUrl);
  lookupUrl.search = new URLSearchParams({ clientId, exact: "true" }).toString();
  const clients = await readJson(
    await request(lookupUrl, { headers: adminHeaders(accessToken) }),
    "Temporary client lookup",
  );
  invariant(Array.isArray(clients) && clients.length === 1, "Temporary client lookup was not exact");
  const internalId = requiredString(clients[0], "id", "Temporary client lookup");
  return { clientId, clientSecret, internalId };
}

async function linkClientScopes(identityBaseUrl, realm, accessToken, clientInternalId, scopeNames) {
  const scopes = await readJson(
    await request(new URL(`admin/realms/${encodeURIComponent(realm)}/client-scopes`, identityBaseUrl), {
      headers: adminHeaders(accessToken),
    }),
    "Keycloak client-scope lookup",
  );
  invariant(Array.isArray(scopes), "Keycloak client-scope lookup did not return an array");
  for (const scopeName of scopeNames) {
    const matches = scopes.filter((scope) => scope?.name === scopeName);
    invariant(matches.length === 1, `Keycloak is missing the exact ${scopeName} client scope`);
    const scopeId = requiredString(matches[0], "id", `${scopeName} client scope`);
    const response = await request(
      new URL(
        `admin/realms/${encodeURIComponent(realm)}/clients/${encodeURIComponent(clientInternalId)}/default-client-scopes/${encodeURIComponent(scopeId)}`,
        identityBaseUrl,
      ),
      {
        body: "{}",
        headers: { ...adminHeaders(accessToken), "content-type": "application/json" },
        method: "PUT",
      },
    );
    invariant(
      response.status === 204,
      `${scopeName} client-scope linkage returned HTTP ${String(response.status)}`,
    );
  }
}

async function lookupTemporaryClients(identityBaseUrl, realm, accessToken, clientId) {
  const lookupUrl = new URL(`admin/realms/${encodeURIComponent(realm)}/clients`, identityBaseUrl);
  lookupUrl.search = new URLSearchParams({ clientId, exact: "true" }).toString();
  const clients = await readJson(
    await request(lookupUrl, { headers: adminHeaders(accessToken) }),
    "Temporary client cleanup lookup",
  );
  invariant(Array.isArray(clients) && clients.length <= 1, "Temporary client cleanup lookup was not unique");
  return clients;
}

async function deleteTemporaryClient(identityBaseUrl, realm, accessToken, temporaryClient) {
  let clientInternalId = temporaryClient.internalId;
  if (clientInternalId === undefined) {
    const clients = await lookupTemporaryClients(
      identityBaseUrl,
      realm,
      accessToken,
      temporaryClient.clientId,
    );
    if (clients.length === 0) return;
    clientInternalId = requiredString(clients[0], "id", "Temporary client cleanup lookup");
  }
  const response = await request(
    new URL(
      `admin/realms/${encodeURIComponent(realm)}/clients/${encodeURIComponent(clientInternalId)}`,
      identityBaseUrl,
    ),
    { headers: adminHeaders(accessToken), method: "DELETE" },
  );
  invariant(
    response.status === 204 || response.status === 404,
    `Temporary client deletion returned HTTP ${String(response.status)}`,
  );
}

async function assertTemporaryClientAbsent(identityBaseUrl, realm, accessToken, temporaryClient) {
  const clients = await lookupTemporaryClients(identityBaseUrl, realm, accessToken, temporaryClient.clientId);
  invariant(clients.length === 0, "A temporary smoke-test client remains in Keycloak");
}

async function issueResourceToken(identityBaseUrl, realm, temporaryClient) {
  const response = await request(
    new URL(`realms/${encodeURIComponent(realm)}/protocol/openid-connect/token`, identityBaseUrl),
    {
      body: new URLSearchParams({
        client_id: temporaryClient.clientId,
        client_secret: temporaryClient.clientSecret,
        grant_type: "client_credentials",
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    },
  );
  const body = await readJson(response, "MCP resource-token issuance");
  return requiredString(body, "access_token", "MCP resource-token issuance");
}

function decodeJwtPayload(token) {
  const parts = token.split(".");
  invariant(parts.length === 3 && parts[1]?.length > 0, "Issued resource token is not a JWT");
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    invariant(payload !== null && typeof payload === "object", "Issued resource token payload is invalid");
    return payload;
  } catch (error) {
    if (error instanceof SmokeError) throw error;
    throw new SmokeError("Issued resource token payload is invalid");
  }
}

function normalizeStringClaim(value, label) {
  const values = typeof value === "string" ? [value] : value;
  invariant(Array.isArray(values) && values.every((entry) => typeof entry === "string"), label);
  return values;
}

function assertResourceClaims(payload, issuer, expectedAudience) {
  invariant(payload.iss === issuer, "Issued resource token has the wrong issuer");
  const scopes =
    typeof payload.scope === "string" ? payload.scope.trim().split(/\s+/u).filter(Boolean).sort() : [];
  invariant(
    JSON.stringify(scopes) === JSON.stringify(expectedLeastPrivilegeScopes),
    "Issued resource token does not have the exact least-privilege scope set",
  );
  const audiences = normalizeStringClaim(payload.aud, "Issued resource token has an invalid audience claim");
  invariant(
    audiences.length === 1 && audiences[0] === expectedAudience,
    "Issued resource token does not have the exact single expected audience",
  );
}

function initializePayload() {
  return {
    id: 1,
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      capabilities: {},
      clientInfo: { name: "mcp-oauth-smoke", version: "1.0.0" },
      protocolVersion: "2025-03-26",
    },
  };
}

async function invokeMcp(payload, accessToken) {
  const headers = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2025-03-26",
    ...(accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` }),
  };
  return request(mcpResourceUrl, {
    body: JSON.stringify(payload),
    headers,
    method: "POST",
  });
}

function assertCampusToolResult(called) {
  const structuredContent = called?.result?.structuredContent;
  const campuses = structuredContent?.campuses;
  invariant(Array.isArray(campuses), "MCP campus tool did not return a campus array");
  const campusIds = campuses.map((campus) => campus?.id).sort();
  invariant(
    JSON.stringify(campusIds) === JSON.stringify([...expectedCampusIds].sort()),
    "MCP campus tool did not return the exact five campus IDs",
  );
  invariant(
    campuses.every((campus) => campus?.officialStatus === "UNVERIFIED"),
    "MCP campus tool did not preserve the unverified campus indicator",
  );
  invariant(
    typeof structuredContent.etag === "string" && structuredContent.etag.length > 0,
    "MCP campus tool did not return a stable ETag",
  );
}

function assertWorldToolResult(called, campusId) {
  const structuredContent = called?.result?.structuredContent;
  invariant(
    structuredContent?.manifest?.campusId === campusId,
    `MCP world tool returned the wrong manifest for ${campusId}`,
  );
  invariant(
    structuredContent.manifest.verificationState === "schematic",
    `MCP world tool did not preserve the schematic indicator for ${campusId}`,
  );
  invariant(
    typeof structuredContent.etag === "string" &&
      structuredContent.etag.length > 0 &&
      structuredContent.etag === structuredContent.manifest.etag,
    `MCP world tool did not preserve the stable ETag for ${campusId}`,
  );
}

export async function runMcpOauthSmoke() {
  const [adminUsername, adminPassword] = requiredEnvironmentPair("KEYCLOAK_ADMIN", "KEYCLOAK_ADMIN_PASSWORD");
  const identityBaseUrl = loopbackBaseUrl(process.env.IDENTITY_BASE_URL ?? "http://127.0.0.1:8080/");
  const realm = process.env.IDENTITY_REALM ?? "gopher-assistant-dev";
  const issuer = new URL(`realms/${encodeURIComponent(realm)}`, identityBaseUrl).toString();
  let adminAccessToken;
  let apiRuntime;
  let mcpRuntime;
  const temporaryClients = [];
  let primaryFailure;
  let result;
  let cleanupPromise;

  const assertNotShuttingDown = () => {
    invariant(requestedShutdownSignal === undefined, "MCP OAuth smoke interrupted by a shutdown signal");
  };
  const cleanup = () => {
    cleanupPromise ??= (async () => {
      const cleanupFailures = [];
      let cleanupAccessToken = adminAccessToken;
      if (temporaryClients.length > 0) {
        try {
          cleanupAccessToken = await authenticateAdmin(identityBaseUrl, adminUsername, adminPassword);
        } catch {
          // The token obtained by the primary path is still a valid bounded fallback.
        }
      }
      await Promise.all(
        [...temporaryClients].reverse().map(async (temporaryClient) => {
          try {
            invariant(cleanupAccessToken !== undefined, "Administrator token is unavailable during cleanup");
            await deleteTemporaryClient(identityBaseUrl, realm, cleanupAccessToken, temporaryClient);
            await assertTemporaryClientAbsent(identityBaseUrl, realm, cleanupAccessToken, temporaryClient);
          } catch {
            cleanupFailures.push(`temporary client ${temporaryClient.clientId}`);
          }
        }),
      );
      try {
        await stopRuntime(mcpRuntime);
      } catch {
        cleanupFailures.push("MCP runtime");
      }
      try {
        await stopRuntime(apiRuntime);
      } catch {
        cleanupFailures.push("API runtime");
      }
      try {
        await Promise.all([assertPortEventuallyFree(apiPort), assertPortEventuallyFree(mcpPort)]);
      } catch {
        cleanupFailures.push("loopback listeners");
      }
      invariant(cleanupFailures.length === 0, "MCP OAuth smoke cleanup failed");
    })();
    return cleanupPromise;
  };
  try {
    assertNotShuttingDown();
    await Promise.all([assertPortFree(apiPort), assertPortFree(mcpPort)]);
    apiRuntime = await spawnRuntime("apps/api/dist/main.js", { HOST: "127.0.0.1", PORT: String(apiPort) });
    await waitForHealthy(new URL("v1/health", apiBaseUrl), apiRuntime);
    assertNotShuttingDown();
    mcpRuntime = await spawnRuntime("apps/mcp-server/dist/index.js", {
      GOPHER_API_BASE_URL: apiBaseUrl.toString(),
      MCP_ALLOWED_ORIGINS: mcpResourceUrl.origin,
      MCP_AUTH_MODE: "oauth",
      MCP_BIND_HOST: "127.0.0.1",
      MCP_EXPECTED_HOST: mcpResourceUrl.host,
      MCP_OAUTH_ISSUER: issuer,
      MCP_OAUTH_JWKS_URL: `${issuer}/protocol/openid-connect/certs`,
      MCP_PORT: String(mcpPort),
      MCP_RESOURCE_URL: mcpResourceUrl.toString(),
    });
    await waitForHealthy(new URL("/readyz", mcpResourceUrl), mcpRuntime);
    assertNotShuttingDown();

    adminAccessToken = await authenticateAdmin(identityBaseUrl, adminUsername, adminPassword);
    const mcpClient = temporaryClientIdentity("mcp");
    temporaryClients.push(mcpClient);
    Object.assign(
      mcpClient,
      await createTemporaryClient(identityBaseUrl, realm, adminAccessToken, mcpClient),
    );
    assertNotShuttingDown();
    await linkClientScopes(identityBaseUrl, realm, adminAccessToken, mcpClient.internalId, [
      "gopher-mcp-audience",
      "campus:read",
    ]);
    assertNotShuttingDown();
    const resourceToken = await issueResourceToken(identityBaseUrl, realm, mcpClient);
    assertResourceClaims(decodeJwtPayload(resourceToken), issuer, mcpResourceUrl.toString());
    assertNotShuttingDown();

    const apiClient = temporaryClientIdentity("api");
    temporaryClients.push(apiClient);
    Object.assign(
      apiClient,
      await createTemporaryClient(identityBaseUrl, realm, adminAccessToken, apiClient),
    );
    assertNotShuttingDown();
    await linkClientScopes(identityBaseUrl, realm, adminAccessToken, apiClient.internalId, [
      "gopher-api-audience",
      "campus:read",
    ]);
    assertNotShuttingDown();
    const wrongAudienceToken = await issueResourceToken(identityBaseUrl, realm, apiClient);
    assertResourceClaims(decodeJwtPayload(wrongAudienceToken), issuer, apiAudience);
    assertNotShuttingDown();

    const unauthenticated = await invokeMcp(initializePayload());
    invariant(unauthenticated.status === 401, "MCP accepted a request without a token");
    const confusedAdminToken = await invokeMcp(initializePayload(), adminAccessToken);
    invariant(confusedAdminToken.status === 401, "MCP accepted a confused administrator token");
    const confusedApiAudienceToken = await invokeMcp(initializePayload(), wrongAudienceToken);
    invariant(
      confusedApiAudienceToken.status === 401,
      "MCP accepted a same-issuer token intended only for the API audience",
    );
    const initialized = await readJson(
      await invokeMcp(initializePayload(), resourceToken),
      "Authenticated MCP initialization",
    );
    invariant(
      initialized?.result?.protocolVersion === "2025-03-26",
      "MCP negotiated an unexpected protocol version",
    );

    const listed = await readJson(
      await invokeMcp({ id: 2, jsonrpc: "2.0", method: "tools/list", params: {} }, resourceToken),
      "Authenticated MCP tool listing",
    );
    const toolNames = listed?.result?.tools?.map((tool) => tool?.name);
    invariant(
      JSON.stringify(toolNames) === JSON.stringify(expectedTools),
      "MCP exposed an unexpected tool catalog",
    );
    const called = await readJson(
      await invokeMcp(
        {
          id: 3,
          jsonrpc: "2.0",
          method: "tools/call",
          params: { arguments: {}, name: "campuses_list" },
        },
        resourceToken,
      ),
      "Authenticated MCP campus tool",
    );
    assertCampusToolResult(called);
    for (const [index, campusId] of expectedCampusIds.entries()) {
      const world = await readJson(
        await invokeMcp(
          {
            id: 4 + index,
            jsonrpc: "2.0",
            method: "tools/call",
            params: { arguments: { campusId }, name: "world_manifest_get" },
          },
          resourceToken,
        ),
        `Authenticated MCP ${campusId} world tool`,
      );
      assertWorldToolResult(world, campusId);
      assertNotShuttingDown();
    }
    result = {
      audienceSeparation: true,
      campuses: 5,
      confusedAdminTokenRejected: true,
      confusedApiAudienceTokenRejected: true,
      issuerExact: true,
      missingTokenRejected: true,
      scopeLeastPrivilege: true,
      status: "passed",
      tools: expectedTools.length,
    };
  } catch (error) {
    primaryFailure =
      error instanceof SmokeError ? error : new SmokeError("MCP OAuth smoke failed unexpectedly");
  } finally {
    try {
      await cleanup();
    } catch {
      primaryFailure = new SmokeError(
        primaryFailure === undefined
          ? "MCP OAuth smoke cleanup failed"
          : "MCP OAuth smoke and cleanup failed",
      );
    }
  }

  if (primaryFailure !== undefined) throw primaryFailure;
  invariant(result !== undefined, "MCP OAuth smoke produced no result");
  return { ...result, listenersClosed: true, temporaryClientsDeleted: 2 };
}

export const smokeMcpOauthTesting = Object.freeze({
  assertCampusToolResult,
  assertResourceClaims,
  assertRuntimeRunning,
  assertWorldToolResult,
  childEnvironment,
  mcpAudience: mcpResourceUrl.toString(),
  stopRuntime,
});

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const shutdownExitCodes = { SIGINT: 130, SIGTERM: 143 };
  const shutdownHandlers = Object.fromEntries(
    Object.keys(shutdownExitCodes).map((signal) => [
      signal,
      () => {
        requestedShutdownSignal ??= signal;
      },
    ]),
  );
  process.on("SIGINT", shutdownHandlers.SIGINT);
  process.on("SIGTERM", shutdownHandlers.SIGTERM);
  try {
    const smokeResult = await runMcpOauthSmoke();
    if (requestedShutdownSignal === undefined) {
      console.log(JSON.stringify(smokeResult, null, 2));
    } else {
      console.error(`MCP OAuth smoke stopped after ${requestedShutdownSignal}`);
      process.exitCode = shutdownExitCodes[requestedShutdownSignal];
    }
  } catch (error) {
    console.error(
      requestedShutdownSignal === undefined && error instanceof SmokeError
        ? error.message
        : requestedShutdownSignal === undefined
          ? "MCP OAuth smoke failed unexpectedly"
          : `MCP OAuth smoke stopped after ${requestedShutdownSignal}`,
    );
    process.exitCode = requestedShutdownSignal === undefined ? 1 : shutdownExitCodes[requestedShutdownSignal];
  } finally {
    process.off("SIGINT", shutdownHandlers.SIGINT);
    process.off("SIGTERM", shutdownHandlers.SIGTERM);
  }
}
