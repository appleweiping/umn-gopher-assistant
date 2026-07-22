import sodium from "libsodium-wrappers-sumo";
import { describe, expect, it, vi } from "vitest";

import { buildPayloadAadV1, type DevicePublicKeyV1 } from "@umn-gopher-assistant/contracts";

import { wrapVaultKeyForDevice } from "../src/internal/device.js";
import { createVaultHandle } from "../src/internal/handles.js";
import { createRecoveryEnvelope } from "../src/internal/recovery.js";
import { openXChaCha, sealXChaCha } from "../src/internal/xchacha.js";

const VAULT_ID = "018fb9d8-3ec5-7e8b-a512-35f8ff523110";
const VAULT_KEY_ID = "018fb9d8-3ec5-7e8b-a512-35f8ff523111";
const DEVICE_ID = "018fb9d8-3ec5-7e8b-a512-35f8ff523112";
const DEVICE_KEY_ID = "018fb9d8-3ec5-7e8b-a512-35f8ff523113";

function sodiumWith(overrides: Readonly<Record<PropertyKey, unknown>>): typeof sodium {
  return new Proxy(sodium, {
    get(target, property) {
      if (Object.prototype.hasOwnProperty.call(overrides, property)) return overrides[property];
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      const callable = value as (...arguments_: unknown[]) => unknown;
      return (...arguments_: unknown[]): unknown => Reflect.apply(callable, target, arguments_);
    },
  });
}

describe("fixed cryptographic and encoding vectors", () => {
  it("matches the libsodium XChaCha20-Poly1305-IETF regression vector", async () => {
    await sodium.ready;
    const key = Uint8Array.from({ length: 32 }, (_, index) => index);
    const nonce = Uint8Array.from({ length: 24 }, (_, index) => index + 32);
    const plaintext = new TextEncoder().encode("fixed-vector");
    const aad = new TextEncoder().encode("uga-aad-v1");
    const ciphertext = sealXChaCha(sodium, key, nonce, plaintext, aad);
    expect(sodium.to_hex(ciphertext)).toBe("7b3035ae1f1a62ee5bca3fcff15f15b076518f1f699e3596f1b08637");
    expect(openXChaCha(sodium, key, nonce, ciphertext, aad)).toEqual(plaintext);
    ciphertext[0] = (ciphertext.at(0) ?? 0) ^ 1;
    expect(() => openXChaCha(sodium, key, nonce, ciphertext, aad)).toThrow(
      expect.objectContaining({ code: "AUTHENTICATION_FAILED" }),
    );
    sodium.memzero(key);
    sodium.memzero(nonce);
    sodium.memzero(plaintext);
    sodium.memzero(aad);
    sodium.memzero(ciphertext);
  });

  it("uses the contracts package's domain-separated canonical AAD vector", () => {
    const aad = buildPayloadAadV1({
      formatVersion: 1,
      vaultId: "018fb9d8-3ec5-7e8b-a512-35f8ff523110",
      vaultKeyId: "018fb9d8-3ec5-7e8b-a512-35f8ff523111",
      revision: 1,
      baseRevision: null,
      cipherSuite: "XCHACHA20_POLY1305",
      contentType: "application/vnd.umn-gopher-assistant.personal-vault+json",
      contentSchemaVersion: 1,
      padding: { algorithm: "SODIUM_PAD", blockSize: 4_096 },
      nonce: "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJ",
      createdAt: "2026-07-19T00:00:00.000Z",
    });
    expect(new TextDecoder().decode(Buffer.from(aad, "base64url"))).toBe(
      '["UGA1/PAYLOAD/AAD",1,"018fb9d8-3ec5-7e8b-a512-35f8ff523110","018fb9d8-3ec5-7e8b-a512-35f8ff523111",1,null,"XCHACHA20_POLY1305","application/vnd.umn-gopher-assistant.personal-vault+json",1,"SODIUM_PAD",4096,"CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJ","2026-07-19T00:00:00.000Z"]',
    );
  });

  it("matches the complete X25519 device-envelope interoperability vector", async () => {
    await sodium.ready;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T00:00:00.000Z"));
    const recipientPublic = "B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9_AsrhtHHw";
    const fingerprint = "wglEgYf6CUXpaDu5DnAqRPpGbt7i4P5b6tIfr9uDfXE";
    const ephemeralPublic = "WGmv9FBUlzLLqu1eXfmzCm2jHLDldCutWtShp2jxpns";
    const nonce = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4";
    const recipient: DevicePublicKeyV1 = {
      formatVersion: 1,
      deviceId: DEVICE_ID,
      deviceKeyId: DEVICE_KEY_ID,
      keyAlgorithm: "X25519",
      publicKey: recipientPublic,
      publicKeyFingerprint: fingerprint,
      createdAt: "2026-07-19T00:00:00.000Z",
      revokedAt: null,
    };
    const ephemeralPrivate = Uint8Array.from({ length: 32 }, (_, index) => index + 33);
    const probeScalar = Uint8Array.from({ length: 32 }, (_, index) => index + 201);
    const nonceBytes = Uint8Array.from({ length: 24 }, (_, index) => index + 97);
    const vectorSodium = sodiumWith({
      crypto_box_curve25519xchacha20poly1305_keypair: () => ({
        keyType: "curve25519",
        privateKey: ephemeralPrivate.slice(),
        publicKey: sodium.from_base64(ephemeralPublic, sodium.base64_variants.URLSAFE_NO_PADDING),
      }),
      randombytes_buf: (length: number) => {
        if (length === 32) return probeScalar.slice();
        if (length === 24) return nonceBytes.slice();
        throw new Error(`Unexpected vector random request: ${String(length)}`);
      },
    });
    const key = createVaultHandle(
      vectorSodium,
      VAULT_ID,
      VAULT_KEY_ID,
      Uint8Array.from({ length: 32 }, (_, index) => index + 65),
    );
    try {
      expect(wrapVaultKeyForDevice(vectorSodium, key, recipient)).toEqual({
        formatVersion: 1,
        vaultId: VAULT_ID,
        vaultKeyId: VAULT_KEY_ID,
        recipientDeviceId: DEVICE_ID,
        recipientKeyId: DEVICE_KEY_ID,
        recipientPublicKeyFingerprint: fingerprint,
        cipherSuite: "X25519_XCHACHA20_POLY1305",
        ephemeralPublicKey: ephemeralPublic,
        nonce,
        wrappedKey:
          "K6WwJY8G9ahyetTvnV5RwwmBzBgK4IRmk29xYY6_xEOz8JsgLvwGI2EuktuGj2drmSgTmvFGHZIytYc8qROJvoVlcf0OrikP2r3Gg4ldoKo",
        createdAt: "2026-07-19T00:00:00.000Z",
      });
    } finally {
      key.destroy();
      sodium.memzero(ephemeralPrivate);
      sodium.memzero(probeScalar);
      sodium.memzero(nonceBytes);
      vi.useRealTimers();
    }
  });

  it("matches the recovery-code byte order and Argon2id recovery-envelope vector", async () => {
    await sodium.ready;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T00:00:00.000Z"));
    const values = new Map<number, Uint8Array>([
      [20, Uint8Array.from({ length: 20 }, (_, index) => index)],
      [16, Uint8Array.from({ length: 16 }, (_, index) => index + 20)],
      [24, Uint8Array.from({ length: 24 }, (_, index) => index + 36)],
    ]);
    const vectorSodium = sodiumWith({
      randombytes_buf: (length: number) => {
        const value = values.get(length);
        if (value === undefined) throw new Error(`Unexpected vector random request: ${String(length)}`);
        return value.slice();
      },
    });
    const key = createVaultHandle(
      vectorSodium,
      VAULT_ID,
      VAULT_KEY_ID,
      Uint8Array.from({ length: 32 }, (_, index) => index + 60),
    );
    try {
      expect(createRecoveryEnvelope(vectorSodium, key)).toEqual({
        recoveryCode: "UGA1-000G-40R4-0M30-E209-185G-R38E-1W81-24GK",
        envelope: {
          formatVersion: 1,
          vaultId: VAULT_ID,
          vaultKeyId: VAULT_KEY_ID,
          cipherSuite: "XCHACHA20_POLY1305",
          kdf: {
            algorithm: "ARGON2ID13",
            salt: "FBUWFxgZGhscHR4fICEiIw",
            opsLimit: 3,
            memLimitBytes: 64 * 1_024 * 1_024,
            outputBytes: 32,
          },
          nonce: "JCUmJygpKissLS4vMDEyMzQ1Njc4OTo7",
          wrappedKey: "itFNS69bI5a1iZqFrGiRQPF6ZCIGDJ71pW-x9BmQgKD5rrvwFjm0-7d7VlOMVWpg",
          aad: "WyJVR0ExL1JFQ09WRVJZL0FBRCIsMSwiMDE4ZmI5ZDgtM2VjNS03ZThiLWE1MTItMzVmOGZmNTIzMTEwIiwiMDE4ZmI5ZDgtM2VjNS03ZThiLWE1MTItMzVmOGZmNTIzMTExIiwiWENIQUNIQTIwX1BPTFkxMzA1IiwiQVJHT04ySUQxMyIsIkZCVVdGeGdaR2hzY0hSNGZJQ0VpSXciLDMsNjcxMDg4NjQsMzIsIkpDVW1KeWdwS2lzc0xTNHZNREV5TXpRMU5qYzRPVG83IiwiMjAyNi0wNy0xOVQwMDowMDowMC4wMDBaIl0",
          createdAt: "2026-07-19T00:00:00.000Z",
        },
      });
    } finally {
      key.destroy();
      for (const value of values.values()) sodium.memzero(value);
      vi.useRealTimers();
    }
  });
});
