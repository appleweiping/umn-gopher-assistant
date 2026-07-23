import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    restoreMocks: true,
    testTimeout: 15_000,
  },
});
