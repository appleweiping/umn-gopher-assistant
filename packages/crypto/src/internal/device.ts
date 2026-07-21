import type { DeviceKeyEnvelopeV1, DeviceKeyHandle, DevicePublicKeyV1, VaultKeyHandle } from "../types.js";
import type { Sodium } from "./sodium.js";

import { buildDeviceEnvelopeHeaderV1 } from "@umn-gopher-assistant/contracts";

import {
  DEVICE_BINDING_TAG_BYTES,
  DEVICE_KEY_BYTES,
  DEVICE_WRAPPED_KEY_BYTES,
  VAULT_KEY_BYTES,
  XCHACHA_NONCE_BYTES,
} from "../constants.js";
import { authenticationFailed, cryptoError, VaultCryptoError, VaultCryptoErrorCode } from "../errors.js";
import {
  concatenate,
  decodeBase64UrlBounded,
  decodeBase64UrlExact,
  encodeBase64Url,
  utf8,
} from "./encoding.js";
import { createDeviceHandle, createVaultHandle, devicePrivateKey, vaultSecret } from "./handles.js";
import { randomUuid } from "./ids.js";
import {
  currentIsoDateTime,
  requireExactKeys,
  requireIsoDateTime,
  requirePlainObject,
  requireUuid,
} from "./validation.js";

const FINGERPRINT_DOMAIN = utf8("UGA1/DEVICE-PUBLIC-KEY/FINGERPRINT\0");
const DEVICE_BINDING_DOMAIN = utf8("UGA1/DEVICE-ENVELOPE/BINDING\0");

function publicKeyFingerprint(sodium: Sodium, publicKey: Uint8Array): string {
  const input = concatenate(FINGERPRINT_DOMAIN, publicKey);
  let digest: Uint8Array | undefined;
  try {
    digest = sodium.crypto_generichash(32, input, null);
    return encodeBase64Url(sodium, digest);
  } finally {
    sodium.memzero(input);
    if (digest !== undefined) sodium.memzero(digest);
  }
}

/**
 * Validates a public descriptor while keeping its decoded bytes inside the
 * crypto package. Browser trusted-device persistence uses this to bind a
 * local private-key envelope to the verified descriptor.
 */
export function validateDevicePublicKeyForInternalUse(
  sodium: Sodium,
  candidate: DevicePublicKeyV1,
  mode: "input" | "authentication",
): { readonly metadata: DevicePublicKeyV1; readonly decoded: Uint8Array } {
  const fail = (): never => {
    throw mode === "authentication"
      ? authenticationFailed()
      : cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  };
  let decoded: Uint8Array | undefined;
  try {
    const record = requirePlainObject(candidate);
    requireExactKeys(record, [
      "createdAt",
      "deviceId",
      "deviceKeyId",
      "formatVersion",
      "keyAlgorithm",
      "publicKey",
      "publicKeyFingerprint",
      "revokedAt",
    ]);
    if (
      record["formatVersion"] !== 1 ||
      record["keyAlgorithm"] !== "X25519" ||
      (record["revokedAt"] !== null && typeof record["revokedAt"] !== "string")
    ) {
      fail();
    }
    const createdAt = requireIsoDateTime(record["createdAt"]);
    const revokedAt = record["revokedAt"] === null ? null : requireIsoDateTime(record["revokedAt"]);
    if (revokedAt !== null && Date.parse(revokedAt) < Date.parse(createdAt)) fail();
    decoded = decodeBase64UrlExact(sodium, record["publicKey"], DEVICE_KEY_BYTES, mode);
    const probeScalar = sodium.randombytes_buf(DEVICE_KEY_BYTES);
    let sharedPoint: Uint8Array | undefined;
    try {
      sharedPoint = sodium.crypto_scalarmult(probeScalar, decoded);
      if (sodium.is_zero(sharedPoint)) fail();
    } catch {
      fail();
    } finally {
      sodium.memzero(probeScalar);
      if (sharedPoint !== undefined) sodium.memzero(sharedPoint);
    }
    const fingerprint = publicKeyFingerprint(sodium, decoded);
    if (fingerprint !== record["publicKeyFingerprint"]) fail();
    return {
      metadata: {
        formatVersion: 1,
        deviceId: requireUuid(record["deviceId"]),
        deviceKeyId: requireUuid(record["deviceKeyId"]),
        keyAlgorithm: "X25519",
        publicKey: record["publicKey"] as string,
        publicKeyFingerprint: fingerprint,
        createdAt,
        revokedAt,
      },
      decoded,
    };
  } catch {
    if (decoded !== undefined) sodium.memzero(decoded);
    fail();
  }
  throw new Error("unreachable");
}

function deviceBindingAad(sodium: Sodium, envelope: Omit<DeviceKeyEnvelopeV1, "wrappedKey">): Uint8Array {
  const header = decodeBase64UrlBounded(sodium, buildDeviceEnvelopeHeaderV1(envelope), 1, 4_096);
  try {
    return concatenate(DEVICE_BINDING_DOMAIN, header);
  } finally {
    sodium.memzero(header);
  }
}

function authenticateDeviceEnvelope(candidate: DeviceKeyEnvelopeV1): Omit<DeviceKeyEnvelopeV1, "wrappedKey"> {
  try {
    const record = requirePlainObject(candidate);
    requireExactKeys(record, [
      "cipherSuite",
      "createdAt",
      "ephemeralPublicKey",
      "formatVersion",
      "nonce",
      "recipientDeviceId",
      "recipientKeyId",
      "recipientPublicKeyFingerprint",
      "vaultId",
      "vaultKeyId",
      "wrappedKey",
    ]);
    if (record["formatVersion"] !== 1 || record["cipherSuite"] !== "X25519_XCHACHA20_POLY1305") {
      throw authenticationFailed();
    }
    return {
      formatVersion: 1,
      vaultId: requireUuid(record["vaultId"]),
      vaultKeyId: requireUuid(record["vaultKeyId"]),
      recipientDeviceId: requireUuid(record["recipientDeviceId"]),
      recipientKeyId: requireUuid(record["recipientKeyId"]),
      recipientPublicKeyFingerprint: record["recipientPublicKeyFingerprint"] as string,
      cipherSuite: "X25519_XCHACHA20_POLY1305",
      ephemeralPublicKey: record["ephemeralPublicKey"] as string,
      nonce: record["nonce"] as string,
      createdAt: requireIsoDateTime(record["createdAt"]),
    };
  } catch {
    throw authenticationFailed();
  }
}

export function generateDeviceKey(sodium: Sodium, deviceId: string, deviceKeyId?: string): DeviceKeyHandle {
  const checkedDeviceId = requireUuid(deviceId);
  const checkedKeyId = deviceKeyId === undefined ? randomUuid(sodium) : requireUuid(deviceKeyId);
  const pair = sodium.crypto_box_curve25519xchacha20poly1305_keypair();
  try {
    const createdAt = currentIsoDateTime();
    const encodedPublicKey = encodeBase64Url(sodium, pair.publicKey);
    return createDeviceHandle(
      sodium,
      {
        formatVersion: 1,
        deviceId: checkedDeviceId,
        deviceKeyId: checkedKeyId,
        keyAlgorithm: "X25519",
        publicKey: encodedPublicKey,
        publicKeyFingerprint: publicKeyFingerprint(sodium, pair.publicKey),
        createdAt,
        revokedAt: null,
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

export function wrapVaultKeyForDevice(
  sodium: Sodium,
  key: VaultKeyHandle,
  recipient: DevicePublicKeyV1,
): DeviceKeyEnvelopeV1 {
  const secret = vaultSecret(key);
  const validated = validateDevicePublicKeyForInternalUse(sodium, recipient, "input");
  if (validated.metadata.revokedAt !== null) {
    sodium.memzero(validated.decoded);
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
  let ephemeral:
    | { readonly publicKey: Uint8Array; readonly privateKey: Uint8Array; readonly keyType: string }
    | undefined;
  let nonce: Uint8Array | undefined;
  let aad: Uint8Array | undefined;
  let bindingTag: Uint8Array | undefined;
  let plaintext: Uint8Array | undefined;
  let wrapped: Uint8Array | undefined;
  try {
    ephemeral = sodium.crypto_box_curve25519xchacha20poly1305_keypair();
    nonce = sodium.randombytes_buf(XCHACHA_NONCE_BYTES);
    const header = {
      formatVersion: 1 as const,
      vaultId: requireUuid(key.vaultId),
      vaultKeyId: requireUuid(key.vaultKeyId),
      recipientDeviceId: validated.metadata.deviceId,
      recipientKeyId: validated.metadata.deviceKeyId,
      recipientPublicKeyFingerprint: validated.metadata.publicKeyFingerprint,
      cipherSuite: "X25519_XCHACHA20_POLY1305" as const,
      ephemeralPublicKey: encodeBase64Url(sodium, ephemeral.publicKey),
      nonce: encodeBase64Url(sodium, nonce),
      createdAt: currentIsoDateTime(),
    };
    aad = deviceBindingAad(sodium, header);
    bindingTag = sodium.crypto_generichash(DEVICE_BINDING_TAG_BYTES, aad, secret);
    plaintext = concatenate(secret, bindingTag);
    wrapped = sodium.crypto_box_curve25519xchacha20poly1305_easy(
      plaintext,
      nonce,
      validated.decoded,
      ephemeral.privateKey,
    );
    if (wrapped.length !== DEVICE_WRAPPED_KEY_BYTES) {
      throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
    }
    return { ...header, wrappedKey: encodeBase64Url(sodium, wrapped) };
  } catch (error) {
    if (error instanceof VaultCryptoError) throw error;
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  } finally {
    sodium.memzero(validated.decoded);
    if (ephemeral !== undefined) {
      sodium.memzero(ephemeral.publicKey);
      sodium.memzero(ephemeral.privateKey);
    }
    if (nonce !== undefined) sodium.memzero(nonce);
    if (aad !== undefined) sodium.memzero(aad);
    if (bindingTag !== undefined) sodium.memzero(bindingTag);
    if (plaintext !== undefined) sodium.memzero(plaintext);
    if (wrapped !== undefined) sodium.memzero(wrapped);
  }
}

export function unwrapVaultKeyForDevice(
  sodium: Sodium,
  deviceKey: DeviceKeyHandle,
  envelope: DeviceKeyEnvelopeV1,
): VaultKeyHandle {
  const privateKey = devicePrivateKey(deviceKey);
  let ephemeralPublicKey: Uint8Array | undefined;
  let nonce: Uint8Array | undefined;
  let wrapped: Uint8Array | undefined;
  let plaintext: Uint8Array | undefined;
  let aad: Uint8Array | undefined;
  let expectedTag: Uint8Array | undefined;
  try {
    const header = authenticateDeviceEnvelope(envelope);
    if (
      header.recipientDeviceId !== deviceKey.publicKey.deviceId ||
      header.recipientKeyId !== deviceKey.publicKey.deviceKeyId ||
      header.recipientPublicKeyFingerprint !== deviceKey.publicKey.publicKeyFingerprint
    ) {
      throw authenticationFailed();
    }
    ephemeralPublicKey = decodeBase64UrlExact(sodium, header.ephemeralPublicKey, DEVICE_KEY_BYTES);
    nonce = decodeBase64UrlExact(sodium, header.nonce, XCHACHA_NONCE_BYTES);
    wrapped = decodeBase64UrlExact(sodium, envelope.wrappedKey, DEVICE_WRAPPED_KEY_BYTES);
    try {
      plaintext = sodium.crypto_box_curve25519xchacha20poly1305_open_easy(
        wrapped,
        nonce,
        ephemeralPublicKey,
        privateKey,
      );
    } catch {
      throw authenticationFailed();
    }
    if (plaintext.length !== VAULT_KEY_BYTES + DEVICE_BINDING_TAG_BYTES) {
      throw authenticationFailed();
    }
    const secret = plaintext.slice(0, VAULT_KEY_BYTES);
    const actualTag = plaintext.subarray(VAULT_KEY_BYTES);
    aad = deviceBindingAad(sodium, header);
    expectedTag = sodium.crypto_generichash(DEVICE_BINDING_TAG_BYTES, aad, secret);
    if (!sodium.memcmp(actualTag, expectedTag)) {
      sodium.memzero(secret);
      throw authenticationFailed();
    }
    return createVaultHandle(sodium, header.vaultId, header.vaultKeyId, secret);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === VaultCryptoErrorCode.DESTROYED_KEY) {
      throw error;
    }
    throw authenticationFailed();
  } finally {
    if (ephemeralPublicKey !== undefined) sodium.memzero(ephemeralPublicKey);
    if (nonce !== undefined) sodium.memzero(nonce);
    if (wrapped !== undefined) sodium.memzero(wrapped);
    if (plaintext !== undefined) sodium.memzero(plaintext);
    if (aad !== undefined) sodium.memzero(aad);
    if (expectedTag !== undefined) sodium.memzero(expectedTag);
  }
}
