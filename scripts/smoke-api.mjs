#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiEntrypoint = resolve(repositoryRoot, "apps/api/dist/main.js");
const startupDeadlineMilliseconds = 90_000;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  invariant(address && typeof address === "object", "Could not allocate an API smoke-test port");
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return address.port;
}

async function fetchJson(url, expectedStatus = 200) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  invariant(response.status === expectedStatus, `${url.pathname} returned HTTP ${String(response.status)}`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  invariant(
    contentType === "application/json" || contentType === "application/problem+json",
    `${url.pathname} did not return JSON`,
  );
  return { body: await response.json(), headers: response.headers };
}

async function waitForHealth(baseUrl, processExited) {
  const deadline = Date.now() + startupDeadlineMilliseconds;
  while (Date.now() < deadline) {
    const exit = await Promise.race([
      processExited,
      new Promise((resolveWait) => setTimeout(() => resolveWait(undefined), 250)),
    ]);
    if (exit !== undefined) throw new Error("Campus API exited before becoming healthy");
    try {
      return await fetchJson(new URL("v1/health", baseUrl));
    } catch {
      // Startup is intentionally polled; only the final failure is reported.
    }
  }
  throw new Error("Campus API did not become healthy within 90 seconds");
}

const port = await availablePort();
const baseUrl = new URL(`http://127.0.0.1:${String(port)}/`);
const child = spawn(process.execPath, [apiEntrypoint], {
  cwd: repositoryRoot,
  env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
  stdio: ["ignore", "ignore", "ignore"],
  windowsHide: true,
});
const processExited = new Promise((resolveExit) => {
  child.once("exit", (code, signal) => resolveExit({ code, signal }));
});

try {
  const health = await waitForHealth(baseUrl, processExited);
  invariant(health.body?.status === "ok", "Health response is not ready");
  invariant(health.body?.service === "campus-api", "Health response has the wrong service");
  invariant(health.headers.get("cache-control") === "no-store", "Health response is cacheable");

  const campusResponse = await fetchJson(new URL("v1/campuses", baseUrl));
  invariant(Array.isArray(campusResponse.body), "Campus response is not an array");
  invariant(campusResponse.body.length === 5, "Campus response does not contain five campuses");
  invariant(
    campusResponse.body.map(({ id }) => id).join(",") === "tc,duluth,crookston,morris,rochester",
    "Campus response has the wrong identifiers or order",
  );
  invariant(
    campusResponse.body.every(({ officialStatus }) => officialStatus === "UNVERIFIED"),
    "A synthetic campus is missing its unverified label",
  );
  invariant(campusResponse.headers.has("etag"), "Campus response is missing an ETag");

  const sourceResponse = await fetchJson(new URL("v1/sources?campusId=tc&limit=1", baseUrl));
  invariant(Array.isArray(sourceResponse.body?.items), "Source response is not a page");
  invariant(
    sourceResponse.body.items.every(({ campusIds }) => campusIds.includes("tc")),
    "Source campus filter was not applied",
  );
  invariant(sourceResponse.headers.has("etag"), "Source response is missing an ETag");

  const worldResponse = await fetchJson(new URL("v1/worlds/morris/manifest", baseUrl));
  invariant(worldResponse.body?.campusId === "morris", "World manifest has the wrong campus");
  invariant(
    worldResponse.body?.verificationState === "schematic",
    "Synthetic world manifest is missing its schematic label",
  );
  invariant(worldResponse.headers.has("etag"), "World response is missing an ETag");

  const unavailableEvents = await fetchJson(new URL("v1/events?campusId=crookston", baseUrl), 503);
  invariant(unavailableEvents.body?.title === "Service Unavailable", "Event fallback title is unstable");
  invariant(
    unavailableEvents.body?.officialUrl === "https://crk.umn.edu/university-relations/events",
    "Disabled event source did not return its useful official link",
  );
  invariant(
    unavailableEvents.body?.sourceId === "crookston-events",
    "Disabled event source returned the wrong provenance",
  );
  invariant(
    unavailableEvents.headers.get("cache-control") === "no-store",
    "LIVE_ONLY/deep-link fallback is cacheable",
  );
  invariant(unavailableEvents.headers.get("retry-after") === "3600", "Event fallback lacks Retry-After");

  console.log(
    JSON.stringify({
      campuses: campusResponse.body.length,
      catalogFallback: unavailableEvents.body.sourceId,
      service: health.body.service,
      sources: sourceResponse.body.items.length,
      status: "passed",
      world: worldResponse.body.campusId,
    }),
  );
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill();
  await Promise.race([processExited, new Promise((resolveWait) => setTimeout(resolveWait, 5_000))]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}
