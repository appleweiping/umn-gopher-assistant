import { describe, expect, it, vi } from "vitest";

import { EncryptedVaultPayloadEnvelopeV1Schema } from "@umn-gopher-assistant/contracts";

import {
  createVaultCrypto,
  PERSONAL_VAULT_CONTENT_TYPE,
  VaultCryptoError,
  VaultCryptoErrorCode,
  VAULT_MAX_PLAINTEXT_BYTES,
} from "../src/index.js";

const VAULT_ID = "11111111-1111-4111-8111-111111111111";
const KEY_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_KEY_ID = "33333333-3333-4333-8333-333333333333";

function flipBase64Url(value: string): string {
  const replacement = value.startsWith("A") ? "B" : "A";
  return replacement + value.slice(1);
}

function expectAuthenticationFailure(action: () => unknown): void {
  try {
    action();
    throw new Error("expected authentication failure");
  } catch (error) {
    expect(error).toBeInstanceOf(VaultCryptoError);
    expect(error).toMatchObject({
      code: VaultCryptoErrorCode.AUTHENTICATION_FAILED,
      message: "Authentication failed.",
    });
  }
}

describe("vault payload encryption", () => {
  it("initializes exactly one frozen facade", async () => {
    const [first, second] = await Promise.all([createVaultCrypto(), createVaultCrypto()]);
    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.keys(first).sort()).toEqual([
      "createKeyring",
      "createRecoveryEnvelope",
      "decryptPayload",
      "encryptPayload",
      "generateDeviceKey",
      "generateVaultKey",
      "recoverVaultKey",
      "reencryptPayloadForRotation",
      "rotateKeyring",
      "unwrapVaultKeyForDevice",
      "wrapVaultKeyForDevice",
    ]);
  });

  it("uses random nonces, canonical metadata AAD, and 4 KiB sodium padding", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));
    try {
      const crypto = await createVaultCrypto();
      const key = crypto.generateVaultKey({ vaultId: VAULT_ID, vaultKeyId: KEY_ID });
      const plaintext = new TextEncoder().encode('{"task":"submit"}');
      const first = crypto.encryptPayload({ key, plaintext, revision: 1, baseRevision: null });
      const second = crypto.encryptPayload({ key, plaintext, revision: 1, baseRevision: null });

      expect(first.nonce).not.toBe(second.nonce);
      expect(first.ciphertext).not.toBe(second.ciphertext);
      expect(first.contentType).toBe(PERSONAL_VAULT_CONTENT_TYPE);
      expect(Buffer.from(first.ciphertext, "base64url")).toHaveLength(4_096 + 16);
      expect(EncryptedVaultPayloadEnvelopeV1Schema.parse(first)).toEqual(first);
      expect(JSON.parse(new TextDecoder().decode(Buffer.from(first.aad, "base64url")))).toEqual([
        "UGA1/PAYLOAD/AAD",
        1,
        VAULT_ID,
        KEY_ID,
        1,
        null,
        "XCHACHA20_POLY1305",
        PERSONAL_VAULT_CONTENT_TYPE,
        1,
        "SODIUM_PAD",
        4_096,
        first.nonce,
        "2026-07-20T00:00:00.000Z",
      ]);
      expect(crypto.decryptPayload({ key, envelope: first })).toEqual(plaintext);
      key.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("authenticates every metadata and ciphertext field", async () => {
    const crypto = await createVaultCrypto();
    const key = crypto.generateVaultKey({ vaultId: VAULT_ID, vaultKeyId: KEY_ID });
    const envelope = crypto.encryptPayload({
      key,
      plaintext: new TextEncoder().encode("sensitive"),
      revision: 2,
      baseRevision: 1,
    });
    const tampered: unknown[] = [
      { ...envelope, formatVersion: 2 },
      { ...envelope, vaultId: "44444444-4444-4444-8444-444444444444" },
      { ...envelope, vaultKeyId: OTHER_KEY_ID },
      { ...envelope, revision: 3 },
      { ...envelope, baseRevision: null },
      { ...envelope, cipherSuite: "AES_256_GCM" },
      { ...envelope, contentType: "application/json" },
      { ...envelope, contentSchemaVersion: 2 },
      { ...envelope, padding: { ...envelope.padding, algorithm: "ZERO_PAD" } },
      { ...envelope, padding: { ...envelope.padding, blockSize: 1_024 } },
      { ...envelope, nonce: flipBase64Url(envelope.nonce) },
      { ...envelope, ciphertext: flipBase64Url(envelope.ciphertext) },
      { ...envelope, aad: flipBase64Url(envelope.aad) },
      { ...envelope, createdAt: "2026-07-20T00:00:00.001Z" },
      { ...envelope, extra: true },
    ];
    for (const candidate of tampered) {
      expectAuthenticationFailure(() =>
        crypto.decryptPayload({ key, envelope: candidate as typeof envelope }),
      );
    }
    key.destroy();
  });

  it("makes wrong-key and malformed-envelope failures indistinguishable and redacted", async () => {
    const crypto = await createVaultCrypto();
    const key = crypto.generateVaultKey({ vaultId: VAULT_ID, vaultKeyId: KEY_ID });
    const wrongKey = crypto.generateVaultKey({ vaultId: VAULT_ID, vaultKeyId: OTHER_KEY_ID });
    const envelope = crypto.encryptPayload({
      key,
      plaintext: new TextEncoder().encode("never disclose this marker"),
      revision: 1,
      baseRevision: null,
    });
    const failures: VaultCryptoError[] = [];
    for (const action of [
      () => crypto.decryptPayload({ key: wrongKey, envelope }),
      () => crypto.decryptPayload({ key, envelope: { ...envelope, ciphertext: "secret-marker" } }),
    ]) {
      try {
        action();
      } catch (error) {
        failures.push(error as VaultCryptoError);
      }
    }
    expect(failures).toHaveLength(2);
    expect(failures.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: "AUTHENTICATION_FAILED", message: "Authentication failed." },
      { code: "AUTHENTICATION_FAILED", message: "Authentication failed." },
    ]);
    expect(failures.every((error) => !("cause" in error))).toBe(true);
    expect(failures.map((error) => error.message).join(" ")).not.toContain("marker");
    key.destroy();
    wrongKey.destroy();
  });

  it("rejects invalid revisions and over-limit payloads before encryption", async () => {
    const crypto = await createVaultCrypto();
    const key = crypto.generateVaultKey({ vaultId: VAULT_ID });
    expect(() =>
      crypto.encryptPayload({
        key,
        plaintext: new Uint8Array(),
        revision: 2,
        baseRevision: null,
      }),
    ).toThrow(expect.objectContaining({ code: VaultCryptoErrorCode.INVALID_INPUT }));
    expect(() =>
      crypto.encryptPayload({
        key,
        plaintext: new Uint8Array(VAULT_MAX_PLAINTEXT_BYTES + 1),
        revision: 1,
        baseRevision: null,
      }),
    ).toThrow(expect.objectContaining({ code: VaultCryptoErrorCode.PAYLOAD_TOO_LARGE }));
    key.destroy();
  });

  it("destroys key material idempotently and refuses subsequent use", async () => {
    const crypto = await createVaultCrypto();
    const key = crypto.generateVaultKey({ vaultId: VAULT_ID });
    expect(key.destroyed).toBe(false);
    key.destroy();
    key.destroy();
    expect(key.destroyed).toBe(true);
    expect(() =>
      crypto.encryptPayload({
        key,
        plaintext: new Uint8Array(),
        revision: 1,
        baseRevision: null,
      }),
    ).toThrow(expect.objectContaining({ code: VaultCryptoErrorCode.DESTROYED_KEY }));
  });
});
