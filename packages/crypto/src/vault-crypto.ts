import type { VaultCrypto } from "./types.js";
import type { Sodium } from "./internal/sodium.js";

import { VAULT_KEY_BYTES } from "./constants.js";
import { VaultCryptoError, VaultCryptoErrorCode } from "./errors.js";
import { generateDeviceKey, unwrapVaultKeyForDevice, wrapVaultKeyForDevice } from "./internal/device.js";
import { createVaultHandle } from "./internal/handles.js";
import {
  computeAuthorizationPublicKeyFingerprintV2,
  computeRootKeyStateMac,
  computeVaultCommitHash,
  createDeviceDescriptorV2,
  createRecoveryAuthorizationPublicKeyV2,
  deriveDeviceAuthorizationKey,
  deriveRecoveryAuthorizationKey,
  generateAuthorizationKey,
  hashAuthorizationManifestV2,
  hashVaultKeyringV1,
  hashVaultPayloadV2,
  signVaultCommandProof,
  signDevicePairingRequest,
  signVaultCommit,
  signVaultReadProof,
  verifyRootKeyStateMac,
  verifyDevicePairingRequest,
  verifyVaultCommandProof,
  verifyVaultCommitSignature,
  verifyVaultReadProof,
} from "./internal/authorization.js";
import { randomUuid } from "./internal/ids.js";
import { createKeyring, rotateKeyring } from "./internal/keyring.js";
import { decryptPayload, encryptPayload } from "./internal/payload.js";
import { decryptPayloadV2, encryptPayloadV2 } from "./internal/payload-v2.js";
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
    generateAuthorizationKey(input) {
      return generateAuthorizationKey(sodium, input.ownerBinding, input.deviceId, input.keyId);
    },
    deriveDeviceAuthorizationKey(input) {
      return deriveDeviceAuthorizationKey(sodium, input.ownerBinding, input.deviceKey, input.keyId);
    },
    deriveRecoveryAuthorizationKey(input) {
      return deriveRecoveryAuthorizationKey(
        sodium,
        input.recoveryCode,
        input.ownerBinding,
        input.vaultId,
        input.keyId,
      );
    },
    createDeviceDescriptorV2(input) {
      return createDeviceDescriptorV2(sodium, input);
    },
    createRecoveryAuthorizationPublicKeyV2(input) {
      return createRecoveryAuthorizationPublicKeyV2(input.authorizationKey);
    },
    computeAuthorizationPublicKeyFingerprintV2(publicKey) {
      return computeAuthorizationPublicKeyFingerprintV2(sodium, publicKey);
    },
    encryptPayload(input) {
      return encryptPayload(sodium, input.key, input.plaintext, input.revision, input.baseRevision);
    },
    decryptPayload(input) {
      return decryptPayload(sodium, input.key, input.envelope);
    },
    encryptPayloadV2(input) {
      return encryptPayloadV2(
        sodium,
        input.key,
        input.ownerBinding,
        input.plaintext,
        input.revision,
        input.baseRevision,
      );
    },
    decryptPayloadV2(input) {
      return decryptPayloadV2(sodium, input.key, input.envelope);
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
    signVaultCommit(input) {
      return signVaultCommit(sodium, input);
    },
    verifyVaultCommitSignature(input) {
      return verifyVaultCommitSignature(sodium, input.commit, input.publicKey);
    },
    computeRootKeyStateMac(input) {
      return computeRootKeyStateMac(sodium, input);
    },
    verifyRootKeyStateMac(input) {
      return verifyRootKeyStateMac(sodium, input.vaultKey, input.commit);
    },
    signVaultCommandProof(input) {
      return signVaultCommandProof(sodium, input);
    },
    signRecoveryAuthorization(input) {
      if (input.authorizationKey.kind !== "RECOVERY") {
        throw new VaultCryptoError(VaultCryptoErrorCode.INVALID_INPUT);
      }
      return signVaultCommandProof(sodium, input);
    },
    verifyVaultCommandProof(input) {
      return verifyVaultCommandProof(sodium, input.proof, input.publicKey);
    },
    signVaultReadProof(input) {
      return signVaultReadProof(sodium, input);
    },
    verifyVaultReadProof(input) {
      return verifyVaultReadProof(sodium, input.proof, input.publicKey);
    },
    signDevicePairingRequest(input) {
      return signDevicePairingRequest(sodium, input.authorizationKey, input.request);
    },
    verifyDevicePairingRequest(input) {
      return verifyDevicePairingRequest(sodium, input.request);
    },
    hashVaultPayloadV2(value) {
      return hashVaultPayloadV2(sodium, value);
    },
    hashVaultKeyringV1(value) {
      return hashVaultKeyringV1(sodium, value);
    },
    hashAuthorizationManifestV2(value) {
      return hashAuthorizationManifestV2(sodium, value);
    },
    computeVaultCommitHash(value) {
      return computeVaultCommitHash(sodium, value);
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
