import type { Sodium } from "./sodium.js";

import { authenticationFailed, cryptoError, VaultCryptoErrorCode } from "../errors.js";

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

function encodedLength(byteLength: number): number {
  return Math.ceil((byteLength * 8) / 6);
}

export function encodeBase64Url(sodium: Sodium, value: Uint8Array): string {
  return sodium.to_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING);
}

export function decodeBase64UrlExact(
  sodium: Sodium,
  value: unknown,
  byteLength: number,
  failure: "authentication" | "input" = "authentication",
): Uint8Array {
  const fail = (): never => {
    throw failure === "authentication"
      ? authenticationFailed()
      : cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  };
  if (
    typeof value !== "string" ||
    value.length !== encodedLength(byteLength) ||
    !BASE64URL_PATTERN.test(value)
  ) {
    fail();
  }
  try {
    const decoded = sodium.from_base64(value as string, sodium.base64_variants.URLSAFE_NO_PADDING);
    if (
      decoded.length !== byteLength ||
      encodeBase64Url(sodium, decoded) !== value
    ) {
      sodium.memzero(decoded);
      fail();
    }
    return decoded;
  } catch {
    fail();
  }
  throw new Error("unreachable");
}

export function decodeBase64UrlBounded(
  sodium: Sodium,
  value: unknown,
  minimumBytes: number,
  maximumBytes: number,
): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length < encodedLength(minimumBytes) ||
    value.length > encodedLength(maximumBytes) ||
    !BASE64URL_PATTERN.test(value)
  ) {
    throw authenticationFailed();
  }
  try {
    const decoded = sodium.from_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING);
    if (
      decoded.length < minimumBytes ||
      decoded.length > maximumBytes ||
      encodeBase64Url(sodium, decoded) !== value
    ) {
      sodium.memzero(decoded);
      throw authenticationFailed();
    }
    return decoded;
  } catch {
    throw authenticationFailed();
  }
}

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function concatenate(...arrays: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(arrays.reduce((total, item) => total + item.length, 0));
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }
  return result;
}
