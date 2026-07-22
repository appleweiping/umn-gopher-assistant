import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { BadRequestException, GoneException } from "@nestjs/common";
import type { CampusId } from "@umn-gopher-assistant/contracts";

import type { CatalogQuery } from "./catalog-query.js";
import { MAX_LIVEWHALE_AGGREGATE_BYTES, MAX_LIVEWHALE_PAGES } from "../integrations/safe-json-fetcher.js";
import { loadCatalogCursorHmacKey } from "../runtime-config.js";

export type CatalogResource = "events" | "sessions";

interface CursorBinding {
  readonly campusId: CampusId;
  readonly from: string | null;
  readonly to: string | null;
}

interface SessionCursorPayload extends CursorBinding {
  readonly normalizedSha256: string;
  readonly offset: number;
  readonly resource: "sessions";
  readonly version: 1;
}

interface EventCursorPayload extends CursorBinding {
  readonly normalizedSha256: string;
  readonly offset: number;
  readonly pageRawSha256: string;
  /** Raw bytes fetched before the page bound by this cursor. */
  readonly rawBytesBeforePage: number;
  readonly resource: "events";
  readonly upstreamPage: number;
  readonly version: 3;
}

type CatalogCursorPayload = EventCursorPayload | SessionCursorPayload;

export interface EventCursorStart {
  readonly expectedNormalizedSha256?: string;
  readonly expectedPageRawSha256?: string;
  readonly offset: number;
  readonly rawBytesBeforePage: number;
  readonly upstreamPage: number;
}

const SHA256 = /^[a-f0-9]{64}$/u;
export const SIGNED_CATALOG_CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,1950}\.[A-Za-z0-9_-]{43}$/u;

export function normalizedSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function canonicalPayload(payload: CatalogCursorPayload): CatalogCursorPayload {
  if (payload.resource === "events") {
    return {
      campusId: payload.campusId,
      from: payload.from,
      normalizedSha256: payload.normalizedSha256,
      offset: payload.offset,
      pageRawSha256: payload.pageRawSha256,
      rawBytesBeforePage: payload.rawBytesBeforePage,
      resource: "events",
      to: payload.to,
      upstreamPage: payload.upstreamPage,
      version: 3,
    };
  }
  return {
    campusId: payload.campusId,
    from: payload.from,
    normalizedSha256: payload.normalizedSha256,
    offset: payload.offset,
    resource: "sessions",
    to: payload.to,
    version: 1,
  };
}

function encode(payload: CatalogCursorPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(canonicalPayload(payload)), "utf8").toString("base64url");
  const signature = createHmac("sha256", loadCatalogCursorHmacKey())
    .update(encodedPayload, "ascii")
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function commonCandidateIsValid(candidate: Record<string, unknown>): boolean {
  return (
    typeof candidate["campusId"] === "string" &&
    (candidate["from"] === null || typeof candidate["from"] === "string") &&
    (candidate["to"] === null || typeof candidate["to"] === "string") &&
    typeof candidate["normalizedSha256"] === "string" &&
    SHA256.test(candidate["normalizedSha256"]) &&
    typeof candidate["offset"] === "number" &&
    Number.isSafeInteger(candidate["offset"])
  );
}

function decode(value: string): CatalogCursorPayload {
  if (!SIGNED_CATALOG_CURSOR_PATTERN.test(value)) throw new BadRequestException("cursor is invalid");
  const separator = value.indexOf(".");
  const encodedPayload = value.slice(0, separator);
  const providedSignature = Buffer.from(value.slice(separator + 1), "base64url");
  const expectedSignature = createHmac("sha256", loadCatalogCursorHmacKey())
    .update(encodedPayload, "ascii")
    .digest();
  if (
    providedSignature.byteLength !== expectedSignature.byteLength ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    throw new BadRequestException("cursor is invalid");
  }
  let parsed: unknown;
  try {
    const bytes = Buffer.from(encodedPayload, "base64url");
    if (bytes.toString("base64url") !== encodedPayload) throw new TypeError("non-canonical base64url");
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new BadRequestException("cursor is invalid");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BadRequestException("cursor is invalid");
  }
  const candidate = parsed as Record<string, unknown>;
  const isSession =
    Object.keys(candidate).sort().join(",") === "campusId,from,normalizedSha256,offset,resource,to,version" &&
    candidate["version"] === 1 &&
    candidate["resource"] === "sessions" &&
    commonCandidateIsValid(candidate) &&
    (candidate["offset"] as number) >= 1;
  const isEvent =
    Object.keys(candidate).sort().join(",") ===
      "campusId,from,normalizedSha256,offset,pageRawSha256,rawBytesBeforePage,resource,to,upstreamPage,version" &&
    candidate["version"] === 3 &&
    candidate["resource"] === "events" &&
    commonCandidateIsValid(candidate) &&
    (candidate["offset"] as number) >= 0 &&
    typeof candidate["pageRawSha256"] === "string" &&
    SHA256.test(candidate["pageRawSha256"]) &&
    typeof candidate["rawBytesBeforePage"] === "number" &&
    Number.isSafeInteger(candidate["rawBytesBeforePage"]) &&
    candidate["rawBytesBeforePage"] >= 0 &&
    candidate["rawBytesBeforePage"] <= MAX_LIVEWHALE_AGGREGATE_BYTES &&
    typeof candidate["upstreamPage"] === "number" &&
    Number.isSafeInteger(candidate["upstreamPage"]) &&
    candidate["upstreamPage"] >= 1 &&
    candidate["upstreamPage"] <= MAX_LIVEWHALE_PAGES;
  if (!isSession && !isEvent) throw new BadRequestException("cursor is invalid");
  const payload = candidate as unknown as CatalogCursorPayload;
  if (encode(payload) !== value) throw new BadRequestException("cursor is invalid");
  return payload;
}

function dateValue(value: string | undefined): string | null {
  return value ?? null;
}

function assertQueryBinding(
  payload: CatalogCursorPayload,
  query: CatalogQuery,
  resource: CatalogResource,
): void {
  if (
    payload.resource !== resource ||
    payload.campusId !== query.campusId ||
    payload.from !== dateValue(query.from) ||
    payload.to !== dateValue(query.to)
  ) {
    throw new BadRequestException("cursor does not match this catalog query");
  }
}

/** Reject malformed or cross-query cursors before any upstream source access. */
export function assertCatalogCursorQuery(
  cursor: string | undefined,
  query: CatalogQuery,
  resource: CatalogResource,
): void {
  if (cursor === undefined) return;
  assertQueryBinding(decode(cursor), query, resource);
}

export function cursorOffset(
  cursor: string | undefined,
  query: CatalogQuery,
  resource: "sessions",
  snapshotSha256: string,
  itemCount: number,
): number {
  if (cursor === undefined) return 0;
  const payload = decode(cursor);
  assertQueryBinding(payload, query, resource);
  if (payload.resource !== "sessions") throw new BadRequestException("cursor is invalid");
  if (payload.normalizedSha256 !== snapshotSha256) {
    throw new GoneException("cursor expired because the source snapshot changed");
  }
  if (payload.offset >= itemCount) {
    throw new BadRequestException("cursor offset is outside the source snapshot");
  }
  return payload.offset;
}

export function nextCatalogCursor(
  nextOffset: number,
  itemCount: number,
  query: CatalogQuery,
  resource: "sessions",
  snapshotSha256: string,
): string | null {
  if (nextOffset >= itemCount) return null;
  return encode({
    campusId: query.campusId,
    from: dateValue(query.from),
    normalizedSha256: snapshotSha256,
    offset: nextOffset,
    resource,
    to: dateValue(query.to),
    version: 1,
  });
}

export function eventCursorStart(cursor: string | undefined, query: CatalogQuery): EventCursorStart {
  if (cursor === undefined) return { offset: 0, rawBytesBeforePage: 0, upstreamPage: 1 };
  const payload = decode(cursor);
  assertQueryBinding(payload, query, "events");
  if (payload.resource !== "events") throw new BadRequestException("cursor is invalid");
  return {
    expectedNormalizedSha256: payload.normalizedSha256,
    expectedPageRawSha256: payload.pageRawSha256,
    offset: payload.offset,
    rawBytesBeforePage: payload.rawBytesBeforePage,
    upstreamPage: payload.upstreamPage,
  };
}

export function assertEventCursorSnapshot(
  cursor: EventCursorStart,
  pageRawSha256: string,
  pageNormalizedSha256: string,
  itemCount: number,
): void {
  if (
    cursor.expectedPageRawSha256 !== undefined &&
    (cursor.expectedPageRawSha256 !== pageRawSha256 ||
      cursor.expectedNormalizedSha256 !== pageNormalizedSha256)
  ) {
    throw new GoneException("cursor expired because the source page snapshot changed");
  }
  if (cursor.offset > itemCount) {
    throw new BadRequestException("cursor offset is outside the source page snapshot");
  }
}

export function nextEventCursor(
  query: CatalogQuery,
  upstreamPage: number,
  offset: number,
  pageRawSha256: string,
  pageNormalizedSha256: string,
  rawBytesBeforePage: number,
): string {
  return encode({
    campusId: query.campusId,
    from: dateValue(query.from),
    normalizedSha256: pageNormalizedSha256,
    offset,
    pageRawSha256,
    rawBytesBeforePage,
    resource: "events",
    to: dateValue(query.to),
    upstreamPage,
    version: 3,
  });
}
