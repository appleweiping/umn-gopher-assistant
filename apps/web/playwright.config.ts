import { defineConfig, devices } from "@playwright/test";
import { randomInt, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const usesExternalServer = process.env["PLAYWRIGHT_BASE_URL"] !== undefined;
const browserChannel = process.env["PLAYWRIGHT_CHANNEL"];
const managedOfflineEnabled = process.env["PLAYWRIGHT_MANAGED_OFFLINE"] === "1";
if (managedOfflineEnabled && usesExternalServer) {
  throw new Error("PLAYWRIGHT_MANAGED_OFFLINE=1 requires the bundled web server; unset PLAYWRIGHT_BASE_URL.");
}

function randomLocalPort(excluded?: number): number {
  let candidate: number;
  do candidate = randomInt(20_000, 60_000);
  while (candidate === excluded);
  return candidate;
}

function configuredPort(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be a valid TCP port.`);
  }
  return parsed;
}

const configuredApplicationPort = configuredPort("PLAYWRIGHT_WEB_SERVER_APPLICATION_PORT");
const applicationPort = usesExternalServer ? undefined : (configuredApplicationPort ?? randomLocalPort());
const baseURL = process.env["PLAYWRIGHT_BASE_URL"] ?? `http://127.0.0.1:${String(applicationPort)}`;
const iphone13Ios26 = {
  ...devices["iPhone 13"],
  // Playwright's device descriptor still advertises iOS 15 even though the
  // pinned engine is WebKit 26.5. Exercise the supported iOS 26 vault path;
  // pre-26 fail-closed behavior is covered by dedicated unit tests.
  userAgent: devices["iPhone 13"].userAgent.replace("CPU iPhone OS 15_0", "CPU iPhone OS 26_0"),
};

if (managedOfflineEnabled && !usesExternalServer) {
  process.env["PLAYWRIGHT_WEB_SERVER_CONTROL_TOKEN"] ??= randomUUID();
  const configuredControlPort = configuredPort("PLAYWRIGHT_WEB_SERVER_CONTROL_PORT");
  const controlPort = configuredControlPort ?? randomLocalPort(applicationPort);
  if (controlPort === applicationPort) {
    throw new Error("Playwright application and control ports must be different.");
  }
  process.env["PLAYWRIGHT_WEB_SERVER_CONTROL_PORT"] ??= String(controlPort);
}
if (applicationPort !== undefined) {
  process.env["PLAYWRIGHT_WEB_SERVER_APPLICATION_PORT"] ??= String(applicationPort);
}

function shellQuote(value: string): string {
  return process.platform === "win32"
    ? `"${value.replaceAll('"', '""')}"`
    : `'${value.replaceAll("'", `'\\''`)}'`;
}

const localServerCommand = `${shellQuote(process.execPath)} ${shellQuote(
  fileURLToPath(new URL("./scripts/playwright-web-server.mjs", import.meta.url)),
)}`;

export default defineConfig({
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env["CI"]),
  // Managed-offline tests stop the one shared origin. Enforce serialization
  // in configuration so a forgotten CLI flag cannot take unrelated tests down.
  fullyParallel: !managedOfflineEnabled,
  outputDir: "test-results",
  projects: [
    {
      name: "chromium",
      testIgnore: /mobile\.spec\.ts/u,
      use: {
        ...devices["Desktop Chrome"],
        ...(browserChannel === undefined ? {} : { channel: browserChannel }),
      },
    },
    {
      name: "firefox",
      testIgnore: /mobile\.spec\.ts/u,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      testIgnore: /mobile\.spec\.ts/u,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile-chromium",
      testMatch: /(?:mobile|vault)\.spec\.ts/u,
      use: { ...devices["Pixel 5"], ...(browserChannel === undefined ? {} : { channel: browserChannel }) },
    },
    {
      name: "mobile-webkit-ios26",
      testMatch: /(?:mobile|vault)\.spec\.ts/u,
      use: iphone13Ios26,
    },
  ],
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  retries: process.env["CI"] ? 1 : 0,
  testDir: "./e2e",
  timeout: 90_000,
  ...(managedOfflineEnabled ? { workers: 1 } : {}),
  use: {
    baseURL,
    screenshot: "only-on-failure",
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  ...(usesExternalServer
    ? {}
    : {
        webServer: {
          // The shell's ambient `node` may differ from the Node 24 process that
          // launched Playwright. The launcher reuses this exact executable for
          // both pnpm build and start, so engine-strict cannot silently drift.
          command: localServerCommand,
          gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
          // Never accept a process left by an older build. If the port is
          // occupied, fail visibly instead of exercising stale application
          // code and reporting a false pass.
          reuseExistingServer: false,
          stderr: "pipe",
          stdout: "pipe",
          timeout: 300_000,
          url: baseURL,
        },
      }),
});
