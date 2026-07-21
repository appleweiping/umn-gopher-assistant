import sodium from "libsodium-wrappers-sumo";
import { describe, expect, it, vi } from "vitest";

import { RecoveryKeyEnvelopeV1Schema, VaultKeyringV1Schema } from "@umn-gopher-assistant/contracts";

import {
  createVaultCrypto,
  RECOVERY_MAX_MEM_LIMIT_BYTES,
  RECOVERY_MAX_OPS_LIMIT,
  VaultCryptoErrorCode,
} from "../src/index.js";
import { normalizeRecoveryCodeForTesting } from "../src/internal/recovery.js";

const VAULT_ID = "11111111-1111-4111-8111-111111111111";
const DEVICE_ONE = "22222222-2222-4222-8222-222222222222";
const DEVICE_TWO = "33333333-3333-4333-8333-333333333333";
function flipBase64Url(value: string): string {
  return `${value.startsWith("A") ? "B" : "A"}${value.slice(1)}`;
}

function changeRecoveryCode(code: string): string {
  const first = code.charAt(5);
  return `${code.slice(0, 5)}${first === "0" ? "1" : "0"}${code.slice(6)}`;
}

describe("Argon2id recovery envelopes and keyrings", () => {
  it("creates canonical 160-bit codes and accepts normalized casing/hyphenation", async () => {
    const crypto = await createVaultCrypto();
    const key = crypto.generateVaultKey({ vaultId: VAULT_ID });
    const generated = crypto.createRecoveryEnvelope({ key });
    expect(generated.recoveryCode).toMatch(
      /^UGA1-(?:[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-){7}[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/u,
    );
    expect(RecoveryKeyEnvelopeV1Schema.parse(generated.envelope)).toEqual(generated.envelope);
    expect(Buffer.from(generated.envelope.wrappedKey, "base64url")).toHaveLength(48);

    const normalized = generated.recoveryCode.toLowerCase().replaceAll("-", "");
    const restored = crypto.recoverVaultKey({ envelope: generated.envelope, recoveryCode: normalized });
    const payload = crypto.encryptPayload({
      key,
      plaintext: new TextEncoder().encode("recovery restored"),
      revision: 1,
      baseRevision: null,
    });
    expect(new TextDecoder().decode(crypto.decryptPayload({ key: restored, envelope: payload }))).toBe(
      "recovery restored",
    );
    restored.destroy();
    key.destroy();
  });

  it("normalizes NFKC, separators, and Crockford aliases to the same raw 20 bytes", () => {
    const canonical = normalizeRecoveryCodeForTesting(
      "UGA1-0111-1000-0111-1000-0111-1000-0111-1000",
    );
    const aliased = normalizeRecoveryCodeForTesting(
      "ｕｇａ１ OIlL\tIooo OIlL Iooo OIlL Iooo OIlL Iooo",
    );
    expect(aliased.display).toBe(canonical.display);
    expect(aliased.entropy).toEqual(canonical.entropy);
    expect(aliased.entropy).toHaveLength(20);
    canonical.entropy.fill(0);
    aliased.entropy.fill(0);
    expect(() =>
      normalizeRecoveryCodeForTesting(
        "UGA1-U111-1000-0111-1000-0111-1000-0111-1000",
      ),
    ).toThrow(expect.objectContaining({ code: VaultCryptoErrorCode.INVALID_INPUT }));
  });

  it("makes wrong recovery codes and envelope tampering one authentication failure", async () => {
    const crypto = await createVaultCrypto();
    const key = crypto.generateVaultKey({ vaultId: VAULT_ID });
    const recovery = crypto.createRecoveryEnvelope({ key });
    const wrongCode = changeRecoveryCode(recovery.recoveryCode);
    for (const input of [
      { envelope: recovery.envelope, recoveryCode: wrongCode },
      {
        envelope: {
          ...recovery.envelope,
          wrappedKey: flipBase64Url(recovery.envelope.wrappedKey),
        },
        recoveryCode: recovery.recoveryCode,
      },
      { envelope: recovery.envelope, recoveryCode: "not-a-recovery-code" },
    ]) {
      expect(() => crypto.recoverVaultKey(input)).toThrow(
        expect.objectContaining({
          code: VaultCryptoErrorCode.AUTHENTICATION_FAILED,
          message: "Authentication failed.",
        }),
      );
    }
    key.destroy();
  });

  it("rejects hostile KDF resource limits before decoding or allocating", async () => {
    const crypto = await createVaultCrypto();
    const key = crypto.generateVaultKey({ vaultId: VAULT_ID });
    const recovery = crypto.createRecoveryEnvelope({ key });
    const hostileMemory = {
      ...recovery.envelope,
      nonce: "not-base64",
      kdf: {
        ...recovery.envelope.kdf,
        memLimitBytes: RECOVERY_MAX_MEM_LIMIT_BYTES + 1,
      },
    };
    const hostileOps = {
      ...recovery.envelope,
      nonce: "not-base64",
      kdf: { ...recovery.envelope.kdf, opsLimit: RECOVERY_MAX_OPS_LIMIT + 1 },
    };
    await sodium.ready;
    const pwhash = vi.spyOn(sodium, "crypto_pwhash");
    try {
      for (const envelope of [hostileMemory, hostileOps]) {
        expect(() =>
          crypto.recoverVaultKey({ envelope, recoveryCode: recovery.recoveryCode }),
        ).toThrow(
          expect.objectContaining({ code: VaultCryptoErrorCode.AUTHENTICATION_FAILED }),
        );
      }
      expect(pwhash).not.toHaveBeenCalled();
    } finally {
      pwhash.mockRestore();
    }
    key.destroy();
  });

  it("creates and rotates schema-valid keyrings without silently destroying the prior key", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));
    try {
      const crypto = await createVaultCrypto();
      const key = crypto.generateVaultKey({ vaultId: VAULT_ID });
      const firstDevice = crypto.generateDeviceKey({ deviceId: DEVICE_ONE });
      const secondDevice = crypto.generateDeviceKey({ deviceId: DEVICE_TWO });
      const first = crypto.createKeyring({
        key,
        revision: 1,
        recipients: [firstDevice.publicKey, secondDevice.publicKey],
      });
      expect(VaultKeyringV1Schema.parse(first.keyring)).toEqual(first.keyring);
      expect(first.keyring.deviceEnvelopes).toHaveLength(2);

      const rotated = crypto.rotateKeyring({
        previousKey: key,
        previousKeyring: first.keyring,
        recipients: [secondDevice.publicKey],
      });
      expect(VaultKeyringV1Schema.parse(rotated.keyring)).toEqual(rotated.keyring);
      expect(rotated.keyring.revision).toBe(2);
      expect(rotated.keyring.vaultKeyId).not.toBe(first.keyring.vaultKeyId);
      expect(rotated.migrationRequired).toBe(true);
      expect(rotated.keyring.deviceEnvelopes.map((item) => item.recipientDeviceId)).toEqual([
        DEVICE_TWO,
      ]);
      expect(key.destroyed).toBe(false);

      const oldPayload = crypto.encryptPayload({
        key,
        plaintext: new TextEncoder().encode("migrate me"),
        revision: 1,
        baseRevision: null,
      });
      const migratedPayload = crypto.reencryptPayloadForRotation({
        previousKey: key,
        nextKey: rotated.key,
        envelope: oldPayload,
        revision: 2,
      });
      expect(migratedPayload.vaultKeyId).toBe(rotated.key.vaultKeyId);
      expect(
        new TextDecoder().decode(
          crypto.decryptPayload({ key: rotated.key, envelope: migratedPayload }),
        ),
      ).toBe("migrate me");

      const rotatedDeviceEnvelope = rotated.keyring.deviceEnvelopes.at(0);
      if (rotatedDeviceEnvelope === undefined) throw new Error("missing rotated envelope");
      const restored = crypto.unwrapVaultKeyForDevice({
        deviceKey: secondDevice,
        envelope: rotatedDeviceEnvelope,
      });
      const payload = crypto.encryptPayload({
        key: rotated.key,
        plaintext: new TextEncoder().encode("rotated"),
        revision: 2,
        baseRevision: 1,
      });
      expect(new TextDecoder().decode(crypto.decryptPayload({ key: restored, envelope: payload }))).toBe(
        "rotated",
      );
      restored.destroy();
      rotated.key.destroy();
      firstDevice.destroy();
      secondDevice.destroy();
      key.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects duplicate and revoked recipients during keyring creation", async () => {
    const crypto = await createVaultCrypto();
    const key = crypto.generateVaultKey({ vaultId: VAULT_ID });
    const device = crypto.generateDeviceKey({ deviceId: DEVICE_ONE });
    expect(() =>
      crypto.createKeyring({
        key,
        revision: 1,
        recipients: [device.publicKey, device.publicKey],
      }),
    ).toThrow(expect.objectContaining({ code: VaultCryptoErrorCode.INVALID_INPUT }));
    expect(() =>
      crypto.createKeyring({
        key,
        revision: 1,
        recipients: [{ ...device.publicKey, revokedAt: new Date().toISOString() }],
      }),
    ).toThrow(expect.objectContaining({ code: VaultCryptoErrorCode.INVALID_INPUT }));
    device.destroy();
    key.destroy();
  });
});
