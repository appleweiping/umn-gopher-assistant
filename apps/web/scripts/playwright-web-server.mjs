import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const pnpmCli = process.env.npm_execpath;
if (typeof pnpmCli !== "string" || pnpmCli.length === 0) {
  throw new Error("Playwright requires npm_execpath so the workspace pnpm CLI can run under Node 24.");
}

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const applicationPortText = process.env.PLAYWRIGHT_WEB_SERVER_APPLICATION_PORT ?? "3000";
const applicationPort = Number(applicationPortText);
if (!Number.isSafeInteger(applicationPort) || applicationPort < 1 || applicationPort > 65_535) {
  throw new Error("Playwright application port is invalid.");
}
const applicationOrigin = `http://127.0.0.1:${String(applicationPort)}`;
const controlToken = process.env.PLAYWRIGHT_WEB_SERVER_CONTROL_TOKEN;
const controlPortText = process.env.PLAYWRIGHT_WEB_SERVER_CONTROL_PORT;
const controlPort = controlPortText === undefined ? undefined : Number(controlPortText);
if (
  (controlToken === undefined) !== (controlPort === undefined) ||
  (controlPort !== undefined &&
    (!Number.isSafeInteger(controlPort) || controlPort < 1 || controlPort > 65_535))
) {
  throw new Error("Playwright managed-offline control configuration is incomplete or invalid.");
}

function spawnPnpm(arguments_) {
  const childEnvironment = { ...process.env };
  delete childEnvironment.PLAYWRIGHT_WEB_SERVER_CONTROL_TOKEN;
  delete childEnvironment.PLAYWRIGHT_WEB_SERVER_CONTROL_PORT;
  delete childEnvironment.PLAYWRIGHT_WEB_SERVER_APPLICATION_PORT;
  return spawn(process.execPath, [pnpmCli, ...arguments_], {
    detached: process.platform !== "win32",
    env: childEnvironment,
    stdio: "inherit",
    windowsHide: true,
  });
}

function spawnApplication() {
  const childEnvironment = { ...process.env };
  delete childEnvironment.PLAYWRIGHT_WEB_SERVER_CONTROL_TOKEN;
  delete childEnvironment.PLAYWRIGHT_WEB_SERVER_CONTROL_PORT;
  delete childEnvironment.PLAYWRIGHT_WEB_SERVER_APPLICATION_PORT;
  return spawn(
    process.execPath,
    [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(applicationPort)],
    {
      cwd: webRoot,
      detached: process.platform !== "win32",
      env: childEnvironment,
      stdio: "inherit",
      windowsHide: true,
    },
  );
}

function terminateProcessTree(child, signal) {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    // The PID is the exact process created by this launcher. `/T` also closes
    // descendants that Next.js may create while serving the production build.
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function waitForClose(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", () => resolve());
  });
}

async function waitBounded(promise, timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function runBuild() {
  const child = spawnPnpm(["--filter", "@umn-gopher-assistant/web...", "build"]);
  const closed = waitForClose(child);
  let resolveSignal;
  const signaled = new Promise((resolve) => {
    resolveSignal = resolve;
  });
  const forward = (signal) => resolveSignal(signal);
  process.once("SIGINT", forward);
  process.once("SIGTERM", forward);
  try {
    const signal = await Promise.race([closed.then(() => undefined), signaled]);
    if (signal !== undefined) {
      terminateProcessTree(child, "SIGTERM");
      if (!(await waitBounded(closed, 3_000))) {
        terminateProcessTree(child, "SIGKILL");
        if (!(await waitBounded(closed, 3_000))) {
          throw new Error("Build process tree did not close after SIGKILL.");
        }
      }
      throw new Error(`Build cancelled by ${signal}.`);
    }
    if (child.exitCode !== 0) throw new Error(`pnpm build exited with code ${String(child.exitCode)}.`);
  } finally {
    process.removeListener("SIGINT", forward);
    process.removeListener("SIGTERM", forward);
  }
}

if (process.env.PLAYWRIGHT_SKIP_BUILD !== "1") await runBuild();

let applicationChild;
let applicationClose;
let shuttingDown = false;
const intentionallyStopped = new WeakSet();
let rejectFatal;
const fatal = new Promise((_, reject) => {
  rejectFatal = reject;
});

function startApplication() {
  if (shuttingDown) return;
  if (
    applicationChild !== undefined &&
    applicationChild.exitCode === null &&
    applicationChild.signalCode === null
  ) {
    return;
  }
  const child = spawnApplication();
  applicationChild = child;
  applicationClose = waitForClose(child);
  void applicationClose.then(
    () => {
      if (applicationChild === child) {
        applicationChild = undefined;
        applicationClose = undefined;
      }
      if (!shuttingDown && !intentionallyStopped.has(child)) {
        rejectFatal(new Error(`Next.js exited unexpectedly with code ${String(child.exitCode)}.`));
      }
    },
    (error) => {
      if (!shuttingDown && !intentionallyStopped.has(child)) rejectFatal(error);
    },
  );
}

async function stopApplication() {
  const child = applicationChild;
  const closed = applicationClose;
  if (child === undefined || closed === undefined) return;
  intentionallyStopped.add(child);
  terminateProcessTree(child, "SIGTERM");
  if (!(await waitBounded(closed, 5_000))) {
    terminateProcessTree(child, "SIGKILL");
    if (!(await waitBounded(closed, 5_000))) {
      throw new Error("Next.js process tree did not close after SIGKILL.");
    }
  }
  if (applicationChild === child) {
    applicationChild = undefined;
    applicationClose = undefined;
  }
}

async function waitForApplicationReady() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (shuttingDown) throw new Error("Playwright server is shutting down.");
    try {
      const response = await fetch(`${applicationOrigin}/today`, {
        cache: "no-store",
        signal: AbortSignal.timeout(1_000),
      });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch {
      // The restarted process has not bound the application port yet.
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  throw new Error("Restarted Next.js server did not become ready within 60 seconds.");
}

function authorized(request) {
  const candidate = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9-]+)$/u)?.[1];
  if (candidate === undefined || controlToken === undefined) return false;
  const expectedBytes = Buffer.from(controlToken);
  const candidateBytes = Buffer.from(candidate);
  return expectedBytes.length === candidateBytes.length && timingSafeEqual(expectedBytes, candidateBytes);
}

let transition = Promise.resolve();
let offlineLease;
function clearOfflineLease() {
  if (offlineLease !== undefined) {
    clearTimeout(offlineLease);
    offlineLease = undefined;
  }
}

function armOfflineLease() {
  if (shuttingDown) return;
  clearOfflineLease();
  // A killed/timed-out test worker must not strand the shared origin offline.
  // Normal tests restore it immediately; this lease is the crash fallback.
  offlineLease = setTimeout(() => {
    offlineLease = undefined;
    if (shuttingDown) return;
    transition = transition.then(
      async () => {
        startApplication();
        await waitForApplicationReady();
      },
      async () => {
        startApplication();
        await waitForApplicationReady();
      },
    );
    void transition.catch((error) => rejectFatal(error));
  }, 90_000);
}

let controlServer;
if (controlPort !== undefined) {
  controlServer = createServer((request, response) => {
    if (request.method !== "POST" || !authorized(request)) {
      response.writeHead(403).end();
      return;
    }
    const action =
      request.url === "/offline"
        ? async () => {
            await stopApplication();
            armOfflineLease();
          }
        : request.url === "/online"
          ? async () => {
              clearOfflineLease();
              startApplication();
              await waitForApplicationReady();
            }
          : undefined;
    if (action === undefined) {
      response.writeHead(404).end();
      return;
    }
    transition = transition.then(action, action);
    void transition.then(
      () => response.writeHead(204).end(),
      () => response.writeHead(500).end(),
    );
  });
  await new Promise((resolve, reject) => {
    controlServer.once("error", reject);
    controlServer.listen(controlPort, "127.0.0.1", resolve);
  });
}

startApplication();

const signaled = new Promise((resolve) => {
  process.once("SIGINT", () => resolve());
  process.once("SIGTERM", () => resolve());
});

try {
  await Promise.race([fatal, signaled]);
} finally {
  shuttingDown = true;
  clearOfflineLease();
  const controlClose =
    controlServer === undefined
      ? undefined
      : new Promise((resolve) => {
          controlServer.close(() => resolve());
        });
  controlServer?.closeAllConnections();
  await waitBounded(
    transition.catch(() => undefined),
    6_000,
  );
  clearOfflineLease();
  await stopApplication();
  if (controlClose !== undefined) await waitBounded(controlClose, 1_000);
}
