export const VAULT_KEY_BYTES = 32;
export const DEVICE_KEY_BYTES = 32;
export const AUTHORIZATION_PUBLIC_KEY_BYTES = 32;
export const AUTHORIZATION_PRIVATE_KEY_BYTES = 64;
export const AUTHORIZATION_SIGNATURE_BYTES = 64;
export const XCHACHA_NONCE_BYTES = 24;
export const XCHACHA_TAG_BYTES = 16;
export const DEVICE_BINDING_TAG_BYTES = 32;
export const DEVICE_WRAPPED_KEY_BYTES = 80;
export const RECOVERY_WRAPPED_KEY_BYTES = 48;
export const RECOVERY_SALT_BYTES = 16;
export const RECOVERY_KEY_BYTES = 32;
export const RECOVERY_ENTROPY_BYTES = 20;
export const RECOVERY_MAX_CODE_INPUT_CHARACTERS = 128;
export const VAULT_PADDING_BLOCK_BYTES = 4_096;
export const VAULT_MAX_PADDED_PLAINTEXT_BYTES = 8 * 1_024 * 1_024;
export const VAULT_MAX_PLAINTEXT_BYTES = VAULT_MAX_PADDED_PLAINTEXT_BYTES - VAULT_PADDING_BLOCK_BYTES;
export const VAULT_MAX_CIPHERTEXT_BYTES = VAULT_MAX_PADDED_PLAINTEXT_BYTES + XCHACHA_TAG_BYTES;
export const VAULT_MAX_AAD_BYTES = 4_096;
export const VAULT_MAX_DEVICE_ENVELOPES = 32;

export const RECOVERY_OPS_LIMIT = 3;
// A random 160-bit recovery secret does not need a desktop-only 256 MiB
// default. 64 MiB remains deliberately expensive while working on mobile
// browsers; imports may retain stronger envelopes up to the bounded maximum.
export const RECOVERY_MEM_LIMIT_BYTES = 64 * 1_024 * 1_024;
export const RECOVERY_MAX_OPS_LIMIT = 4;
export const RECOVERY_MAX_MEM_LIMIT_BYTES = 256 * 1_024 * 1_024;

export const PERSONAL_VAULT_CONTENT_TYPE = "application/vnd.umn-gopher-assistant.personal-vault+json";
