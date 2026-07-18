import { describe, expect, it } from "vitest";

import { LOCAL_DATABASE_URL, resolveDatabaseUrl } from "../src/database-url.js";

describe("database connection configuration", () => {
  it("uses the same reproducible local credentials as Compose", () => {
    expect(LOCAL_DATABASE_URL).toBe("postgres://gopher:local-postgres-password-only@127.0.0.1:5432/gopher");
    expect(resolveDatabaseUrl({})).toBe(LOCAL_DATABASE_URL);
    expect(resolveDatabaseUrl({ DATABASE_URL: "postgres://explicit/db" })).toBe("postgres://explicit/db");
  });
});
