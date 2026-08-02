import { describe, expect, it } from "vitest";

import { signingKeyFingerprintBytes } from "../src/personal-vault/signing-key-fingerprint.js";

describe("personal-vault signing-key fingerprint storage", () => {
  it("decodes an authenticated canonical fingerprint to its exact 32 bytes", () => {
    const expected = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
    const fingerprint = signingKeyFingerprintBytes(expected.toString("base64url"));

    expect(fingerprint).toEqual(expected);
    fingerprint.fill(0);
  });

  it.each([
    "",
    Buffer.alloc(31, 1).toString("base64url"),
    `${Buffer.alloc(32, 2).toString("base64url")}=`,
    "not-a-canonical-fingerprint",
  ])("rejects a malformed fingerprint without returning partial bytes", (value) => {
    expect(() => signingKeyFingerprintBytes(value)).toThrow(
      "Authorization signing-key fingerprint must be canonical 32-byte base64url",
    );
  });
});
