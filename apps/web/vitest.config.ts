import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    environment: "jsdom",
    // Keep jsdom suites reliable when Turborepo is also running API, database,
    // contract, and SDK tests. Threads are cheaper to start than forked Node
    // processes on Windows CI, and the cap prevents worker-start starvation.
    pool: "threads",
    maxWorkers: 2,
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/setup.ts"],
  },
});
