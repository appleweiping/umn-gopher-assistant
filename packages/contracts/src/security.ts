import { z } from "zod";

import { Base64UrlSchema, IsoDateTimeSchema } from "./common.js";

function hasDecodedByteLength(value: string, expectedLength: number): boolean {
  let bufferedBits = 0;
  let bufferedValue = 0;
  let byteLength = 0;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  for (const character of value) {
    const encoded = alphabet.indexOf(character);
    if (encoded < 0) {
      return false;
    }
    bufferedValue = (bufferedValue << 6) | encoded;
    bufferedBits += 6;
    while (bufferedBits >= 8) {
      bufferedBits -= 8;
      byteLength += 1;
      bufferedValue &= (1 << bufferedBits) - 1;
    }
  }
  return byteLength === expectedLength && (bufferedBits === 0 || bufferedValue === 0);
}

const encodedBytes = (length: number, label: string) =>
  Base64UrlSchema.refine(
    (value) => hasDecodedByteLength(value, length),
    `${label} must decode to ${String(length)} bytes`,
  );

const X25519PublicKeySchema = encodedBytes(32, "X25519 public key");
const XChaCha20NonceSchema = encodedBytes(24, "XChaCha20-Poly1305 nonce");
const AesGcmNonceSchema = encodedBytes(12, "AES-GCM nonce");

export const DeviceKeyEnvelopeSchema = z
  .object({
    deviceId: z.string().min(1).max(256),
    keyId: z.string().min(1).max(256),
    algorithm: z.literal("X25519_XCHACHA20_POLY1305"),
    ephemeralPublicKey: X25519PublicKeySchema,
    wrappedKey: Base64UrlSchema,
    nonce: XChaCha20NonceSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export type DeviceKeyEnvelope = z.infer<typeof DeviceKeyEnvelopeSchema>;

const EncryptedVaultEnvelopeBaseSchema = z.object({
  version: z.literal(1),
  keyId: z.string().min(1).max(256),
  ciphertext: Base64UrlSchema,
  aad: Base64UrlSchema,
  deviceEnvelopes: z.array(DeviceKeyEnvelopeSchema).min(1),
  createdAt: IsoDateTimeSchema,
});

export const EncryptedVaultEnvelopeSchema = z.discriminatedUnion("algorithm", [
  EncryptedVaultEnvelopeBaseSchema.extend({
    algorithm: z.literal("XCHACHA20_POLY1305"),
    nonce: XChaCha20NonceSchema,
  }).strict(),
  EncryptedVaultEnvelopeBaseSchema.extend({
    algorithm: z.literal("AES_256_GCM"),
    nonce: AesGcmNonceSchema,
  }).strict(),
]);
export type EncryptedVaultEnvelope = z.infer<typeof EncryptedVaultEnvelopeSchema>;
