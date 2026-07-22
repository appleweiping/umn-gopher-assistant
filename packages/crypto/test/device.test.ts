import sodium from "libsodium-wrappers-sumo";
import { describe, expect, it, vi } from "vitest";

import { DeviceKeyEnvelopeV1Schema, DevicePublicKeyV1Schema } from "@umn-gopher-assistant/contracts";

import { createVaultCrypto, VaultCryptoErrorCode } from "../src/index.js";

const VAULT_ID = "11111111-1111-4111-8111-111111111111";
const DEVICE_ONE = "22222222-2222-4222-8222-222222222222";
const DEVICE_ONE_KEY = "33333333-3333-4333-8333-333333333333";
const DEVICE_TWO = "44444444-4444-4444-8444-444444444444";

function flipBase64Url(value: string): string {
  return `${value.startsWith("A") ? "B" : "A"}${value.slice(1)}`;
}

describe("X25519 device key envelopes", () => {
  it("publishes schema-valid keys and wraps exactly 64 secret bytes into 80 ciphertext bytes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));
    try {
      const crypto = await createVaultCrypto();
      const vaultKey = crypto.generateVaultKey({ vaultId: VAULT_ID });
      const device = crypto.generateDeviceKey({
        deviceId: DEVICE_ONE,
        deviceKeyId: DEVICE_ONE_KEY,
      });
      expect(DevicePublicKeyV1Schema.parse(device.publicKey)).toEqual(device.publicKey);
      expect(Object.isFrozen(device.publicKey)).toBe(true);
      const envelope = crypto.wrapVaultKeyForDevice({ key: vaultKey, recipient: device.publicKey });
      expect(DeviceKeyEnvelopeV1Schema.parse(envelope)).toEqual(envelope);
      expect(Buffer.from(envelope.wrappedKey, "base64url")).toHaveLength(80);

      const restored = crypto.unwrapVaultKeyForDevice({ deviceKey: device, envelope });
      const payload = crypto.encryptPayload({
        key: vaultKey,
        plaintext: new TextEncoder().encode("device restored"),
        revision: 1,
        baseRevision: null,
      });
      expect(new TextDecoder().decode(crypto.decryptPayload({ key: restored, envelope: payload }))).toBe(
        "device restored",
      );
      restored.destroy();
      device.destroy();
      vaultKey.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("isolates devices and authenticates recipient, time, ephemeral key, nonce, and wrapped bytes", async () => {
    const crypto = await createVaultCrypto();
    const vaultKey = crypto.generateVaultKey({ vaultId: VAULT_ID });
    const first = crypto.generateDeviceKey({ deviceId: DEVICE_ONE });
    const second = crypto.generateDeviceKey({ deviceId: DEVICE_TWO });
    const envelope = crypto.wrapVaultKeyForDevice({ key: vaultKey, recipient: first.publicKey });
    const candidates = [
      { ...envelope, recipientDeviceId: DEVICE_TWO },
      { ...envelope, recipientKeyId: second.publicKey.deviceKeyId },
      { ...envelope, recipientPublicKeyFingerprint: second.publicKey.publicKeyFingerprint },
      { ...envelope, createdAt: "2026-07-20T00:00:00.001Z" },
      { ...envelope, ephemeralPublicKey: flipBase64Url(envelope.ephemeralPublicKey) },
      { ...envelope, nonce: flipBase64Url(envelope.nonce) },
      { ...envelope, wrappedKey: flipBase64Url(envelope.wrappedKey) },
    ];
    expect(() => crypto.unwrapVaultKeyForDevice({ deviceKey: second, envelope })).toThrow(
      expect.objectContaining({ code: VaultCryptoErrorCode.AUTHENTICATION_FAILED }),
    );
    for (const candidate of candidates) {
      expect(() => crypto.unwrapVaultKeyForDevice({ deviceKey: first, envelope: candidate })).toThrow(
        expect.objectContaining({ code: VaultCryptoErrorCode.AUTHENTICATION_FAILED }),
      );
    }
    first.destroy();
    second.destroy();
    vaultKey.destroy();
  });

  it("rejects forged and revoked recipient public keys", async () => {
    const crypto = await createVaultCrypto();
    const vaultKey = crypto.generateVaultKey({ vaultId: VAULT_ID });
    const device = crypto.generateDeviceKey({ deviceId: DEVICE_ONE });
    expect(() =>
      crypto.wrapVaultKeyForDevice({
        key: vaultKey,
        recipient: { ...device.publicKey, publicKeyFingerprint: "A".repeat(43) },
      }),
    ).toThrow(expect.objectContaining({ code: VaultCryptoErrorCode.INVALID_INPUT }));
    await sodium.ready;
    for (const firstByte of [0, 1]) {
      const lowOrder = new Uint8Array(32);
      lowOrder[0] = firstByte;
      const domain = new TextEncoder().encode("UGA1/DEVICE-PUBLIC-KEY/FINGERPRINT\0");
      const fingerprintInput = new Uint8Array(domain.length + lowOrder.length);
      fingerprintInput.set(domain);
      fingerprintInput.set(lowOrder, domain.length);
      const fingerprint = sodium.crypto_generichash(32, fingerprintInput, null);
      const variant = sodium.base64_variants.URLSAFE_NO_PADDING;
      expect(() =>
        crypto.wrapVaultKeyForDevice({
          key: vaultKey,
          recipient: {
            ...device.publicKey,
            publicKey: sodium.to_base64(lowOrder, variant),
            publicKeyFingerprint: sodium.to_base64(fingerprint, variant),
          },
        }),
      ).toThrow(expect.objectContaining({ code: VaultCryptoErrorCode.INVALID_INPUT }));
      sodium.memzero(lowOrder);
      sodium.memzero(domain);
      sodium.memzero(fingerprintInput);
      sodium.memzero(fingerprint);
    }
    expect(() =>
      crypto.wrapVaultKeyForDevice({
        key: vaultKey,
        recipient: { ...device.publicKey, revokedAt: new Date().toISOString() },
      }),
    ).toThrow(expect.objectContaining({ code: VaultCryptoErrorCode.INVALID_INPUT }));
    device.destroy();
    vaultKey.destroy();
  });

  it("destroys private device keys idempotently", async () => {
    const crypto = await createVaultCrypto();
    const vaultKey = crypto.generateVaultKey({ vaultId: VAULT_ID });
    const device = crypto.generateDeviceKey({ deviceId: DEVICE_ONE });
    const envelope = crypto.wrapVaultKeyForDevice({ key: vaultKey, recipient: device.publicKey });
    device.destroy();
    device.destroy();
    expect(device.destroyed).toBe(true);
    expect(() => crypto.unwrapVaultKeyForDevice({ deviceKey: device, envelope })).toThrow(
      expect.objectContaining({ code: VaultCryptoErrorCode.DESTROYED_KEY }),
    );
    vaultKey.destroy();
  });
});
