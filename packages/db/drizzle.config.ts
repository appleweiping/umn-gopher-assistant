import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  out: "./migrations",
  schema: "./src/schema.ts",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "postgres://gopher:gopher-local@localhost:5432/gopher",
  },
  strict: true,
  verbose: true,
});
