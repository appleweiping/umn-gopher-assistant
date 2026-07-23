import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    environment: "jsdom",
    // Keep jsdom suites reliable when Turborepo is also running API, database,
    // contract, and SDK tests. Vitest workers can miss their startup handshake
    // under Windows process/antivirus pressure, so that platform runs serially.
    pool: "forks",
    maxWorkers: process.platform === "win32" ? 1 : 2,
    testTimeout: 15_000,
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/setup.ts"],
  },
});
