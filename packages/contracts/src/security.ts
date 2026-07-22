import { z } from "zod";

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const XCHACHA20_POLY1305_TAG_BYTES = 16;

export const VAULT_PADDING_BLOCK_BYTES = 4_096;
export const VAULT_MAX_PADDED_PLAINTEXT_BYTES = 8 * 1_024 * 1_024;
export const VAULT_MAX_CIPHERTEXT_BYTES = VAULT_MAX_PADDED_PLAINTEXT_BYTES + XCHACHA20_POLY1305_TAG_BYTES;
export const VAULT_MAX_AAD_BYTES = 4_096;
export const VAULT_MAX_DEVICE_ENVELOPES = 32;

export const PAYLOAD_AAD_V1_DOMAIN = "UGA1/PAYLOAD/AAD";
export const RECOVERY_AAD_V1_DOMAIN = "UGA1/RECOVERY/AAD";
export const DEVICE_ENVELOPE_HEADER_V1_DOMAIN = "UGA1/DEVICE-ENVELOPE/HEADER";

export interface PayloadAadV1Input {
  readonly formatVersion: 1;
  readonly vaultId: string;
  readonly vaultKeyId: string;
  readonly revision: number;
  readonly baseRevision: number | null;
  readonly cipherSuite: "XCHACHA20_POLY1305";
  readonly contentType: "application/vnd.umn-gopher-assistant.personal-vault+json";
  readonly contentSchemaVersion: 1;
  readonly padding: {
    readonly algorithm: "SODIUM_PAD";
    readonly blockSize: 4_096;
  };
  readonly nonce: string;
  readonly createdAt: string;
}

export interface RecoveryAadV1Input {
  readonly formatVersion: 1;
  readonly vaultId: string;
  readonly vaultKeyId: string;
  readonly cipherSuite: "XCHACHA20_POLY1305";
  readonly kdf: {
    readonly algorithm: "ARGON2ID13";
    readonly salt: string;
    readonly opsLimit: number;
    readonly memLimitBytes: number;
    readonly outputBytes: 32;
  };
  readonly nonce: string;
  readonly createdAt: string;
}

export interface DeviceEnvelopeHeaderV1Input {
  readonly formatVersion: 1;
  readonly vaultId: string;
  readonly vaultKeyId: string;
  readonly recipientDeviceId: string;
  readonly recipientKeyId: string;
  readonly recipientPublicKeyFingerprint: string;
  readonly cipherSuite: "X25519_XCHACHA20_POLY1305";
  readonly ephemeralPublicKey: string;
  readonly nonce: string;
  readonly createdAt: string;
}

function encodedCharacterLength(byteLength: number): number {
  return Math.ceil((byteLength * 8) / 6);
}

function encodeAsciiBase64Url(value: string): string {
  let encoded = "";
  for (let offset = 0; offset < value.length; offset += 3) {
    const first = value.charCodeAt(offset);
    const hasSecond = offset + 1 < value.length;
    const hasThird = offset + 2 < value.length;
    const second = hasSecond ? value.charCodeAt(offset + 1) : 0;
    const third = hasThird ? value.charCodeAt(offset + 2) : 0;

    if (first > 0x7f || second > 0x7f || third > 0x7f) {
      throw new TypeError("Canonical E2EE metadata must contain ASCII characters only");
    }

    const triplet = (first << 16) | (second << 8) | third;
    encoded += BASE64URL_ALPHABET.charAt((triplet >>> 18) & 0x3f);
    encoded += BASE64URL_ALPHABET.charAt((triplet >>> 12) & 0x3f);
    if (hasSecond) {
      encoded += BASE64URL_ALPHABET.charAt((triplet >>> 6) & 0x3f);
    }
    if (hasThird) {
      encoded += BASE64URL_ALPHABET.charAt(triplet & 0x3f);
    }
  }
  return encoded;
}

function encodeCanonicalAad(domain: string, fields: readonly unknown[]): string {
  return encodeAsciiBase64Url(JSON.stringify([domain, ...fields]));
}

/**
 * Returns the canonical payload AAD bytes encoded as unpadded base64url.
 * The decoded bytes are the ASCII JSON array specified by ADR 0002.
 */
export function buildPayloadAadV1(value: PayloadAadV1Input): string {
  return encodeCanonicalAad(PAYLOAD_AAD_V1_DOMAIN, [
    value.formatVersion,
    value.vaultId,
    value.vaultKeyId,
    value.revision,
    value.baseRevision,
    value.cipherSuite,
    value.contentType,
    value.contentSchemaVersion,
    value.padding.algorithm,
    value.padding.blockSize,
    value.nonce,
    value.createdAt,
  ]);
}

/**
 * Returns the canonical recovery AAD bytes encoded as unpadded base64url.
 * The decoded bytes are the ASCII JSON array specified by ADR 0002.
 */
export function buildRecoveryAadV1(value: RecoveryAadV1Input): string {
  return encodeCanonicalAad(RECOVERY_AAD_V1_DOMAIN, [
    value.formatVersion,
    value.vaultId,
    value.vaultKeyId,
    value.cipherSuite,
    value.kdf.algorithm,
    value.kdf.salt,
    value.kdf.opsLimit,
    value.kdf.memLimitBytes,
    value.kdf.outputBytes,
    value.nonce,
    value.createdAt,
  ]);
}

/**
 * Returns the canonical device-envelope binding header encoded as unpadded
 * base64url. The decoded ASCII bytes are input to the keyed binding tag.
 */
export function buildDeviceEnvelopeHeaderV1(value: DeviceEnvelopeHeaderV1Input): string {
  return encodeCanonicalAad(DEVICE_ENVELOPE_HEADER_V1_DOMAIN, [
    value.formatVersion,
    value.vaultId,
    value.vaultKeyId,
    value.recipientDeviceId,
    value.recipientKeyId,
    value.recipientPublicKeyFingerprint,
    value.cipherSuite,
    value.ephemeralPublicKey,
    value.nonce,
    value.createdAt,
  ]);
}

function canonicalDecodedByteLength(value: string): number | null {
  const remainder = value.length % 4;
  if (remainder === 1 || !BASE64URL_PATTERN.test(value)) {
    return null;
  }

  const finalValue = BASE64URL_ALPHABET.indexOf(value.at(-1) ?? "");
  if (finalValue < 0) {
    return null;
  }
  if (remainder === 2 && (finalValue & 0b1111) !== 0) {
    return null;
  }
  if (remainder === 3 && (finalValue & 0b11) !== 0) {
    return null;
  }

  return Math.floor((value.length * 6) / 8);
}

function exactEncodedBytes(byteLength: number, label: string) {
  const characterLength = encodedCharacterLength(byteLength);
  return z
    .string()
    .length(characterLength, `${label} must be ${String(characterLength)} base64url characters`)
    .pipe(
      z
        .string()
        .refine(
          (value) => canonicalDecodedByteLength(value) === byteLength,
          `${label} must be canonical unpadded base64url encoding exactly ${String(byteLength)} bytes`,
        ),
    );
}

function boundedEncodedBytes(minBytes: number, maxBytes: number, label: string) {
  const minCharacters = encodedCharacterLength(minBytes);
  const maxCharacters = encodedCharacterLength(maxBytes);
  return z
    .string()
    .min(minCharacters, `${label} is too short`)
    .max(maxCharacters, `${label} exceeds the encoded size limit`)
    .pipe(
      z.string().refine((value) => {
        const byteLength = canonicalDecodedByteLength(value);
        return byteLength !== null && byteLength >= minBytes && byteLength <= maxBytes;
      }, `${label} must be canonical unpadded base64url within the byte-size limit`),
    );
}

// Security metadata is authenticated byte-for-byte. Accepting alternate UUID
// casing or timestamp offsets creates multiple serialized identities for the
// same logical value and disagrees with the crypto runtime's canonical parser.
const UuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    "Expected a canonical lowercase UUID",
  );
const CanonicalIsoDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u, "Expected UTC time with milliseconds")
  .refine(
    (value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
    "Expected a canonical UTC timestamp",
  );
const RevisionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const X25519PublicKeySchema = exactEncodedBytes(32, "X25519 public key");
const PublicKeyFingerprintSchema = exactEncodedBytes(32, "public-key fingerprint");
const XChaCha20NonceSchema = exactEncodedBytes(24, "XChaCha20-Poly1305 nonce");
const DeviceWrappedKeySchema = exactEncodedBytes(80, "device-wrapped vault key");
const RecoveryWrappedKeySchema = exactEncodedBytes(48, "recovery-wrapped vault key");
const Argon2idSaltSchema = exactEncodedBytes(16, "Argon2id salt");
const AadSchema = boundedEncodedBytes(1, VAULT_MAX_AAD_BYTES, "authenticated data");
const PayloadCiphertextSchema = boundedEncodedBytes(
  VAULT_PADDING_BLOCK_BYTES + XCHACHA20_POLY1305_TAG_BYTES,
  VAULT_MAX_CIPHERTEXT_BYTES,
  "vault ciphertext",
).refine((value) => {
  const byteLength = canonicalDecodedByteLength(value);
  return byteLength !== null && (byteLength - XCHACHA20_POLY1305_TAG_BYTES) % VAULT_PADDING_BLOCK_BYTES === 0;
}, "vault ciphertext must contain a complete 4 KiB padded payload and authentication tag");

export const DevicePublicKeyV1Schema = z
  .object({
    formatVersion: z.literal(1),
    deviceId: UuidSchema,
    deviceKeyId: UuidSchema,
    keyAlgorithm: z.literal("X25519"),
    publicKey: X25519PublicKeySchema,
    publicKeyFingerprint: PublicKeyFingerprintSchema,
    createdAt: CanonicalIsoDateTimeSchema,
    revokedAt: CanonicalIsoDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.revokedAt !== null && Date.parse(value.revokedAt) < Date.parse(value.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["revokedAt"],
        message: "revokedAt must not precede createdAt",
      });
    }
  });
export type DevicePublicKeyV1 = z.infer<typeof DevicePublicKeyV1Schema>;

export const DeviceKeyEnvelopeV1Schema = z
  .object({
    formatVersion: z.literal(1),
    vaultId: UuidSchema,
    vaultKeyId: UuidSchema,
    recipientDeviceId: UuidSchema,
    recipientKeyId: UuidSchema,
    recipientPublicKeyFingerprint: PublicKeyFingerprintSchema,
    cipherSuite: z.literal("X25519_XCHACHA20_POLY1305"),
    ephemeralPublicKey: X25519PublicKeySchema,
    nonce: XChaCha20NonceSchema,
    wrappedKey: DeviceWrappedKeySchema,
    createdAt: CanonicalIsoDateTimeSchema,
  })
  .strict();
export type DeviceKeyEnvelopeV1 = z.infer<typeof DeviceKeyEnvelopeV1Schema>;

export const Argon2idParametersV1Schema = z
  .object({
    algorithm: z.literal("ARGON2ID13"),
    salt: Argon2idSaltSchema,
    opsLimit: z.number().int().min(2).max(4),
    memLimitBytes: z
      .number()
      .int()
      .min(64 * 1_024 * 1_024)
      .max(256 * 1_024 * 1_024),
    outputBytes: z.literal(32),
  })
  .strict();
export type Argon2idParametersV1 = z.infer<typeof Argon2idParametersV1Schema>;

export const RecoveryKeyEnvelopeV1Schema = z
  .object({
    formatVersion: z.literal(1),
    vaultId: UuidSchema,
    vaultKeyId: UuidSchema,
    cipherSuite: z.literal("XCHACHA20_POLY1305"),
    kdf: Argon2idParametersV1Schema,
    nonce: XChaCha20NonceSchema,
    wrappedKey: RecoveryWrappedKeySchema,
    aad: AadSchema,
    createdAt: CanonicalIsoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.aad !== buildRecoveryAadV1(value)) {
      context.addIssue({
        code: "custom",
        path: ["aad"],
        message: "aad must exactly match the canonical v1 recovery metadata",
      });
    }
  });
export type RecoveryKeyEnvelopeV1 = z.infer<typeof RecoveryKeyEnvelopeV1Schema>;

export const VaultPayloadPaddingV1Schema = z
  .object({
    algorithm: z.literal("SODIUM_PAD"),
    blockSize: z.literal(VAULT_PADDING_BLOCK_BYTES),
  })
  .strict();
export type VaultPayloadPaddingV1 = z.infer<typeof VaultPayloadPaddingV1Schema>;

export const EncryptedVaultPayloadEnvelopeV1Schema = z
  .object({
    formatVersion: z.literal(1),
    vaultId: UuidSchema,
    vaultKeyId: UuidSchema,
    revision: RevisionSchema,
    baseRevision: RevisionSchema.nullable(),
    cipherSuite: z.literal("XCHACHA20_POLY1305"),
    contentType: z.literal("application/vnd.umn-gopher-assistant.personal-vault+json"),
    contentSchemaVersion: z.literal(1),
    padding: VaultPayloadPaddingV1Schema,
    nonce: XChaCha20NonceSchema,
    ciphertext: PayloadCiphertextSchema,
    aad: AadSchema,
    createdAt: CanonicalIsoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.baseRevision === null && value.revision !== 1) {
      context.addIssue({
        code: "custom",
        path: ["baseRevision"],
        message: "baseRevision may be null only for revision 1",
      });
    }
    if (value.baseRevision !== null && value.revision !== value.baseRevision + 1) {
      context.addIssue({
        code: "custom",
        path: ["baseRevision"],
        message: "revision must equal baseRevision plus one",
      });
    }
    if (value.aad !== buildPayloadAadV1(value)) {
      context.addIssue({
        code: "custom",
        path: ["aad"],
        message: "aad must exactly match the canonical v1 payload metadata",
      });
    }
  });
export type EncryptedVaultPayloadEnvelopeV1 = z.infer<typeof EncryptedVaultPayloadEnvelopeV1Schema>;

export const VaultKeyringV1Schema = z
  .object({
    formatVersion: z.literal(1),
    vaultId: UuidSchema,
    vaultKeyId: UuidSchema,
    revision: RevisionSchema,
    // New keyrings retain the validated recipient descriptors required to
    // re-wrap a rotated root key. Optionality keeps pre-release local records
    // recoverable when their sole legacy descriptor is the trusted device.
    devicePublicKeys: z.array(DevicePublicKeyV1Schema).min(1).max(VAULT_MAX_DEVICE_ENVELOPES).optional(),
    deviceEnvelopes: z.array(DeviceKeyEnvelopeV1Schema).min(1).max(VAULT_MAX_DEVICE_ENVELOPES),
    recoveryEnvelope: RecoveryKeyEnvelopeV1Schema,
    createdAt: CanonicalIsoDateTimeSchema,
    updatedAt: CanonicalIsoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const recipientDeviceIds = new Set<string>();
    const recipientKeyIds = new Set<string>();

    value.deviceEnvelopes.forEach((envelope, index) => {
      if (envelope.vaultId !== value.vaultId) {
        context.addIssue({
          code: "custom",
          path: ["deviceEnvelopes", index, "vaultId"],
          message: "device envelope vaultId must match keyring vaultId",
        });
      }
      if (envelope.vaultKeyId !== value.vaultKeyId) {
        context.addIssue({
          code: "custom",
          path: ["deviceEnvelopes", index, "vaultKeyId"],
          message: "device envelope vaultKeyId must match keyring vaultKeyId",
        });
      }
      if (recipientDeviceIds.has(envelope.recipientDeviceId)) {
        context.addIssue({
          code: "custom",
          path: ["deviceEnvelopes", index, "recipientDeviceId"],
          message: "recipientDeviceId must be unique within a keyring",
        });
      }
      if (recipientKeyIds.has(envelope.recipientKeyId)) {
        context.addIssue({
          code: "custom",
          path: ["deviceEnvelopes", index, "recipientKeyId"],
          message: "recipientKeyId must be unique within a keyring",
        });
      }
      if (Date.parse(envelope.createdAt) > Date.parse(value.updatedAt)) {
        context.addIssue({
          code: "custom",
          path: ["deviceEnvelopes", index, "createdAt"],
          message: "device envelope createdAt must not follow keyring updatedAt",
        });
      }
      recipientDeviceIds.add(envelope.recipientDeviceId);
      recipientKeyIds.add(envelope.recipientKeyId);
    });

    if (value.devicePublicKeys !== undefined) {
      if (value.devicePublicKeys.length !== value.deviceEnvelopes.length) {
        context.addIssue({
          code: "custom",
          path: ["devicePublicKeys"],
          message: "devicePublicKeys must correspond one-to-one with deviceEnvelopes",
        });
      }
      value.devicePublicKeys.forEach((publicKey, index) => {
        const envelope = value.deviceEnvelopes[index];
        if (
          envelope === undefined ||
          envelope.recipientDeviceId !== publicKey.deviceId ||
          envelope.recipientKeyId !== publicKey.deviceKeyId ||
          envelope.recipientPublicKeyFingerprint !== publicKey.publicKeyFingerprint
        ) {
          context.addIssue({
            code: "custom",
            path: ["devicePublicKeys", index],
            message: "device public key identity must match its device envelope",
          });
        }
        if (publicKey.revokedAt !== null) {
          context.addIssue({
            code: "custom",
            path: ["devicePublicKeys", index, "revokedAt"],
            message: "a keyring recipient must not be revoked",
          });
        }
      });
    }

    if (value.recoveryEnvelope.vaultId !== value.vaultId) {
      context.addIssue({
        code: "custom",
        path: ["recoveryEnvelope", "vaultId"],
        message: "recovery envelope vaultId must match keyring vaultId",
      });
    }
    if (value.recoveryEnvelope.vaultKeyId !== value.vaultKeyId) {
      context.addIssue({
        code: "custom",
        path: ["recoveryEnvelope", "vaultKeyId"],
        message: "recovery envelope vaultKeyId must match keyring vaultKeyId",
      });
    }
    if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "updatedAt must not precede createdAt",
      });
    }
    if (Date.parse(value.recoveryEnvelope.createdAt) > Date.parse(value.updatedAt)) {
      context.addIssue({
        code: "custom",
        path: ["recoveryEnvelope", "createdAt"],
        message: "recovery envelope createdAt must not follow keyring updatedAt",
      });
    }
  });
export type VaultKeyringV1 = z.infer<typeof VaultKeyringV1Schema>;

// The pre-v1 names were never released. Keep import compatibility while making
// every caller use the reviewed v1 wire shape and fixed XChaCha20 suite.
export const DeviceKeyEnvelopeSchema = DeviceKeyEnvelopeV1Schema;
export type DeviceKeyEnvelope = DeviceKeyEnvelopeV1;
export const EncryptedVaultEnvelopeSchema = EncryptedVaultPayloadEnvelopeV1Schema;
export type EncryptedVaultEnvelope = EncryptedVaultPayloadEnvelopeV1;
