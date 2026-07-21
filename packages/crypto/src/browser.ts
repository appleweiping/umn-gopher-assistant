import type { DeviceKeyHandle, DevicePublicKeyV1 } from "./types.js";

import { DEVICE_KEY_BYTES } from "./constants.js";
import { authenticationFailed, cryptoError, VaultCryptoError, VaultCryptoErrorCode } from "./errors.js";
import { validateDevicePublicKeyForInternalUse } from "./internal/device.js";
import { decodeBase64UrlExact, encodeBase64Url, utf8 } from "./internal/encoding.js";
import { createDeviceHandle, devicePrivateKey } from "./internal/handles.js";
import { initializeSodium } from "./internal/sodium.js";
import { requireExactKeys, requirePlainObject, requireUuid } from "./internal/validation.js";

const BROWSER_DEVICE_KEY_ENVELOPE_VERSION = 1 as const;
const BROWSER_DEVICE_KEY_ENVELOPE_CIPHER = "AES_256_GCM" as const;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const BROWSER_DEVICE_KEY_AAD_DOMAIN = "UGA1/BROWSER-DEVICE-KEY/ENVELOPE";

/**
 * A serializable local envelope for an X25519 device private key.
 *
 * The associated data binds this exact version and cipher suite to the device
 * descriptor. `wrappingKey` is deliberately not part of this record: callers
 * persist its non-extractable `CryptoKey` directly using IndexedDB structured
 * cloning, never as JWK or raw bytes.
 */
export interface BrowserDeviceKeyEnvelopeV1 {
  readonly formatVersion: typeof BROWSER_DEVICE_KEY_ENVELOPE_VERSION;
  readonly cipherSuite: typeof BROWSER_DEVICE_KEY_ENVELOPE_CIPHER;
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly publicKeyFingerprint: string;
  /** Fresh, exact 96-bit AES-GCM IV encoded as unpadded base64url. */
  readonly iv: string;
  /** AES-GCM ciphertext of the 32-byte X25519 private scalar, including its 128-bit tag. */
  readonly ciphertext: string;
}

export interface SealBrowserDeviceKeyInput {
  readonly deviceKey: DeviceKeyHandle;
  /** A non-extractable AES-256-GCM key with exactly encrypt and decrypt usages. */
  readonly wrappingKey: CryptoKey;
}

export interface OpenBrowserDeviceKeyInput {
  readonly publicKey: DevicePublicKeyV1;
  /** The persisted non-extractable AES-256-GCM key from the same browser origin. */
  readonly wrappingKey: CryptoKey;
  readonly envelope: BrowserDeviceKeyEnvelopeV1;
}

interface AuthenticatedBrowserDeviceKeyEnvelope {
  readonly formatVersion: typeof BROWSER_DEVICE_KEY_ENVELOPE_VERSION;
  readonly cipherSuite: typeof BROWSER_DEVICE_KEY_ENVELOPE_CIPHER;
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly publicKeyFingerprint: string;
  readonly iv: string;
  readonly ciphertext: string;
}

function browserCrypto(): Crypto {
  // The DOM lib declares `crypto` as always present, but browser capability
  // detection must still safely handle runtimes where it is absent.
  const candidate = (globalThis as { readonly crypto?: Crypto }).crypto;
  if (candidate?.subtle === undefined) {
    throw cryptoError(VaultCryptoErrorCode.UNSUPPORTED_FORMAT);
  }
  return candidate;
}

/** Returns whether this runtime exposes the WebCrypto primitives required by this entry point. */
export function supportsBrowserDeviceKeyEnvelope(): boolean {
  return (globalThis as { readonly crypto?: Crypto }).crypto?.subtle !== undefined;
}

/** Creates the origin-bound key which is persisted through IndexedDB structured clone. */
export async function createBrowserDeviceWrappingKey(): Promise<CryptoKey> {
  const crypto = browserCrypto();
  try {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    assertBrowserDeviceWrappingKey(key);
    return key;
  } catch (error) {
    if (error instanceof VaultCryptoError) throw error;
    throw cryptoError(VaultCryptoErrorCode.UNSUPPORTED_FORMAT);
  }
}

/**
 * Re-validates a key loaded from IndexedDB before it is used. This detects a
 * substitute extractable key or an incompatible WebCrypto algorithm without
 * ever exporting the key material.
 */
export function assertBrowserDeviceWrappingKey(key: unknown): asserts key is CryptoKey {
  if (!(key instanceof CryptoKey)) {
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
  const algorithm = key.algorithm;
  const usages = key.usages;
  if (
    key.type !== "secret" ||
    key.extractable ||
    algorithm.name !== "AES-GCM" ||
    (algorithm as AesKeyAlgorithm).length !== 256 ||
    usages.length !== 2 ||
    !usages.includes("encrypt") ||
    !usages.includes("decrypt")
  ) {
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
}

function envelopeAad(
  value: Pick<
    AuthenticatedBrowserDeviceKeyEnvelope,
    "formatVersion" | "cipherSuite" | "deviceId" | "deviceKeyId" | "publicKeyFingerprint"
  >,
): Uint8Array {
  return utf8(
    JSON.stringify([
      BROWSER_DEVICE_KEY_AAD_DOMAIN,
      value.formatVersion,
      value.cipherSuite,
      value.deviceId,
      value.deviceKeyId,
      value.publicKeyFingerprint,
    ]),
  );
}

/** DOM's BufferSource typing deliberately excludes SharedArrayBuffer-backed views. */
function webCryptoBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value);
}

function authenticateEnvelope(
  sodium: Awaited<ReturnType<typeof initializeSodium>>,
  candidate: BrowserDeviceKeyEnvelopeV1,
): AuthenticatedBrowserDeviceKeyEnvelope {
  try {
    const record = requirePlainObject(candidate);
    requireExactKeys(record, [
      "cipherSuite",
      "ciphertext",
      "deviceId",
      "deviceKeyId",
      "formatVersion",
      "iv",
      "publicKeyFingerprint",
    ]);
    if (
      record["formatVersion"] !== BROWSER_DEVICE_KEY_ENVELOPE_VERSION ||
      record["cipherSuite"] !== BROWSER_DEVICE_KEY_ENVELOPE_CIPHER
    ) {
      throw authenticationFailed();
    }
    const fingerprint = record["publicKeyFingerprint"] as string;
    const fingerprintBytes = decodeBase64UrlExact(sodium, fingerprint, DEVICE_KEY_BYTES);
    try {
      return {
        formatVersion: BROWSER_DEVICE_KEY_ENVELOPE_VERSION,
        cipherSuite: BROWSER_DEVICE_KEY_ENVELOPE_CIPHER,
        deviceId: requireUuid(record["deviceId"]),
        deviceKeyId: requireUuid(record["deviceKeyId"]),
        publicKeyFingerprint: fingerprint,
        iv: record["iv"] as string,
        ciphertext: record["ciphertext"] as string,
      };
    } finally {
      sodium.memzero(fingerprintBytes);
    }
  } catch {
    throw authenticationFailed();
  }
}

function assertDeviceKeyPair(
  sodium: Awaited<ReturnType<typeof initializeSodium>>,
  deviceKey: DeviceKeyHandle,
): void {
  const descriptor = validateDevicePublicKeyForInternalUse(sodium, deviceKey.publicKey, "input");
  let derivedPublicKey: Uint8Array | undefined;
  try {
    derivedPublicKey = sodium.crypto_scalarmult_base(devicePrivateKey(deviceKey));
    if (!sodium.memcmp(derivedPublicKey, descriptor.decoded)) {
      throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
    }
  } finally {
    sodium.memzero(descriptor.decoded);
    if (derivedPublicKey !== undefined) sodium.memzero(derivedPublicKey);
  }
}

/**
 * Encrypts the opaque device handle's private scalar without exposing it to an
 * application caller. The result is safe to store beside the descriptor and
 * non-extractable CryptoKey in IndexedDB.
 */
export async function sealBrowserDeviceKey(
  input: SealBrowserDeviceKeyInput,
): Promise<BrowserDeviceKeyEnvelopeV1> {
  const crypto = browserCrypto();
  assertBrowserDeviceWrappingKey(input.wrappingKey);
  const sodium = await initializeSodium();
  assertDeviceKeyPair(sodium, input.deviceKey);
  const descriptor = input.deviceKey.publicKey;
  let iv: Uint8Array | undefined;
  let aad: Uint8Array | undefined;
  let ciphertext: Uint8Array | undefined;
  let privateKeyForCrypto: Uint8Array<ArrayBuffer> | undefined;
  try {
    iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
    const metadata: Omit<BrowserDeviceKeyEnvelopeV1, "iv" | "ciphertext"> = {
      formatVersion: BROWSER_DEVICE_KEY_ENVELOPE_VERSION,
      cipherSuite: BROWSER_DEVICE_KEY_ENVELOPE_CIPHER,
      deviceId: descriptor.deviceId,
      deviceKeyId: descriptor.deviceKeyId,
      publicKeyFingerprint: descriptor.publicKeyFingerprint,
    };
    aad = envelopeAad(metadata);
    privateKeyForCrypto = webCryptoBytes(devicePrivateKey(input.deviceKey));
    ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: webCryptoBytes(iv),
          additionalData: webCryptoBytes(aad),
          tagLength: 128,
        },
        input.wrappingKey,
        privateKeyForCrypto,
      ),
    );
    if (ciphertext.length !== DEVICE_KEY_BYTES + AES_GCM_TAG_BYTES) {
      throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
    }
    return {
      ...metadata,
      iv: encodeBase64Url(sodium, iv),
      ciphertext: encodeBase64Url(sodium, ciphertext),
    };
  } catch (error) {
    if (error instanceof VaultCryptoError) throw error;
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  } finally {
    if (iv !== undefined) sodium.memzero(iv);
    if (aad !== undefined) sodium.memzero(aad);
    if (ciphertext !== undefined) sodium.memzero(ciphertext);
    if (privateKeyForCrypto !== undefined) sodium.memzero(privateKeyForCrypto);
  }
}

/**
 * Opens and validates a local envelope entirely inside the crypto package.
 * Any malformed/tampered envelope and any private/public mismatch is reported
 * as the same authentication failure; raw private-key bytes never leave here.
 */
export async function openBrowserDeviceKey(input: OpenBrowserDeviceKeyInput): Promise<DeviceKeyHandle> {
  const crypto = browserCrypto();
  assertBrowserDeviceWrappingKey(input.wrappingKey);
  const sodium = await initializeSodium();
  let validatedPublic: ReturnType<typeof validateDevicePublicKeyForInternalUse> | undefined;
  let iv: Uint8Array | undefined;
  let ciphertext: Uint8Array | undefined;
  let aad: Uint8Array | undefined;
  let privateKey: Uint8Array | undefined;
  let derivedPublicKey: Uint8Array | undefined;
  let ivForCrypto: Uint8Array<ArrayBuffer> | undefined;
  let aadForCrypto: Uint8Array<ArrayBuffer> | undefined;
  let ciphertextForCrypto: Uint8Array<ArrayBuffer> | undefined;
  try {
    const envelope = authenticateEnvelope(sodium, input.envelope);
    validatedPublic = validateDevicePublicKeyForInternalUse(sodium, input.publicKey, "authentication");
    if (
      envelope.deviceId !== validatedPublic.metadata.deviceId ||
      envelope.deviceKeyId !== validatedPublic.metadata.deviceKeyId ||
      envelope.publicKeyFingerprint !== validatedPublic.metadata.publicKeyFingerprint
    ) {
      throw authenticationFailed();
    }
    iv = decodeBase64UrlExact(sodium, envelope.iv, AES_GCM_IV_BYTES);
    ciphertext = decodeBase64UrlExact(sodium, envelope.ciphertext, DEVICE_KEY_BYTES + AES_GCM_TAG_BYTES);
    aad = envelopeAad(envelope);
    ivForCrypto = webCryptoBytes(iv);
    aadForCrypto = webCryptoBytes(aad);
    ciphertextForCrypto = webCryptoBytes(ciphertext);
    try {
      privateKey = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: ivForCrypto, additionalData: aadForCrypto, tagLength: 128 },
          input.wrappingKey,
          ciphertextForCrypto,
        ),
      );
    } catch {
      throw authenticationFailed();
    }
    if (privateKey.length !== DEVICE_KEY_BYTES) throw authenticationFailed();
    derivedPublicKey = sodium.crypto_scalarmult_base(privateKey);
    if (!sodium.memcmp(derivedPublicKey, validatedPublic.decoded)) {
      throw authenticationFailed();
    }
    const handlePrivateKey = privateKey;
    privateKey = undefined;
    return createDeviceHandle(sodium, validatedPublic.metadata, handlePrivateKey);
  } catch (error) {
    if (error instanceof VaultCryptoError && error.code === VaultCryptoErrorCode.INVALID_INPUT) {
      throw authenticationFailed();
    }
    if (error instanceof VaultCryptoError) throw error;
    throw authenticationFailed();
  } finally {
    if (validatedPublic !== undefined) sodium.memzero(validatedPublic.decoded);
    if (iv !== undefined) sodium.memzero(iv);
    if (ciphertext !== undefined) sodium.memzero(ciphertext);
    if (aad !== undefined) sodium.memzero(aad);
    if (privateKey !== undefined) sodium.memzero(privateKey);
    if (derivedPublicKey !== undefined) sodium.memzero(derivedPublicKey);
    if (ivForCrypto !== undefined) sodium.memzero(ivForCrypto);
    if (aadForCrypto !== undefined) sodium.memzero(aadForCrypto);
    if (ciphertextForCrypto !== undefined) sodium.memzero(ciphertextForCrypto);
  }
}
