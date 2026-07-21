import type { RecoveryEnvelopeResult, RecoveryKeyEnvelopeV1, VaultKeyHandle } from "../types.js";
import type { Sodium } from "./sodium.js";

import { buildRecoveryAadV1 } from "@umn-gopher-assistant/contracts";

import {
  RECOVERY_ENTROPY_BYTES,
  RECOVERY_KEY_BYTES,
  RECOVERY_MAX_MEM_LIMIT_BYTES,
  RECOVERY_MAX_OPS_LIMIT,
  RECOVERY_MEM_LIMIT_BYTES,
  RECOVERY_OPS_LIMIT,
  RECOVERY_SALT_BYTES,
  RECOVERY_WRAPPED_KEY_BYTES,
  VAULT_MAX_AAD_BYTES,
  XCHACHA_NONCE_BYTES,
} from "../constants.js";
import { authenticationFailed, cryptoError, VaultCryptoErrorCode } from "../errors.js";
import { decodeBase64UrlBounded, decodeBase64UrlExact, encodeBase64Url } from "./encoding.js";
import { createVaultHandle, vaultSecret } from "./handles.js";
import { openXChaCha, sealXChaCha } from "./xchacha.js";
import {
  currentIsoDateTime,
  requireExactKeys,
  requireIsoDateTime,
  requirePlainObject,
  requireUuid,
} from "./validation.js";

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RECOVERY_CODE_PATTERN = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{32}$/u;

function encodeCrockford(bytes: Uint8Array): string {
  let accumulator = 0;
  let bits = 0;
  let result = "";
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += CROCKFORD_ALPHABET.charAt((accumulator >>> bits) & 31);
      accumulator &= (1 << bits) - 1;
    }
  }
  if (bits !== 0) result += CROCKFORD_ALPHABET.charAt((accumulator << (5 - bits)) & 31);
  return result;
}

function formatRecoveryCode(body: string): string {
  const chunks = body.match(/.{1,4}/gu);
  if (chunks === null) throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  return `UGA1-${chunks.join("-")}`;
}

interface NormalizedRecoveryCode {
  readonly display: string;
  readonly entropy: Uint8Array;
}

function decodeCrockford(body: string): Uint8Array {
  const decoded = new Uint8Array(RECOVERY_ENTROPY_BYTES);
  let accumulator = 0;
  let bits = 0;
  let outputIndex = 0;
  for (const character of body) {
    const value = CROCKFORD_ALPHABET.indexOf(character);
    if (value < 0) throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
    accumulator = (accumulator << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      decoded[outputIndex] = (accumulator >>> bits) & 0xff;
      outputIndex += 1;
      accumulator &= (1 << bits) - 1;
    }
  }
  if (bits !== 0 || outputIndex !== RECOVERY_ENTROPY_BYTES) {
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
  return decoded;
}

function normalizeRecoveryCode(code: unknown, mode: "input" | "authentication"): NormalizedRecoveryCode {
  const fail = (): never => {
    throw mode === "authentication"
      ? authenticationFailed()
      : cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  };
  if (typeof code !== "string") fail();
  const compact = (code as string)
    .normalize("NFKC")
    .replaceAll(/[- \t\r\n]/gu, "")
    .toUpperCase();
  if (!compact.startsWith("UGA1")) fail();
  const body = compact.slice(4).replaceAll("O", "0").replaceAll(/[IL]/gu, "1");
  if (!RECOVERY_CODE_PATTERN.test(body)) fail();
  try {
    return { display: formatRecoveryCode(body), entropy: decodeCrockford(body) };
  } catch {
    return fail();
  }
}

export function generateRecoveryCode(sodium: Sodium): string {
  const entropy = sodium.randombytes_buf(RECOVERY_ENTROPY_BYTES);
  try {
    return formatRecoveryCode(encodeCrockford(entropy));
  } finally {
    sodium.memzero(entropy);
  }
}

interface RecoveryMetadata {
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

function recoveryAadEncoded(metadata: RecoveryMetadata): string {
  return buildRecoveryAadV1(metadata);
}

function deriveRecoveryKey(
  sodium: Sodium,
  recoveryEntropy: Uint8Array,
  salt: Uint8Array,
  opsLimit: number,
  memLimitBytes: number,
): Uint8Array {
  return sodium.crypto_pwhash(
    RECOVERY_KEY_BYTES,
    recoveryEntropy,
    salt,
    opsLimit,
    memLimitBytes,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}

function authenticateRecoveryMetadata(candidate: RecoveryKeyEnvelopeV1): RecoveryMetadata {
  try {
    const record = requirePlainObject(candidate);
    requireExactKeys(record, [
      "aad",
      "cipherSuite",
      "createdAt",
      "formatVersion",
      "kdf",
      "nonce",
      "vaultId",
      "vaultKeyId",
      "wrappedKey",
    ]);
    const kdf = requirePlainObject(record["kdf"]);
    requireExactKeys(kdf, ["algorithm", "memLimitBytes", "opsLimit", "outputBytes", "salt"]);
    if (
      record["formatVersion"] !== 1 ||
      record["cipherSuite"] !== "XCHACHA20_POLY1305" ||
      kdf["algorithm"] !== "ARGON2ID13" ||
      kdf["outputBytes"] !== RECOVERY_KEY_BYTES ||
      !Number.isSafeInteger(kdf["opsLimit"]) ||
      !Number.isSafeInteger(kdf["memLimitBytes"])
    ) {
      throw authenticationFailed();
    }
    const opsLimit = kdf["opsLimit"] as number;
    const memLimitBytes = kdf["memLimitBytes"] as number;
    if (opsLimit > RECOVERY_MAX_OPS_LIMIT || memLimitBytes > RECOVERY_MAX_MEM_LIMIT_BYTES) {
      throw cryptoError(VaultCryptoErrorCode.KDF_LIMIT_EXCEEDED);
    }
    if (opsLimit < 2 || memLimitBytes < 64 * 1_024 * 1_024) {
      throw authenticationFailed();
    }
    return {
      formatVersion: 1,
      vaultId: requireUuid(record["vaultId"]),
      vaultKeyId: requireUuid(record["vaultKeyId"]),
      cipherSuite: "XCHACHA20_POLY1305",
      kdf: {
        algorithm: "ARGON2ID13",
        salt: kdf["salt"] as string,
        opsLimit,
        memLimitBytes,
        outputBytes: 32,
      },
      nonce: record["nonce"] as string,
      createdAt: requireIsoDateTime(record["createdAt"]),
    };
  } catch {
    throw authenticationFailed();
  }
}

export function createRecoveryEnvelope(sodium: Sodium, key: VaultKeyHandle): RecoveryEnvelopeResult {
  const secret = vaultSecret(key);
  let recoveryEntropy: Uint8Array | undefined;
  let salt: Uint8Array | undefined;
  let nonce: Uint8Array | undefined;
  let aad: Uint8Array | undefined;
  let derivedKey: Uint8Array | undefined;
  let wrapped: Uint8Array | undefined;
  try {
    recoveryEntropy = sodium.randombytes_buf(RECOVERY_ENTROPY_BYTES);
    const recoveryCode = formatRecoveryCode(encodeCrockford(recoveryEntropy));
    salt = sodium.randombytes_buf(RECOVERY_SALT_BYTES);
    nonce = sodium.randombytes_buf(XCHACHA_NONCE_BYTES);
    const metadata: RecoveryMetadata = {
      formatVersion: 1,
      vaultId: requireUuid(key.vaultId),
      vaultKeyId: requireUuid(key.vaultKeyId),
      cipherSuite: "XCHACHA20_POLY1305",
      kdf: {
        algorithm: "ARGON2ID13",
        salt: encodeBase64Url(sodium, salt),
        opsLimit: RECOVERY_OPS_LIMIT,
        memLimitBytes: RECOVERY_MEM_LIMIT_BYTES,
        outputBytes: 32,
      },
      nonce: encodeBase64Url(sodium, nonce),
      createdAt: currentIsoDateTime(),
    };
    const aadEncoded = recoveryAadEncoded(metadata);
    aad = decodeBase64UrlBounded(sodium, aadEncoded, 1, VAULT_MAX_AAD_BYTES);
    if (aad.length > VAULT_MAX_AAD_BYTES) {
      throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
    }
    derivedKey = deriveRecoveryKey(
      sodium,
      recoveryEntropy,
      salt,
      metadata.kdf.opsLimit,
      metadata.kdf.memLimitBytes,
    );
    wrapped = sealXChaCha(sodium, derivedKey, nonce, secret, aad);
    return {
      recoveryCode,
      envelope: {
        ...metadata,
        wrappedKey: encodeBase64Url(sodium, wrapped),
        aad: aadEncoded,
      },
    };
  } finally {
    if (salt !== undefined) sodium.memzero(salt);
    if (nonce !== undefined) sodium.memzero(nonce);
    if (aad !== undefined) sodium.memzero(aad);
    if (derivedKey !== undefined) sodium.memzero(derivedKey);
    if (wrapped !== undefined) sodium.memzero(wrapped);
    if (recoveryEntropy !== undefined) sodium.memzero(recoveryEntropy);
  }
}

export function recoverVaultKey(
  sodium: Sodium,
  envelope: RecoveryKeyEnvelopeV1,
  recoveryCodeInput: string,
): VaultKeyHandle {
  let salt: Uint8Array | undefined;
  let nonce: Uint8Array | undefined;
  let wrapped: Uint8Array | undefined;
  let storedAad: Uint8Array | undefined;
  let expectedAad: Uint8Array | undefined;
  let derivedKey: Uint8Array | undefined;
  let secret: Uint8Array | undefined;
  let recoveryEntropy: Uint8Array | undefined;
  try {
    const metadata = authenticateRecoveryMetadata(envelope);
    const recoveryCode = normalizeRecoveryCode(recoveryCodeInput, "authentication");
    recoveryEntropy = recoveryCode.entropy;
    salt = decodeBase64UrlExact(sodium, metadata.kdf.salt, RECOVERY_SALT_BYTES);
    nonce = decodeBase64UrlExact(sodium, envelope.nonce, XCHACHA_NONCE_BYTES);
    wrapped = decodeBase64UrlExact(sodium, envelope.wrappedKey, RECOVERY_WRAPPED_KEY_BYTES);
    storedAad = decodeBase64UrlBounded(sodium, envelope.aad, 1, VAULT_MAX_AAD_BYTES);
    expectedAad = decodeBase64UrlBounded(sodium, recoveryAadEncoded(metadata), 1, VAULT_MAX_AAD_BYTES);
    if (!sodium.memcmp(storedAad, expectedAad)) throw authenticationFailed();
    derivedKey = deriveRecoveryKey(
      sodium,
      recoveryEntropy,
      salt,
      metadata.kdf.opsLimit,
      metadata.kdf.memLimitBytes,
    );
    secret = openXChaCha(sodium, derivedKey, nonce, wrapped, expectedAad);
    if (secret.length !== RECOVERY_KEY_BYTES) throw authenticationFailed();
    const handleSecret = secret;
    secret = undefined;
    return createVaultHandle(sodium, metadata.vaultId, metadata.vaultKeyId, handleSecret);
  } catch {
    throw authenticationFailed();
  } finally {
    if (salt !== undefined) sodium.memzero(salt);
    if (nonce !== undefined) sodium.memzero(nonce);
    if (wrapped !== undefined) sodium.memzero(wrapped);
    if (storedAad !== undefined) sodium.memzero(storedAad);
    if (expectedAad !== undefined) sodium.memzero(expectedAad);
    if (derivedKey !== undefined) sodium.memzero(derivedKey);
    if (secret !== undefined) sodium.memzero(secret);
    if (recoveryEntropy !== undefined) sodium.memzero(recoveryEntropy);
  }
}

/** Internal vector hook; not exported by the package root. */
export function normalizeRecoveryCodeForTesting(code: string): NormalizedRecoveryCode {
  return normalizeRecoveryCode(code, "input");
}
