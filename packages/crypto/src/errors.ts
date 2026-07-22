export const VaultCryptoErrorCode = {
  AUTHENTICATION_FAILED: "AUTHENTICATION_FAILED",
  DESTROYED_KEY: "DESTROYED_KEY",
  INVALID_INPUT: "INVALID_INPUT",
  KDF_LIMIT_EXCEEDED: "KDF_LIMIT_EXCEEDED",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  UNSUPPORTED_FORMAT: "UNSUPPORTED_FORMAT",
} as const;

export type VaultCryptoErrorCode = (typeof VaultCryptoErrorCode)[keyof typeof VaultCryptoErrorCode];

const SAFE_MESSAGES: Readonly<Record<VaultCryptoErrorCode, string>> = {
  AUTHENTICATION_FAILED: "Authentication failed.",
  DESTROYED_KEY: "The key handle has been destroyed.",
  INVALID_INPUT: "The cryptographic input is invalid.",
  KDF_LIMIT_EXCEEDED: "The recovery key derivation parameters exceed the resource limit.",
  PAYLOAD_TOO_LARGE: "The vault payload exceeds the supported size limit.",
  UNSUPPORTED_FORMAT: "The encrypted envelope format is not supported.",
};

export class VaultCryptoError extends Error {
  readonly code: VaultCryptoErrorCode;

  constructor(code: VaultCryptoErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "VaultCryptoError";
    this.code = code;
  }
}

export function cryptoError(code: VaultCryptoErrorCode): VaultCryptoError {
  return new VaultCryptoError(code);
}

export function authenticationFailed(): VaultCryptoError {
  return cryptoError(VaultCryptoErrorCode.AUTHENTICATION_FAILED);
}
