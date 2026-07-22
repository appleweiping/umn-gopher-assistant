import { UpstreamSchemaError } from "./errors.js";

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}

export function expectObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UpstreamSchemaError(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

export function expectArray(value: unknown, path: string, maximum: number): readonly unknown[] {
  if (!Array.isArray(value)) throw new UpstreamSchemaError(path, "expected an array");
  if (value.length > maximum) {
    throw new UpstreamSchemaError(path, `record count exceeds ${String(maximum)}`);
  }
  return value;
}

export function expectString(value: unknown, path: string, maximum: number, pattern?: RegExp): string {
  if (typeof value !== "string") throw new UpstreamSchemaError(path, "expected a string");
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum || containsControlCharacter(normalized)) {
    throw new UpstreamSchemaError(path, "string is empty, oversized, or contains control characters");
  }
  if (pattern !== undefined && !pattern.test(normalized)) {
    throw new UpstreamSchemaError(path, "string does not match the expected format");
  }
  return normalized;
}

export function expectInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new UpstreamSchemaError(path, "expected a bounded integer");
  }
  return value as number;
}

export function optionalString(value: unknown, path: string, maximum: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  return expectString(value, path, maximum);
}

export function expectDateOnly(value: unknown, path: string): string {
  const date = expectString(value, path, 10, /^\d{4}-\d{2}-\d{2}$/u);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new UpstreamSchemaError(path, "expected a real calendar date");
  }
  return date;
}

export function expectInstant(value: unknown, path: string): string {
  const instant = expectString(
    value,
    path,
    64,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u,
  );
  const milliseconds = Date.parse(instant);
  if (!Number.isFinite(milliseconds)) throw new UpstreamSchemaError(path, "expected a valid ISO instant");
  return new Date(milliseconds).toISOString();
}

export function normalizedRecordsMatch(left: object, right: object): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
