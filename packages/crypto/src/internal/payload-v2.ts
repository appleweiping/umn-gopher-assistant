import type { EncryptedVaultPayloadEnvelopeV2, VaultKeyHandle } from "../types.js";
import type { Sodium } from "./sodium.js";

import { buildPayloadAadV2, OwnerBindingV2Schema } from "@umn-gopher-assistant/contracts";

import {
  PERSONAL_VAULT_CONTENT_TYPE,
  VAULT_MAX_AAD_BYTES,
  VAULT_MAX_CIPHERTEXT_BYTES,
  VAULT_MAX_PLAINTEXT_BYTES,
  VAULT_PADDING_BLOCK_BYTES,
  XCHACHA_NONCE_BYTES,
  XCHACHA_TAG_BYTES,
} from "../constants.js";
import { authenticationFailed, cryptoError, VaultCryptoError, VaultCryptoErrorCode } from "../errors.js";
import { decodeBase64UrlBounded, decodeBase64UrlExact, encodeBase64Url } from "./encoding.js";
import { vaultSecret } from "./handles.js";
import { openXChaCha, sealXChaCha } from "./xchacha.js";
import {
  currentIsoDateTime,
  requireExactKeys,
  requireIsoDateTime,
  requirePlainObject,
  requireRevisionPair,
  requireUuid,
} from "./validation.js";

interface PayloadMetadataV2 {
  readonly formatVersion: 2;
  readonly ownerBinding: string;
  readonly vaultId: string;
  readonly vaultKeyId: string;
  readonly revision: number;
  readonly baseRevision: number | null;
  readonly cipherSuite: "XCHACHA20_POLY1305";
  readonly contentType: typeof PERSONAL_VAULT_CONTENT_TYPE;
  readonly contentSchemaVersion: 1;
  readonly padding: {
    readonly algorithm: "SODIUM_PAD";
    readonly blockSize: typeof VAULT_PADDING_BLOCK_BYTES;
  };
  readonly nonce: string;
  readonly createdAt: string;
}

function requireOwnerBinding(value: unknown, mode: "input" | "authentication"): string {
  const result = OwnerBindingV2Schema.safeParse(value);
  if (!result.success) {
    if (mode === "authentication") throw authenticationFailed();
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
  return result.data;
}

function authenticateEnvelopeMetadata(value: unknown): PayloadMetadataV2 {
  try {
    const record = requirePlainObject(value);
    requireExactKeys(record, [
      "aad",
      "baseRevision",
      "cipherSuite",
      "ciphertext",
      "contentSchemaVersion",
      "contentType",
      "createdAt",
      "formatVersion",
      "nonce",
      "ownerBinding",
      "padding",
      "revision",
      "vaultId",
      "vaultKeyId",
    ]);
    const revisions = requireRevisionPair(record["revision"], record["baseRevision"]);
    const padding = requirePlainObject(record["padding"]);
    requireExactKeys(padding, ["algorithm", "blockSize"]);
    if (
      record["formatVersion"] !== 2 ||
      record["cipherSuite"] !== "XCHACHA20_POLY1305" ||
      record["contentType"] !== PERSONAL_VAULT_CONTENT_TYPE ||
      record["contentSchemaVersion"] !== 1 ||
      padding["algorithm"] !== "SODIUM_PAD" ||
      padding["blockSize"] !== VAULT_PADDING_BLOCK_BYTES
    ) {
      throw authenticationFailed();
    }
    return {
      formatVersion: 2,
      ownerBinding: requireOwnerBinding(record["ownerBinding"], "authentication"),
      vaultId: requireUuid(record["vaultId"]),
      vaultKeyId: requireUuid(record["vaultKeyId"]),
      revision: revisions.revision,
      baseRevision: revisions.baseRevision,
      cipherSuite: "XCHACHA20_POLY1305",
      contentType: PERSONAL_VAULT_CONTENT_TYPE,
      contentSchemaVersion: 1,
      padding: { algorithm: "SODIUM_PAD", blockSize: VAULT_PADDING_BLOCK_BYTES },
      nonce: record["nonce"] as string,
      createdAt: requireIsoDateTime(record["createdAt"]),
    };
  } catch {
    throw authenticationFailed();
  }
}

export function encryptPayloadV2(
  sodium: Sodium,
  key: VaultKeyHandle,
  ownerBindingInput: string,
  plaintext: Uint8Array,
  revision: number,
  baseRevision: number | null,
): EncryptedVaultPayloadEnvelopeV2 {
  const secret = vaultSecret(key);
  const ownerBinding = requireOwnerBinding(ownerBindingInput, "input");
  if (!(plaintext instanceof Uint8Array)) throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  if (plaintext.length > VAULT_MAX_PLAINTEXT_BYTES) {
    throw cryptoError(VaultCryptoErrorCode.PAYLOAD_TOO_LARGE);
  }
  const revisions = requireRevisionPair(revision, baseRevision);
  let nonce: Uint8Array | undefined;
  let aad: Uint8Array | undefined;
  let padded: Uint8Array | undefined;
  let ciphertext: Uint8Array | undefined;
  try {
    nonce = sodium.randombytes_buf(XCHACHA_NONCE_BYTES);
    const metadata: PayloadMetadataV2 = {
      formatVersion: 2,
      ownerBinding,
      vaultId: requireUuid(key.vaultId),
      vaultKeyId: requireUuid(key.vaultKeyId),
      revision: revisions.revision,
      baseRevision: revisions.baseRevision,
      cipherSuite: "XCHACHA20_POLY1305",
      contentType: PERSONAL_VAULT_CONTENT_TYPE,
      contentSchemaVersion: 1,
      padding: { algorithm: "SODIUM_PAD", blockSize: VAULT_PADDING_BLOCK_BYTES },
      nonce: encodeBase64Url(sodium, nonce),
      createdAt: currentIsoDateTime(),
    };
    const aadEncoded = buildPayloadAadV2(metadata);
    aad = decodeBase64UrlBounded(sodium, aadEncoded, 1, VAULT_MAX_AAD_BYTES);
    padded = sodium.pad(plaintext, VAULT_PADDING_BLOCK_BYTES);
    if (padded.length > VAULT_MAX_CIPHERTEXT_BYTES - XCHACHA_TAG_BYTES) {
      throw cryptoError(VaultCryptoErrorCode.PAYLOAD_TOO_LARGE);
    }
    ciphertext = sealXChaCha(sodium, secret, nonce, padded, aad);
    return {
      ...metadata,
      ciphertext: encodeBase64Url(sodium, ciphertext),
      aad: aadEncoded,
    };
  } finally {
    if (nonce !== undefined) sodium.memzero(nonce);
    if (aad !== undefined) sodium.memzero(aad);
    if (padded !== undefined) sodium.memzero(padded);
    if (ciphertext !== undefined) sodium.memzero(ciphertext);
  }
}

export function decryptPayloadV2(
  sodium: Sodium,
  key: VaultKeyHandle,
  envelope: EncryptedVaultPayloadEnvelopeV2,
): Uint8Array {
  const secret = vaultSecret(key);
  let nonce: Uint8Array | undefined;
  let ciphertext: Uint8Array | undefined;
  let storedAad: Uint8Array | undefined;
  let expectedAad: Uint8Array | undefined;
  let padded: Uint8Array | undefined;
  try {
    const metadata = authenticateEnvelopeMetadata(envelope);
    if (metadata.vaultId !== key.vaultId || metadata.vaultKeyId !== key.vaultKeyId) {
      throw authenticationFailed();
    }
    nonce = decodeBase64UrlExact(sodium, envelope.nonce, XCHACHA_NONCE_BYTES);
    ciphertext = decodeBase64UrlBounded(
      sodium,
      envelope.ciphertext,
      VAULT_PADDING_BLOCK_BYTES + XCHACHA_TAG_BYTES,
      VAULT_MAX_CIPHERTEXT_BYTES,
    );
    if ((ciphertext.length - XCHACHA_TAG_BYTES) % VAULT_PADDING_BLOCK_BYTES !== 0) {
      throw authenticationFailed();
    }
    storedAad = decodeBase64UrlBounded(sodium, envelope.aad, 1, VAULT_MAX_AAD_BYTES);
    expectedAad = decodeBase64UrlBounded(sodium, buildPayloadAadV2(metadata), 1, VAULT_MAX_AAD_BYTES);
    if (!sodium.memcmp(storedAad, expectedAad)) throw authenticationFailed();
    padded = openXChaCha(sodium, secret, nonce, ciphertext, expectedAad);
    try {
      return sodium.unpad(padded, VAULT_PADDING_BLOCK_BYTES);
    } catch {
      throw authenticationFailed();
    }
  } catch (error) {
    if (error instanceof VaultCryptoError && error.code === VaultCryptoErrorCode.DESTROYED_KEY) {
      throw error;
    }
    throw authenticationFailed();
  } finally {
    if (nonce !== undefined) sodium.memzero(nonce);
    if (ciphertext !== undefined) sodium.memzero(ciphertext);
    if (storedAad !== undefined) sodium.memzero(storedAad);
    if (expectedAad !== undefined) sodium.memzero(expectedAad);
    if (padded !== undefined) sodium.memzero(padded);
  }
}
