import { cryptoError, VaultCryptoErrorCode } from "../errors.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export function requireUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
  return value;
}

export function requireRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
  return value as number;
}

export function requireRevisionPair(
  revision: unknown,
  baseRevision: unknown,
): {
  readonly revision: number;
  readonly baseRevision: number | null;
} {
  const checkedRevision = requireRevision(revision);
  if (baseRevision === null) {
    if (checkedRevision !== 1) {
      throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
    }
    return { revision: checkedRevision, baseRevision: null };
  }
  const checkedBase = requireRevision(baseRevision);
  if (checkedBase !== checkedRevision - 1) {
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
  return { revision: checkedRevision, baseRevision: checkedBase };
}

export function requireIsoDateTime(value: unknown): string {
  if (
    typeof value !== "string" ||
    !ISO_DATE_TIME_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
  return value;
}

export function currentIsoDateTime(): string {
  return new Date().toISOString();
}

export function requirePlainObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
  return value as Record<string, unknown>;
}

export function requireExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
}
