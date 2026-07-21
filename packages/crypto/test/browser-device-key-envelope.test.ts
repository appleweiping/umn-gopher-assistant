import { describe, expect, it } from "vitest";

import {
  createBrowserDeviceWrappingKey,
  openBrowserDeviceKey,
  sealBrowserDeviceKey,
} from "../src/browser.js";
import { createVaultCrypto, VaultCryptoErrorCode } from "../src/index.js";

const VAULT_ID = "11111111-1111-4111-8111-111111111111";
const DEVICE_ONE = "22222222-2222-4222-8222-222222222222";
const DEVICE_TWO = "44444444-4444-4444-8444-444444444444";

function flipBase64Url(value: string): string {
  return `${value.startsWith("A") ? "B" : "A"}${value.slice(1)}`;
}

describe("browser local device-key envelopes", () => {
  it("uses a non-extractable AES-256-GCM CryptoKey and restores an opaque matching handle", async () => {
    const crypto = await createVaultCrypto();
    const original = crypto.generateDeviceKey({ deviceId: DEVICE_ONE });
    const wrappingKey = await createBrowserDeviceWrappingKey();
    expect(wrappingKey.extractable).toBe(false);
    expect(wrappingKey.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect(wrappingKey.usages).toEqual(["encrypt", "decrypt"]);
    await expect(globalThis.crypto.subtle.exportKey("raw", wrappingKey)).rejects.toThrow();
    const persistedKey = structuredClone(wrappingKey);
    expect(persistedKey.extractable).toBe(false);
    expect(persistedKey.usages).toEqual(["encrypt", "decrypt"]);

    const envelope = await sealBrowserDeviceKey({ deviceKey: original, wrappingKey });
    expect(envelope).toEqual({
      formatVersion: 1,
      cipherSuite: "AES_256_GCM",
      deviceId: original.publicKey.deviceId,
      deviceKeyId: original.publicKey.deviceKeyId,
      publicKeyFingerprint: original.publicKey.publicKeyFingerprint,
      iv: expect.any(String),
      ciphertext: expect.any(String),
    });
    expect(Buffer.from(envelope.iv, "base64url")).toHaveLength(12);
    expect(Buffer.from(envelope.ciphertext, "base64url")).toHaveLength(48);

    const restored = await openBrowserDeviceKey({
      publicKey: original.publicKey,
      wrappingKey: persistedKey,
      envelope,
    });
    const vaultKey = crypto.generateVaultKey({ vaultId: VAULT_ID });
    const wrapped = crypto.wrapVaultKeyForDevice({ key: vaultKey, recipient: restored.publicKey });
    const unlocked = crypto.unwrapVaultKeyForDevice({ deviceKey: restored, envelope: wrapped });
    expect(unlocked.vaultId).toBe(VAULT_ID);

    unlocked.destroy();
    vaultKey.destroy();
    restored.destroy();
    original.destroy();
  });

  it("authenticates every serialized field and rejects a descriptor/private-key mismatch", async () => {
    const crypto = await createVaultCrypto();
    const first = crypto.generateDeviceKey({ deviceId: DEVICE_ONE });
    const second = crypto.generateDeviceKey({ deviceId: DEVICE_TWO });
    const wrappingKey = await createBrowserDeviceWrappingKey();
    const envelope = await sealBrowserDeviceKey({ deviceKey: first, wrappingKey });
    const candidates = [
      { ...envelope, formatVersion: 2 },
      { ...envelope, cipherSuite: "XCHACHA20_POLY1305" },
      { ...envelope, deviceId: DEVICE_TWO },
      { ...envelope, deviceKeyId: second.publicKey.deviceKeyId },
      { ...envelope, publicKeyFingerprint: second.publicKey.publicKeyFingerprint },
      { ...envelope, iv: flipBase64Url(envelope.iv) },
      { ...envelope, ciphertext: flipBase64Url(envelope.ciphertext) },
      { ...envelope, unexpected: true },
    ];
    for (const candidate of candidates) {
      await expect(
        openBrowserDeviceKey({
          publicKey: first.publicKey,
          wrappingKey,
          envelope: candidate as typeof envelope,
        }),
      ).rejects.toMatchObject({ code: VaultCryptoErrorCode.AUTHENTICATION_FAILED });
    }
    await expect(
      openBrowserDeviceKey({ publicKey: second.publicKey, wrappingKey, envelope }),
    ).rejects.toMatchObject({ code: VaultCryptoErrorCode.AUTHENTICATION_FAILED });

    first.destroy();
    second.destroy();
  });
});
