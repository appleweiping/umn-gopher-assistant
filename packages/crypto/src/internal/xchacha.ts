import type { Sodium } from "./sodium.js";

import { XCHACHA_NONCE_BYTES, XCHACHA_TAG_BYTES, VAULT_KEY_BYTES } from "../constants.js";
import { authenticationFailed, cryptoError, VaultCryptoErrorCode } from "../errors.js";

export function sealXChaCha(
  sodium: Sodium,
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  if (key.length !== VAULT_KEY_BYTES || nonce.length !== XCHACHA_NONCE_BYTES) {
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
  return sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, aad, null, nonce, key);
}

export function openXChaCha(
  sodium: Sodium,
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  if (
    key.length !== VAULT_KEY_BYTES ||
    nonce.length !== XCHACHA_NONCE_BYTES ||
    ciphertext.length < XCHACHA_TAG_BYTES
  ) {
    throw authenticationFailed();
  }
  try {
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, aad, nonce, key);
  } catch {
    throw authenticationFailed();
  }
}
