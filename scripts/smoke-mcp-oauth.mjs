#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID, sign as signData } from "node:crypto";
import { access } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const apiPort = 4000;
const mcpPort = 4100;
const fixtureIssuerPort = 4200;
const apiBaseUrl = new URL(`http://127.0.0.1:${String(apiPort)}/`);
const mcpResourceUrl = new URL(`http://127.0.0.1:${String(mcpPort)}/mcp`);
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

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function createDpopKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const publicJwk = publicKey.export({ format: "jwk" });
  invariant(
    publicJwk.kty === "EC" &&
      publicJwk.crv === "P-256" &&
      typeof publicJwk.x === "string" &&
      typeof publicJwk.y === "string" &&
      publicJwk.d === undefined,
    "Generated smoke DPoP key is not a public P-256 JWK",
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

export function createFixtureSigningKey() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2_048,
  });
  return {
    privateKey,
    publicJwk: {
      ...publicKey.export({ format: "jwk" }),
      alg: "RS256",
      kid: "mcp-smoke-signing-key",
      use: "sig",
    },
  };
}

export function createFixtureAccessToken({
  audience,
  clientId = "gopher-mcp",
  dpopJkt,
  issuer,
  signingKey,
  subject = "mcp-smoke-subject",
}) {
  const now = Math.floor(Date.now() / 1_000);
  const header = {
    alg: "RS256",
    kid: signingKey.publicJwk.kid,
    typ: "at+jwt",
  };
  const payload = {
    aud: audience,
    azp: clientId,
    cnf: { jkt: dpopJkt },
    exp: now + 300,
    iat: now,
    iss: issuer,
    jti: randomUUID(),
    nbf: now - 1,
    scope: "campus:read",
    sub: subject,
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = signData("RSA-SHA256", Buffer.from(signingInput, "ascii"), signingKey.privateKey);
  return `${signingInput}.${signature.toString("base64url")}`;
}

export function createResourceDpopProof({ accessToken, key, nonce, url = mcpResourceUrl }) {
  const header = {
    alg: "ES256",
    jwk: key.publicJwk,
    typ: "dpop+jwt",
  };
  const payload = {
    ath: createHash("sha256").update(accessToken, "ascii").digest("base64url"),
    htm: "POST",
    htu: url.toString(),
    iat: Math.floor(Date.now() / 1_000),
    jti: randomUUID(),
    ...(nonce === undefined ? {} : { nonce }),
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = signData(null, Buffer.from(signingInput, "ascii"), {
    dsaEncoding: "ieee-p1363",
    key: key.privateKey,
  });
  invariant(signature.length === 64, "Generated smoke DPoP signature has the wrong length");
  return `${signingInput}.${signature.toString("base64url")}`;
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

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const server = createNetServer();
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

export function childEnvironment(overrides, inheritedEnvironment = process.env) {
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

export function assertRuntimeRunning(child) {
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

export async function stopRuntime(
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

async function startFixtureIssuer(publicJwk) {
  const server = createHttpServer((incoming, response) => {
    if (incoming.method === "GET" && incoming.url === "/jwks") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/json",
      });
      response.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise((resolve, reject) => {
    const onError = () => reject(new SmokeError("Fixture issuer could not start"));
    server.once("error", onError);
    server.listen(fixtureIssuerPort, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  return server;
}

async function stopHttpServer(server) {
  if (server === undefined || !server.listening) return;
  await new Promise((resolve) => server.close(() => resolve()));
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

export function assertResourceClaims(payload, issuer, expectedAudience) {
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

async function invokeMcp(payload, { accessToken, key, nonce, proof, scheme = "DPoP" } = {}) {
  const headers = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2025-03-26",
    ...(accessToken === undefined ? {} : { authorization: `${scheme} ${accessToken}` }),
    ...(proof === undefined && accessToken !== undefined && key !== undefined
      ? { dpop: createResourceDpopProof({ accessToken, key, nonce }) }
      : proof === undefined
        ? {}
        : { dpop: proof }),
  };
  return request(mcpResourceUrl, {
    body: JSON.stringify(payload),
    headers,
    method: "POST",
  });
}

export function assertCampusToolResult(called) {
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

export function assertWorldToolResult(called, campusId) {
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
  const fixtureIssuer = `http://127.0.0.1:${String(fixtureIssuerPort)}/issuer`;
  const fixtureJwksUrl = `http://127.0.0.1:${String(fixtureIssuerPort)}/jwks`;
  const signingKey = createFixtureSigningKey();
  const proofKey = createDpopKey();
  const wrongProofKey = createDpopKey();
  const smokeSubject = `mcp-smoke-${randomUUID()}`;
  let apiRuntime;
  let mcpRuntime;
  let issuerRuntime;
  let primaryFailure;
  let result;

  try {
    invariant(requestedShutdownSignal === undefined, "MCP OAuth smoke interrupted before startup");
    await Promise.all([apiPort, mcpPort, fixtureIssuerPort].map((port) => assertPortFree(port)));
    issuerRuntime = await startFixtureIssuer(signingKey.publicJwk);
    apiRuntime = await spawnRuntime("apps/api/dist/main.js", {
      HOST: "127.0.0.1",
      NODE_ENV: "test",
      PORT: String(apiPort),
    });
    await waitForHealthy(new URL("v1/health", apiBaseUrl), apiRuntime);
    mcpRuntime = await spawnRuntime("apps/mcp-server/dist/index.js", {
      GOPHER_API_BASE_URL: apiBaseUrl.toString(),
      MCP_ALLOWED_CLIENT_IDS: "gopher-mcp",
      MCP_ALLOWED_ORIGINS: mcpResourceUrl.origin,
      MCP_AUTH_MODE: "oauth",
      MCP_BIND_HOST: "127.0.0.1",
      MCP_DPOP_REDIS_URL:
        process.env.MCP_DPOP_REDIS_URL ?? "redis://:local-redis-password-only@127.0.0.1:6379",
      MCP_EXPECTED_HOST: mcpResourceUrl.host,
      MCP_OAUTH_ISSUER: fixtureIssuer,
      MCP_OAUTH_JWKS_URL: fixtureJwksUrl,
      MCP_PORT: String(mcpPort),
      MCP_RESOURCE_URL: mcpResourceUrl.toString(),
      NODE_ENV: "test",
    });
    await waitForHealthy(new URL("/readyz", mcpResourceUrl), mcpRuntime);

    const accessToken = createFixtureAccessToken({
      audience: mcpResourceUrl.toString(),
      dpopJkt: proofKey.thumbprint,
      issuer: fixtureIssuer,
      signingKey,
      subject: smokeSubject,
    });
    const wrongAudienceToken = createFixtureAccessToken({
      audience: apiAudience,
      dpopJkt: proofKey.thumbprint,
      issuer: fixtureIssuer,
      signingKey,
      subject: smokeSubject,
    });
    assertResourceClaims(decodeJwtPayload(accessToken), fixtureIssuer, mcpResourceUrl.toString());
    assertResourceClaims(decodeJwtPayload(wrongAudienceToken), fixtureIssuer, apiAudience);

    invariant(
      (await invokeMcp(initializePayload())).status === 401,
      "MCP accepted a request without a token",
    );
    invariant(
      (
        await invokeMcp(initializePayload(), {
          accessToken,
          scheme: "Bearer",
        })
      ).status === 401,
      "MCP accepted Bearer fallback",
    );
    invariant(
      (
        await invokeMcp(initializePayload(), {
          accessToken: wrongAudienceToken,
          key: proofKey,
        })
      ).status === 401,
      "MCP accepted a same-issuer token intended for the Core API",
    );
    invariant(
      (
        await invokeMcp(initializePayload(), {
          accessToken,
          key: wrongProofKey,
        })
      ).status === 401,
      "MCP accepted a proof signed by the wrong key",
    );

    const challenge = await invokeMcp(initializePayload(), {
      accessToken,
      key: proofKey,
    });
    invariant(challenge.status === 401, "MCP did not issue an initial nonce challenge");
    invariant(
      challenge.headers.get("www-authenticate")?.includes('error="use_dpop_nonce"') === true,
      "MCP nonce challenge omitted use_dpop_nonce",
    );
    const nonce = challenge.headers.get("dpop-nonce");
    invariant(
      typeof nonce === "string" && /^[\x21\x23-\x5B\x5D-\x7E]{1,512}$/u.test(nonce),
      "MCP nonce challenge was missing or malformed",
    );

    const acceptedProof = createResourceDpopProof({
      accessToken,
      key: proofKey,
      nonce,
    });
    const initialized = await readJson(
      await invokeMcp(initializePayload(), {
        accessToken,
        proof: acceptedProof,
      }),
      "Authenticated MCP initialization",
    );
    invariant(
      initialized?.result?.protocolVersion === "2025-03-26",
      "MCP negotiated an unexpected protocol version",
    );
    invariant(
      (
        await invokeMcp(initializePayload(), {
          accessToken,
          proof: acceptedProof,
        })
      ).status === 401,
      "MCP accepted a replayed DPoP proof",
    );

    const listed = await readJson(
      await invokeMcp(
        { id: 2, jsonrpc: "2.0", method: "tools/list", params: {} },
        { accessToken, key: proofKey, nonce },
      ),
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
        { accessToken, key: proofKey, nonce },
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
          { accessToken, key: proofKey, nonce },
        ),
        `Authenticated MCP ${campusId} world tool`,
      );
      assertWorldToolResult(world, campusId);
    }
    result = {
      audienceSeparation: true,
      bearerRejected: true,
      campuses: 5,
      issuerExact: true,
      missingTokenRejected: true,
      nonceRetry: true,
      replayRejected: true,
      scopeLeastPrivilege: true,
      status: "passed",
      strictLocalTokenFixture: true,
      tools: expectedTools.length,
      wrongProofKeyRejected: true,
    };
  } catch (error) {
    primaryFailure =
      error instanceof SmokeError ? error : new SmokeError("MCP OAuth smoke failed unexpectedly");
  } finally {
    const cleanupFailures = [];
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
      await stopHttpServer(issuerRuntime);
    } catch {
      cleanupFailures.push("fixture issuer");
    }
    try {
      await Promise.all([apiPort, mcpPort, fixtureIssuerPort].map((port) => assertPortEventuallyFree(port)));
    } catch {
      cleanupFailures.push("loopback listeners");
    }
    if (cleanupFailures.length > 0) {
      primaryFailure = new SmokeError(
        primaryFailure === undefined
          ? "MCP OAuth smoke cleanup failed"
          : "MCP OAuth smoke and cleanup failed",
      );
    }
  }

  if (primaryFailure !== undefined) throw primaryFailure;
  invariant(result !== undefined, "MCP OAuth smoke produced no result");
  return {
    ...result,
    fixtureIssuerClosed: true,
    listenersClosed: true,
    temporaryClientsDeleted: 0,
  };
}

export const smokeMcpOauthTesting = Object.freeze({
  assertCampusToolResult,
  assertResourceClaims,
  assertRuntimeRunning,
  assertWorldToolResult,
  childEnvironment,
  createDpopKey,
  createFixtureAccessToken,
  createFixtureSigningKey,
  createResourceDpopProof,
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
