const SIGNING_KEY_FINGERPRINT_BYTES = 32;

export function signingKeyFingerprintBytes(value: string): Buffer {
  const fingerprint = Buffer.from(value, "base64url");
  if (
    fingerprint.byteLength !== SIGNING_KEY_FINGERPRINT_BYTES ||
    fingerprint.toString("base64url") !== value
  ) {
    fingerprint.fill(0);
    throw new Error("Authorization signing-key fingerprint must be canonical 32-byte base64url");
  }
  return fingerprint;
}
