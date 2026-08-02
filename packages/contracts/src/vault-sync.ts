import { z } from "zod";

import {
  VAULT_MAX_AAD_BYTES,
  VAULT_MAX_CIPHERTEXT_BYTES,
  VAULT_MAX_DEVICE_ENVELOPES,
  VAULT_PADDING_BLOCK_BYTES,
  VaultKeyringV1Schema,
} from "./security.js";

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const XCHACHA20_POLY1305_TAG_BYTES = 16;
const MAX_COMMAND_LIFETIME_MS = 10 * 60 * 1_000;

export const PAYLOAD_AAD_V2_DOMAIN = "UGA2/PAYLOAD/AAD";
export const VAULT_COMMIT_SIGNATURE_V2_DOMAIN = "UGA2/VAULT-COMMIT/SIGNATURE";
export const VAULT_COMMIT_STATE_MAC_V2_DOMAIN = "UGA2/VAULT-COMMIT/STATE-MAC";
export const VAULT_COMMAND_PROOF_V2_DOMAIN = "UGA2/VAULT-COMMAND/PROOF";
export const VAULT_READ_PROOF_V2_DOMAIN = "UGA2/VAULT-READ/PROOF";
export const DEVICE_PAIRING_REQUEST_V2_DOMAIN = "UGA2/DEVICE-PAIRING/REQUEST";

function encodedCharacterLength(byteLength: number): number {
  return Math.ceil((byteLength * 8) / 6);
}

function canonicalDecodedByteLength(value: string): number | null {
  const remainder = value.length % 4;
  if (remainder === 1 || !BASE64URL_PATTERN.test(value)) return null;
  const finalValue = BASE64URL_ALPHABET.indexOf(value.at(-1) ?? "");
  if (finalValue < 0) return null;
  if (remainder === 2 && (finalValue & 0b1111) !== 0) return null;
  if (remainder === 3 && (finalValue & 0b11) !== 0) return null;
  return Math.floor((value.length * 6) / 8);
}

function exactEncodedBytes(byteLength: number, label: string) {
  return z
    .string()
    .length(
      encodedCharacterLength(byteLength),
      `${label} must be ${String(encodedCharacterLength(byteLength))} base64url characters`,
    )
    .refine(
      (value) => canonicalDecodedByteLength(value) === byteLength,
      `${label} must be canonical unpadded base64url encoding exactly ${String(byteLength)} bytes`,
    );
}

function boundedEncodedBytes(minimumBytes: number, maximumBytes: number, label: string) {
  return z
    .string()
    .min(encodedCharacterLength(minimumBytes), `${label} is too short`)
    .max(encodedCharacterLength(maximumBytes), `${label} exceeds the encoded size limit`)
    .refine((value) => {
      const byteLength = canonicalDecodedByteLength(value);
      return byteLength !== null && byteLength >= minimumBytes && byteLength <= maximumBytes;
    }, `${label} must be canonical unpadded base64url within the byte-size limit`);
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
    if (hasSecond) encoded += BASE64URL_ALPHABET.charAt((triplet >>> 6) & 0x3f);
    if (hasThird) encoded += BASE64URL_ALPHABET.charAt(triplet & 0x3f);
  }
  return encoded;
}

function encodeCanonicalTuple(domain: string, fields: readonly unknown[]): string {
  return encodeAsciiBase64Url(JSON.stringify([domain, ...fields]));
}

function decodeAsciiBase64Url(value: string): string {
  if (canonicalDecodedByteLength(value) === null) {
    throw new TypeError("Expected canonical unpadded base64url");
  }
  let decoded = "";
  let accumulator = 0;
  let bits = 0;
  for (const character of value) {
    const sextet = BASE64URL_ALPHABET.indexOf(character);
    if (sextet < 0) throw new TypeError("Expected canonical unpadded base64url");
    accumulator = (accumulator << 6) | sextet;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      const byte = (accumulator >>> bits) & 0xff;
      if (byte > 0x7f) throw new TypeError("Canonical E2EE metadata must be ASCII");
      decoded += String.fromCharCode(byte);
      accumulator &= (1 << bits) - 1;
    }
  }
  return decoded;
}

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
const PositiveSafeIntegerSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const HashSchema = exactEncodedBytes(32, "BLAKE2b-256 hash");
const PublicKeySchema = exactEncodedBytes(32, "public key");
const FingerprintSchema = exactEncodedBytes(32, "public-key fingerprint");
const SignatureSchema = exactEncodedBytes(64, "Ed25519 signature");
const NonceSchema = exactEncodedBytes(24, "XChaCha20-Poly1305 nonce");
const AadSchema = boundedEncodedBytes(1, VAULT_MAX_AAD_BYTES, "authenticated data");
const PayloadCiphertextSchema = boundedEncodedBytes(
  VAULT_PADDING_BLOCK_BYTES + XCHACHA20_POLY1305_TAG_BYTES,
  VAULT_MAX_CIPHERTEXT_BYTES,
  "vault ciphertext",
).refine((value) => {
  const byteLength = canonicalDecodedByteLength(value);
  return byteLength !== null && (byteLength - XCHACHA20_POLY1305_TAG_BYTES) % VAULT_PADDING_BLOCK_BYTES === 0;
}, "vault ciphertext must contain a complete 4 KiB padded payload and authentication tag");

/** Opaque account binding derived and checked by the authenticated account boundary. */
export const OwnerBindingV2Schema = exactEncodedBytes(32, "owner binding");
export type OwnerBindingV2 = z.infer<typeof OwnerBindingV2Schema>;

export const DeviceEncryptionPublicKeyV2Schema = z
  .object({
    keyId: UuidSchema,
    algorithm: z.literal("X25519"),
    publicKey: PublicKeySchema,
    fingerprint: FingerprintSchema,
  })
  .strict();
export type DeviceEncryptionPublicKeyV2 = z.infer<typeof DeviceEncryptionPublicKeyV2Schema>;

export const DeviceAuthorizationPublicKeyV2Schema = z
  .object({
    keyId: UuidSchema,
    algorithm: z.literal("ED25519"),
    publicKey: PublicKeySchema,
    fingerprint: FingerprintSchema,
  })
  .strict();
export type DeviceAuthorizationPublicKeyV2 = z.infer<typeof DeviceAuthorizationPublicKeyV2Schema>;

export const DeviceDescriptorV2Schema = z
  .object({
    formatVersion: z.literal(2),
    ownerBinding: OwnerBindingV2Schema,
    deviceId: UuidSchema,
    encryptionKey: DeviceEncryptionPublicKeyV2Schema,
    authorizationKey: DeviceAuthorizationPublicKeyV2Schema,
    createdAt: CanonicalIsoDateTimeSchema,
    revokedAt: CanonicalIsoDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.encryptionKey.keyId === value.authorizationKey.keyId) {
      context.addIssue({
        code: "custom",
        path: ["authorizationKey", "keyId"],
        message: "encryption and authorization keys must have distinct key IDs",
      });
    }
    if (value.revokedAt !== null && Date.parse(value.revokedAt) < Date.parse(value.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["revokedAt"],
        message: "revokedAt must not precede createdAt",
      });
    }
  });
export type DeviceDescriptorV2 = z.infer<typeof DeviceDescriptorV2Schema>;

export const RecoveryAuthorizationPublicKeyV2Schema = z
  .object({
    formatVersion: z.literal(2),
    ownerBinding: OwnerBindingV2Schema,
    vaultId: UuidSchema,
    keyId: UuidSchema,
    algorithm: z.literal("ED25519"),
    publicKey: PublicKeySchema,
    fingerprint: FingerprintSchema,
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
export type RecoveryAuthorizationPublicKeyV2 = z.infer<typeof RecoveryAuthorizationPublicKeyV2Schema>;

export const AuthorizationManifestV2Schema = z
  .object({
    formatVersion: z.literal(2),
    ownerBinding: OwnerBindingV2Schema,
    vaultId: UuidSchema,
    epoch: PositiveSafeIntegerSchema,
    revision: PositiveSafeIntegerSchema,
    devices: z.array(DeviceDescriptorV2Schema).min(1).max(VAULT_MAX_DEVICE_ENVELOPES),
    recoveryAuthorization: RecoveryAuthorizationPublicKeyV2Schema,
    createdAt: CanonicalIsoDateTimeSchema,
    updatedAt: CanonicalIsoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const deviceIds = new Set<string>();
    const keyIds = new Set<string>();
    let activeDevices = 0;
    value.devices.forEach((device, index) => {
      if (device.ownerBinding !== value.ownerBinding) {
        context.addIssue({
          code: "custom",
          path: ["devices", index, "ownerBinding"],
          message: "device ownerBinding must match manifest ownerBinding",
        });
      }
      if (deviceIds.has(device.deviceId)) {
        context.addIssue({
          code: "custom",
          path: ["devices", index, "deviceId"],
          message: "deviceId must be unique within an authorization manifest",
        });
      }
      for (const [field, keyId] of [
        ["encryptionKey", device.encryptionKey.keyId],
        ["authorizationKey", device.authorizationKey.keyId],
      ] as const) {
        if (keyIds.has(keyId)) {
          context.addIssue({
            code: "custom",
            path: ["devices", index, field, "keyId"],
            message: "every keyId must be unique within an authorization manifest",
          });
        }
        keyIds.add(keyId);
      }
      if (Date.parse(device.createdAt) > Date.parse(value.updatedAt)) {
        context.addIssue({
          code: "custom",
          path: ["devices", index, "createdAt"],
          message: "device createdAt must not follow manifest updatedAt",
        });
      }
      if (device.revokedAt === null) activeDevices += 1;
      deviceIds.add(device.deviceId);
    });
    if (activeDevices === 0) {
      context.addIssue({
        code: "custom",
        path: ["devices"],
        message: "authorization manifest must retain at least one active device",
      });
    }
    if (
      value.recoveryAuthorization.ownerBinding !== value.ownerBinding ||
      value.recoveryAuthorization.vaultId !== value.vaultId
    ) {
      context.addIssue({
        code: "custom",
        path: ["recoveryAuthorization"],
        message: "recovery authorization key must match manifest owner and vault",
      });
    }
    if (keyIds.has(value.recoveryAuthorization.keyId)) {
      context.addIssue({
        code: "custom",
        path: ["recoveryAuthorization", "keyId"],
        message: "recovery authorization keyId must be unique",
      });
    }
    if (value.recoveryAuthorization.revokedAt !== null) {
      context.addIssue({
        code: "custom",
        path: ["recoveryAuthorization", "revokedAt"],
        message: "current recovery authorization key must not be revoked",
      });
    }
    if (
      Date.parse(value.updatedAt) < Date.parse(value.createdAt) ||
      Date.parse(value.recoveryAuthorization.createdAt) > Date.parse(value.updatedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "manifest lifecycle timestamps are inconsistent",
      });
    }
  });
export type AuthorizationManifestV2 = z.infer<typeof AuthorizationManifestV2Schema>;

export interface PayloadAadV2Input {
  readonly formatVersion: 2;
  readonly ownerBinding: string;
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

export function buildPayloadAadV2(value: PayloadAadV2Input): string {
  return encodeCanonicalTuple(PAYLOAD_AAD_V2_DOMAIN, [
    value.formatVersion,
    value.ownerBinding,
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

export const EncryptedVaultPayloadEnvelopeV2Schema = z
  .object({
    formatVersion: z.literal(2),
    ownerBinding: OwnerBindingV2Schema,
    vaultId: UuidSchema,
    vaultKeyId: UuidSchema,
    revision: PositiveSafeIntegerSchema,
    baseRevision: PositiveSafeIntegerSchema.nullable(),
    cipherSuite: z.literal("XCHACHA20_POLY1305"),
    contentType: z.literal("application/vnd.umn-gopher-assistant.personal-vault+json"),
    contentSchemaVersion: z.literal(1),
    padding: z
      .object({
        algorithm: z.literal("SODIUM_PAD"),
        blockSize: z.literal(VAULT_PADDING_BLOCK_BYTES),
      })
      .strict(),
    nonce: NonceSchema,
    ciphertext: PayloadCiphertextSchema,
    aad: AadSchema,
    createdAt: CanonicalIsoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.baseRevision === null && value.revision !== 1) ||
      (value.baseRevision !== null && value.revision !== value.baseRevision + 1)
    ) {
      context.addIssue({
        code: "custom",
        path: ["baseRevision"],
        message: "payload revisions must form a consecutive chain beginning at one",
      });
    }
    if (value.aad !== buildPayloadAadV2(value)) {
      context.addIssue({
        code: "custom",
        path: ["aad"],
        message: "aad must exactly match the canonical account-bound v2 payload metadata",
      });
    }
  });
export type EncryptedVaultPayloadEnvelopeV2 = z.infer<typeof EncryptedVaultPayloadEnvelopeV2Schema>;

export const VaultCommitAuthorV2Schema = z
  .object({
    kind: z.enum(["DEVICE", "RECOVERY"]),
    keyId: UuidSchema,
    deviceId: UuidSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.kind === "DEVICE" && value.deviceId === null) ||
      (value.kind === "RECOVERY" && value.deviceId !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["deviceId"],
        message: "deviceId is required only for a device author",
      });
    }
  });
export type VaultCommitAuthorV2 = z.infer<typeof VaultCommitAuthorV2Schema>;

export interface VaultCommitCanonicalInputV2 {
  readonly formatVersion: 2;
  readonly ownerBinding: string;
  readonly vaultId: string;
  readonly epoch: number;
  readonly sequence: number;
  readonly parentCommitHash: string | null;
  readonly payloadHash: string;
  readonly keyringHash: string;
  readonly authorizationManifestHash: string;
  readonly operationId: string;
  readonly author: VaultCommitAuthorV2;
  readonly createdAt: string;
}

export const VaultCommitCanonicalInputV2Schema = z
  .object({
    formatVersion: z.literal(2),
    ownerBinding: OwnerBindingV2Schema,
    vaultId: UuidSchema,
    epoch: PositiveSafeIntegerSchema,
    sequence: PositiveSafeIntegerSchema,
    parentCommitHash: HashSchema.nullable(),
    payloadHash: HashSchema,
    keyringHash: HashSchema,
    authorizationManifestHash: HashSchema,
    operationId: UuidSchema,
    author: VaultCommitAuthorV2Schema,
    createdAt: CanonicalIsoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const isGenesis = value.epoch === 1 && value.sequence === 1;
    if ((isGenesis && value.parentCommitHash !== null) || (!isGenesis && value.parentCommitHash === null)) {
      context.addIssue({
        code: "custom",
        path: ["parentCommitHash"],
        message: "only the epoch-one sequence-one genesis commit may omit its parent",
      });
    }
  });

function commitCanonicalFields(value: VaultCommitCanonicalInputV2): readonly unknown[] {
  return [
    value.formatVersion,
    value.ownerBinding,
    value.vaultId,
    value.epoch,
    value.sequence,
    value.parentCommitHash,
    value.payloadHash,
    value.keyringHash,
    value.authorizationManifestHash,
    value.operationId,
    value.author.kind,
    value.author.keyId,
    value.author.deviceId,
    value.createdAt,
  ];
}

export function buildVaultCommitSigningBytesV2(value: VaultCommitCanonicalInputV2): string {
  return encodeCanonicalTuple(VAULT_COMMIT_SIGNATURE_V2_DOMAIN, commitCanonicalFields(value));
}

export function buildVaultCommitMacBytesV2(value: VaultCommitCanonicalInputV2): string {
  return encodeCanonicalTuple(VAULT_COMMIT_STATE_MAC_V2_DOMAIN, commitCanonicalFields(value));
}

export const VaultCommitV2Schema = z
  .object({
    formatVersion: z.literal(2),
    ownerBinding: OwnerBindingV2Schema,
    vaultId: UuidSchema,
    epoch: PositiveSafeIntegerSchema,
    sequence: PositiveSafeIntegerSchema,
    parentCommitHash: HashSchema.nullable(),
    payloadHash: HashSchema,
    keyringHash: HashSchema,
    authorizationManifestHash: HashSchema,
    operationId: UuidSchema,
    author: VaultCommitAuthorV2Schema,
    createdAt: CanonicalIsoDateTimeSchema,
    stateMac: HashSchema,
    signature: SignatureSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const isGenesis = value.epoch === 1 && value.sequence === 1;
    if ((isGenesis && value.parentCommitHash !== null) || (!isGenesis && value.parentCommitHash === null)) {
      context.addIssue({
        code: "custom",
        path: ["parentCommitHash"],
        message: "only the epoch-one sequence-one genesis commit may omit its parent",
      });
    }
  });
export type VaultCommitV2 = z.infer<typeof VaultCommitV2Schema>;

export const VaultSyncSnapshotV2Schema = z
  .object({
    formatVersion: z.literal(2),
    ownerBinding: OwnerBindingV2Schema,
    vaultId: UuidSchema,
    commitHash: HashSchema,
    commit: VaultCommitV2Schema,
    payload: EncryptedVaultPayloadEnvelopeV2Schema,
    keyring: VaultKeyringV1Schema,
    authorizationManifest: AuthorizationManifestV2Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.commit.ownerBinding !== value.ownerBinding ||
      value.payload.ownerBinding !== value.ownerBinding ||
      value.authorizationManifest.ownerBinding !== value.ownerBinding
    ) {
      context.addIssue({
        code: "custom",
        path: ["ownerBinding"],
        message: "all snapshot components must use the snapshot ownerBinding",
      });
    }
    if (
      value.commit.vaultId !== value.vaultId ||
      value.payload.vaultId !== value.vaultId ||
      value.keyring.vaultId !== value.vaultId ||
      value.authorizationManifest.vaultId !== value.vaultId
    ) {
      context.addIssue({
        code: "custom",
        path: ["vaultId"],
        message: "all snapshot components must use the snapshot vaultId",
      });
    }
    if (
      value.payload.vaultKeyId !== value.keyring.vaultKeyId ||
      value.commit.epoch !== value.authorizationManifest.epoch
    ) {
      context.addIssue({
        code: "custom",
        path: ["commit"],
        message: "snapshot payload, keyring, manifest, and commit epochs must agree",
      });
    }
    const authorIsAuthorized =
      value.commit.author.kind === "DEVICE"
        ? value.authorizationManifest.devices.some(
            (device) =>
              device.revokedAt === null &&
              device.deviceId === value.commit.author.deviceId &&
              device.authorizationKey.keyId === value.commit.author.keyId,
          )
        : value.authorizationManifest.recoveryAuthorization.keyId === value.commit.author.keyId;
    if (!authorIsAuthorized) {
      context.addIssue({
        code: "custom",
        path: ["commit", "author"],
        message: "commit author must be active in the authorization manifest",
      });
    }
  });
export type VaultSyncSnapshotV2 = z.infer<typeof VaultSyncSnapshotV2Schema>;

export const VaultCommandTypeV2Schema = z.enum([
  "CREATE_VAULT",
  "UPDATE_PAYLOAD",
  "PAIR_DEVICE",
  "ROTATE_KEY",
]);
export type VaultCommandTypeV2 = z.infer<typeof VaultCommandTypeV2Schema>;

export interface VaultCommandProofCanonicalInputV2 {
  readonly formatVersion: 2;
  readonly commandType: VaultCommandTypeV2;
  readonly ownerBinding: string;
  readonly vaultId: string;
  readonly operationId: string;
  readonly expectedParentCommitHash: string | null;
  readonly nextCommitHash: string;
  readonly signer: VaultCommitAuthorV2;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export const VaultCommandProofCanonicalInputV2Schema = z
  .object({
    formatVersion: z.literal(2),
    commandType: VaultCommandTypeV2Schema,
    ownerBinding: OwnerBindingV2Schema,
    vaultId: UuidSchema,
    operationId: UuidSchema,
    expectedParentCommitHash: HashSchema.nullable(),
    nextCommitHash: HashSchema,
    signer: VaultCommitAuthorV2Schema,
    issuedAt: CanonicalIsoDateTimeSchema,
    expiresAt: CanonicalIsoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const lifetime = Date.parse(value.expiresAt) - Date.parse(value.issuedAt);
    if (lifetime <= 0 || lifetime > MAX_COMMAND_LIFETIME_MS) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "command proof lifetime must be positive and no longer than ten minutes",
      });
    }
  });

export function buildVaultCommandProofBytesV2(value: VaultCommandProofCanonicalInputV2): string {
  return encodeCanonicalTuple(VAULT_COMMAND_PROOF_V2_DOMAIN, [
    value.formatVersion,
    value.commandType,
    value.ownerBinding,
    value.vaultId,
    value.operationId,
    value.expectedParentCommitHash,
    value.nextCommitHash,
    value.signer.kind,
    value.signer.keyId,
    value.signer.deviceId,
    value.issuedAt,
    value.expiresAt,
  ]);
}

export const VaultCommandProofV2Schema = z
  .object({
    formatVersion: z.literal(2),
    commandType: VaultCommandTypeV2Schema,
    ownerBinding: OwnerBindingV2Schema,
    vaultId: UuidSchema,
    operationId: UuidSchema,
    expectedParentCommitHash: HashSchema.nullable(),
    nextCommitHash: HashSchema,
    signer: VaultCommitAuthorV2Schema,
    issuedAt: CanonicalIsoDateTimeSchema,
    expiresAt: CanonicalIsoDateTimeSchema,
    signature: SignatureSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const lifetime = Date.parse(value.expiresAt) - Date.parse(value.issuedAt);
    if (lifetime <= 0 || lifetime > MAX_COMMAND_LIFETIME_MS) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "command proof lifetime must be positive and no longer than ten minutes",
      });
    }
  });
export type VaultCommandProofV2 = z.infer<typeof VaultCommandProofV2Schema>;

export interface VaultReadProofCanonicalInputV2 {
  readonly formatVersion: 2;
  readonly ownerBinding: string;
  readonly vaultId: string;
  readonly signer: VaultCommitAuthorV2;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export const VaultReadProofCanonicalInputV2Schema = z
  .object({
    formatVersion: z.literal(2),
    ownerBinding: OwnerBindingV2Schema,
    vaultId: UuidSchema,
    signer: VaultCommitAuthorV2Schema,
    nonce: exactEncodedBytes(32, "read-proof nonce"),
    issuedAt: CanonicalIsoDateTimeSchema,
    expiresAt: CanonicalIsoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const lifetime = Date.parse(value.expiresAt) - Date.parse(value.issuedAt);
    if (lifetime <= 0 || lifetime > 2 * 60 * 1_000) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "read proof lifetime must be positive and no longer than two minutes",
      });
    }
  });

export function buildVaultReadProofBytesV2(value: VaultReadProofCanonicalInputV2): string {
  return encodeCanonicalTuple(VAULT_READ_PROOF_V2_DOMAIN, [
    value.formatVersion,
    value.ownerBinding,
    value.vaultId,
    value.signer.kind,
    value.signer.keyId,
    value.signer.deviceId,
    value.nonce,
    value.issuedAt,
    value.expiresAt,
  ]);
}

export const VaultReadProofV2Schema = z
  .object({
    formatVersion: z.literal(2),
    ownerBinding: OwnerBindingV2Schema,
    vaultId: UuidSchema,
    signer: VaultCommitAuthorV2Schema,
    nonce: exactEncodedBytes(32, "read-proof nonce"),
    issuedAt: CanonicalIsoDateTimeSchema,
    expiresAt: CanonicalIsoDateTimeSchema,
    signature: SignatureSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const lifetime = Date.parse(value.expiresAt) - Date.parse(value.issuedAt);
    if (lifetime <= 0 || lifetime > 2 * 60 * 1_000) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "read proof lifetime must be positive and no longer than two minutes",
      });
    }
  });
export type VaultReadProofV2 = z.infer<typeof VaultReadProofV2Schema>;

/**
 * Encodes the complete strict read proof for the HTTP header. The schema parse
 * supplies the one normative property order; the result is browser-compatible
 * canonical unpadded base64url and contains no Node Buffer dependency.
 */
export function encodeVaultReadProofHeaderV2(value: VaultReadProofV2): string {
  return encodeAsciiBase64Url(JSON.stringify(VaultReadProofV2Schema.parse(value)));
}

/** Decodes a read-proof HTTP header and rejects alternate JSON/property order. */
export function decodeVaultReadProofHeaderV2(value: string): VaultReadProofV2 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeAsciiBase64Url(value));
  } catch {
    throw new TypeError("Invalid canonical vault read-proof header");
  }
  const proof = VaultReadProofV2Schema.parse(parsed);
  if (encodeVaultReadProofHeaderV2(proof) !== value) {
    throw new TypeError("Invalid canonical vault read-proof header");
  }
  return proof;
}

interface CommandBinding {
  readonly commandType: VaultCommandTypeV2;
  readonly ownerBinding: string;
  readonly vaultId: string;
  readonly operationId: string;
  readonly expectedParentCommitHash: string | null;
  readonly nextSnapshot: VaultSyncSnapshotV2;
  readonly proof: VaultCommandProofV2;
}

function validateCommandBinding(value: CommandBinding, context: z.RefinementCtx): void {
  const { proof, nextSnapshot } = value;
  if (
    proof.commandType !== value.commandType ||
    proof.ownerBinding !== value.ownerBinding ||
    proof.vaultId !== value.vaultId ||
    proof.operationId !== value.operationId ||
    proof.expectedParentCommitHash !== value.expectedParentCommitHash ||
    proof.nextCommitHash !== nextSnapshot.commitHash
  ) {
    context.addIssue({
      code: "custom",
      path: ["proof"],
      message: "proof metadata must exactly bind the command and next commit",
    });
  }
  if (
    nextSnapshot.ownerBinding !== value.ownerBinding ||
    nextSnapshot.vaultId !== value.vaultId ||
    nextSnapshot.commit.operationId !== value.operationId ||
    nextSnapshot.commit.parentCommitHash !== value.expectedParentCommitHash
  ) {
    context.addIssue({
      code: "custom",
      path: ["nextSnapshot"],
      message: "next snapshot must exactly bind the command owner, vault, operation, and parent",
    });
  }
  if (
    proof.signer.kind !== nextSnapshot.commit.author.kind ||
    proof.signer.keyId !== nextSnapshot.commit.author.keyId ||
    proof.signer.deviceId !== nextSnapshot.commit.author.deviceId
  ) {
    context.addIssue({
      code: "custom",
      path: ["proof", "signer"],
      message: "command signer must be the next commit author",
    });
  }
}

const CommandBaseShape = {
  formatVersion: z.literal(2),
  ownerBinding: OwnerBindingV2Schema,
  vaultId: UuidSchema,
  operationId: UuidSchema,
  proof: VaultCommandProofV2Schema,
} as const;

export const VaultCreateCommandV2Schema = z
  .object({
    ...CommandBaseShape,
    commandType: z.literal("CREATE_VAULT"),
    snapshot: VaultSyncSnapshotV2Schema,
  })
  .strict()
  .superRefine((value, context) => {
    validateCommandBinding(
      {
        ...value,
        expectedParentCommitHash: null,
        nextSnapshot: value.snapshot,
      },
      context,
    );
    if (
      value.snapshot.commit.epoch !== 1 ||
      value.snapshot.commit.sequence !== 1 ||
      value.snapshot.authorizationManifest.revision !== 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["snapshot"],
        message: "create command must contain a genesis snapshot",
      });
    }
  });
export type VaultCreateCommandV2 = z.infer<typeof VaultCreateCommandV2Schema>;

export const VaultUpdatePayloadCommandV2Schema = z
  .object({
    ...CommandBaseShape,
    commandType: z.literal("UPDATE_PAYLOAD"),
    expectedParentCommitHash: HashSchema,
    nextSnapshot: VaultSyncSnapshotV2Schema,
  })
  .strict()
  .superRefine((value, context) => validateCommandBinding(value, context));
export type VaultUpdatePayloadCommandV2 = z.infer<typeof VaultUpdatePayloadCommandV2Schema>;

export const VaultPairDeviceCommandV2Schema = z
  .object({
    ...CommandBaseShape,
    commandType: z.literal("PAIR_DEVICE"),
    expectedParentCommitHash: HashSchema,
    pairedDevice: DeviceDescriptorV2Schema,
    nextSnapshot: VaultSyncSnapshotV2Schema,
  })
  .strict()
  .superRefine((value, context) => {
    validateCommandBinding(value, context);
    if (
      value.pairedDevice.ownerBinding !== value.ownerBinding ||
      value.pairedDevice.revokedAt !== null ||
      !value.nextSnapshot.authorizationManifest.devices.some(
        (device) =>
          device.deviceId === value.pairedDevice.deviceId &&
          device.encryptionKey.keyId === value.pairedDevice.encryptionKey.keyId &&
          device.authorizationKey.keyId === value.pairedDevice.authorizationKey.keyId,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["pairedDevice"],
        message: "paired device must be active and present in the next manifest",
      });
    }
  });
export type VaultPairDeviceCommandV2 = z.infer<typeof VaultPairDeviceCommandV2Schema>;

export const VaultRotationReasonV2Schema = z.enum([
  "DEVICE_REVOKED",
  "RECOVERY_ROTATED",
  "SCHEDULED",
  "COMPROMISE",
]);
export type VaultRotationReasonV2 = z.infer<typeof VaultRotationReasonV2Schema>;

export const VaultRotateKeyCommandV2Schema = z
  .object({
    ...CommandBaseShape,
    commandType: z.literal("ROTATE_KEY"),
    expectedParentCommitHash: HashSchema,
    reason: VaultRotationReasonV2Schema,
    nextSnapshot: VaultSyncSnapshotV2Schema,
  })
  .strict()
  .superRefine((value, context) => validateCommandBinding(value, context));
export type VaultRotateKeyCommandV2 = z.infer<typeof VaultRotateKeyCommandV2Schema>;

export const VaultMutationCommandV2Schema = z.discriminatedUnion("commandType", [
  VaultCreateCommandV2Schema,
  VaultUpdatePayloadCommandV2Schema,
  VaultPairDeviceCommandV2Schema,
  VaultRotateKeyCommandV2Schema,
]);
export type VaultMutationCommandV2 = z.infer<typeof VaultMutationCommandV2Schema>;

export interface DevicePairingRequestCanonicalInputV2 {
  readonly formatVersion: 2;
  readonly ownerBinding: string;
  readonly vaultId: string;
  readonly operationId: string;
  readonly requestingDevice: DeviceDescriptorV2;
  readonly pairingCodeCommitment: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export const DevicePairingRequestCanonicalInputV2Schema = z
  .object({
    formatVersion: z.literal(2),
    ownerBinding: OwnerBindingV2Schema,
    vaultId: UuidSchema,
    operationId: UuidSchema,
    requestingDevice: DeviceDescriptorV2Schema,
    pairingCodeCommitment: HashSchema,
    issuedAt: CanonicalIsoDateTimeSchema,
    expiresAt: CanonicalIsoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const lifetime = Date.parse(value.expiresAt) - Date.parse(value.issuedAt);
    if (
      value.requestingDevice.ownerBinding !== value.ownerBinding ||
      value.requestingDevice.revokedAt !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["requestingDevice"],
        message: "requesting device must be active and bound to the authenticated owner",
      });
    }
    if (lifetime <= 0 || lifetime > 15 * 60 * 1_000) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "pairing lifetime must be positive and no longer than fifteen minutes",
      });
    }
  });

export function buildDevicePairingRequestBytesV2(value: DevicePairingRequestCanonicalInputV2): string {
  return encodeCanonicalTuple(DEVICE_PAIRING_REQUEST_V2_DOMAIN, [
    value.formatVersion,
    value.ownerBinding,
    value.vaultId,
    value.operationId,
    value.requestingDevice.deviceId,
    value.requestingDevice.encryptionKey.keyId,
    value.requestingDevice.encryptionKey.publicKey,
    value.requestingDevice.encryptionKey.fingerprint,
    value.requestingDevice.authorizationKey.keyId,
    value.requestingDevice.authorizationKey.publicKey,
    value.requestingDevice.authorizationKey.fingerprint,
    value.requestingDevice.createdAt,
    value.pairingCodeCommitment,
    value.issuedAt,
    value.expiresAt,
  ]);
}

export const DevicePairingRequestV2Schema = z
  .object({
    formatVersion: z.literal(2),
    ownerBinding: OwnerBindingV2Schema,
    vaultId: UuidSchema,
    operationId: UuidSchema,
    requestingDevice: DeviceDescriptorV2Schema,
    pairingCodeCommitment: HashSchema,
    issuedAt: CanonicalIsoDateTimeSchema,
    expiresAt: CanonicalIsoDateTimeSchema,
    signature: SignatureSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const lifetime = Date.parse(value.expiresAt) - Date.parse(value.issuedAt);
    if (
      value.requestingDevice.ownerBinding !== value.ownerBinding ||
      value.requestingDevice.revokedAt !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["requestingDevice"],
        message: "requesting device must be active and bound to the authenticated owner",
      });
    }
    if (lifetime <= 0 || lifetime > 15 * 60 * 1_000) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "pairing lifetime must be positive and no longer than fifteen minutes",
      });
    }
  });
export type DevicePairingRequestV2 = z.infer<typeof DevicePairingRequestV2Schema>;

export const PairingApprovalRequestV2Schema = z
  .object({
    pairingCodeCommitment: HashSchema,
    command: VaultPairDeviceCommandV2Schema,
  })
  .strict();
export type PairingApprovalRequestV2 = z.infer<typeof PairingApprovalRequestV2Schema>;

export const PairingStateV2Schema = z.enum(["pending", "approved", "consumed", "expired", "cancelled"]);
export type PairingStateV2 = z.infer<typeof PairingStateV2Schema>;

export const DevicePairingViewV2Schema = z
  .object({
    id: UuidSchema,
    vaultId: UuidSchema,
    requestingDevice: DeviceDescriptorV2Schema,
    state: PairingStateV2Schema,
    expiresAt: CanonicalIsoDateTimeSchema,
    createdAt: CanonicalIsoDateTimeSchema,
    updatedAt: CanonicalIsoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      Date.parse(value.updatedAt) < Date.parse(value.createdAt) ||
      Date.parse(value.expiresAt) < Date.parse(value.createdAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "pairing lifecycle timestamps are inconsistent",
      });
    }
  });
export type DevicePairingViewV2 = z.infer<typeof DevicePairingViewV2Schema>;
