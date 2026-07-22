import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    environment: "jsdom",
    // Keep jsdom suites reliable when Turborepo is also running API, database,
    // contract, and SDK tests. Vitest thread workers intermittently fail their
    // startup handshake on Windows; bounded forks are slower but deterministic.
    pool: "forks",
    maxWorkers: 2,
    testTimeout: 15_000,
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/setup.ts"],
  },
});
