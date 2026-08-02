import type {
  AuthorizationKeyHandle,
  CreateDeviceDescriptorV2Input,
  DeviceAuthorizationPublicKeyV2,
  DeviceDescriptorV2,
  DevicePairingRequestV2,
  RecoveryAuthorizationPublicKeyV2,
  RootKeyStateMacInput,
  SignVaultCommandProofInput,
  SignVaultCommitInput,
  SignVaultReadProofInput,
  VaultCommandProofV2,
  VaultCommitV2,
  VaultReadProofV2,
} from "../types.js";
import type { Sodium } from "./sodium.js";

import {
  AuthorizationManifestV2Schema,
  buildVaultCommandProofBytesV2,
  buildVaultCommitMacBytesV2,
  buildVaultCommitSigningBytesV2,
  buildVaultReadProofBytesV2,
  buildDevicePairingRequestBytesV2,
  DeviceAuthorizationPublicKeyV2Schema,
  DeviceDescriptorV2Schema,
  DevicePairingRequestCanonicalInputV2Schema,
  DevicePairingRequestV2Schema,
  EncryptedVaultPayloadEnvelopeV2Schema,
  OwnerBindingV2Schema,
  RecoveryAuthorizationPublicKeyV2Schema,
  VaultCommandProofCanonicalInputV2Schema,
  VaultCommandProofV2Schema,
  VaultCommitCanonicalInputV2Schema,
  VaultCommitV2Schema,
  VaultKeyringV1Schema,
  VaultReadProofCanonicalInputV2Schema,
  VaultReadProofV2Schema,
  type AuthorizationManifestV2,
  type EncryptedVaultPayloadEnvelopeV2,
  type VaultKeyringV1,
} from "@umn-gopher-assistant/contracts";

import {
  AUTHORIZATION_PRIVATE_KEY_BYTES,
  AUTHORIZATION_PUBLIC_KEY_BYTES,
  AUTHORIZATION_SIGNATURE_BYTES,
} from "../constants.js";
import { authenticationFailed, cryptoError, VaultCryptoError, VaultCryptoErrorCode } from "../errors.js";
import {
  concatenate,
  decodeBase64UrlBounded,
  decodeBase64UrlExact,
  encodeBase64Url,
  utf8,
} from "./encoding.js";
import {
  authorizationPrivateKey,
  createAuthorizationHandle,
  devicePrivateKey,
  vaultSecret,
} from "./handles.js";
import { randomUuid } from "./ids.js";
import { normalizeRecoveryCodeForInternalUse } from "./recovery.js";
import { currentIsoDateTime, requireUuid } from "./validation.js";
import { validateDevicePublicKeyForInternalUse } from "./device.js";

const AUTHORIZATION_FINGERPRINT_DOMAIN = utf8("UGA2/AUTHORIZATION-PUBLIC-KEY/FINGERPRINT\0");
const RECOVERY_AUTHORIZATION_SEED_DOMAIN = utf8("UGA2/RECOVERY-AUTHORIZATION/SEED\0");
const DEVICE_AUTHORIZATION_SEED_DOMAIN = utf8("UGA2/DEVICE-AUTHORIZATION/SEED\0");
const PAYLOAD_HASH_DOMAIN = utf8("UGA2/PAYLOAD/HASH\0");
const KEYRING_HASH_DOMAIN = utf8("UGA2/KEYRING/HASH\0");
const AUTHORIZATION_MANIFEST_HASH_DOMAIN = utf8("UGA2/AUTHORIZATION-MANIFEST/HASH\0");
const VAULT_COMMIT_HASH_DOMAIN = utf8("UGA2/VAULT-COMMIT/HASH\0");

function parseOwnerBinding(value: unknown): string {
  const result = OwnerBindingV2Schema.safeParse(value);
  if (!result.success) throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  return result.data;
}

function fingerprintRawAuthorizationKey(sodium: Sodium, publicKey: Uint8Array): string {
  const input = concatenate(AUTHORIZATION_FINGERPRINT_DOMAIN, publicKey);
  let digest: Uint8Array | undefined;
  try {
    digest = sodium.crypto_generichash(32, input, null);
    return encodeBase64Url(sodium, digest);
  } finally {
    sodium.memzero(input);
    if (digest !== undefined) sodium.memzero(digest);
  }
}

export function computeAuthorizationPublicKeyFingerprintV2(sodium: Sodium, encodedPublicKey: string): string {
  const publicKey = decodeBase64UrlExact(sodium, encodedPublicKey, AUTHORIZATION_PUBLIC_KEY_BYTES, "input");
  try {
    return fingerprintRawAuthorizationKey(sodium, publicKey);
  } finally {
    sodium.memzero(publicKey);
  }
}

function createAuthorizationKey(
  sodium: Sodium,
  metadata: {
    readonly kind: "DEVICE" | "RECOVERY";
    readonly ownerBinding: string;
    readonly deviceId: string | null;
    readonly vaultId: string | null;
    readonly keyId: string;
    readonly createdAt: string;
  },
  pair: { readonly publicKey: Uint8Array; readonly privateKey: Uint8Array },
): AuthorizationKeyHandle {
  try {
    if (
      pair.publicKey.length !== AUTHORIZATION_PUBLIC_KEY_BYTES ||
      pair.privateKey.length !== AUTHORIZATION_PRIVATE_KEY_BYTES
    ) {
      throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
    }
    return createAuthorizationHandle(
      sodium,
      {
        ...metadata,
        publicKey: encodeBase64Url(sodium, pair.publicKey),
        fingerprint: fingerprintRawAuthorizationKey(sodium, pair.publicKey),
      },
      pair.privateKey,
    );
  } catch (error) {
    sodium.memzero(pair.privateKey);
    throw error;
  } finally {
    sodium.memzero(pair.publicKey);
  }
}

export function generateAuthorizationKey(
  sodium: Sodium,
  ownerBindingInput: string,
  deviceIdInput: string,
  keyIdInput?: string,
): AuthorizationKeyHandle {
  const ownerBinding = parseOwnerBinding(ownerBindingInput);
  const deviceId = requireUuid(deviceIdInput);
  const keyId = keyIdInput === undefined ? randomUuid(sodium) : requireUuid(keyIdInput);
  return createAuthorizationKey(
    sodium,
    {
      kind: "DEVICE",
      ownerBinding,
      deviceId,
      vaultId: null,
      keyId,
      createdAt: currentIsoDateTime(),
    },
    sodium.crypto_sign_keypair(),
  );
}

export function deriveDeviceAuthorizationKey(
  sodium: Sodium,
  ownerBindingInput: string,
  deviceKey: CreateDeviceDescriptorV2Input["encryptionKey"],
  keyIdInput: string,
): AuthorizationKeyHandle {
  const ownerBinding = parseOwnerBinding(ownerBindingInput);
  const keyId = requireUuid(keyIdInput);
  const validated = validateDevicePublicKeyForInternalUse(sodium, deviceKey.publicKey, "input");
  let ownerBytes: Uint8Array | undefined;
  let seedInput: Uint8Array | undefined;
  let seed: Uint8Array | undefined;
  try {
    ownerBytes = decodeBase64UrlExact(sodium, ownerBinding, 32, "input");
    seedInput = concatenate(
      DEVICE_AUTHORIZATION_SEED_DOMAIN,
      ownerBytes,
      utf8(validated.metadata.deviceId),
      utf8(keyId),
    );
    seed = sodium.crypto_generichash(32, seedInput, devicePrivateKey(deviceKey));
    return createAuthorizationKey(
      sodium,
      {
        kind: "DEVICE",
        ownerBinding,
        deviceId: validated.metadata.deviceId,
        vaultId: null,
        keyId,
        createdAt: currentIsoDateTime(),
      },
      sodium.crypto_sign_seed_keypair(seed),
    );
  } finally {
    sodium.memzero(validated.decoded);
    if (ownerBytes !== undefined) sodium.memzero(ownerBytes);
    if (seedInput !== undefined) sodium.memzero(seedInput);
    if (seed !== undefined) sodium.memzero(seed);
  }
}

export function deriveRecoveryAuthorizationKey(
  sodium: Sodium,
  recoveryCode: string,
  ownerBindingInput: string,
  vaultIdInput: string,
  keyIdInput: string,
): AuthorizationKeyHandle {
  const ownerBinding = parseOwnerBinding(ownerBindingInput);
  const vaultId = requireUuid(vaultIdInput);
  const keyId = requireUuid(keyIdInput);
  const normalized = normalizeRecoveryCodeForInternalUse(recoveryCode, "input");
  let ownerBytes: Uint8Array | undefined;
  let seedInput: Uint8Array | undefined;
  let seed: Uint8Array | undefined;
  try {
    ownerBytes = decodeBase64UrlExact(sodium, ownerBinding, 32, "input");
    seedInput = concatenate(RECOVERY_AUTHORIZATION_SEED_DOMAIN, ownerBytes, utf8(vaultId));
    seed = sodium.crypto_generichash(32, seedInput, normalized.entropy);
    return createAuthorizationKey(
      sodium,
      {
        kind: "RECOVERY",
        ownerBinding,
        deviceId: null,
        vaultId,
        keyId,
        createdAt: currentIsoDateTime(),
      },
      sodium.crypto_sign_seed_keypair(seed),
    );
  } finally {
    sodium.memzero(normalized.entropy);
    if (ownerBytes !== undefined) sodium.memzero(ownerBytes);
    if (seedInput !== undefined) sodium.memzero(seedInput);
    if (seed !== undefined) sodium.memzero(seed);
  }
}

export function createDeviceDescriptorV2(
  sodium: Sodium,
  input: CreateDeviceDescriptorV2Input,
): DeviceDescriptorV2 {
  const ownerBinding = parseOwnerBinding(input.ownerBinding);
  const authorizationKey = input.authorizationKey;
  if (
    authorizationKey.kind !== "DEVICE" ||
    authorizationKey.ownerBinding !== ownerBinding ||
    authorizationKey.deviceId === null ||
    authorizationKey.vaultId !== null
  ) {
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
  authorizationPrivateKey(authorizationKey);
  const encryption = validateDevicePublicKeyForInternalUse(sodium, input.encryptionKey.publicKey, "input");
  try {
    if (encryption.metadata.deviceId !== authorizationKey.deviceId) {
      throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
    }
    return DeviceDescriptorV2Schema.parse({
      formatVersion: 2,
      ownerBinding,
      deviceId: authorizationKey.deviceId,
      encryptionKey: {
        keyId: encryption.metadata.deviceKeyId,
        algorithm: "X25519",
        publicKey: encryption.metadata.publicKey,
        fingerprint: encryption.metadata.publicKeyFingerprint,
      },
      authorizationKey: {
        keyId: authorizationKey.keyId,
        algorithm: "ED25519",
        publicKey: authorizationKey.publicKey,
        fingerprint: authorizationKey.fingerprint,
      },
      createdAt: currentIsoDateTime(),
      revokedAt: null,
    });
  } catch (error) {
    if (error instanceof VaultCryptoError) throw error;
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  } finally {
    sodium.memzero(encryption.decoded);
  }
}

export function createRecoveryAuthorizationPublicKeyV2(
  authorizationKey: AuthorizationKeyHandle,
): RecoveryAuthorizationPublicKeyV2 {
  if (
    authorizationKey.kind !== "RECOVERY" ||
    authorizationKey.deviceId !== null ||
    authorizationKey.vaultId === null
  ) {
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
  authorizationPrivateKey(authorizationKey);
  try {
    return RecoveryAuthorizationPublicKeyV2Schema.parse({
      formatVersion: 2,
      ownerBinding: authorizationKey.ownerBinding,
      vaultId: authorizationKey.vaultId,
      keyId: authorizationKey.keyId,
      algorithm: "ED25519",
      publicKey: authorizationKey.publicKey,
      fingerprint: authorizationKey.fingerprint,
      createdAt: authorizationKey.createdAt,
      revokedAt: null,
    });
  } catch {
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
}

function validatedAuthorizationPublicKey(
  sodium: Sodium,
  candidate: DeviceAuthorizationPublicKeyV2 | RecoveryAuthorizationPublicKeyV2,
): Uint8Array {
  let parsed: DeviceAuthorizationPublicKeyV2 | RecoveryAuthorizationPublicKeyV2;
  const recovery = RecoveryAuthorizationPublicKeyV2Schema.safeParse(candidate);
  if (recovery.success) {
    parsed = recovery.data;
  } else {
    const device = DeviceAuthorizationPublicKeyV2Schema.safeParse(candidate);
    if (!device.success) throw authenticationFailed();
    parsed = device.data;
  }
  const publicKey = decodeBase64UrlExact(sodium, parsed.publicKey, AUTHORIZATION_PUBLIC_KEY_BYTES);
  if (fingerprintRawAuthorizationKey(sodium, publicKey) !== parsed.fingerprint) {
    sodium.memzero(publicKey);
    throw authenticationFailed();
  }
  return publicKey;
}

function signerMatchesHandle(
  handle: AuthorizationKeyHandle,
  value: {
    readonly ownerBinding: string;
    readonly vaultId: string;
    readonly signer: {
      readonly kind: "DEVICE" | "RECOVERY";
      readonly keyId: string;
      readonly deviceId: string | null;
    };
  },
): boolean {
  return (
    handle.ownerBinding === value.ownerBinding &&
    handle.keyId === value.signer.keyId &&
    handle.kind === value.signer.kind &&
    handle.deviceId === value.signer.deviceId &&
    (handle.kind === "DEVICE" ? handle.vaultId === null : handle.vaultId === value.vaultId)
  );
}

function signCanonicalBytes(sodium: Sodium, handle: AuthorizationKeyHandle, encodedBytes: string): string {
  let message: Uint8Array | undefined;
  let signature: Uint8Array | undefined;
  try {
    message = decodeBase64UrlBounded(sodium, encodedBytes, 1, 4_096);
    signature = sodium.crypto_sign_detached(message, authorizationPrivateKey(handle));
    if (signature.length !== AUTHORIZATION_SIGNATURE_BYTES) {
      throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
    }
    return encodeBase64Url(sodium, signature);
  } finally {
    if (message !== undefined) sodium.memzero(message);
    if (signature !== undefined) sodium.memzero(signature);
  }
}

function verifyCanonicalSignature(
  sodium: Sodium,
  publicKeyValue: DeviceAuthorizationPublicKeyV2 | RecoveryAuthorizationPublicKeyV2,
  signatureValue: string,
  encodedBytes: string,
): boolean {
  let publicKey: Uint8Array | undefined;
  let signature: Uint8Array | undefined;
  let message: Uint8Array | undefined;
  try {
    publicKey = validatedAuthorizationPublicKey(sodium, publicKeyValue);
    signature = decodeBase64UrlExact(sodium, signatureValue, AUTHORIZATION_SIGNATURE_BYTES);
    message = decodeBase64UrlBounded(sodium, encodedBytes, 1, 4_096);
    return sodium.crypto_sign_verify_detached(signature, message, publicKey);
  } catch {
    return false;
  } finally {
    if (publicKey !== undefined) sodium.memzero(publicKey);
    if (signature !== undefined) sodium.memzero(signature);
    if (message !== undefined) sodium.memzero(message);
  }
}

export function computeRootKeyStateMac(sodium: Sodium, input: RootKeyStateMacInput): string {
  const commit = VaultCommitCanonicalInputV2Schema.parse(input.commit);
  if (commit.vaultId !== input.vaultKey.vaultId) {
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
  let bytes: Uint8Array | undefined;
  let mac: Uint8Array | undefined;
  try {
    bytes = decodeBase64UrlBounded(sodium, buildVaultCommitMacBytesV2(commit), 1, 4_096);
    mac = sodium.crypto_generichash(32, bytes, vaultSecret(input.vaultKey));
    return encodeBase64Url(sodium, mac);
  } catch (error) {
    if (error instanceof VaultCryptoError) throw error;
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  } finally {
    if (bytes !== undefined) sodium.memzero(bytes);
    if (mac !== undefined) sodium.memzero(mac);
  }
}

export function verifyRootKeyStateMac(
  sodium: Sodium,
  vaultKey: RootKeyStateMacInput["vaultKey"],
  candidate: VaultCommitV2,
): boolean {
  try {
    const commit = VaultCommitV2Schema.parse(candidate);
    const canonicalCommit = {
      formatVersion: commit.formatVersion,
      ownerBinding: commit.ownerBinding,
      vaultId: commit.vaultId,
      epoch: commit.epoch,
      sequence: commit.sequence,
      parentCommitHash: commit.parentCommitHash,
      payloadHash: commit.payloadHash,
      keyringHash: commit.keyringHash,
      authorizationManifestHash: commit.authorizationManifestHash,
      operationId: commit.operationId,
      author: commit.author,
      createdAt: commit.createdAt,
    } as const;
    const expected = computeRootKeyStateMac(sodium, { vaultKey, commit: canonicalCommit });
    const expectedBytes = decodeBase64UrlExact(sodium, expected, 32);
    const actualBytes = decodeBase64UrlExact(sodium, commit.stateMac, 32);
    try {
      return sodium.memcmp(expectedBytes, actualBytes);
    } finally {
      sodium.memzero(expectedBytes);
      sodium.memzero(actualBytes);
    }
  } catch {
    return false;
  }
}

export function signVaultCommit(sodium: Sodium, input: SignVaultCommitInput): VaultCommitV2 {
  try {
    const commit = VaultCommitCanonicalInputV2Schema.parse(input.commit);
    if (
      !signerMatchesHandle(input.authorizationKey, {
        ownerBinding: commit.ownerBinding,
        vaultId: commit.vaultId,
        signer: commit.author,
      })
    ) {
      throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
    }
    const stateMac = computeRootKeyStateMac(sodium, {
      vaultKey: input.vaultKey,
      commit,
    });
    const signature = signCanonicalBytes(
      sodium,
      input.authorizationKey,
      buildVaultCommitSigningBytesV2(commit),
    );
    return VaultCommitV2Schema.parse({ ...commit, stateMac, signature });
  } catch (error) {
    if (error instanceof VaultCryptoError) throw error;
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
}

export function verifyVaultCommitSignature(
  sodium: Sodium,
  commitValue: VaultCommitV2,
  publicKey: DeviceAuthorizationPublicKeyV2 | RecoveryAuthorizationPublicKeyV2,
): boolean {
  const result = VaultCommitV2Schema.safeParse(commitValue);
  if (!result.success) return false;
  return verifyCanonicalSignature(
    sodium,
    publicKey,
    result.data.signature,
    buildVaultCommitSigningBytesV2(result.data),
  );
}

export function signVaultCommandProof(
  sodium: Sodium,
  input: SignVaultCommandProofInput,
): VaultCommandProofV2 {
  try {
    const proof = VaultCommandProofCanonicalInputV2Schema.parse(input.proof);
    if (
      !signerMatchesHandle(input.authorizationKey, {
        ownerBinding: proof.ownerBinding,
        vaultId: proof.vaultId,
        signer: proof.signer,
      })
    ) {
      throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
    }
    return VaultCommandProofV2Schema.parse({
      ...proof,
      signature: signCanonicalBytes(sodium, input.authorizationKey, buildVaultCommandProofBytesV2(proof)),
    });
  } catch (error) {
    if (error instanceof VaultCryptoError) throw error;
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
}

export function verifyVaultCommandProof(
  sodium: Sodium,
  proofValue: VaultCommandProofV2,
  publicKey: DeviceAuthorizationPublicKeyV2 | RecoveryAuthorizationPublicKeyV2,
): boolean {
  const result = VaultCommandProofV2Schema.safeParse(proofValue);
  if (!result.success) return false;
  return verifyCanonicalSignature(
    sodium,
    publicKey,
    result.data.signature,
    buildVaultCommandProofBytesV2(result.data),
  );
}

export function signVaultReadProof(sodium: Sodium, input: SignVaultReadProofInput): VaultReadProofV2 {
  try {
    const proof = VaultReadProofCanonicalInputV2Schema.parse(input.proof);
    if (
      !signerMatchesHandle(input.authorizationKey, {
        ownerBinding: proof.ownerBinding,
        vaultId: proof.vaultId,
        signer: proof.signer,
      })
    ) {
      throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
    }
    return VaultReadProofV2Schema.parse({
      ...proof,
      signature: signCanonicalBytes(sodium, input.authorizationKey, buildVaultReadProofBytesV2(proof)),
    });
  } catch (error) {
    if (error instanceof VaultCryptoError) throw error;
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
}

export function verifyVaultReadProof(
  sodium: Sodium,
  proofValue: VaultReadProofV2,
  publicKey: DeviceAuthorizationPublicKeyV2 | RecoveryAuthorizationPublicKeyV2,
): boolean {
  const result = VaultReadProofV2Schema.safeParse(proofValue);
  if (!result.success) return false;
  return verifyCanonicalSignature(
    sodium,
    publicKey,
    result.data.signature,
    buildVaultReadProofBytesV2(result.data),
  );
}

export function signDevicePairingRequest(
  sodium: Sodium,
  authorizationKey: AuthorizationKeyHandle,
  requestValue: Parameters<typeof DevicePairingRequestCanonicalInputV2Schema.parse>[0],
): DevicePairingRequestV2 {
  try {
    const request = DevicePairingRequestCanonicalInputV2Schema.parse(requestValue);
    if (
      authorizationKey.kind !== "DEVICE" ||
      authorizationKey.ownerBinding !== request.ownerBinding ||
      authorizationKey.deviceId !== request.requestingDevice.deviceId ||
      authorizationKey.keyId !== request.requestingDevice.authorizationKey.keyId ||
      authorizationKey.publicKey !== request.requestingDevice.authorizationKey.publicKey ||
      authorizationKey.fingerprint !== request.requestingDevice.authorizationKey.fingerprint
    ) {
      throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
    }
    return DevicePairingRequestV2Schema.parse({
      ...request,
      signature: signCanonicalBytes(sodium, authorizationKey, buildDevicePairingRequestBytesV2(request)),
    });
  } catch (error) {
    if (error instanceof VaultCryptoError) throw error;
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
}

export function verifyDevicePairingRequest(sodium: Sodium, requestValue: DevicePairingRequestV2): boolean {
  const result = DevicePairingRequestV2Schema.safeParse(requestValue);
  if (!result.success) return false;
  return verifyCanonicalSignature(
    sodium,
    result.data.requestingDevice.authorizationKey,
    result.data.signature,
    buildDevicePairingRequestBytesV2(result.data),
  );
}

function hashCanonicalArtifact(sodium: Sodium, domain: Uint8Array, value: object): string {
  let serialized: Uint8Array | undefined;
  let input: Uint8Array | undefined;
  let digest: Uint8Array | undefined;
  try {
    serialized = utf8(JSON.stringify(value));
    input = concatenate(domain, serialized);
    digest = sodium.crypto_generichash(32, input, null);
    return encodeBase64Url(sodium, digest);
  } finally {
    if (serialized !== undefined) sodium.memzero(serialized);
    if (input !== undefined) sodium.memzero(input);
    if (digest !== undefined) sodium.memzero(digest);
  }
}

export function hashVaultPayloadV2(sodium: Sodium, value: EncryptedVaultPayloadEnvelopeV2): string {
  return hashCanonicalArtifact(
    sodium,
    PAYLOAD_HASH_DOMAIN,
    EncryptedVaultPayloadEnvelopeV2Schema.parse(value),
  );
}

export function hashVaultKeyringV1(sodium: Sodium, value: VaultKeyringV1): string {
  return hashCanonicalArtifact(sodium, KEYRING_HASH_DOMAIN, VaultKeyringV1Schema.parse(value));
}

export function hashAuthorizationManifestV2(sodium: Sodium, value: AuthorizationManifestV2): string {
  return hashCanonicalArtifact(
    sodium,
    AUTHORIZATION_MANIFEST_HASH_DOMAIN,
    AuthorizationManifestV2Schema.parse(value),
  );
}

export function computeVaultCommitHash(sodium: Sodium, value: VaultCommitV2): string {
  return hashCanonicalArtifact(sodium, VAULT_COMMIT_HASH_DOMAIN, VaultCommitV2Schema.parse(value));
}
