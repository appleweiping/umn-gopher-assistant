import { BadRequestException } from "@nestjs/common";

export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

const DEFAULT_PAGE_LIMIT = 25;
const MAX_PAGE_LIMIT = 100;

export function parsePageLimit(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PAGE_LIMIT;
  }
  if (!/^\d+$/u.test(value)) {
    throw new BadRequestException("limit must be an integer between 1 and 100");
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new BadRequestException("limit must be an integer between 1 and 100");
  }
  return limit;
}

function encodeCursor(namespace: string, offset: number): string {
  return Buffer.from(`${namespace}:${String(offset)}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined, namespace: string, itemCount: number): number {
  if (cursor === undefined) {
    return 0;
  }
  if (!/^[A-Za-z0-9_-]+$/u.test(cursor)) {
    throw new BadRequestException("cursor is invalid or expired");
  }
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const match = new RegExp(`^${namespace}:(\\d+)$`, "u").exec(decoded);
  const offset = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= itemCount) {
    throw new BadRequestException("cursor is invalid or expired");
  }
  return offset;
}

export function paginateCursorPage<T>(
  items: readonly T[],
  cursor: string | undefined,
  limit: number,
  namespace: string,
): CursorPage<T> {
  const offset = decodeCursor(cursor, namespace, items.length);
  const end = Math.min(offset + limit, items.length);
  return {
    items: items.slice(offset, end),
    nextCursor: end < items.length ? encodeCursor(namespace, end) : null,
  };
}
