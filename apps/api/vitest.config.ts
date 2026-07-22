import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Leave capacity for the Web/jsdom suite when Turborepo runs workspace
    // tests together on a two-core CI runner.
    hookTimeout: 30_000,
    maxWorkers: 2,
    restoreMocks: true,
  },
});
