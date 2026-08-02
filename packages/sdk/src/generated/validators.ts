/**
 * Generated from openapi/openapi.yaml. DO NOT EDIT.
 * Run `pnpm --filter @umn-gopher-assistant/sdk generate` after contract changes.
 */

import { z } from "zod";

import { operationDefinitions } from "./operations.js";
import type { OperationId } from "./operations.js";

export const successValidatorContractSha256 =
  "7b70d2d0f8a949814c099353c98dbc71d07f011c3c88e9168e84fdb82d162271";

type ImplementedOperationId = {
  [Id in OperationId]: (typeof operationDefinitions)[Id]["runtimeStatus"] extends "implemented" ? Id : never;
}[OperationId];

const implementedSuccessSchemas = {
  approvePersonalVaultDevicePairing: {
    "200": z
      .object({
        authorizationManifest: z
          .object({
            createdAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            devices: z
              .array(
                z
                  .object({
                    authorizationKey: z
                      .object({
                        algorithm: z.literal("ED25519"),
                        fingerprint: z
                          .string()
                          .min(43)
                          .max(43)
                          .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                        keyId: z
                          .string()
                          .min(36)
                          .max(36)
                          .regex(
                            new RegExp(
                              "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                            ),
                          ),
                        publicKey: z
                          .string()
                          .min(43)
                          .max(43)
                          .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      })
                      .strict(),
                    createdAt: z.iso
                      .datetime({ offset: true })
                      .min(24)
                      .max(24)
                      .regex(
                        new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                      ),
                    deviceId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    encryptionKey: z
                      .object({
                        algorithm: z.literal("X25519"),
                        fingerprint: z
                          .string()
                          .min(43)
                          .max(43)
                          .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                        keyId: z
                          .string()
                          .min(36)
                          .max(36)
                          .regex(
                            new RegExp(
                              "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                            ),
                          ),
                        publicKey: z
                          .string()
                          .min(43)
                          .max(43)
                          .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      })
                      .strict(),
                    formatVersion: z.literal(2),
                    ownerBinding: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    revokedAt: z.union([
                      z.iso
                        .datetime({ offset: true })
                        .min(24)
                        .max(24)
                        .regex(
                          new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                        ),
                      z.null(),
                    ]),
                  })
                  .strict(),
              )
              .min(1)
              .max(32),
            epoch: z.number().int().min(1).max(9007199254740991),
            formatVersion: z.literal(2),
            ownerBinding: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            recoveryAuthorization: z
              .object({
                algorithm: z.literal("ED25519"),
                createdAt: z.iso
                  .datetime({ offset: true })
                  .min(24)
                  .max(24)
                  .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                fingerprint: z
                  .string()
                  .min(43)
                  .max(43)
                  .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                formatVersion: z.literal(2),
                keyId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                ownerBinding: z
                  .string()
                  .min(43)
                  .max(43)
                  .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                publicKey: z
                  .string()
                  .min(43)
                  .max(43)
                  .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                revokedAt: z.union([
                  z.iso
                    .datetime({ offset: true })
                    .min(24)
                    .max(24)
                    .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                  z.null(),
                ]),
                vaultId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
              })
              .strict(),
            revision: z.number().int().min(1).max(9007199254740991),
            updatedAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            vaultId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          })
          .strict(),
        commit: z
          .object({
            author: z
              .object({
                deviceId: z.union([
                  z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                  z.null(),
                ]),
                keyId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                kind: z.enum(["DEVICE", "RECOVERY"]),
              })
              .strict(),
            authorizationManifestHash: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            createdAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            epoch: z.number().int().min(1).max(9007199254740991),
            formatVersion: z.literal(2),
            keyringHash: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            operationId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
            ownerBinding: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            parentCommitHash: z.union([
              z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              z.null(),
            ]),
            payloadHash: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            sequence: z.number().int().min(1).max(9007199254740991),
            signature: z.string().min(86).max(86).regex(new RegExp("^[A-Za-z0-9_-]{85}[AQgw]$")),
            stateMac: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            vaultId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          })
          .strict(),
        commitHash: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
        formatVersion: z.literal(2),
        keyring: z
          .object({
            createdAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            deviceEnvelopes: z
              .array(
                z
                  .object({
                    cipherSuite: z.literal("X25519_XCHACHA20_POLY1305"),
                    createdAt: z.iso
                      .datetime({ offset: true })
                      .min(24)
                      .max(24)
                      .regex(
                        new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                      ),
                    ephemeralPublicKey: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    formatVersion: z.literal(1),
                    nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
                    recipientDeviceId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    recipientKeyId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    recipientPublicKeyFingerprint: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    vaultId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    vaultKeyId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    wrappedKey: z
                      .string()
                      .min(107)
                      .max(107)
                      .regex(new RegExp("^[A-Za-z0-9_-]{106}[AEIMQUYcgkosw048]$")),
                  })
                  .strict(),
              )
              .min(1)
              .max(32),
            devicePublicKeys: z
              .array(
                z
                  .object({
                    createdAt: z.iso
                      .datetime({ offset: true })
                      .min(24)
                      .max(24)
                      .regex(
                        new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                      ),
                    deviceId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    deviceKeyId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    formatVersion: z.literal(1),
                    keyAlgorithm: z.literal("X25519"),
                    publicKey: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    publicKeyFingerprint: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    revokedAt: z.union([
                      z.iso
                        .datetime({ offset: true })
                        .min(24)
                        .max(24)
                        .regex(
                          new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                        ),
                      z.null(),
                    ]),
                  })
                  .strict(),
              )
              .min(1)
              .max(32)
              .optional(),
            formatVersion: z.literal(1),
            recoveryEnvelope: z
              .object({
                aad: z.string().min(2).max(5462).regex(new RegExp("^[A-Za-z0-9_-]+$")),
                cipherSuite: z.literal("XCHACHA20_POLY1305"),
                createdAt: z.iso
                  .datetime({ offset: true })
                  .min(24)
                  .max(24)
                  .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                formatVersion: z.literal(1),
                kdf: z
                  .object({
                    algorithm: z.literal("ARGON2ID13"),
                    memLimitBytes: z.number().int().min(67108864).max(268435456),
                    opsLimit: z.number().int().min(2).max(4),
                    outputBytes: z.literal(32),
                    salt: z.string().min(22).max(22).regex(new RegExp("^[A-Za-z0-9_-]{21}[AQgw]$")),
                  })
                  .strict(),
                nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
                vaultId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                vaultKeyId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                wrappedKey: z.string().min(64).max(64).regex(new RegExp("^[A-Za-z0-9_-]{64}$")),
              })
              .strict(),
            revision: z.number().int().min(1).max(9007199254740991),
            updatedAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            vaultId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
            vaultKeyId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          })
          .strict(),
        ownerBinding: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
        payload: z
          .object({
            aad: z.string().min(2).max(5462).regex(new RegExp("^[A-Za-z0-9_-]+$")),
            baseRevision: z.union([z.number().int().min(1).max(9007199254740991), z.null()]),
            cipherSuite: z.literal("XCHACHA20_POLY1305"),
            ciphertext: z.string().min(5483).max(11184832).regex(new RegExp("^[A-Za-z0-9_-]+$")),
            contentSchemaVersion: z.literal(1),
            contentType: z.literal("application/vnd.umn-gopher-assistant.personal-vault+json"),
            createdAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            formatVersion: z.literal(2),
            nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
            ownerBinding: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            padding: z
              .object({
                algorithm: z.literal("SODIUM_PAD"),
                blockSize: z.literal(4096),
              })
              .strict(),
            revision: z.number().int().min(1).max(9007199254740991),
            vaultId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
            vaultKeyId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          })
          .strict(),
        vaultId: z
          .string()
          .min(36)
          .max(36)
          .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
      })
      .strict(),
  },
  bootstrapPersonalVault: {
    "200": z
      .object({
        formatVersion: z.literal(2),
        ownerBinding: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
        vault: z.union([
          z
            .object({
              exists: z.literal(false),
            })
            .strict(),
          z
            .object({
              etag: z.string().min(3).max(128).regex(new RegExp('^"[\\x21\\x23-\\x7e]+"$')),
              exists: z.literal(true),
              recoveryAuthorization: z
                .object({
                  algorithm: z.literal("ED25519"),
                  createdAt: z.iso
                    .datetime({ offset: true })
                    .min(24)
                    .max(24)
                    .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                  fingerprint: z
                    .string()
                    .min(43)
                    .max(43)
                    .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                  formatVersion: z.literal(2),
                  keyId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                  ownerBinding: z
                    .string()
                    .min(43)
                    .max(43)
                    .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                  publicKey: z
                    .string()
                    .min(43)
                    .max(43)
                    .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                  revokedAt: z.union([
                    z.iso
                      .datetime({ offset: true })
                      .min(24)
                      .max(24)
                      .regex(
                        new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                      ),
                    z.null(),
                  ]),
                  vaultId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                })
                .strict(),
              vaultId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
            })
            .strict(),
        ]),
      })
      .strict(),
  },
  cancelPersonalVaultDevicePairing: {
    "200": z
      .object({
        createdAt: z.iso
          .datetime({ offset: true })
          .min(24)
          .max(24)
          .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
        expiresAt: z.iso
          .datetime({ offset: true })
          .min(24)
          .max(24)
          .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
        id: z
          .string()
          .min(36)
          .max(36)
          .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
        requestingDevice: z
          .object({
            authorizationKey: z
              .object({
                algorithm: z.literal("ED25519"),
                fingerprint: z
                  .string()
                  .min(43)
                  .max(43)
                  .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                keyId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                publicKey: z
                  .string()
                  .min(43)
                  .max(43)
                  .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              })
              .strict(),
            createdAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            deviceId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
            encryptionKey: z
              .object({
                algorithm: z.literal("X25519"),
                fingerprint: z
                  .string()
                  .min(43)
                  .max(43)
                  .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                keyId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                publicKey: z
                  .string()
                  .min(43)
                  .max(43)
                  .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              })
              .strict(),
            formatVersion: z.literal(2),
            ownerBinding: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            revokedAt: z.union([
              z.iso
                .datetime({ offset: true })
                .min(24)
                .max(24)
                .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
              z.null(),
            ]),
          })
          .strict(),
        state: z.enum(["pending", "approved", "consumed", "expired", "cancelled"]),
        updatedAt: z.iso
          .datetime({ offset: true })
          .min(24)
          .max(24)
          .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
        vaultId: z
          .string()
          .min(36)
          .max(36)
          .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
      })
      .strict(),
  },
  createPersonalVault: {
    "201": z
      .object({
        authorizationManifest: z
          .object({
            createdAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            devices: z
              .array(
                z
                  .object({
                    authorizationKey: z
                      .object({
                        algorithm: z.literal("ED25519"),
                        fingerprint: z
                          .string()
                          .min(43)
                          .max(43)
                          .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                        keyId: z
                          .string()
                          .min(36)
                          .max(36)
                          .regex(
                            new RegExp(
                              "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                            ),
                          ),
                        publicKey: z
                          .string()
                          .min(43)
                          .max(43)
                          .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      })
                      .strict(),
                    createdAt: z.iso
                      .datetime({ offset: true })
                      .min(24)
                      .max(24)
                      .regex(
                        new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                      ),
                    deviceId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    encryptionKey: z
                      .object({
                        algorithm: z.literal("X25519"),
                        fingerprint: z
                          .string()
                          .min(43)
                          .max(43)
                          .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                        keyId: z
                          .string()
                          .min(36)
                          .max(36)
                          .regex(
                            new RegExp(
                              "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                            ),
                          ),
                        publicKey: z
                          .string()
                          .min(43)
                          .max(43)
                          .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      })
                      .strict(),
                    formatVersion: z.literal(2),
                    ownerBinding: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    revokedAt: z.union([
                      z.iso
                        .datetime({ offset: true })
                        .min(24)
                        .max(24)
                        .regex(
                          new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                        ),
                      z.null(),
                    ]),
                  })
                  .strict(),
              )
              .min(1)
              .max(32),
            epoch: z.number().int().min(1).max(9007199254740991),
            formatVersion: z.literal(2),
            ownerBinding: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            recoveryAuthorization: z
              .object({
                algorithm: z.literal("ED25519"),
                createdAt: z.iso
                  .datetime({ offset: true })
                  .min(24)
                  .max(24)
                  .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                fingerprint: z
                  .string()
                  .min(43)
                  .max(43)
                  .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                formatVersion: z.literal(2),
                keyId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                ownerBinding: z
                  .string()
                  .min(43)
                  .max(43)
                  .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                publicKey: z
                  .string()
                  .min(43)
                  .max(43)
                  .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                revokedAt: z.union([
                  z.iso
                    .datetime({ offset: true })
                    .min(24)
                    .max(24)
                    .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                  z.null(),
                ]),
                vaultId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
              })
              .strict(),
            revision: z.number().int().min(1).max(9007199254740991),
            updatedAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            vaultId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          })
          .strict(),
        commit: z
          .object({
            author: z
              .object({
                deviceId: z.union([
                  z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                  z.null(),
                ]),
                keyId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                kind: z.enum(["DEVICE", "RECOVERY"]),
              })
              .strict(),
            authorizationManifestHash: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            createdAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            epoch: z.number().int().min(1).max(9007199254740991),
            formatVersion: z.literal(2),
            keyringHash: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            operationId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
            ownerBinding: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            parentCommitHash: z.union([
              z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              z.null(),
            ]),
            payloadHash: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            sequence: z.number().int().min(1).max(9007199254740991),
            signature: z.string().min(86).max(86).regex(new RegExp("^[A-Za-z0-9_-]{85}[AQgw]$")),
            stateMac: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            vaultId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          })
          .strict(),
        commitHash: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
        formatVersion: z.literal(2),
        keyring: z
          .object({
            createdAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            deviceEnvelopes: z
              .array(
                z
                  .object({
                    cipherSuite: z.literal("X25519_XCHACHA20_POLY1305"),
                    createdAt: z.iso
                      .datetime({ offset: true })
                      .min(24)
                      .max(24)
                      .regex(
                        new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                      ),
                    ephemeralPublicKey: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    formatVersion: z.literal(1),
                    nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
                    recipientDeviceId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    recipientKeyId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    recipientPublicKeyFingerprint: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    vaultId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    vaultKeyId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    wrappedKey: z
                      .string()
                      .min(107)
                      .max(107)
                      .regex(new RegExp("^[A-Za-z0-9_-]{106}[AEIMQUYcgkosw048]$")),
                  })
                  .strict(),
              )
              .min(1)
              .max(32),
            devicePublicKeys: z
              .array(
                z
                  .object({
                    createdAt: z.iso
                      .datetime({ offset: true })
                      .min(24)
                      .max(24)
                      .regex(
                        new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                      ),
                    deviceId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    deviceKeyId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    formatVersion: z.literal(1),
                    keyAlgorithm: z.literal("X25519"),
                    publicKey: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    publicKeyFingerprint: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    revokedAt: z.union([
                      z.iso
                        .datetime({ offset: true })
                        .min(24)
                        .max(24)
                        .regex(
                          new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                        ),
                      z.null(),
                    ]),
                  })
                  .strict(),
              )
              .min(1)
              .max(32)
              .optional(),
            formatVersion: z.literal(1),
            recoveryEnvelope: z
              .object({
                aad: z.string().min(2).max(5462).regex(new RegExp("^[A-Za-z0-9_-]+$")),
                cipherSuite: z.literal("XCHACHA20_POLY1305"),
                createdAt: z.iso
                  .datetime({ offset: true })
                  .min(24)
                  .max(24)
                  .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                formatVersion: z.literal(1),
                kdf: z
                  .object({
                    algorithm: z.literal("ARGON2ID13"),
                    memLimitBytes: z.number().int().min(67108864).max(268435456),
                    opsLimit: z.number().int().min(2).max(4),
                    outputBytes: z.literal(32),
                    salt: z.string().min(22).max(22).regex(new RegExp("^[A-Za-z0-9_-]{21}[AQgw]$")),
                  })
                  .strict(),
                nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
                vaultId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                vaultKeyId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                wrappedKey: z.string().min(64).max(64).regex(new RegExp("^[A-Za-z0-9_-]{64}$")),
              })
              .strict(),
            revision: z.number().int().min(1).max(9007199254740991),
            updatedAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            vaultId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
            vaultKeyId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          })
          .strict(),
        ownerBinding: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
        payload: z
          .object({
            aad: z.string().min(2).max(5462).regex(new RegExp("^[A-Za-z0-9_-]+$")),
            baseRevision: z.union([z.number().int().min(1).max(9007199254740991), z.null()]),
            cipherSuite: z.literal("XCHACHA20_POLY1305"),
            ciphertext: z.string().min(5483).max(11184832).regex(new RegExp("^[A-Za-z0-9_-]+$")),
            contentSchemaVersion: z.literal(1),
            contentType: z.literal("application/vnd.umn-gopher-assistant.personal-vault+json"),
            createdAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            formatVersion: z.literal(2),
            nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
            ownerBinding: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            padding: z
              .object({
                algorithm: z.literal("SODIUM_PAD"),
                blockSize: z.literal(4096),
              })
              .strict(),
            revision: z.number().int().min(1).max(9007199254740991),
            vaultId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
            vaultKeyId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          })
          .strict(),
        vaultId: z
          .string()
          .min(36)
          .max(36)
          .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
      })
      .strict(),
  },
  createPersonalVaultDevicePairing: {
    "201": z
      .object({
        createdAt: z.iso
          .datetime({ offset: true })
          .min(24)
          .max(24)
          .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
        expiresAt: z.iso
          .datetime({ offset: true })
          .min(24)
          .max(24)
          .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
        id: z
          .string()
          .min(36)
          .max(36)
          .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
        requestingDevice: z
          .object({
            authorizationKey: z
              .object({
                algorithm: z.literal("ED25519"),
                fingerprint: z
                  .string()
                  .min(43)
                  .max(43)
                  .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                keyId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                publicKey: z
                  .string()
                  .min(43)
                  .max(43)
                  .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              })
              .strict(),
            createdAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            deviceId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
            encryptionKey: z
              .object({
                algorithm: z.literal("X25519"),
                fingerprint: z
                  .string()
                  .min(43)
                  .max(43)
                  .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                keyId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                publicKey: z
                  .string()
                  .min(43)
                  .max(43)
                  .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              })
              .strict(),
            formatVersion: z.literal(2),
            ownerBinding: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            revokedAt: z.union([
              z.iso
                .datetime({ offset: true })
                .min(24)
                .max(24)
                .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
              z.null(),
            ]),
          })
          .strict(),
        state: z.enum(["pending", "approved", "consumed", "expired", "cancelled"]),
        updatedAt: z.iso
          .datetime({ offset: true })
          .min(24)
          .max(24)
          .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
        vaultId: z
          .string()
          .min(36)
          .max(36)
          .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
      })
      .strict(),
  },
  getHealth: {
    "200": z
      .object({
        service: z.literal("campus-api"),
        status: z.literal("ok"),
        time: z.iso.datetime({ offset: true }),
        version: z.string(),
      })
      .strict(),
  },
  getWorldManifest: {
    "200": z
      .object({
        campusId: z.enum(["tc", "duluth", "crookston", "morris", "rochester"]),
        etag: z.string(),
        generatedAt: z.iso.datetime({ offset: true }),
        portals: z.array(
          z
            .object({
              fromCampusId: z.enum(["tc", "duluth", "crookston", "morris", "rochester"]),
              id: z.string(),
              label: z
                .object({
                  en: z.string().min(1),
                  "zh-CN": z.string().min(1),
                })
                .strict(),
              position: z.array(z.number()).min(3).max(3),
              targetWorldVersion: z.string(),
              toCampusId: z.enum(["tc", "duluth", "crookston", "morris", "rochester"]),
              verificationState: z.enum(["schematic", "surveyed", "campus-reviewed", "verified", "retired"]),
            })
            .strict(),
        ),
        revision: z.number().int().min(1),
        sourceIds: z.array(z.string()).min(1),
        tiles: z.array(
          z
            .object({
              bounds: z.array(z.number()).min(4).max(4),
              byteLength: z.number().int().min(1),
              contentType: z.string(),
              id: z.string(),
              licenseStatus: z.enum([
                "OPEN_REUSE",
                "LIVE_ONLY",
                "DEEPLINK_ONLY",
                "APPROVAL_REQUIRED",
                "PROHIBITED",
              ]),
              maxZoom: z.number().int().min(0).max(24),
              minZoom: z.number().int().min(0).max(24),
              sha256: z.string().regex(new RegExp("^[a-f0-9]{64}$")),
              url: z.url(),
              verificationState: z.enum(["schematic", "surveyed", "campus-reviewed", "verified", "retired"]),
            })
            .strict(),
        ),
        verificationState: z.enum(["schematic", "surveyed", "campus-reviewed", "verified", "retired"]),
        worldVersion: z.string(),
      })
      .strict(),
  },
  listAcademicSessions: {
    "200": z
      .object({
        items: z
          .array(
            z
              .object({
                academicCareerCode: z.string().regex(new RegExp("^[A-Z0-9]{2,12}$")),
                beginDate: z.string().regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")),
                campusId: z.enum(["tc", "duluth", "crookston", "morris", "rochester"]),
                endDate: z.string().regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")),
                enrollmentOpenDate: z.union([
                  z.string().regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")),
                  z.null(),
                ]),
                id: z.string().regex(new RegExp("^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")),
                institutionCode: z.enum(["UMNTC", "UMNDL", "UMNCR", "UMNMO"]),
                name: z.string().min(1).max(256),
                observedAt: z.iso.datetime({ offset: true }),
                sessionCode: z.string().regex(new RegExp("^[A-Z0-9]{1,12}$")),
                sourceId: z.string().regex(new RegExp("^[a-z0-9][a-z0-9-]{2,127}$")),
                sourceObservationId: z
                  .string()
                  .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
                termCode: z.string().regex(new RegExp("^[0-9]{4}$")),
              })
              .strict()
              .refine(
                (value) =>
                  !(
                    Object.hasOwn(value, "campusId") &&
                    (!Object.hasOwn(value, "campusId") || ["tc", "rochester"].includes(value["campusId"]))
                  ) ||
                  (Object.hasOwn(value, "institutionCode") &&
                    (!Object.hasOwn(value, "institutionCode") || value["institutionCode"] === "UMNTC")),
                {
                  message:
                    "Conditional constraint from listAcademicSessions.responses.200.application/json.properties.items.items.allOf[0] failed",
                },
              )
              .refine(
                (value) =>
                  !(
                    Object.hasOwn(value, "campusId") &&
                    (!Object.hasOwn(value, "campusId") || value["campusId"] === "duluth")
                  ) ||
                  (Object.hasOwn(value, "institutionCode") &&
                    (!Object.hasOwn(value, "institutionCode") || value["institutionCode"] === "UMNDL")),
                {
                  message:
                    "Conditional constraint from listAcademicSessions.responses.200.application/json.properties.items.items.allOf[1] failed",
                },
              )
              .refine(
                (value) =>
                  !(
                    Object.hasOwn(value, "campusId") &&
                    (!Object.hasOwn(value, "campusId") || value["campusId"] === "crookston")
                  ) ||
                  (Object.hasOwn(value, "institutionCode") &&
                    (!Object.hasOwn(value, "institutionCode") || value["institutionCode"] === "UMNCR")),
                {
                  message:
                    "Conditional constraint from listAcademicSessions.responses.200.application/json.properties.items.items.allOf[2] failed",
                },
              )
              .refine(
                (value) =>
                  !(
                    Object.hasOwn(value, "campusId") &&
                    (!Object.hasOwn(value, "campusId") || value["campusId"] === "morris")
                  ) ||
                  (Object.hasOwn(value, "institutionCode") &&
                    (!Object.hasOwn(value, "institutionCode") || value["institutionCode"] === "UMNMO")),
                {
                  message:
                    "Conditional constraint from listAcademicSessions.responses.200.application/json.properties.items.items.allOf[3] failed",
                },
              ),
          )
          .max(100),
        nextCursor: z.union([
          z.string().min(45).max(1994).regex(new RegExp("^[A-Za-z0-9_-]{1,1950}\\.[A-Za-z0-9_-]{43}$")),
          z.null(),
        ]),
        range: z
          .object({
            defaulted: z.boolean(),
            from: z.string().regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")),
            to: z.string().regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")),
          })
          .strict(),
        retrievalCoverage: z
          .object({
            nextUpstreamPage: z.union([z.number().int().min(1).max(20), z.null()]),
            pagesFetched: z.number().int().min(1).max(3),
            recordsFetched: z.number().int().min(0).max(50000),
            sourceTotalPages: z.number().int().min(0),
            sourceTotalRecords: z.number().int().min(0),
            truncatedByPolicy: z.boolean(),
          })
          .strict(),
        sourceObservations: z
          .array(
            z
              .object({
                appliedCacheDisposition: z.enum([
                  "NO_ACCESS",
                  "DISCARDED_AFTER_RESPONSE",
                  "OPERATIONAL_METADATA_ONLY",
                  "CONTENT_CACHED",
                ]),
                cachePolicy: z.enum(["CACHE_ALLOWED", "METADATA_ONLY", "NO_CONTENT_CACHE", "NO_ACCESS"]),
                campusId: z.enum(["tc", "duluth", "crookston", "morris", "rochester"]),
                dataClassification: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]),
                durationMs: z.number().int().min(0).max(120000),
                failureCode: z.null(),
                freshnessState: z.enum(["FRESH", "STALE", "EXPIRED", "UNKNOWN"]),
                httpStatus: z.number().int().min(200).max(299),
                licenseStatus: z.enum([
                  "OPEN_REUSE",
                  "LIVE_ONLY",
                  "DEEPLINK_ONLY",
                  "APPROVAL_REQUIRED",
                  "PROHIBITED",
                ]),
                observationId: z
                  .string()
                  .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
                observedAt: z.iso.datetime({ offset: true }),
                outcome: z.literal("SUCCESS"),
                parserVersion: z.string().regex(new RegExp("^[a-z0-9][a-z0-9._@/-]{0,127}$")),
                rawByteLength: z.number().int().min(0).max(10485760),
                rawSha256: z.string().regex(new RegExp("^[a-f0-9]{64}$")),
                recordsAccepted: z.number().int().min(0).max(1000000),
                recordsRejected: z.number().int().min(0).max(1000000),
                sourceId: z.string().regex(new RegExp("^[a-z0-9][a-z0-9-]{2,127}$")),
              })
              .strict(),
          )
          .min(1)
          .max(1),
      })
      .strict(),
  },
  listCampuses: {
    "200": z.array(
      z
        .object({
          academicCalendarCampusId: z.enum(["tc", "duluth", "crookston", "morris", "rochester"]),
          academicInstitutionCode: z.enum(["UMNTC", "UMNDL", "UMNCR", "UMNMO"]),
          city: z
            .object({
              en: z.string().min(1),
              "zh-CN": z.string().min(1),
            })
            .strict(),
          id: z.enum(["tc", "duluth", "crookston", "morris", "rochester"]),
          name: z
            .object({
              en: z.string().min(1),
              "zh-CN": z.string().min(1),
            })
            .strict(),
          officialStatus: z.enum(["UNVERIFIED", "PUBLISHER_ASSERTED", "PARTNERSHIP_VERIFIED"]),
          sourceUrl: z.url().regex(new RegExp("^https://")),
          timeZone: z.string(),
        })
        .strict(),
    ),
  },
  listEvents: {
    "200": z
      .object({
        items: z
          .array(
            z
              .object({
                allDay: z.boolean(),
                campusId: z.enum(["tc", "duluth", "crookston", "morris", "rochester"]),
                canonicalUrl: z.url().regex(new RegExp("^https://")),
                categories: z.array(z.string().min(1).max(128)).max(32),
                descriptionText: z.union([z.string().max(20000), z.null()]),
                endsAt: z.union([z.iso.datetime({ offset: true }), z.null()]),
                id: z.string().regex(new RegExp("^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")),
                language: z.string().regex(new RegExp("^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")),
                location: z.union([
                  z
                    .object({
                      address: z.union([z.string().max(1024), z.null()]),
                      coordinates: z.union([z.array(z.number()).min(2).max(2), z.null()]),
                      name: z.union([z.string().max(512), z.null()]),
                      onlineUrl: z.union([z.url().regex(new RegExp("^https://")), z.null()]),
                    })
                    .strict()
                    .refine(
                      (value) =>
                        !(
                          Object.hasOwn(value, "name") &&
                          Object.hasOwn(value, "address") &&
                          Object.hasOwn(value, "coordinates") &&
                          Object.hasOwn(value, "onlineUrl") &&
                          (!Object.hasOwn(value, "name") || value["name"] === null) &&
                          (!Object.hasOwn(value, "address") || value["address"] === null) &&
                          (!Object.hasOwn(value, "coordinates") || value["coordinates"] === null) &&
                          (!Object.hasOwn(value, "onlineUrl") || value["onlineUrl"] === null)
                        ) || false,
                      {
                        message:
                          "Conditional constraint from listEvents.responses.200.application/json.properties.items.items.properties.location.object.allOf[0] failed",
                      },
                    ),
                  z.null(),
                ]),
                observedAt: z.iso.datetime({ offset: true }),
                sourceId: z.string().regex(new RegExp("^[a-z0-9][a-z0-9-]{2,127}$")),
                sourceObservationId: z
                  .string()
                  .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
                startsAt: z.iso.datetime({ offset: true }),
                status: z.enum(["SCHEDULED", "POSTPONED", "CANCELLED"]),
                timeZone: z.string().min(1).max(128),
                title: z.string().min(1).max(1024),
              })
              .strict(),
          )
          .max(100),
        nextCursor: z.union([
          z.string().min(45).max(1994).regex(new RegExp("^[A-Za-z0-9_-]{1,1950}\\.[A-Za-z0-9_-]{43}$")),
          z.null(),
        ]),
        range: z
          .object({
            defaulted: z.boolean(),
            from: z.string().regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")),
            to: z.string().regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")),
          })
          .strict(),
        retrievalCoverage: z
          .object({
            nextUpstreamPage: z.union([z.number().int().min(1).max(20), z.null()]),
            pagesFetched: z.number().int().min(1).max(3),
            recordsFetched: z.number().int().min(0).max(50000),
            sourceTotalPages: z.number().int().min(0),
            sourceTotalRecords: z.number().int().min(0),
            truncatedByPolicy: z.boolean(),
          })
          .strict(),
        sourceObservations: z
          .array(
            z
              .object({
                appliedCacheDisposition: z.enum([
                  "NO_ACCESS",
                  "DISCARDED_AFTER_RESPONSE",
                  "OPERATIONAL_METADATA_ONLY",
                  "CONTENT_CACHED",
                ]),
                cachePolicy: z.enum(["CACHE_ALLOWED", "METADATA_ONLY", "NO_CONTENT_CACHE", "NO_ACCESS"]),
                campusId: z.enum(["tc", "duluth", "crookston", "morris", "rochester"]),
                dataClassification: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]),
                durationMs: z.number().int().min(0).max(120000),
                failureCode: z.null(),
                freshnessState: z.enum(["FRESH", "STALE", "EXPIRED", "UNKNOWN"]),
                httpStatus: z.number().int().min(200).max(299),
                licenseStatus: z.enum([
                  "OPEN_REUSE",
                  "LIVE_ONLY",
                  "DEEPLINK_ONLY",
                  "APPROVAL_REQUIRED",
                  "PROHIBITED",
                ]),
                observationId: z
                  .string()
                  .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
                observedAt: z.iso.datetime({ offset: true }),
                outcome: z.literal("SUCCESS"),
                parserVersion: z.string().regex(new RegExp("^[a-z0-9][a-z0-9._@/-]{0,127}$")),
                rawByteLength: z.number().int().min(0).max(10485760),
                rawSha256: z.string().regex(new RegExp("^[a-f0-9]{64}$")),
                recordsAccepted: z.number().int().min(0).max(1000000),
                recordsRejected: z.number().int().min(0).max(1000000),
                sourceId: z.string().regex(new RegExp("^[a-z0-9][a-z0-9-]{2,127}$")),
              })
              .strict(),
          )
          .min(1)
          .max(3),
      })
      .strict(),
  },
  listPersonalVaultDevicePairings: {
    "200": z
      .object({
        items: z
          .array(
            z
              .object({
                createdAt: z.iso
                  .datetime({ offset: true })
                  .min(24)
                  .max(24)
                  .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                expiresAt: z.iso
                  .datetime({ offset: true })
                  .min(24)
                  .max(24)
                  .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                id: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                requestingDevice: z
                  .object({
                    authorizationKey: z
                      .object({
                        algorithm: z.literal("ED25519"),
                        fingerprint: z
                          .string()
                          .min(43)
                          .max(43)
                          .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                        keyId: z
                          .string()
                          .min(36)
                          .max(36)
                          .regex(
                            new RegExp(
                              "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                            ),
                          ),
                        publicKey: z
                          .string()
                          .min(43)
                          .max(43)
                          .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      })
                      .strict(),
                    createdAt: z.iso
                      .datetime({ offset: true })
                      .min(24)
                      .max(24)
                      .regex(
                        new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                      ),
                    deviceId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    encryptionKey: z
                      .object({
                        algorithm: z.literal("X25519"),
                        fingerprint: z
                          .string()
                          .min(43)
                          .max(43)
                          .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                        keyId: z
                          .string()
                          .min(36)
                          .max(36)
                          .regex(
                            new RegExp(
                              "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                            ),
                          ),
                        publicKey: z
                          .string()
                          .min(43)
                          .max(43)
                          .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      })
                      .strict(),
                    formatVersion: z.literal(2),
                    ownerBinding: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    revokedAt: z.union([
                      z.iso
                        .datetime({ offset: true })
                        .min(24)
                        .max(24)
                        .regex(
                          new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                        ),
                      z.null(),
                    ]),
                  })
                  .strict(),
                state: z.enum(["pending", "approved", "consumed", "expired", "cancelled"]),
                updatedAt: z.iso
                  .datetime({ offset: true })
                  .min(24)
                  .max(24)
                  .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                vaultId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
              })
              .strict(),
          )
          .max(100),
      })
      .strict(),
  },
  listSources: {
    "200": z
      .object({
        items: z.array(
          z
            .object({
              attribution: z.string().min(1).max(2048),
              authorizationEvidenceUrl: z.union([z.url().regex(new RegExp("^https://")), z.null()]),
              cacheDisposition: z
                .object({
                  derivedArtifacts: z.enum(["PROHIBITED", "SAME_RETENTION", "SEPARATE_APPROVAL"]),
                  normalizedRecords: z.enum(["NEVER_STORE", "TRANSIENT_ONLY", "PERSIST_WITH_TTL"]),
                  rawResponse: z.enum(["NEVER_STORE", "TRANSIENT_ONLY", "PERSIST_WITH_TTL"]),
                  retentionSeconds: z.union([z.number().int().min(1).max(31536000), z.null()]),
                })
                .strict(),
              cachePolicy: z.enum(["CACHE_ALLOWED", "METADATA_ONLY", "NO_CONTENT_CACHE", "NO_ACCESS"]),
              campusIds: z
                .array(z.enum(["tc", "duluth", "crookston", "morris", "rochester"]))
                .min(1)
                .max(5),
              dataClasses: z
                .array(
                  z.enum([
                    "PUBLIC_METADATA",
                    "COPYRIGHTED_CONTENT",
                    "PRECISE_LOCATION",
                    "PERSONAL_DATA",
                    "SENSITIVE_DATA",
                    "SAFETY_CRITICAL",
                    "MEDIA",
                  ]),
                )
                .min(1)
                .max(7),
              dataClassification: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]),
              freshnessState: z.enum(["FRESH", "STALE", "EXPIRED", "UNKNOWN"]),
              id: z.string().regex(new RegExp("^[a-z0-9][a-z0-9-]{2,127}$")),
              killSwitch: z
                .object({
                  defaultState: z.enum(["ENABLED", "DISABLED"]),
                  fallback: z.enum(["DEEPLINK_ONLY", "UNAVAILABLE"]),
                  key: z.string().regex(new RegExp("^source\\.[a-z0-9][a-z0-9.-]{2,127}\\.enabled$")),
                })
                .strict(),
              lastCheckedAt: z.union([z.iso.datetime({ offset: true }), z.null()]),
              licenseEvidenceUrl: z.union([z.url().regex(new RegExp("^https://")), z.null()]),
              licenseStatus: z.enum([
                "OPEN_REUSE",
                "LIVE_ONLY",
                "DEEPLINK_ONLY",
                "APPROVAL_REQUIRED",
                "PROHIBITED",
              ]),
              name: z
                .object({
                  en: z.string().min(1),
                  "zh-CN": z.string().min(1),
                })
                .strict(),
              officialStatus: z.enum(["UNVERIFIED", "PUBLISHER_ASSERTED", "PARTNERSHIP_VERIFIED"]),
              owner: z
                .object({
                  contactUrl: z.url().regex(new RegExp("^https://")),
                  teamId: z.string().regex(new RegExp("^[a-z0-9][a-z0-9-]{2,63}$")),
                })
                .strict(),
              publisher: z.string().min(1).max(256),
              resourceKinds: z
                .array(
                  z.enum([
                    "CAMPUS_DEEPLINK",
                    "ACADEMIC_SESSION",
                    "PUBLIC_EVENT",
                    "AI_KNOWLEDGE_SUMMARY",
                    "AI_VERIFICATION_LINK",
                  ]),
                )
                .min(1)
                .max(3),
              sourceUrl: z.url().regex(new RegExp("^https://")),
              termsReviewedAt: z.union([z.iso.datetime({ offset: true }), z.null()]),
              termsReviewExpiresAt: z.union([z.iso.datetime({ offset: true }), z.null()]),
              verificationState: z.enum(["schematic", "surveyed", "campus-reviewed", "verified", "retired"]),
            })
            .strict()
            .refine(
              (value) =>
                !(
                  Object.hasOwn(value, "licenseStatus") &&
                  (!Object.hasOwn(value, "licenseStatus") || value["licenseStatus"] === "PROHIBITED")
                ) ||
                ((!Object.hasOwn(value, "cachePolicy") || value["cachePolicy"] === "NO_ACCESS") &&
                  (!Object.hasOwn(value, "termsReviewedAt") || value["termsReviewedAt"] === null) &&
                  (!Object.hasOwn(value, "termsReviewExpiresAt") || value["termsReviewExpiresAt"] === null)),
              {
                message:
                  "Conditional constraint from listSources.responses.200.application/json.properties.items.items.allOf[0] failed",
              },
            )
            .refine(
              (value) =>
                !(
                  Object.hasOwn(value, "licenseStatus") &&
                  (!Object.hasOwn(value, "licenseStatus") || value["licenseStatus"] === "APPROVAL_REQUIRED")
                ) ||
                ((!Object.hasOwn(value, "cachePolicy") || value["cachePolicy"] === "NO_ACCESS") &&
                  (!Object.hasOwn(value, "termsReviewedAt") || value["termsReviewedAt"] === null) &&
                  (!Object.hasOwn(value, "termsReviewExpiresAt") || value["termsReviewExpiresAt"] === null)),
              {
                message:
                  "Conditional constraint from listSources.responses.200.application/json.properties.items.items.allOf[1] failed",
              },
            )
            .refine(
              (value) =>
                !(
                  Object.hasOwn(value, "licenseStatus") &&
                  (!Object.hasOwn(value, "licenseStatus") || value["licenseStatus"] === "LIVE_ONLY")
                ) ||
                ((!Object.hasOwn(value, "authorizationEvidenceUrl") ||
                  typeof value["authorizationEvidenceUrl"] === "string") &&
                  (!Object.hasOwn(value, "termsReviewedAt") ||
                    typeof value["termsReviewedAt"] === "string") &&
                  (!Object.hasOwn(value, "termsReviewExpiresAt") ||
                    typeof value["termsReviewExpiresAt"] === "string")),
              {
                message:
                  "Conditional constraint from listSources.responses.200.application/json.properties.items.items.allOf[2] failed",
              },
            )
            .refine(
              (value) =>
                !(
                  Object.hasOwn(value, "termsReviewedAt") &&
                  (!Object.hasOwn(value, "termsReviewedAt") || value["termsReviewedAt"] === null)
                ) ||
                !Object.hasOwn(value, "termsReviewExpiresAt") ||
                value["termsReviewExpiresAt"] === null,
              {
                message:
                  "Conditional constraint from listSources.responses.200.application/json.properties.items.items.allOf[3] failed",
              },
            )
            .refine(
              (value) =>
                !(
                  Object.hasOwn(value, "termsReviewExpiresAt") &&
                  (!Object.hasOwn(value, "termsReviewExpiresAt") || value["termsReviewExpiresAt"] === null)
                ) ||
                !Object.hasOwn(value, "termsReviewedAt") ||
                value["termsReviewedAt"] === null,
              {
                message:
                  "Conditional constraint from listSources.responses.200.application/json.properties.items.items.allOf[4] failed",
              },
            ),
        ),
        nextCursor: z.union([z.string(), z.null()]),
      })
      .strict(),
  },
  queryCampusAssistant: {
    "200": z
      .object({
        campusId: z.enum(["tc", "duluth", "crookston", "morris", "rochester"]),
        citations: z
          .array(
            z
              .object({
                campusId: z.enum(["tc", "duluth", "crookston", "morris", "rochester"]),
                category: z.enum(["library", "student-services", "safety", "transportation", "dining"]),
                contentSha256: z.string().regex(new RegExp("^[a-f0-9]{64}$")),
                documentId: z.string().regex(new RegExp("^[a-z0-9][a-z0-9-]{2,127}$")),
                excerpt: z
                  .string()
                  .min(1)
                  .max(4000)
                  .refine((value) => value === value.trim(), {
                    message: "Evidence text cannot have boundary whitespace",
                  })
                  .refine((value) => value.normalize("NFC") === value, {
                    message: "Evidence text must use NFC Unicode normalization",
                  })
                  .refine((value) => !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value), {
                    message: "Evidence text cannot contain control or format characters",
                  })
                  .refine(
                    (value) =>
                      !/[<>]|&(?:#(?:[xX][0-9A-Fa-f]+|\d+)|[A-Za-z][A-Za-z0-9]{1,31});?/u.test(value),
                    { message: "Evidence text cannot contain HTML or encoded HTML" },
                  ),
                id: z.string().regex(new RegExp("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")),
                summaryFreshnessState: z.enum(["FRESH", "STALE", "EXPIRED"]),
                summarySource: z
                  .object({
                    corpusSha256: z.string().regex(new RegExp("^[a-f0-9]{64}$")),
                    kind: z.literal("project-authored-summary"),
                    license: z
                      .object({
                        evidenceUrl: z.literal("https://www.apache.org/licenses/LICENSE-2.0"),
                        spdxId: z.literal("Apache-2.0"),
                        status: z.literal("OPEN_REUSE"),
                      })
                      .strict(),
                    sourceId: z.string().regex(new RegExp("^[a-z0-9][a-z0-9-]{2,127}$")),
                    sourceUrl: z
                      .url()
                      .regex(
                        new RegExp(
                          "^[Hh][Tt][Tt][Pp][Ss]://[Gg][Ii][Tt][Hh][Uu][Bb]\\.[Cc][Oo][Mm](?::443)?/appleweiping/umn-gopher-assistant/blob/main/apps/ai-knowledge/ai_knowledge/data/corpus\\.json$",
                        ),
                      ),
                  })
                  .strict(),
                summaryVerificationState: z.literal("schematic"),
                title: z
                  .object({
                    en: z
                      .string()
                      .min(1)
                      .max(2000)
                      .refine((value) => value === value.trim(), {
                        message: "Evidence text cannot have boundary whitespace",
                      })
                      .refine((value) => value.normalize("NFC") === value, {
                        message: "Evidence text must use NFC Unicode normalization",
                      })
                      .refine((value) => !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value), {
                        message: "Evidence text cannot contain control or format characters",
                      })
                      .refine(
                        (value) =>
                          !/[<>]|&(?:#(?:[xX][0-9A-Fa-f]+|\d+)|[A-Za-z][A-Za-z0-9]{1,31});?/u.test(value),
                        { message: "Evidence text cannot contain HTML or encoded HTML" },
                      ),
                    "zh-CN": z
                      .string()
                      .min(1)
                      .max(2000)
                      .refine((value) => value === value.trim(), {
                        message: "Evidence text cannot have boundary whitespace",
                      })
                      .refine((value) => value.normalize("NFC") === value, {
                        message: "Evidence text must use NFC Unicode normalization",
                      })
                      .refine((value) => !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value), {
                        message: "Evidence text cannot contain control or format characters",
                      })
                      .refine(
                        (value) =>
                          !/[<>]|&(?:#(?:[xX][0-9A-Fa-f]+|\d+)|[A-Za-z][A-Za-z0-9]{1,31});?/u.test(value),
                        { message: "Evidence text cannot contain HTML or encoded HTML" },
                      ),
                  })
                  .strict(),
                updatedAt: z.iso.datetime({ offset: true }),
                verificationLink: z
                  .object({
                    contentRetrieved: z.literal(false),
                    kind: z.literal("official-verification-link"),
                    licenseStatus: z.literal("DEEPLINK_ONLY"),
                    sourceId: z.string().regex(new RegExp("^[a-z0-9][a-z0-9-]{2,127}$")),
                    sourceUrl: z
                      .url()
                      .regex(
                        new RegExp(
                          "^[Hh][Tt][Tt][Pp][Ss]://(?:[A-Za-z0-9-]+\\.)*[Uu][Mm][Nn]\\.[Ee][Dd][Uu](?::443)?(?:/[^@?#]*)?$",
                        ),
                      ),
                    sourceUse: z.literal("verification-link-only"),
                  })
                  .strict(),
              })
              .strict(),
          )
          .max(128),
        locale: z.enum(["en", "zh-CN"]),
        paragraphs: z
          .array(
            z
              .object({
                citationIds: z
                  .array(z.string().regex(new RegExp("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")))
                  .min(1)
                  .max(64),
                id: z.string().regex(new RegExp("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")),
                text: z
                  .string()
                  .min(1)
                  .max(4000)
                  .refine((value) => value === value.trim(), {
                    message: "Evidence text cannot have boundary whitespace",
                  })
                  .refine((value) => value.normalize("NFC") === value, {
                    message: "Evidence text must use NFC Unicode normalization",
                  })
                  .refine((value) => !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value), {
                    message: "Evidence text cannot contain control or format characters",
                  })
                  .refine(
                    (value) =>
                      !/[<>]|&(?:#(?:[xX][0-9A-Fa-f]+|\d+)|[A-Za-z][A-Za-z0-9]{1,31});?/u.test(value),
                    { message: "Evidence text cannot contain HTML or encoded HTML" },
                  ),
              })
              .strict(),
          )
          .max(64),
        queryId: z
          .string()
          .regex(
            new RegExp(
              "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
            ),
          ),
        retrieval: z
          .object({
            documentsConsidered: z.number().int().min(0).max(1000000),
            mode: z.literal("no-key-hybrid"),
          })
          .strict(),
        state: z.enum(["answered", "stale", "conflict", "no-results"]),
      })
      .strict()
      .superRefine((value, refinement) => {
        const paragraphIds = value.paragraphs.map((paragraph) => paragraph.id);
        if (new Set(paragraphIds).size !== paragraphIds.length) {
          refinement.addIssue({
            code: "custom",
            message: "paragraph ids must be unique",
            path: ["paragraphs"],
          });
        }
        const citationIds = value.citations.map((citation) => citation.id);
        if (new Set(citationIds).size !== citationIds.length) {
          refinement.addIssue({
            code: "custom",
            message: "citation ids must be unique",
            path: ["citations"],
          });
        }
        const knownCitationIds = new Set(citationIds);
        const referencedCitationIds = new Set();
        value.paragraphs.forEach((paragraph, paragraphIndex) => {
          const paragraphCitationIds = new Set();
          paragraph.citationIds.forEach((citationId, citationIndex) => {
            if (paragraphCitationIds.has(citationId)) {
              refinement.addIssue({
                code: "custom",
                message: "citationIds must be unique within a paragraph",
                path: ["paragraphs", paragraphIndex, "citationIds", citationIndex],
              });
            }
            paragraphCitationIds.add(citationId);
            referencedCitationIds.add(citationId);
            if (!knownCitationIds.has(citationId)) {
              refinement.addIssue({
                code: "custom",
                message: "paragraph citationIds must reference citations in this response",
                path: ["paragraphs", paragraphIndex, "citationIds", citationIndex],
              });
            }
          });
        });
        value.citations.forEach((citation, citationIndex) => {
          if (citation.campusId !== value.campusId) {
            refinement.addIssue({
              code: "custom",
              message: "cross-campus citations are not allowed",
              path: ["citations", citationIndex, "campusId"],
            });
          }
          if (citation.summarySource.sourceId === citation.verificationLink.sourceId) {
            refinement.addIssue({
              code: "custom",
              message: "summary and official verification sources must be distinct",
              path: ["citations", citationIndex, "verificationLink", "sourceId"],
            });
          }
          if (!referencedCitationIds.has(citation.id)) {
            refinement.addIssue({
              code: "custom",
              message: "every citation must support at least one answer paragraph",
              path: ["citations", citationIndex, "id"],
            });
          }
        });
        if (new Set(value.citations.map((citation) => citation.summarySource.corpusSha256)).size > 1) {
          refinement.addIssue({
            code: "custom",
            message: "all citations must come from one atomic authored-summary corpus snapshot",
            path: ["citations"],
          });
        }
        if (value.state === "no-results") {
          if (value.paragraphs.length !== 0)
            refinement.addIssue({
              code: "custom",
              message: "no-results responses cannot contain answer paragraphs",
              path: ["paragraphs"],
            });
          if (value.citations.length !== 0)
            refinement.addIssue({
              code: "custom",
              message: "no-results responses cannot contain citations",
              path: ["citations"],
            });
          return;
        }
        if (value.paragraphs.length === 0)
          refinement.addIssue({
            code: "custom",
            message: "non-empty responses require at least one evidence-backed paragraph",
            path: ["paragraphs"],
          });
        if (value.citations.length === 0)
          refinement.addIssue({
            code: "custom",
            message: "non-empty responses require at least one citation",
            path: ["citations"],
          });
        if (value.state === "answered") {
          value.citations.forEach((citation, citationIndex) => {
            if (citation.summaryFreshnessState !== "FRESH")
              refinement.addIssue({
                code: "custom",
                message: "answered responses may cite only FRESH authored summaries",
                path: ["citations", citationIndex, "summaryFreshnessState"],
              });
          });
        }
        if (value.state === "stale") {
          value.citations.forEach((citation, citationIndex) => {
            if (citation.summaryFreshnessState !== "STALE" && citation.summaryFreshnessState !== "EXPIRED")
              refinement.addIssue({
                code: "custom",
                message: "stale responses may cite only STALE or EXPIRED authored summaries",
                path: ["citations", citationIndex, "summaryFreshnessState"],
              });
          });
        }
        if (value.state === "conflict") {
          if (value.citations.length < 2)
            refinement.addIssue({
              code: "custom",
              message: "conflict responses require at least two citations",
              path: ["citations"],
            });
          if (new Set(value.citations.map((citation) => citation.documentId)).size < 2)
            refinement.addIssue({
              code: "custom",
              message: "conflict responses require at least two distinct authored documents",
              path: ["citations"],
            });
          if (new Set(value.citations.map((citation) => citation.verificationLink.sourceId)).size < 2)
            refinement.addIssue({
              code: "custom",
              message: "conflict responses require at least two distinct official verification links",
              path: ["citations"],
            });
          if (new Set(value.citations.map((citation) => citation.contentSha256)).size < 2)
            refinement.addIssue({
              code: "custom",
              message: "conflict responses require genuinely different evidence",
              path: ["citations"],
            });
        }
      }),
  },
  readPersonalVault: {
    "200": z
      .object({
        authorizationManifest: z
          .object({
            createdAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            devices: z
              .array(
                z
                  .object({
                    authorizationKey: z
                      .object({
                        algorithm: z.literal("ED25519"),
                        fingerprint: z
                          .string()
                          .min(43)
                          .max(43)
                          .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                        keyId: z
                          .string()
                          .min(36)
                          .max(36)
                          .regex(
                            new RegExp(
                              "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                            ),
                          ),
                        publicKey: z
                          .string()
                          .min(43)
                          .max(43)
                          .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      })
                      .strict(),
                    createdAt: z.iso
                      .datetime({ offset: true })
                      .min(24)
                      .max(24)
                      .regex(
                        new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                      ),
                    deviceId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    encryptionKey: z
                      .object({
                        algorithm: z.literal("X25519"),
                        fingerprint: z
                          .string()
                          .min(43)
                          .max(43)
                          .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                        keyId: z
                          .string()
                          .min(36)
                          .max(36)
                          .regex(
                            new RegExp(
                              "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                            ),
                          ),
                        publicKey: z
                          .string()
                          .min(43)
                          .max(43)
                          .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      })
                      .strict(),
                    formatVersion: z.literal(2),
                    ownerBinding: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    revokedAt: z.union([
                      z.iso
                        .datetime({ offset: true })
                        .min(24)
                        .max(24)
                        .regex(
                          new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                        ),
                      z.null(),
                    ]),
                  })
                  .strict(),
              )
              .min(1)
              .max(32),
            epoch: z.number().int().min(1).max(9007199254740991),
            formatVersion: z.literal(2),
            ownerBinding: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            recoveryAuthorization: z
              .object({
                algorithm: z.literal("ED25519"),
                createdAt: z.iso
                  .datetime({ offset: true })
                  .min(24)
                  .max(24)
                  .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                fingerprint: z
                  .string()
                  .min(43)
                  .max(43)
                  .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                formatVersion: z.literal(2),
                keyId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                ownerBinding: z
                  .string()
                  .min(43)
                  .max(43)
                  .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                publicKey: z
                  .string()
                  .min(43)
                  .max(43)
                  .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                revokedAt: z.union([
                  z.iso
                    .datetime({ offset: true })
                    .min(24)
                    .max(24)
                    .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                  z.null(),
                ]),
                vaultId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
              })
              .strict(),
            revision: z.number().int().min(1).max(9007199254740991),
            updatedAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            vaultId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          })
          .strict(),
        commit: z
          .object({
            author: z
              .object({
                deviceId: z.union([
                  z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                  z.null(),
                ]),
                keyId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                kind: z.enum(["DEVICE", "RECOVERY"]),
              })
              .strict(),
            authorizationManifestHash: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            createdAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            epoch: z.number().int().min(1).max(9007199254740991),
            formatVersion: z.literal(2),
            keyringHash: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            operationId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
            ownerBinding: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            parentCommitHash: z.union([
              z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              z.null(),
            ]),
            payloadHash: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            sequence: z.number().int().min(1).max(9007199254740991),
            signature: z.string().min(86).max(86).regex(new RegExp("^[A-Za-z0-9_-]{85}[AQgw]$")),
            stateMac: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            vaultId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          })
          .strict(),
        commitHash: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
        formatVersion: z.literal(2),
        keyring: z
          .object({
            createdAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            deviceEnvelopes: z
              .array(
                z
                  .object({
                    cipherSuite: z.literal("X25519_XCHACHA20_POLY1305"),
                    createdAt: z.iso
                      .datetime({ offset: true })
                      .min(24)
                      .max(24)
                      .regex(
                        new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                      ),
                    ephemeralPublicKey: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    formatVersion: z.literal(1),
                    nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
                    recipientDeviceId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    recipientKeyId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    recipientPublicKeyFingerprint: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    vaultId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    vaultKeyId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    wrappedKey: z
                      .string()
                      .min(107)
                      .max(107)
                      .regex(new RegExp("^[A-Za-z0-9_-]{106}[AEIMQUYcgkosw048]$")),
                  })
                  .strict(),
              )
              .min(1)
              .max(32),
            devicePublicKeys: z
              .array(
                z
                  .object({
                    createdAt: z.iso
                      .datetime({ offset: true })
                      .min(24)
                      .max(24)
                      .regex(
                        new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                      ),
                    deviceId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    deviceKeyId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    formatVersion: z.literal(1),
                    keyAlgorithm: z.literal("X25519"),
                    publicKey: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    publicKeyFingerprint: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    revokedAt: z.union([
                      z.iso
                        .datetime({ offset: true })
                        .min(24)
                        .max(24)
                        .regex(
                          new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                        ),
                      z.null(),
                    ]),
                  })
                  .strict(),
              )
              .min(1)
              .max(32)
              .optional(),
            formatVersion: z.literal(1),
            recoveryEnvelope: z
              .object({
                aad: z.string().min(2).max(5462).regex(new RegExp("^[A-Za-z0-9_-]+$")),
                cipherSuite: z.literal("XCHACHA20_POLY1305"),
                createdAt: z.iso
                  .datetime({ offset: true })
                  .min(24)
                  .max(24)
                  .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                formatVersion: z.literal(1),
                kdf: z
                  .object({
                    algorithm: z.literal("ARGON2ID13"),
                    memLimitBytes: z.number().int().min(67108864).max(268435456),
                    opsLimit: z.number().int().min(2).max(4),
                    outputBytes: z.literal(32),
                    salt: z.string().min(22).max(22).regex(new RegExp("^[A-Za-z0-9_-]{21}[AQgw]$")),
                  })
                  .strict(),
                nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
                vaultId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                vaultKeyId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                wrappedKey: z.string().min(64).max(64).regex(new RegExp("^[A-Za-z0-9_-]{64}$")),
              })
              .strict(),
            revision: z.number().int().min(1).max(9007199254740991),
            updatedAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            vaultId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
            vaultKeyId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          })
          .strict(),
        ownerBinding: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
        payload: z
          .object({
            aad: z.string().min(2).max(5462).regex(new RegExp("^[A-Za-z0-9_-]+$")),
            baseRevision: z.union([z.number().int().min(1).max(9007199254740991), z.null()]),
            cipherSuite: z.literal("XCHACHA20_POLY1305"),
            ciphertext: z.string().min(5483).max(11184832).regex(new RegExp("^[A-Za-z0-9_-]+$")),
            contentSchemaVersion: z.literal(1),
            contentType: z.literal("application/vnd.umn-gopher-assistant.personal-vault+json"),
            createdAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            formatVersion: z.literal(2),
            nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
            ownerBinding: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            padding: z
              .object({
                algorithm: z.literal("SODIUM_PAD"),
                blockSize: z.literal(4096),
              })
              .strict(),
            revision: z.number().int().min(1).max(9007199254740991),
            vaultId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
            vaultKeyId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          })
          .strict(),
        vaultId: z
          .string()
          .min(36)
          .max(36)
          .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
      })
      .strict(),
  },
  rotatePersonalVaultKey: {
    "200": z
      .object({
        authorizationManifest: z
          .object({
            createdAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            devices: z
              .array(
                z
                  .object({
                    authorizationKey: z
                      .object({
                        algorithm: z.literal("ED25519"),
                        fingerprint: z
                          .string()
                          .min(43)
                          .max(43)
                          .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                        keyId: z
                          .string()
                          .min(36)
                          .max(36)
                          .regex(
                            new RegExp(
                              "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                            ),
                          ),
                        publicKey: z
                          .string()
                          .min(43)
                          .max(43)
                          .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      })
                      .strict(),
                    createdAt: z.iso
                      .datetime({ offset: true })
                      .min(24)
                      .max(24)
                      .regex(
                        new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                      ),
                    deviceId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    encryptionKey: z
                      .object({
                        algorithm: z.literal("X25519"),
                        fingerprint: z
                          .string()
                          .min(43)
                          .max(43)
                          .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                        keyId: z
                          .string()
                          .min(36)
                          .max(36)
                          .regex(
                            new RegExp(
                              "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                            ),
                          ),
                        publicKey: z
                          .string()
                          .min(43)
                          .max(43)
                          .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      })
                      .strict(),
                    formatVersion: z.literal(2),
                    ownerBinding: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    revokedAt: z.union([
                      z.iso
                        .datetime({ offset: true })
                        .min(24)
                        .max(24)
                        .regex(
                          new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                        ),
                      z.null(),
                    ]),
                  })
                  .strict(),
              )
              .min(1)
              .max(32),
            epoch: z.number().int().min(1).max(9007199254740991),
            formatVersion: z.literal(2),
            ownerBinding: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            recoveryAuthorization: z
              .object({
                algorithm: z.literal("ED25519"),
                createdAt: z.iso
                  .datetime({ offset: true })
                  .min(24)
                  .max(24)
                  .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                fingerprint: z
                  .string()
                  .min(43)
                  .max(43)
                  .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                formatVersion: z.literal(2),
                keyId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                ownerBinding: z
                  .string()
                  .min(43)
                  .max(43)
                  .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                publicKey: z
                  .string()
                  .min(43)
                  .max(43)
                  .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                revokedAt: z.union([
                  z.iso
                    .datetime({ offset: true })
                    .min(24)
                    .max(24)
                    .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                  z.null(),
                ]),
                vaultId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
              })
              .strict(),
            revision: z.number().int().min(1).max(9007199254740991),
            updatedAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            vaultId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          })
          .strict(),
        commit: z
          .object({
            author: z
              .object({
                deviceId: z.union([
                  z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                  z.null(),
                ]),
                keyId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                kind: z.enum(["DEVICE", "RECOVERY"]),
              })
              .strict(),
            authorizationManifestHash: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            createdAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            epoch: z.number().int().min(1).max(9007199254740991),
            formatVersion: z.literal(2),
            keyringHash: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            operationId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
            ownerBinding: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            parentCommitHash: z.union([
              z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              z.null(),
            ]),
            payloadHash: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            sequence: z.number().int().min(1).max(9007199254740991),
            signature: z.string().min(86).max(86).regex(new RegExp("^[A-Za-z0-9_-]{85}[AQgw]$")),
            stateMac: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            vaultId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          })
          .strict(),
        commitHash: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
        formatVersion: z.literal(2),
        keyring: z
          .object({
            createdAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            deviceEnvelopes: z
              .array(
                z
                  .object({
                    cipherSuite: z.literal("X25519_XCHACHA20_POLY1305"),
                    createdAt: z.iso
                      .datetime({ offset: true })
                      .min(24)
                      .max(24)
                      .regex(
                        new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                      ),
                    ephemeralPublicKey: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    formatVersion: z.literal(1),
                    nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
                    recipientDeviceId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    recipientKeyId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    recipientPublicKeyFingerprint: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    vaultId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    vaultKeyId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    wrappedKey: z
                      .string()
                      .min(107)
                      .max(107)
                      .regex(new RegExp("^[A-Za-z0-9_-]{106}[AEIMQUYcgkosw048]$")),
                  })
                  .strict(),
              )
              .min(1)
              .max(32),
            devicePublicKeys: z
              .array(
                z
                  .object({
                    createdAt: z.iso
                      .datetime({ offset: true })
                      .min(24)
                      .max(24)
                      .regex(
                        new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                      ),
                    deviceId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    deviceKeyId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    formatVersion: z.literal(1),
                    keyAlgorithm: z.literal("X25519"),
                    publicKey: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    publicKeyFingerprint: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    revokedAt: z.union([
                      z.iso
                        .datetime({ offset: true })
                        .min(24)
                        .max(24)
                        .regex(
                          new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                        ),
                      z.null(),
                    ]),
                  })
                  .strict(),
              )
              .min(1)
              .max(32)
              .optional(),
            formatVersion: z.literal(1),
            recoveryEnvelope: z
              .object({
                aad: z.string().min(2).max(5462).regex(new RegExp("^[A-Za-z0-9_-]+$")),
                cipherSuite: z.literal("XCHACHA20_POLY1305"),
                createdAt: z.iso
                  .datetime({ offset: true })
                  .min(24)
                  .max(24)
                  .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                formatVersion: z.literal(1),
                kdf: z
                  .object({
                    algorithm: z.literal("ARGON2ID13"),
                    memLimitBytes: z.number().int().min(67108864).max(268435456),
                    opsLimit: z.number().int().min(2).max(4),
                    outputBytes: z.literal(32),
                    salt: z.string().min(22).max(22).regex(new RegExp("^[A-Za-z0-9_-]{21}[AQgw]$")),
                  })
                  .strict(),
                nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
                vaultId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                vaultKeyId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                wrappedKey: z.string().min(64).max(64).regex(new RegExp("^[A-Za-z0-9_-]{64}$")),
              })
              .strict(),
            revision: z.number().int().min(1).max(9007199254740991),
            updatedAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            vaultId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
            vaultKeyId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          })
          .strict(),
        ownerBinding: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
        payload: z
          .object({
            aad: z.string().min(2).max(5462).regex(new RegExp("^[A-Za-z0-9_-]+$")),
            baseRevision: z.union([z.number().int().min(1).max(9007199254740991), z.null()]),
            cipherSuite: z.literal("XCHACHA20_POLY1305"),
            ciphertext: z.string().min(5483).max(11184832).regex(new RegExp("^[A-Za-z0-9_-]+$")),
            contentSchemaVersion: z.literal(1),
            contentType: z.literal("application/vnd.umn-gopher-assistant.personal-vault+json"),
            createdAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            formatVersion: z.literal(2),
            nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
            ownerBinding: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            padding: z
              .object({
                algorithm: z.literal("SODIUM_PAD"),
                blockSize: z.literal(4096),
              })
              .strict(),
            revision: z.number().int().min(1).max(9007199254740991),
            vaultId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
            vaultKeyId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          })
          .strict(),
        vaultId: z
          .string()
          .min(36)
          .max(36)
          .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
      })
      .strict(),
  },
  updatePersonalVaultPayload: {
    "200": z
      .object({
        authorizationManifest: z
          .object({
            createdAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            devices: z
              .array(
                z
                  .object({
                    authorizationKey: z
                      .object({
                        algorithm: z.literal("ED25519"),
                        fingerprint: z
                          .string()
                          .min(43)
                          .max(43)
                          .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                        keyId: z
                          .string()
                          .min(36)
                          .max(36)
                          .regex(
                            new RegExp(
                              "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                            ),
                          ),
                        publicKey: z
                          .string()
                          .min(43)
                          .max(43)
                          .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      })
                      .strict(),
                    createdAt: z.iso
                      .datetime({ offset: true })
                      .min(24)
                      .max(24)
                      .regex(
                        new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                      ),
                    deviceId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    encryptionKey: z
                      .object({
                        algorithm: z.literal("X25519"),
                        fingerprint: z
                          .string()
                          .min(43)
                          .max(43)
                          .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                        keyId: z
                          .string()
                          .min(36)
                          .max(36)
                          .regex(
                            new RegExp(
                              "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                            ),
                          ),
                        publicKey: z
                          .string()
                          .min(43)
                          .max(43)
                          .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      })
                      .strict(),
                    formatVersion: z.literal(2),
                    ownerBinding: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    revokedAt: z.union([
                      z.iso
                        .datetime({ offset: true })
                        .min(24)
                        .max(24)
                        .regex(
                          new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                        ),
                      z.null(),
                    ]),
                  })
                  .strict(),
              )
              .min(1)
              .max(32),
            epoch: z.number().int().min(1).max(9007199254740991),
            formatVersion: z.literal(2),
            ownerBinding: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            recoveryAuthorization: z
              .object({
                algorithm: z.literal("ED25519"),
                createdAt: z.iso
                  .datetime({ offset: true })
                  .min(24)
                  .max(24)
                  .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                fingerprint: z
                  .string()
                  .min(43)
                  .max(43)
                  .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                formatVersion: z.literal(2),
                keyId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                ownerBinding: z
                  .string()
                  .min(43)
                  .max(43)
                  .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                publicKey: z
                  .string()
                  .min(43)
                  .max(43)
                  .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                revokedAt: z.union([
                  z.iso
                    .datetime({ offset: true })
                    .min(24)
                    .max(24)
                    .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                  z.null(),
                ]),
                vaultId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
              })
              .strict(),
            revision: z.number().int().min(1).max(9007199254740991),
            updatedAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            vaultId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          })
          .strict(),
        commit: z
          .object({
            author: z
              .object({
                deviceId: z.union([
                  z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                  z.null(),
                ]),
                keyId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                kind: z.enum(["DEVICE", "RECOVERY"]),
              })
              .strict(),
            authorizationManifestHash: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            createdAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            epoch: z.number().int().min(1).max(9007199254740991),
            formatVersion: z.literal(2),
            keyringHash: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            operationId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
            ownerBinding: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            parentCommitHash: z.union([
              z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              z.null(),
            ]),
            payloadHash: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            sequence: z.number().int().min(1).max(9007199254740991),
            signature: z.string().min(86).max(86).regex(new RegExp("^[A-Za-z0-9_-]{85}[AQgw]$")),
            stateMac: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            vaultId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          })
          .strict(),
        commitHash: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
        formatVersion: z.literal(2),
        keyring: z
          .object({
            createdAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            deviceEnvelopes: z
              .array(
                z
                  .object({
                    cipherSuite: z.literal("X25519_XCHACHA20_POLY1305"),
                    createdAt: z.iso
                      .datetime({ offset: true })
                      .min(24)
                      .max(24)
                      .regex(
                        new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                      ),
                    ephemeralPublicKey: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    formatVersion: z.literal(1),
                    nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
                    recipientDeviceId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    recipientKeyId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    recipientPublicKeyFingerprint: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    vaultId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    vaultKeyId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    wrappedKey: z
                      .string()
                      .min(107)
                      .max(107)
                      .regex(new RegExp("^[A-Za-z0-9_-]{106}[AEIMQUYcgkosw048]$")),
                  })
                  .strict(),
              )
              .min(1)
              .max(32),
            devicePublicKeys: z
              .array(
                z
                  .object({
                    createdAt: z.iso
                      .datetime({ offset: true })
                      .min(24)
                      .max(24)
                      .regex(
                        new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                      ),
                    deviceId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    deviceKeyId: z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    formatVersion: z.literal(1),
                    keyAlgorithm: z.literal("X25519"),
                    publicKey: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    publicKeyFingerprint: z
                      .string()
                      .min(43)
                      .max(43)
                      .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    revokedAt: z.union([
                      z.iso
                        .datetime({ offset: true })
                        .min(24)
                        .max(24)
                        .regex(
                          new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                        ),
                      z.null(),
                    ]),
                  })
                  .strict(),
              )
              .min(1)
              .max(32)
              .optional(),
            formatVersion: z.literal(1),
            recoveryEnvelope: z
              .object({
                aad: z.string().min(2).max(5462).regex(new RegExp("^[A-Za-z0-9_-]+$")),
                cipherSuite: z.literal("XCHACHA20_POLY1305"),
                createdAt: z.iso
                  .datetime({ offset: true })
                  .min(24)
                  .max(24)
                  .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                formatVersion: z.literal(1),
                kdf: z
                  .object({
                    algorithm: z.literal("ARGON2ID13"),
                    memLimitBytes: z.number().int().min(67108864).max(268435456),
                    opsLimit: z.number().int().min(2).max(4),
                    outputBytes: z.literal(32),
                    salt: z.string().min(22).max(22).regex(new RegExp("^[A-Za-z0-9_-]{21}[AQgw]$")),
                  })
                  .strict(),
                nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
                vaultId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                vaultKeyId: z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                wrappedKey: z.string().min(64).max(64).regex(new RegExp("^[A-Za-z0-9_-]{64}$")),
              })
              .strict(),
            revision: z.number().int().min(1).max(9007199254740991),
            updatedAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            vaultId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
            vaultKeyId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          })
          .strict(),
        ownerBinding: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
        payload: z
          .object({
            aad: z.string().min(2).max(5462).regex(new RegExp("^[A-Za-z0-9_-]+$")),
            baseRevision: z.union([z.number().int().min(1).max(9007199254740991), z.null()]),
            cipherSuite: z.literal("XCHACHA20_POLY1305"),
            ciphertext: z.string().min(5483).max(11184832).regex(new RegExp("^[A-Za-z0-9_-]+$")),
            contentSchemaVersion: z.literal(1),
            contentType: z.literal("application/vnd.umn-gopher-assistant.personal-vault+json"),
            createdAt: z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            formatVersion: z.literal(2),
            nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
            ownerBinding: z
              .string()
              .min(43)
              .max(43)
              .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            padding: z
              .object({
                algorithm: z.literal("SODIUM_PAD"),
                blockSize: z.literal(4096),
              })
              .strict(),
            revision: z.number().int().min(1).max(9007199254740991),
            vaultId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
            vaultKeyId: z
              .string()
              .min(36)
              .max(36)
              .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          })
          .strict(),
        vaultId: z
          .string()
          .min(36)
          .max(36)
          .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
      })
      .strict(),
  },
} satisfies Record<ImplementedOperationId, Readonly<Record<number, z.ZodType>>>;

const implementedRequestBodySchemas = {
  approvePersonalVaultDevicePairing: z
    .object({
      command: z
        .object({
          commandType: z.literal("PAIR_DEVICE"),
          expectedParentCommitHash: z
            .string()
            .min(43)
            .max(43)
            .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
          formatVersion: z.literal(2),
          nextSnapshot: z
            .object({
              authorizationManifest: z
                .object({
                  createdAt: z.iso
                    .datetime({ offset: true })
                    .min(24)
                    .max(24)
                    .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                  devices: z
                    .array(
                      z
                        .object({
                          authorizationKey: z
                            .object({
                              algorithm: z.literal("ED25519"),
                              fingerprint: z
                                .string()
                                .min(43)
                                .max(43)
                                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                              keyId: z
                                .string()
                                .min(36)
                                .max(36)
                                .regex(
                                  new RegExp(
                                    "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                                  ),
                                ),
                              publicKey: z
                                .string()
                                .min(43)
                                .max(43)
                                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                            })
                            .strict(),
                          createdAt: z.iso
                            .datetime({ offset: true })
                            .min(24)
                            .max(24)
                            .regex(
                              new RegExp(
                                "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$",
                              ),
                            ),
                          deviceId: z
                            .string()
                            .min(36)
                            .max(36)
                            .regex(
                              new RegExp(
                                "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                              ),
                            ),
                          encryptionKey: z
                            .object({
                              algorithm: z.literal("X25519"),
                              fingerprint: z
                                .string()
                                .min(43)
                                .max(43)
                                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                              keyId: z
                                .string()
                                .min(36)
                                .max(36)
                                .regex(
                                  new RegExp(
                                    "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                                  ),
                                ),
                              publicKey: z
                                .string()
                                .min(43)
                                .max(43)
                                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                            })
                            .strict(),
                          formatVersion: z.literal(2),
                          ownerBinding: z
                            .string()
                            .min(43)
                            .max(43)
                            .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                          revokedAt: z.union([
                            z.iso
                              .datetime({ offset: true })
                              .min(24)
                              .max(24)
                              .regex(
                                new RegExp(
                                  "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$",
                                ),
                              ),
                            z.null(),
                          ]),
                        })
                        .strict(),
                    )
                    .min(1)
                    .max(32),
                  epoch: z.number().int().min(1).max(9007199254740991),
                  formatVersion: z.literal(2),
                  ownerBinding: z
                    .string()
                    .min(43)
                    .max(43)
                    .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                  recoveryAuthorization: z
                    .object({
                      algorithm: z.literal("ED25519"),
                      createdAt: z.iso
                        .datetime({ offset: true })
                        .min(24)
                        .max(24)
                        .regex(
                          new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                        ),
                      fingerprint: z
                        .string()
                        .min(43)
                        .max(43)
                        .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      formatVersion: z.literal(2),
                      keyId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      ownerBinding: z
                        .string()
                        .min(43)
                        .max(43)
                        .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      publicKey: z
                        .string()
                        .min(43)
                        .max(43)
                        .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      revokedAt: z.union([
                        z.iso
                          .datetime({ offset: true })
                          .min(24)
                          .max(24)
                          .regex(
                            new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                          ),
                        z.null(),
                      ]),
                      vaultId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                    })
                    .strict(),
                  revision: z.number().int().min(1).max(9007199254740991),
                  updatedAt: z.iso
                    .datetime({ offset: true })
                    .min(24)
                    .max(24)
                    .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                  vaultId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                })
                .strict(),
              commit: z
                .object({
                  author: z
                    .object({
                      deviceId: z.union([
                        z
                          .string()
                          .min(36)
                          .max(36)
                          .regex(
                            new RegExp(
                              "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                            ),
                          ),
                        z.null(),
                      ]),
                      keyId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      kind: z.enum(["DEVICE", "RECOVERY"]),
                    })
                    .strict(),
                  authorizationManifestHash: z
                    .string()
                    .min(43)
                    .max(43)
                    .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                  createdAt: z.iso
                    .datetime({ offset: true })
                    .min(24)
                    .max(24)
                    .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                  epoch: z.number().int().min(1).max(9007199254740991),
                  formatVersion: z.literal(2),
                  keyringHash: z
                    .string()
                    .min(43)
                    .max(43)
                    .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                  operationId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                  ownerBinding: z
                    .string()
                    .min(43)
                    .max(43)
                    .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                  parentCommitHash: z.union([
                    z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                    z.null(),
                  ]),
                  payloadHash: z
                    .string()
                    .min(43)
                    .max(43)
                    .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                  sequence: z.number().int().min(1).max(9007199254740991),
                  signature: z.string().min(86).max(86).regex(new RegExp("^[A-Za-z0-9_-]{85}[AQgw]$")),
                  stateMac: z
                    .string()
                    .min(43)
                    .max(43)
                    .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                  vaultId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                })
                .strict(),
              commitHash: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              formatVersion: z.literal(2),
              keyring: z
                .object({
                  createdAt: z.iso
                    .datetime({ offset: true })
                    .min(24)
                    .max(24)
                    .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                  deviceEnvelopes: z
                    .array(
                      z
                        .object({
                          cipherSuite: z.literal("X25519_XCHACHA20_POLY1305"),
                          createdAt: z.iso
                            .datetime({ offset: true })
                            .min(24)
                            .max(24)
                            .regex(
                              new RegExp(
                                "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$",
                              ),
                            ),
                          ephemeralPublicKey: z
                            .string()
                            .min(43)
                            .max(43)
                            .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                          formatVersion: z.literal(1),
                          nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
                          recipientDeviceId: z
                            .string()
                            .min(36)
                            .max(36)
                            .regex(
                              new RegExp(
                                "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                              ),
                            ),
                          recipientKeyId: z
                            .string()
                            .min(36)
                            .max(36)
                            .regex(
                              new RegExp(
                                "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                              ),
                            ),
                          recipientPublicKeyFingerprint: z
                            .string()
                            .min(43)
                            .max(43)
                            .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                          vaultId: z
                            .string()
                            .min(36)
                            .max(36)
                            .regex(
                              new RegExp(
                                "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                              ),
                            ),
                          vaultKeyId: z
                            .string()
                            .min(36)
                            .max(36)
                            .regex(
                              new RegExp(
                                "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                              ),
                            ),
                          wrappedKey: z
                            .string()
                            .min(107)
                            .max(107)
                            .regex(new RegExp("^[A-Za-z0-9_-]{106}[AEIMQUYcgkosw048]$")),
                        })
                        .strict(),
                    )
                    .min(1)
                    .max(32),
                  devicePublicKeys: z
                    .array(
                      z
                        .object({
                          createdAt: z.iso
                            .datetime({ offset: true })
                            .min(24)
                            .max(24)
                            .regex(
                              new RegExp(
                                "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$",
                              ),
                            ),
                          deviceId: z
                            .string()
                            .min(36)
                            .max(36)
                            .regex(
                              new RegExp(
                                "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                              ),
                            ),
                          deviceKeyId: z
                            .string()
                            .min(36)
                            .max(36)
                            .regex(
                              new RegExp(
                                "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                              ),
                            ),
                          formatVersion: z.literal(1),
                          keyAlgorithm: z.literal("X25519"),
                          publicKey: z
                            .string()
                            .min(43)
                            .max(43)
                            .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                          publicKeyFingerprint: z
                            .string()
                            .min(43)
                            .max(43)
                            .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                          revokedAt: z.union([
                            z.iso
                              .datetime({ offset: true })
                              .min(24)
                              .max(24)
                              .regex(
                                new RegExp(
                                  "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$",
                                ),
                              ),
                            z.null(),
                          ]),
                        })
                        .strict(),
                    )
                    .min(1)
                    .max(32)
                    .optional(),
                  formatVersion: z.literal(1),
                  recoveryEnvelope: z
                    .object({
                      aad: z.string().min(2).max(5462).regex(new RegExp("^[A-Za-z0-9_-]+$")),
                      cipherSuite: z.literal("XCHACHA20_POLY1305"),
                      createdAt: z.iso
                        .datetime({ offset: true })
                        .min(24)
                        .max(24)
                        .regex(
                          new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                        ),
                      formatVersion: z.literal(1),
                      kdf: z
                        .object({
                          algorithm: z.literal("ARGON2ID13"),
                          memLimitBytes: z.number().int().min(67108864).max(268435456),
                          opsLimit: z.number().int().min(2).max(4),
                          outputBytes: z.literal(32),
                          salt: z.string().min(22).max(22).regex(new RegExp("^[A-Za-z0-9_-]{21}[AQgw]$")),
                        })
                        .strict(),
                      nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
                      vaultId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      vaultKeyId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      wrappedKey: z.string().min(64).max(64).regex(new RegExp("^[A-Za-z0-9_-]{64}$")),
                    })
                    .strict(),
                  revision: z.number().int().min(1).max(9007199254740991),
                  updatedAt: z.iso
                    .datetime({ offset: true })
                    .min(24)
                    .max(24)
                    .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                  vaultId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                  vaultKeyId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                })
                .strict(),
              ownerBinding: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              payload: z
                .object({
                  aad: z.string().min(2).max(5462).regex(new RegExp("^[A-Za-z0-9_-]+$")),
                  baseRevision: z.union([z.number().int().min(1).max(9007199254740991), z.null()]),
                  cipherSuite: z.literal("XCHACHA20_POLY1305"),
                  ciphertext: z.string().min(5483).max(11184832).regex(new RegExp("^[A-Za-z0-9_-]+$")),
                  contentSchemaVersion: z.literal(1),
                  contentType: z.literal("application/vnd.umn-gopher-assistant.personal-vault+json"),
                  createdAt: z.iso
                    .datetime({ offset: true })
                    .min(24)
                    .max(24)
                    .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                  formatVersion: z.literal(2),
                  nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
                  ownerBinding: z
                    .string()
                    .min(43)
                    .max(43)
                    .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                  padding: z
                    .object({
                      algorithm: z.literal("SODIUM_PAD"),
                      blockSize: z.literal(4096),
                    })
                    .strict(),
                  revision: z.number().int().min(1).max(9007199254740991),
                  vaultId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                  vaultKeyId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                })
                .strict(),
              vaultId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
            })
            .strict(),
          operationId: z
            .string()
            .min(36)
            .max(36)
            .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          ownerBinding: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
          pairedDevice: z
            .object({
              authorizationKey: z
                .object({
                  algorithm: z.literal("ED25519"),
                  fingerprint: z
                    .string()
                    .min(43)
                    .max(43)
                    .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                  keyId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                  publicKey: z
                    .string()
                    .min(43)
                    .max(43)
                    .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                })
                .strict(),
              createdAt: z.iso
                .datetime({ offset: true })
                .min(24)
                .max(24)
                .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
              deviceId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
              encryptionKey: z
                .object({
                  algorithm: z.literal("X25519"),
                  fingerprint: z
                    .string()
                    .min(43)
                    .max(43)
                    .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                  keyId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                  publicKey: z
                    .string()
                    .min(43)
                    .max(43)
                    .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                })
                .strict(),
              formatVersion: z.literal(2),
              ownerBinding: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              revokedAt: z.union([
                z.iso
                  .datetime({ offset: true })
                  .min(24)
                  .max(24)
                  .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                z.null(),
              ]),
            })
            .strict(),
          proof: z
            .object({
              commandType: z.enum(["CREATE_VAULT", "UPDATE_PAYLOAD", "PAIR_DEVICE", "ROTATE_KEY"]),
              expectedParentCommitHash: z.union([
                z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                z.null(),
              ]),
              expiresAt: z.iso
                .datetime({ offset: true })
                .min(24)
                .max(24)
                .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
              formatVersion: z.literal(2),
              issuedAt: z.iso
                .datetime({ offset: true })
                .min(24)
                .max(24)
                .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
              nextCommitHash: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              operationId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
              ownerBinding: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              signature: z.string().min(86).max(86).regex(new RegExp("^[A-Za-z0-9_-]{85}[AQgw]$")),
              signer: z
                .object({
                  deviceId: z.union([
                    z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    z.null(),
                  ]),
                  keyId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                  kind: z.enum(["DEVICE", "RECOVERY"]),
                })
                .strict(),
              vaultId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
            })
            .strict(),
          vaultId: z
            .string()
            .min(36)
            .max(36)
            .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
        })
        .strict(),
      pairingCodeCommitment: z
        .string()
        .min(43)
        .max(43)
        .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
    })
    .strict(),
  createPersonalVault: z
    .object({
      commandType: z.literal("CREATE_VAULT"),
      formatVersion: z.literal(2),
      operationId: z
        .string()
        .min(36)
        .max(36)
        .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
      ownerBinding: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
      proof: z
        .object({
          commandType: z.enum(["CREATE_VAULT", "UPDATE_PAYLOAD", "PAIR_DEVICE", "ROTATE_KEY"]),
          expectedParentCommitHash: z.union([
            z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            z.null(),
          ]),
          expiresAt: z.iso
            .datetime({ offset: true })
            .min(24)
            .max(24)
            .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
          formatVersion: z.literal(2),
          issuedAt: z.iso
            .datetime({ offset: true })
            .min(24)
            .max(24)
            .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
          nextCommitHash: z
            .string()
            .min(43)
            .max(43)
            .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
          operationId: z
            .string()
            .min(36)
            .max(36)
            .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          ownerBinding: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
          signature: z.string().min(86).max(86).regex(new RegExp("^[A-Za-z0-9_-]{85}[AQgw]$")),
          signer: z
            .object({
              deviceId: z.union([
                z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                z.null(),
              ]),
              keyId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
              kind: z.enum(["DEVICE", "RECOVERY"]),
            })
            .strict(),
          vaultId: z
            .string()
            .min(36)
            .max(36)
            .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
        })
        .strict(),
      snapshot: z
        .object({
          authorizationManifest: z
            .object({
              createdAt: z.iso
                .datetime({ offset: true })
                .min(24)
                .max(24)
                .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
              devices: z
                .array(
                  z
                    .object({
                      authorizationKey: z
                        .object({
                          algorithm: z.literal("ED25519"),
                          fingerprint: z
                            .string()
                            .min(43)
                            .max(43)
                            .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                          keyId: z
                            .string()
                            .min(36)
                            .max(36)
                            .regex(
                              new RegExp(
                                "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                              ),
                            ),
                          publicKey: z
                            .string()
                            .min(43)
                            .max(43)
                            .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                        })
                        .strict(),
                      createdAt: z.iso
                        .datetime({ offset: true })
                        .min(24)
                        .max(24)
                        .regex(
                          new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                        ),
                      deviceId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      encryptionKey: z
                        .object({
                          algorithm: z.literal("X25519"),
                          fingerprint: z
                            .string()
                            .min(43)
                            .max(43)
                            .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                          keyId: z
                            .string()
                            .min(36)
                            .max(36)
                            .regex(
                              new RegExp(
                                "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                              ),
                            ),
                          publicKey: z
                            .string()
                            .min(43)
                            .max(43)
                            .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                        })
                        .strict(),
                      formatVersion: z.literal(2),
                      ownerBinding: z
                        .string()
                        .min(43)
                        .max(43)
                        .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      revokedAt: z.union([
                        z.iso
                          .datetime({ offset: true })
                          .min(24)
                          .max(24)
                          .regex(
                            new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                          ),
                        z.null(),
                      ]),
                    })
                    .strict(),
                )
                .min(1)
                .max(32),
              epoch: z.number().int().min(1).max(9007199254740991),
              formatVersion: z.literal(2),
              ownerBinding: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              recoveryAuthorization: z
                .object({
                  algorithm: z.literal("ED25519"),
                  createdAt: z.iso
                    .datetime({ offset: true })
                    .min(24)
                    .max(24)
                    .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                  fingerprint: z
                    .string()
                    .min(43)
                    .max(43)
                    .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                  formatVersion: z.literal(2),
                  keyId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                  ownerBinding: z
                    .string()
                    .min(43)
                    .max(43)
                    .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                  publicKey: z
                    .string()
                    .min(43)
                    .max(43)
                    .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                  revokedAt: z.union([
                    z.iso
                      .datetime({ offset: true })
                      .min(24)
                      .max(24)
                      .regex(
                        new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                      ),
                    z.null(),
                  ]),
                  vaultId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                })
                .strict(),
              revision: z.number().int().min(1).max(9007199254740991),
              updatedAt: z.iso
                .datetime({ offset: true })
                .min(24)
                .max(24)
                .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
              vaultId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
            })
            .strict(),
          commit: z
            .object({
              author: z
                .object({
                  deviceId: z.union([
                    z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    z.null(),
                  ]),
                  keyId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                  kind: z.enum(["DEVICE", "RECOVERY"]),
                })
                .strict(),
              authorizationManifestHash: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              createdAt: z.iso
                .datetime({ offset: true })
                .min(24)
                .max(24)
                .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
              epoch: z.number().int().min(1).max(9007199254740991),
              formatVersion: z.literal(2),
              keyringHash: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              operationId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
              ownerBinding: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              parentCommitHash: z.union([
                z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                z.null(),
              ]),
              payloadHash: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              sequence: z.number().int().min(1).max(9007199254740991),
              signature: z.string().min(86).max(86).regex(new RegExp("^[A-Za-z0-9_-]{85}[AQgw]$")),
              stateMac: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              vaultId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
            })
            .strict(),
          commitHash: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
          formatVersion: z.literal(2),
          keyring: z
            .object({
              createdAt: z.iso
                .datetime({ offset: true })
                .min(24)
                .max(24)
                .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
              deviceEnvelopes: z
                .array(
                  z
                    .object({
                      cipherSuite: z.literal("X25519_XCHACHA20_POLY1305"),
                      createdAt: z.iso
                        .datetime({ offset: true })
                        .min(24)
                        .max(24)
                        .regex(
                          new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                        ),
                      ephemeralPublicKey: z
                        .string()
                        .min(43)
                        .max(43)
                        .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      formatVersion: z.literal(1),
                      nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
                      recipientDeviceId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      recipientKeyId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      recipientPublicKeyFingerprint: z
                        .string()
                        .min(43)
                        .max(43)
                        .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      vaultId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      vaultKeyId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      wrappedKey: z
                        .string()
                        .min(107)
                        .max(107)
                        .regex(new RegExp("^[A-Za-z0-9_-]{106}[AEIMQUYcgkosw048]$")),
                    })
                    .strict(),
                )
                .min(1)
                .max(32),
              devicePublicKeys: z
                .array(
                  z
                    .object({
                      createdAt: z.iso
                        .datetime({ offset: true })
                        .min(24)
                        .max(24)
                        .regex(
                          new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                        ),
                      deviceId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      deviceKeyId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      formatVersion: z.literal(1),
                      keyAlgorithm: z.literal("X25519"),
                      publicKey: z
                        .string()
                        .min(43)
                        .max(43)
                        .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      publicKeyFingerprint: z
                        .string()
                        .min(43)
                        .max(43)
                        .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      revokedAt: z.union([
                        z.iso
                          .datetime({ offset: true })
                          .min(24)
                          .max(24)
                          .regex(
                            new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                          ),
                        z.null(),
                      ]),
                    })
                    .strict(),
                )
                .min(1)
                .max(32)
                .optional(),
              formatVersion: z.literal(1),
              recoveryEnvelope: z
                .object({
                  aad: z.string().min(2).max(5462).regex(new RegExp("^[A-Za-z0-9_-]+$")),
                  cipherSuite: z.literal("XCHACHA20_POLY1305"),
                  createdAt: z.iso
                    .datetime({ offset: true })
                    .min(24)
                    .max(24)
                    .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                  formatVersion: z.literal(1),
                  kdf: z
                    .object({
                      algorithm: z.literal("ARGON2ID13"),
                      memLimitBytes: z.number().int().min(67108864).max(268435456),
                      opsLimit: z.number().int().min(2).max(4),
                      outputBytes: z.literal(32),
                      salt: z.string().min(22).max(22).regex(new RegExp("^[A-Za-z0-9_-]{21}[AQgw]$")),
                    })
                    .strict(),
                  nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
                  vaultId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                  vaultKeyId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                  wrappedKey: z.string().min(64).max(64).regex(new RegExp("^[A-Za-z0-9_-]{64}$")),
                })
                .strict(),
              revision: z.number().int().min(1).max(9007199254740991),
              updatedAt: z.iso
                .datetime({ offset: true })
                .min(24)
                .max(24)
                .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
              vaultId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
              vaultKeyId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
            })
            .strict(),
          ownerBinding: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
          payload: z
            .object({
              aad: z.string().min(2).max(5462).regex(new RegExp("^[A-Za-z0-9_-]+$")),
              baseRevision: z.union([z.number().int().min(1).max(9007199254740991), z.null()]),
              cipherSuite: z.literal("XCHACHA20_POLY1305"),
              ciphertext: z.string().min(5483).max(11184832).regex(new RegExp("^[A-Za-z0-9_-]+$")),
              contentSchemaVersion: z.literal(1),
              contentType: z.literal("application/vnd.umn-gopher-assistant.personal-vault+json"),
              createdAt: z.iso
                .datetime({ offset: true })
                .min(24)
                .max(24)
                .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
              formatVersion: z.literal(2),
              nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
              ownerBinding: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              padding: z
                .object({
                  algorithm: z.literal("SODIUM_PAD"),
                  blockSize: z.literal(4096),
                })
                .strict(),
              revision: z.number().int().min(1).max(9007199254740991),
              vaultId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
              vaultKeyId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
            })
            .strict(),
          vaultId: z
            .string()
            .min(36)
            .max(36)
            .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
        })
        .strict(),
      vaultId: z
        .string()
        .min(36)
        .max(36)
        .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
    })
    .strict(),
  createPersonalVaultDevicePairing: z
    .object({
      expiresAt: z.iso
        .datetime({ offset: true })
        .min(24)
        .max(24)
        .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
      formatVersion: z.literal(2),
      issuedAt: z.iso
        .datetime({ offset: true })
        .min(24)
        .max(24)
        .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
      operationId: z
        .string()
        .min(36)
        .max(36)
        .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
      ownerBinding: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
      pairingCodeCommitment: z
        .string()
        .min(43)
        .max(43)
        .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
      requestingDevice: z
        .object({
          authorizationKey: z
            .object({
              algorithm: z.literal("ED25519"),
              fingerprint: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              keyId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
              publicKey: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            })
            .strict(),
          createdAt: z.iso
            .datetime({ offset: true })
            .min(24)
            .max(24)
            .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
          deviceId: z
            .string()
            .min(36)
            .max(36)
            .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          encryptionKey: z
            .object({
              algorithm: z.literal("X25519"),
              fingerprint: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              keyId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
              publicKey: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            })
            .strict(),
          formatVersion: z.literal(2),
          ownerBinding: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
          revokedAt: z.union([
            z.iso
              .datetime({ offset: true })
              .min(24)
              .max(24)
              .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
            z.null(),
          ]),
        })
        .strict(),
      signature: z.string().min(86).max(86).regex(new RegExp("^[A-Za-z0-9_-]{85}[AQgw]$")),
      vaultId: z
        .string()
        .min(36)
        .max(36)
        .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
    })
    .strict(),
  queryCampusAssistant: z
    .object({
      campusId: z.enum(["tc", "duluth", "crookston", "morris", "rochester"]),
      locale: z.enum(["en", "zh-CN"]),
      query: z
        .string()
        .trim()
        .min(2)
        .max(500)
        .regex(new RegExp("^\\S(?:[\\s\\S]{0,498}\\S)?$"))
        .refine((value) => value.normalize("NFC") === value, {
          message: "Query must use NFC Unicode normalization",
        })
        .refine((value) => !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value), {
          message: "Query cannot contain control or format characters",
        })
        .refine((value) => !/[<>]|&(?:#(?:[xX][0-9A-Fa-f]+|\d+)|[A-Za-z][A-Za-z0-9]{1,31});?/u.test(value), {
          message: "Query cannot contain HTML or encoded HTML",
        }),
    })
    .strict(),
  rotatePersonalVaultKey: z
    .object({
      commandType: z.literal("ROTATE_KEY"),
      expectedParentCommitHash: z
        .string()
        .min(43)
        .max(43)
        .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
      formatVersion: z.literal(2),
      nextSnapshot: z
        .object({
          authorizationManifest: z
            .object({
              createdAt: z.iso
                .datetime({ offset: true })
                .min(24)
                .max(24)
                .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
              devices: z
                .array(
                  z
                    .object({
                      authorizationKey: z
                        .object({
                          algorithm: z.literal("ED25519"),
                          fingerprint: z
                            .string()
                            .min(43)
                            .max(43)
                            .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                          keyId: z
                            .string()
                            .min(36)
                            .max(36)
                            .regex(
                              new RegExp(
                                "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                              ),
                            ),
                          publicKey: z
                            .string()
                            .min(43)
                            .max(43)
                            .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                        })
                        .strict(),
                      createdAt: z.iso
                        .datetime({ offset: true })
                        .min(24)
                        .max(24)
                        .regex(
                          new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                        ),
                      deviceId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      encryptionKey: z
                        .object({
                          algorithm: z.literal("X25519"),
                          fingerprint: z
                            .string()
                            .min(43)
                            .max(43)
                            .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                          keyId: z
                            .string()
                            .min(36)
                            .max(36)
                            .regex(
                              new RegExp(
                                "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                              ),
                            ),
                          publicKey: z
                            .string()
                            .min(43)
                            .max(43)
                            .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                        })
                        .strict(),
                      formatVersion: z.literal(2),
                      ownerBinding: z
                        .string()
                        .min(43)
                        .max(43)
                        .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      revokedAt: z.union([
                        z.iso
                          .datetime({ offset: true })
                          .min(24)
                          .max(24)
                          .regex(
                            new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                          ),
                        z.null(),
                      ]),
                    })
                    .strict(),
                )
                .min(1)
                .max(32),
              epoch: z.number().int().min(1).max(9007199254740991),
              formatVersion: z.literal(2),
              ownerBinding: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              recoveryAuthorization: z
                .object({
                  algorithm: z.literal("ED25519"),
                  createdAt: z.iso
                    .datetime({ offset: true })
                    .min(24)
                    .max(24)
                    .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                  fingerprint: z
                    .string()
                    .min(43)
                    .max(43)
                    .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                  formatVersion: z.literal(2),
                  keyId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                  ownerBinding: z
                    .string()
                    .min(43)
                    .max(43)
                    .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                  publicKey: z
                    .string()
                    .min(43)
                    .max(43)
                    .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                  revokedAt: z.union([
                    z.iso
                      .datetime({ offset: true })
                      .min(24)
                      .max(24)
                      .regex(
                        new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                      ),
                    z.null(),
                  ]),
                  vaultId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                })
                .strict(),
              revision: z.number().int().min(1).max(9007199254740991),
              updatedAt: z.iso
                .datetime({ offset: true })
                .min(24)
                .max(24)
                .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
              vaultId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
            })
            .strict(),
          commit: z
            .object({
              author: z
                .object({
                  deviceId: z.union([
                    z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    z.null(),
                  ]),
                  keyId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                  kind: z.enum(["DEVICE", "RECOVERY"]),
                })
                .strict(),
              authorizationManifestHash: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              createdAt: z.iso
                .datetime({ offset: true })
                .min(24)
                .max(24)
                .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
              epoch: z.number().int().min(1).max(9007199254740991),
              formatVersion: z.literal(2),
              keyringHash: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              operationId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
              ownerBinding: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              parentCommitHash: z.union([
                z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                z.null(),
              ]),
              payloadHash: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              sequence: z.number().int().min(1).max(9007199254740991),
              signature: z.string().min(86).max(86).regex(new RegExp("^[A-Za-z0-9_-]{85}[AQgw]$")),
              stateMac: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              vaultId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
            })
            .strict(),
          commitHash: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
          formatVersion: z.literal(2),
          keyring: z
            .object({
              createdAt: z.iso
                .datetime({ offset: true })
                .min(24)
                .max(24)
                .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
              deviceEnvelopes: z
                .array(
                  z
                    .object({
                      cipherSuite: z.literal("X25519_XCHACHA20_POLY1305"),
                      createdAt: z.iso
                        .datetime({ offset: true })
                        .min(24)
                        .max(24)
                        .regex(
                          new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                        ),
                      ephemeralPublicKey: z
                        .string()
                        .min(43)
                        .max(43)
                        .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      formatVersion: z.literal(1),
                      nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
                      recipientDeviceId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      recipientKeyId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      recipientPublicKeyFingerprint: z
                        .string()
                        .min(43)
                        .max(43)
                        .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      vaultId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      vaultKeyId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      wrappedKey: z
                        .string()
                        .min(107)
                        .max(107)
                        .regex(new RegExp("^[A-Za-z0-9_-]{106}[AEIMQUYcgkosw048]$")),
                    })
                    .strict(),
                )
                .min(1)
                .max(32),
              devicePublicKeys: z
                .array(
                  z
                    .object({
                      createdAt: z.iso
                        .datetime({ offset: true })
                        .min(24)
                        .max(24)
                        .regex(
                          new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                        ),
                      deviceId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      deviceKeyId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      formatVersion: z.literal(1),
                      keyAlgorithm: z.literal("X25519"),
                      publicKey: z
                        .string()
                        .min(43)
                        .max(43)
                        .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      publicKeyFingerprint: z
                        .string()
                        .min(43)
                        .max(43)
                        .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      revokedAt: z.union([
                        z.iso
                          .datetime({ offset: true })
                          .min(24)
                          .max(24)
                          .regex(
                            new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                          ),
                        z.null(),
                      ]),
                    })
                    .strict(),
                )
                .min(1)
                .max(32)
                .optional(),
              formatVersion: z.literal(1),
              recoveryEnvelope: z
                .object({
                  aad: z.string().min(2).max(5462).regex(new RegExp("^[A-Za-z0-9_-]+$")),
                  cipherSuite: z.literal("XCHACHA20_POLY1305"),
                  createdAt: z.iso
                    .datetime({ offset: true })
                    .min(24)
                    .max(24)
                    .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                  formatVersion: z.literal(1),
                  kdf: z
                    .object({
                      algorithm: z.literal("ARGON2ID13"),
                      memLimitBytes: z.number().int().min(67108864).max(268435456),
                      opsLimit: z.number().int().min(2).max(4),
                      outputBytes: z.literal(32),
                      salt: z.string().min(22).max(22).regex(new RegExp("^[A-Za-z0-9_-]{21}[AQgw]$")),
                    })
                    .strict(),
                  nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
                  vaultId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                  vaultKeyId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                  wrappedKey: z.string().min(64).max(64).regex(new RegExp("^[A-Za-z0-9_-]{64}$")),
                })
                .strict(),
              revision: z.number().int().min(1).max(9007199254740991),
              updatedAt: z.iso
                .datetime({ offset: true })
                .min(24)
                .max(24)
                .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
              vaultId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
              vaultKeyId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
            })
            .strict(),
          ownerBinding: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
          payload: z
            .object({
              aad: z.string().min(2).max(5462).regex(new RegExp("^[A-Za-z0-9_-]+$")),
              baseRevision: z.union([z.number().int().min(1).max(9007199254740991), z.null()]),
              cipherSuite: z.literal("XCHACHA20_POLY1305"),
              ciphertext: z.string().min(5483).max(11184832).regex(new RegExp("^[A-Za-z0-9_-]+$")),
              contentSchemaVersion: z.literal(1),
              contentType: z.literal("application/vnd.umn-gopher-assistant.personal-vault+json"),
              createdAt: z.iso
                .datetime({ offset: true })
                .min(24)
                .max(24)
                .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
              formatVersion: z.literal(2),
              nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
              ownerBinding: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              padding: z
                .object({
                  algorithm: z.literal("SODIUM_PAD"),
                  blockSize: z.literal(4096),
                })
                .strict(),
              revision: z.number().int().min(1).max(9007199254740991),
              vaultId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
              vaultKeyId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
            })
            .strict(),
          vaultId: z
            .string()
            .min(36)
            .max(36)
            .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
        })
        .strict(),
      operationId: z
        .string()
        .min(36)
        .max(36)
        .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
      ownerBinding: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
      proof: z
        .object({
          commandType: z.enum(["CREATE_VAULT", "UPDATE_PAYLOAD", "PAIR_DEVICE", "ROTATE_KEY"]),
          expectedParentCommitHash: z.union([
            z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            z.null(),
          ]),
          expiresAt: z.iso
            .datetime({ offset: true })
            .min(24)
            .max(24)
            .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
          formatVersion: z.literal(2),
          issuedAt: z.iso
            .datetime({ offset: true })
            .min(24)
            .max(24)
            .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
          nextCommitHash: z
            .string()
            .min(43)
            .max(43)
            .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
          operationId: z
            .string()
            .min(36)
            .max(36)
            .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          ownerBinding: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
          signature: z.string().min(86).max(86).regex(new RegExp("^[A-Za-z0-9_-]{85}[AQgw]$")),
          signer: z
            .object({
              deviceId: z.union([
                z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                z.null(),
              ]),
              keyId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
              kind: z.enum(["DEVICE", "RECOVERY"]),
            })
            .strict(),
          vaultId: z
            .string()
            .min(36)
            .max(36)
            .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
        })
        .strict(),
      reason: z.enum(["DEVICE_REVOKED", "RECOVERY_ROTATED", "SCHEDULED", "COMPROMISE"]),
      vaultId: z
        .string()
        .min(36)
        .max(36)
        .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
    })
    .strict(),
  updatePersonalVaultPayload: z
    .object({
      commandType: z.literal("UPDATE_PAYLOAD"),
      expectedParentCommitHash: z
        .string()
        .min(43)
        .max(43)
        .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
      formatVersion: z.literal(2),
      nextSnapshot: z
        .object({
          authorizationManifest: z
            .object({
              createdAt: z.iso
                .datetime({ offset: true })
                .min(24)
                .max(24)
                .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
              devices: z
                .array(
                  z
                    .object({
                      authorizationKey: z
                        .object({
                          algorithm: z.literal("ED25519"),
                          fingerprint: z
                            .string()
                            .min(43)
                            .max(43)
                            .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                          keyId: z
                            .string()
                            .min(36)
                            .max(36)
                            .regex(
                              new RegExp(
                                "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                              ),
                            ),
                          publicKey: z
                            .string()
                            .min(43)
                            .max(43)
                            .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                        })
                        .strict(),
                      createdAt: z.iso
                        .datetime({ offset: true })
                        .min(24)
                        .max(24)
                        .regex(
                          new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                        ),
                      deviceId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      encryptionKey: z
                        .object({
                          algorithm: z.literal("X25519"),
                          fingerprint: z
                            .string()
                            .min(43)
                            .max(43)
                            .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                          keyId: z
                            .string()
                            .min(36)
                            .max(36)
                            .regex(
                              new RegExp(
                                "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                              ),
                            ),
                          publicKey: z
                            .string()
                            .min(43)
                            .max(43)
                            .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                        })
                        .strict(),
                      formatVersion: z.literal(2),
                      ownerBinding: z
                        .string()
                        .min(43)
                        .max(43)
                        .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      revokedAt: z.union([
                        z.iso
                          .datetime({ offset: true })
                          .min(24)
                          .max(24)
                          .regex(
                            new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                          ),
                        z.null(),
                      ]),
                    })
                    .strict(),
                )
                .min(1)
                .max(32),
              epoch: z.number().int().min(1).max(9007199254740991),
              formatVersion: z.literal(2),
              ownerBinding: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              recoveryAuthorization: z
                .object({
                  algorithm: z.literal("ED25519"),
                  createdAt: z.iso
                    .datetime({ offset: true })
                    .min(24)
                    .max(24)
                    .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                  fingerprint: z
                    .string()
                    .min(43)
                    .max(43)
                    .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                  formatVersion: z.literal(2),
                  keyId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                  ownerBinding: z
                    .string()
                    .min(43)
                    .max(43)
                    .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                  publicKey: z
                    .string()
                    .min(43)
                    .max(43)
                    .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                  revokedAt: z.union([
                    z.iso
                      .datetime({ offset: true })
                      .min(24)
                      .max(24)
                      .regex(
                        new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                      ),
                    z.null(),
                  ]),
                  vaultId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                })
                .strict(),
              revision: z.number().int().min(1).max(9007199254740991),
              updatedAt: z.iso
                .datetime({ offset: true })
                .min(24)
                .max(24)
                .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
              vaultId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
            })
            .strict(),
          commit: z
            .object({
              author: z
                .object({
                  deviceId: z.union([
                    z
                      .string()
                      .min(36)
                      .max(36)
                      .regex(
                        new RegExp(
                          "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                        ),
                      ),
                    z.null(),
                  ]),
                  keyId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                  kind: z.enum(["DEVICE", "RECOVERY"]),
                })
                .strict(),
              authorizationManifestHash: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              createdAt: z.iso
                .datetime({ offset: true })
                .min(24)
                .max(24)
                .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
              epoch: z.number().int().min(1).max(9007199254740991),
              formatVersion: z.literal(2),
              keyringHash: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              operationId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
              ownerBinding: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              parentCommitHash: z.union([
                z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                z.null(),
              ]),
              payloadHash: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              sequence: z.number().int().min(1).max(9007199254740991),
              signature: z.string().min(86).max(86).regex(new RegExp("^[A-Za-z0-9_-]{85}[AQgw]$")),
              stateMac: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              vaultId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
            })
            .strict(),
          commitHash: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
          formatVersion: z.literal(2),
          keyring: z
            .object({
              createdAt: z.iso
                .datetime({ offset: true })
                .min(24)
                .max(24)
                .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
              deviceEnvelopes: z
                .array(
                  z
                    .object({
                      cipherSuite: z.literal("X25519_XCHACHA20_POLY1305"),
                      createdAt: z.iso
                        .datetime({ offset: true })
                        .min(24)
                        .max(24)
                        .regex(
                          new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                        ),
                      ephemeralPublicKey: z
                        .string()
                        .min(43)
                        .max(43)
                        .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      formatVersion: z.literal(1),
                      nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
                      recipientDeviceId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      recipientKeyId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      recipientPublicKeyFingerprint: z
                        .string()
                        .min(43)
                        .max(43)
                        .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      vaultId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      vaultKeyId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      wrappedKey: z
                        .string()
                        .min(107)
                        .max(107)
                        .regex(new RegExp("^[A-Za-z0-9_-]{106}[AEIMQUYcgkosw048]$")),
                    })
                    .strict(),
                )
                .min(1)
                .max(32),
              devicePublicKeys: z
                .array(
                  z
                    .object({
                      createdAt: z.iso
                        .datetime({ offset: true })
                        .min(24)
                        .max(24)
                        .regex(
                          new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                        ),
                      deviceId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      deviceKeyId: z
                        .string()
                        .min(36)
                        .max(36)
                        .regex(
                          new RegExp(
                            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                          ),
                        ),
                      formatVersion: z.literal(1),
                      keyAlgorithm: z.literal("X25519"),
                      publicKey: z
                        .string()
                        .min(43)
                        .max(43)
                        .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      publicKeyFingerprint: z
                        .string()
                        .min(43)
                        .max(43)
                        .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
                      revokedAt: z.union([
                        z.iso
                          .datetime({ offset: true })
                          .min(24)
                          .max(24)
                          .regex(
                            new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"),
                          ),
                        z.null(),
                      ]),
                    })
                    .strict(),
                )
                .min(1)
                .max(32)
                .optional(),
              formatVersion: z.literal(1),
              recoveryEnvelope: z
                .object({
                  aad: z.string().min(2).max(5462).regex(new RegExp("^[A-Za-z0-9_-]+$")),
                  cipherSuite: z.literal("XCHACHA20_POLY1305"),
                  createdAt: z.iso
                    .datetime({ offset: true })
                    .min(24)
                    .max(24)
                    .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
                  formatVersion: z.literal(1),
                  kdf: z
                    .object({
                      algorithm: z.literal("ARGON2ID13"),
                      memLimitBytes: z.number().int().min(67108864).max(268435456),
                      opsLimit: z.number().int().min(2).max(4),
                      outputBytes: z.literal(32),
                      salt: z.string().min(22).max(22).regex(new RegExp("^[A-Za-z0-9_-]{21}[AQgw]$")),
                    })
                    .strict(),
                  nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
                  vaultId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                  vaultKeyId: z
                    .string()
                    .min(36)
                    .max(36)
                    .regex(
                      new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                    ),
                  wrappedKey: z.string().min(64).max(64).regex(new RegExp("^[A-Za-z0-9_-]{64}$")),
                })
                .strict(),
              revision: z.number().int().min(1).max(9007199254740991),
              updatedAt: z.iso
                .datetime({ offset: true })
                .min(24)
                .max(24)
                .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
              vaultId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
              vaultKeyId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
            })
            .strict(),
          ownerBinding: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
          payload: z
            .object({
              aad: z.string().min(2).max(5462).regex(new RegExp("^[A-Za-z0-9_-]+$")),
              baseRevision: z.union([z.number().int().min(1).max(9007199254740991), z.null()]),
              cipherSuite: z.literal("XCHACHA20_POLY1305"),
              ciphertext: z.string().min(5483).max(11184832).regex(new RegExp("^[A-Za-z0-9_-]+$")),
              contentSchemaVersion: z.literal(1),
              contentType: z.literal("application/vnd.umn-gopher-assistant.personal-vault+json"),
              createdAt: z.iso
                .datetime({ offset: true })
                .min(24)
                .max(24)
                .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
              formatVersion: z.literal(2),
              nonce: z.string().min(32).max(32).regex(new RegExp("^[A-Za-z0-9_-]{32}$")),
              ownerBinding: z
                .string()
                .min(43)
                .max(43)
                .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
              padding: z
                .object({
                  algorithm: z.literal("SODIUM_PAD"),
                  blockSize: z.literal(4096),
                })
                .strict(),
              revision: z.number().int().min(1).max(9007199254740991),
              vaultId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
              vaultKeyId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
            })
            .strict(),
          vaultId: z
            .string()
            .min(36)
            .max(36)
            .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
        })
        .strict(),
      operationId: z
        .string()
        .min(36)
        .max(36)
        .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
      ownerBinding: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
      proof: z
        .object({
          commandType: z.enum(["CREATE_VAULT", "UPDATE_PAYLOAD", "PAIR_DEVICE", "ROTATE_KEY"]),
          expectedParentCommitHash: z.union([
            z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
            z.null(),
          ]),
          expiresAt: z.iso
            .datetime({ offset: true })
            .min(24)
            .max(24)
            .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
          formatVersion: z.literal(2),
          issuedAt: z.iso
            .datetime({ offset: true })
            .min(24)
            .max(24)
            .regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")),
          nextCommitHash: z
            .string()
            .min(43)
            .max(43)
            .regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
          operationId: z
            .string()
            .min(36)
            .max(36)
            .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
          ownerBinding: z.string().min(43).max(43).regex(new RegExp("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$")),
          signature: z.string().min(86).max(86).regex(new RegExp("^[A-Za-z0-9_-]{85}[AQgw]$")),
          signer: z
            .object({
              deviceId: z.union([
                z
                  .string()
                  .min(36)
                  .max(36)
                  .regex(
                    new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                  ),
                z.null(),
              ]),
              keyId: z
                .string()
                .min(36)
                .max(36)
                .regex(
                  new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"),
                ),
              kind: z.enum(["DEVICE", "RECOVERY"]),
            })
            .strict(),
          vaultId: z
            .string()
            .min(36)
            .max(36)
            .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
        })
        .strict(),
      vaultId: z
        .string()
        .min(36)
        .max(36)
        .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
    })
    .strict(),
} satisfies Partial<Record<ImplementedOperationId, z.ZodType>>;

const schemasByOperation: Readonly<Partial<Record<OperationId, Readonly<Record<number, z.ZodType>>>>> =
  implementedSuccessSchemas;

const requestBodySchemasByOperation: Readonly<Partial<Record<OperationId, z.ZodType>>> =
  implementedRequestBodySchemas;

export type RequestBodyValidationResult =
  | { readonly success: true; readonly data: unknown }
  | { readonly success: false; readonly reason: "invalid-request-body" | "request-body-not-declared" };

export function validateImplementedRequestBody(
  operationId: OperationId,
  value: unknown,
): RequestBodyValidationResult {
  const schema = requestBodySchemasByOperation[operationId];
  if (schema === undefined) {
    return { success: false, reason: "request-body-not-declared" };
  }
  const result = schema.safeParse(value);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, reason: "invalid-request-body" };
}

export type SuccessBodyValidationFailureReason =
  | "invalid-success-body"
  | "operation-not-implemented"
  | "unexpected-success-status";

export type SuccessBodyValidationResult =
  | { readonly success: true; readonly data: unknown }
  | { readonly success: false; readonly reason: SuccessBodyValidationFailureReason };

export function validateImplementedSuccessBody(
  operationId: OperationId,
  status: number,
  value: unknown,
): SuccessBodyValidationResult {
  const statusSchemas = schemasByOperation[operationId];
  if (statusSchemas === undefined) {
    return { success: false, reason: "operation-not-implemented" };
  }
  const schema = statusSchemas[status];
  if (schema === undefined) {
    return { success: false, reason: "unexpected-success-status" };
  }
  const result = schema.safeParse(value);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, reason: "invalid-success-body" };
}
