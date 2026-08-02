import { describe, expect, it } from "vitest";

import { loadPersonalDatabaseConfig } from "../src/personal-database/personal-database.config.js";

describe("personal database runtime configuration", () => {
  it("rejects duplicate sslmode parameters instead of validating a different value than the driver", () => {
    expect(() =>
      loadPersonalDatabaseConfig({
        API_ACCOUNT_HMAC_KEY_VERSION: "1",
        NODE_ENV: "production",
        API_PERSONAL_DATABASE_URL:
          "postgresql://runtime:secret@db.example/gopher?sslmode=verify-full&sslmode=disable",
      }),
    ).toThrow("at most one sslmode");
  });

  it("requires certificate and hostname verification in production", () => {
    expect(() =>
      loadPersonalDatabaseConfig({
        API_ACCOUNT_HMAC_KEY_VERSION: "1",
        NODE_ENV: "production",
        API_PERSONAL_DATABASE_URL: "postgresql://runtime:secret@db.example/gopher?sslmode=require",
      }),
    ).toThrow("sslmode=verify-full");

    expect(
      loadPersonalDatabaseConfig({
        API_ACCOUNT_HMAC_KEY_VERSION: "1",
        NODE_ENV: "production",
        API_PERSONAL_DATABASE_URL: "postgresql://runtime:secret@db.example/gopher?sslmode=verify-full",
      }),
    ).toMatchObject({
      identityHmacKeyVersion: 1,
      identityHmacRotationFinalized: false,
    });
  });

  it("requires explicit production versioning and permits previous-key removal only after finalization", () => {
    const url = "postgresql://runtime:secret@db.example/gopher?sslmode=verify-full";
    expect(() =>
      loadPersonalDatabaseConfig({
        API_PERSONAL_DATABASE_URL: url,
        NODE_ENV: "production",
      }),
    ).toThrow("API_ACCOUNT_HMAC_KEY_VERSION is required in production");
    const finalized = loadPersonalDatabaseConfig({
      API_ACCOUNT_HMAC_KEY_VERSION: "2",
      API_ACCOUNT_HMAC_ROTATION_FINALIZED: "true",
      API_PERSONAL_DATABASE_URL: url,
      NODE_ENV: "production",
    });
    expect(finalized).toMatchObject({
      identityHmacKeyVersion: 2,
      identityHmacRotationFinalized: true,
    });
    expect(finalized).not.toHaveProperty("previousIdentityHmacKeyVersion");
  });
});
