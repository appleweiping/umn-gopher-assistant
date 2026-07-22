#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiEntrypoint = resolve(repositoryRoot, "apps/api/dist/main.js");
const startupDeadlineMilliseconds = 60_000;

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
  invariant(address && typeof address === "object", "Could not allocate a live catalog smoke port");
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return address.port;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(45_000),
  });
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  invariant(
    contentType === "application/json" || contentType === "application/problem+json",
    `${url.pathname} did not return JSON`,
  );
  const body = await response.json();
  if (response.status !== 200) {
    const failureCode =
      body && typeof body === "object" && typeof body.failureCode === "string"
        ? body.failureCode
        : "UNKNOWN_FAILURE";
    const sourceId =
      body && typeof body === "object" && typeof body.sourceId === "string"
        ? body.sourceId
        : "unknown-source";
    throw new Error(`${url.pathname} returned HTTP ${String(response.status)} (${failureCode}, ${sourceId})`);
  }
  invariant(response.headers.get("cache-control") === "no-store", `${url.pathname} is cacheable`);
  invariant(response.headers.has("etag"), `${url.pathname} is missing an ETag`);
  return body;
}

async function waitForHealth(baseUrl, processExited) {
  const deadline = Date.now() + startupDeadlineMilliseconds;
  while (Date.now() < deadline) {
    const exit = await Promise.race([
      processExited,
      new Promise((resolveWait) => setTimeout(() => resolveWait(undefined), 250)),
    ]);
    if (exit !== undefined) throw new Error("Campus API exited before the live catalog smoke");
    try {
      const response = await fetch(new URL("v1/health", baseUrl), {
        redirect: "error",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
    } catch {
      // Only the bounded final readiness failure is reported.
    }
  }
  throw new Error("Campus API did not become healthy within 60 seconds");
}

function summary(name, body) {
  invariant(body && typeof body === "object", `${name} response is not an object`);
  invariant(Array.isArray(body.items), `${name} response has no items array`);
  invariant(Array.isArray(body.sourceObservations), `${name} response has no source observations`);
  invariant(
    body.retrievalCoverage && typeof body.retrievalCoverage === "object",
    `${name} response has no retrieval coverage`,
  );
  invariant(
    body.sourceObservations.length >= 1 &&
      body.sourceObservations.every((observation) => observation?.outcome === "SUCCESS"),
    `${name} response has no successful source observation`,
  );
  return {
    check: name,
    items: body.items.length,
    observations: body.sourceObservations.length,
    pagesFetched: body.retrievalCoverage.pagesFetched,
    truncated: body.retrievalCoverage.truncatedByPolicy,
  };
}

async function stopChild(child, processExited) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    invariant(Number.isSafeInteger(child.pid) && child.pid > 0, "API child process has no valid PID");
    const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    await Promise.race([
      new Promise((resolveExit) => killer.once("exit", resolveExit)),
      new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
    ]);
    await Promise.race([processExited, new Promise((resolveWait) => setTimeout(resolveWait, 5_000))]);
    return;
  }
  child.kill("SIGTERM");
  const exit = await Promise.race([
    processExited,
    new Promise((resolveWait) => setTimeout(() => resolveWait(undefined), 5_000)),
  ]);
  if (exit === undefined && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

if (process.env.RUN_LIVE_CATALOG_SMOKE !== "1") {
  throw new Error(
    "Live catalog smoke is opt-in. Set RUN_LIVE_CATALOG_SMOKE=1 after confirming this is a one-off check.",
  );
}

const from = process.env.CATALOG_SMOKE_FROM ?? "2026-08-01";
const to = process.env.CATALOG_SMOKE_TO ?? "2026-12-01";
invariant(/^\d{4}-\d{2}-\d{2}$/u.test(from), "CATALOG_SMOKE_FROM must be YYYY-MM-DD");
invariant(/^\d{4}-\d{2}-\d{2}$/u.test(to), "CATALOG_SMOKE_TO must be YYYY-MM-DD");

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
  await waitForHealth(baseUrl, processExited);
  const encodedRange = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=3`;
  const checks = [
    ["tc-sessions", `v1/academics/sessions?campusId=tc&${encodedRange}`],
    ["tc-events", `v1/events?campusId=tc&${encodedRange}`],
    ["duluth-events", `v1/events?campusId=duluth&${encodedRange}`],
  ];
  const results = [];
  for (const [name, path] of checks) {
    results.push(summary(name, await fetchJson(new URL(path, baseUrl))));
  }
  console.log(JSON.stringify({ range: { from, to }, results, status: "passed" }));
} finally {
  await stopChild(child, processExited);
}
