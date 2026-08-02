import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";
import type { Sql } from "postgres";

import type { AuthPrincipal } from "../src/auth/auth.types.js";
import {
  accountHmacKeyFingerprint,
  assertPostgresAccountHmacContinuity,
} from "../src/accounts/account-hmac-continuity.service.js";
import { HmacAccountResolver } from "../src/accounts/hmac-account-resolver.js";
import type { AccountIdentityStore } from "../src/accounts/account.types.js";
import { InMemoryAccountIdentityStore } from "../src/accounts/in-memory-account-identity.store.js";
import { PostgresAccountIdentityStore } from "../src/accounts/postgres-account-identity.store.js";
import { loadAccountSubjectHmacKeySet } from "../src/runtime-config.js";

const principal: AuthPrincipal = {
  clientId: "gopher-web",
  issuer: "https://identity.example.edu/realms/gopher",
  scopes: ["personal:write"],
  subject: "student-1",
};

describe("account resolver", () => {
  it("uses the verified issuer/subject HMAC only for lookup and returns the stable stored owner binding", async () => {
    const hmacKey = new Uint8Array(Buffer.alloc(32, 3));
    const stableOwnerBinding = Buffer.alloc(32, 7);
    const observed: string[] = [];
    const store: AccountIdentityStore = {
      resolveAccount(subjectHmac) {
        observed.push(Buffer.from(subjectHmac).toString("base64url"));
        return Promise.resolve({
          accountId: "018fb9d8-3ec5-7e8b-a512-35f8ff523100",
          ownerBinding: new Uint8Array(stableOwnerBinding),
        });
      },
    };
    const resolver = new HmacAccountResolver(store, hmacKey);

    const first = await resolver.resolve(principal);
    const second = await resolver.resolve(principal);
    const identityHmac = createHmac("sha256", hmacKey)
      .update(`${principal.issuer}\0${principal.subject}`)
      .digest("base64url");

    expect(first).toEqual(second);
    expect(first.ownerBinding).toBe(stableOwnerBinding.toString("base64url"));
    expect(first.ownerBinding).not.toBe(identityHmac);
    expect(observed).toEqual([identityHmac, identityHmac]);
  });

  it("separates the same subject at different verified issuers", async () => {
    const observed: string[] = [];
    const store: AccountIdentityStore = {
      resolveAccount(subjectHmac) {
        observed.push(Buffer.from(subjectHmac).toString("base64url"));
        return Promise.resolve({
          accountId: "018fb9d8-3ec5-7e8b-a512-35f8ff523100",
          ownerBinding: new Uint8Array(Buffer.alloc(32, 8)),
        });
      },
    };
    const resolver = new HmacAccountResolver(store, new Uint8Array(Buffer.alloc(32, 9)));
    await resolver.resolve(principal);
    await resolver.resolve({ ...principal, issuer: "https://other.example.edu" });
    expect(observed[0]).not.toBe(observed[1]);
  });

  it("aliases an immediately previous digest to the same random account binding", async () => {
    const store = new InMemoryAccountIdentityStore();
    const oldKey = new Uint8Array(Buffer.alloc(32, 10));
    const currentKey = new Uint8Array(Buffer.alloc(32, 11));
    const beforeRotation = await new HmacAccountResolver(store, oldKey).resolve(principal);
    const duringRotation = await new HmacAccountResolver(store, currentKey, oldKey).resolve(principal);
    const afterRotation = await new HmacAccountResolver(store, currentKey).resolve(principal);

    expect(duringRotation).toEqual(beforeRotation);
    expect(afterRotation).toEqual(beforeRotation);
  });

  it("passes current and previous digests with their versions to the four-argument resolver", async () => {
    const observed: unknown[][] = [];
    const sql = ((_strings: TemplateStringsArray, ...values: readonly unknown[]) => {
      observed.push([...values]);
      return Promise.resolve([
        {
          accountId: "018fb9d8-3ec5-7e8b-a512-35f8ff523100",
          ownerBinding: Buffer.alloc(32, 12),
        },
      ]);
    }) as unknown as Sql<Record<string, never>>;
    const store = new PostgresAccountIdentityStore(sql, 2, 1);
    const currentDigest = new Uint8Array(Buffer.alloc(32, 13));
    const previousDigest = new Uint8Array(Buffer.alloc(32, 14));

    await store.resolveAccount(currentDigest, previousDigest);

    expect(observed).toHaveLength(1);
    expect(observed[0]?.[0]).toEqual(Buffer.from(currentDigest));
    expect(observed[0]?.[1]).toBe(2);
    expect(observed[0]?.[2]).toEqual(Buffer.from(previousDigest));
    expect(observed[0]?.[3]).toBe(1);
  });

  it("checks a domain-separated key fingerprint through the startup continuity function", async () => {
    const observed: unknown[][] = [];
    const sql = ((_strings: TemplateStringsArray, ...values: readonly unknown[]) => {
      observed.push(values.map((value) => (Buffer.isBuffer(value) ? Buffer.from(value) : value)));
      return Promise.resolve([]);
    }) as unknown as Sql<Record<string, never>>;
    const currentKey = new Uint8Array(Buffer.alloc(32, 19));
    const previousKey = new Uint8Array(Buffer.alloc(32, 20));

    await assertPostgresAccountHmacContinuity(sql, {
      allowExistingContinuityBootstrap: false,
      currentKey,
      currentVersion: 2,
      previousKey,
      previousVersion: 1,
      rotationFinalized: false,
    });

    expect(observed).toHaveLength(1);
    expect(observed[0]).toEqual([
      2,
      Buffer.from(accountHmacKeyFingerprint(currentKey)),
      1,
      Buffer.from(accountHmacKeyFingerprint(previousKey)),
      false,
      false,
    ]);
    expect(accountHmacKeyFingerprint(currentKey)).not.toEqual(
      accountHmacKeyFingerprint(new Uint8Array(Buffer.alloc(32, 21))),
    );
  });

  it("fails closed on incomplete, non-consecutive, or reused rotation keys", () => {
    const current = Buffer.alloc(32, 15).toString("base64url");
    const previous = Buffer.alloc(32, 16).toString("base64url");
    expect(() =>
      loadAccountSubjectHmacKeySet({
        API_ACCOUNT_HMAC_KEY_VERSION: "2",
        API_ACCOUNT_SUBJECT_HMAC_KEY: current,
        NODE_ENV: "test",
      }),
    ).toThrow("require the previous key and version");
    expect(() =>
      loadAccountSubjectHmacKeySet({
        API_ACCOUNT_HMAC_KEY_VERSION: "3",
        API_ACCOUNT_SUBJECT_HMAC_KEY: current,
        API_PREVIOUS_ACCOUNT_HMAC_KEY_VERSION: "1",
        API_PREVIOUS_ACCOUNT_SUBJECT_HMAC_KEY: previous,
        NODE_ENV: "test",
      }),
    ).toThrow("immediately precede");
    expect(() =>
      loadAccountSubjectHmacKeySet({
        API_ACCOUNT_HMAC_KEY_VERSION: "2",
        API_ACCOUNT_SUBJECT_HMAC_KEY: current,
        API_PREVIOUS_ACCOUNT_HMAC_KEY_VERSION: "1",
        API_PREVIOUS_ACCOUNT_SUBJECT_HMAC_KEY: current,
        NODE_ENV: "test",
      }),
    ).toThrow("must be independent");
    expect(
      loadAccountSubjectHmacKeySet({
        API_ACCOUNT_HMAC_KEY_VERSION: "2",
        API_ACCOUNT_SUBJECT_HMAC_KEY: current,
        API_PREVIOUS_ACCOUNT_HMAC_KEY_VERSION: "1",
        API_PREVIOUS_ACCOUNT_SUBJECT_HMAC_KEY: previous,
        NODE_ENV: "test",
      }),
    ).toMatchObject({ currentVersion: 2, previousVersion: 1 });
  });

  it("requires explicit production versioning and an explicit completed-rotation state", () => {
    const current = Buffer.alloc(32, 22).toString("base64url");
    expect(() =>
      loadAccountSubjectHmacKeySet({
        API_ACCOUNT_SUBJECT_HMAC_KEY: current,
        NODE_ENV: "production",
      }),
    ).toThrow("API_ACCOUNT_HMAC_KEY_VERSION is required in production");
    const finalized = loadAccountSubjectHmacKeySet({
      API_ACCOUNT_HMAC_KEY_VERSION: "2",
      API_ACCOUNT_HMAC_ROTATION_FINALIZED: "true",
      API_ACCOUNT_SUBJECT_HMAC_KEY: current,
      NODE_ENV: "production",
    });
    expect(finalized).toMatchObject({
      currentVersion: 2,
      rotationFinalized: true,
    });
    expect(finalized).not.toHaveProperty("previousKey");
    expect(() =>
      loadAccountSubjectHmacKeySet({
        API_ACCOUNT_HMAC_ALLOW_EXISTING_BOOTSTRAP: "yes",
        API_ACCOUNT_HMAC_KEY_VERSION: "1",
        API_ACCOUNT_SUBJECT_HMAC_KEY: current,
        NODE_ENV: "test",
      }),
    ).toThrow("must be exactly true or false");
  });
});
