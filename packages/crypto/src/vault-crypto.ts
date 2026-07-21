import type { VaultCrypto } from "./types.js";
import type { Sodium } from "./internal/sodium.js";

import { VAULT_KEY_BYTES } from "./constants.js";
import { VaultCryptoError, VaultCryptoErrorCode } from "./errors.js";
import { generateDeviceKey, unwrapVaultKeyForDevice, wrapVaultKeyForDevice } from "./internal/device.js";
import { createVaultHandle } from "./internal/handles.js";
import { randomUuid } from "./internal/ids.js";
import { createKeyring, rotateKeyring } from "./internal/keyring.js";
import { decryptPayload, encryptPayload } from "./internal/payload.js";
import { createRecoveryEnvelope, recoverVaultKey } from "./internal/recovery.js";
import { initializeSodium } from "./internal/sodium.js";
import { requireUuid } from "./internal/validation.js";

function createInitializedVaultCrypto(sodium: Sodium): VaultCrypto {
  const api: VaultCrypto = {
    generateVaultKey(input) {
      const vaultId = requireUuid(input.vaultId);
      const vaultKeyId = input.vaultKeyId === undefined ? randomUuid(sodium) : requireUuid(input.vaultKeyId);
      return createVaultHandle(sodium, vaultId, vaultKeyId, sodium.randombytes_buf(VAULT_KEY_BYTES));
    },
    generateDeviceKey(input) {
      return generateDeviceKey(sodium, input.deviceId, input.deviceKeyId);
    },
    encryptPayload(input) {
      return encryptPayload(sodium, input.key, input.plaintext, input.revision, input.baseRevision);
    },
    decryptPayload(input) {
      return decryptPayload(sodium, input.key, input.envelope);
    },
    wrapVaultKeyForDevice(input) {
      return wrapVaultKeyForDevice(sodium, input.key, input.recipient);
    },
    unwrapVaultKeyForDevice(input) {
      return unwrapVaultKeyForDevice(sodium, input.deviceKey, input.envelope);
    },
    createRecoveryEnvelope(input) {
      return createRecoveryEnvelope(sodium, input.key);
    },
    recoverVaultKey(input) {
      return recoverVaultKey(sodium, input.envelope, input.recoveryCode);
    },
    createKeyring(input) {
      return createKeyring(sodium, input);
    },
    rotateKeyring(input) {
      return rotateKeyring(sodium, input);
    },
    reencryptPayloadForRotation(input) {
      if (
        input.previousKey.vaultId !== input.nextKey.vaultId ||
        input.previousKey.vaultKeyId === input.nextKey.vaultKeyId
      ) {
        throw new VaultCryptoError(VaultCryptoErrorCode.INVALID_INPUT);
      }
      const plaintext = decryptPayload(sodium, input.previousKey, input.envelope);
      try {
        return encryptPayload(sodium, input.nextKey, plaintext, input.revision, input.envelope.revision);
      } finally {
        sodium.memzero(plaintext);
      }
    },
  };
  return Object.freeze(api);
}

let vaultCryptoSingleton: Promise<VaultCrypto> | undefined;

/** Initialize libsodium once and return the process-wide stateless vault crypto facade. */
export function createVaultCrypto(): Promise<VaultCrypto> {
  vaultCryptoSingleton ??= initializeSodium().then((sodium) => createInitializedVaultCrypto(sodium));
  return vaultCryptoSingleton;
}
