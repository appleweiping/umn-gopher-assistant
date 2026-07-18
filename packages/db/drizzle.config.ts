import { defineConfig } from "drizzle-kit";

import { resolveDatabaseUrl } from "./src/database-url.js";

export default defineConfig({
  dialect: "postgresql",
  out: "./migrations",
  schema: "./src/schema.ts",
  dbCredentials: {
    url: resolveDatabaseUrl(),
  },
  strict: true,
  verbose: true,
});
