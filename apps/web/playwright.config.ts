import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env["PLAYWRIGHT_BASE_URL"] ?? "http://127.0.0.1:3000";
const usesExternalServer = process.env["PLAYWRIGHT_BASE_URL"] !== undefined;
const browserChannel = process.env["PLAYWRIGHT_CHANNEL"];

export default defineConfig({
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env["CI"]),
  fullyParallel: true,
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
      name: "mobile-chromium",
      testMatch: /mobile\.spec\.ts/u,
      use: { ...devices["Pixel 5"], ...(browserChannel === undefined ? {} : { channel: browserChannel }) },
    },
  ],
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  retries: process.env["CI"] ? 1 : 0,
  testDir: "./e2e",
  timeout: 90_000,
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
          command: "pnpm build && pnpm start --hostname 127.0.0.1 --port 3000",
          reuseExistingServer: !process.env["CI"],
          stderr: "pipe",
          stdout: "pipe",
          timeout: 300_000,
          url: baseURL,
        },
      }),
});
