import { z } from "zod";

import { Base64UrlSchema, IsoDateTimeSchema } from "./common.js";

export const DeviceKeyEnvelopeSchema = z
  .object({
    deviceId: z.string().min(1).max(256),
    keyId: z.string().min(1).max(256),
    algorithm: z.literal("X25519_XCHACHA20_POLY1305"),
    ephemeralPublicKey: Base64UrlSchema,
    wrappedKey: Base64UrlSchema,
    nonce: Base64UrlSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export type DeviceKeyEnvelope = z.infer<typeof DeviceKeyEnvelopeSchema>;

export const EncryptedVaultEnvelopeSchema = z
  .object({
    version: z.literal(1),
    algorithm: z.enum(["XCHACHA20_POLY1305", "AES_256_GCM"]),
    keyId: z.string().min(1).max(256),
    ciphertext: Base64UrlSchema,
    nonce: Base64UrlSchema,
    aad: Base64UrlSchema,
    deviceEnvelopes: z.array(DeviceKeyEnvelopeSchema).min(1),
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export type EncryptedVaultEnvelope = z.infer<typeof EncryptedVaultEnvelopeSchema>;
