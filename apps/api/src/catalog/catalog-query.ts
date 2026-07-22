import { BadRequestException } from "@nestjs/common";
import { CampusIdSchema, type CampusId } from "@umn-gopher-assistant/contracts";

import { SIGNED_CATALOG_CURSOR_PATTERN } from "./catalog-cursor.js";

const ALLOWED_QUERY_PARAMETERS = new Set(["campusId", "cursor", "from", "limit", "to"]);
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const MAX_EXPLICIT_RANGE_DAYS = 183;

export interface CatalogQuery {
  readonly campusId: CampusId;
  readonly cursor?: string;
  readonly from?: string;
  readonly limit: number;
  readonly to?: string;
}

function singleQueryValue(query: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const value = query[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new BadRequestException(`${name} must be specified exactly once`);
  }
  return value;
}

function parseIsoDate(value: string | undefined, name: "from" | "to"): string | undefined {
  if (value === undefined) return undefined;
  const match = ISO_DATE.exec(value);
  if (match === null) {
    throw new BadRequestException(`${name} must be an ISO date in YYYY-MM-DD format`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new BadRequestException(`${name} must be a real calendar date`);
  }
  return value;
}

function parseLimit(value: string | undefined): number {
  if (value === undefined) return 25;
  if (!/^(?:[1-9]|[1-9]\d|100)$/u.test(value)) {
    throw new BadRequestException("limit must be an integer between 1 and 100");
  }
  return Number(value);
}

export function parseCatalogQuery(query: Readonly<Record<string, unknown>>): CatalogQuery {
  const unknownParameter = Object.keys(query).find((key) => !ALLOWED_QUERY_PARAMETERS.has(key));
  if (unknownParameter !== undefined) {
    throw new BadRequestException(`unknown query parameter: ${unknownParameter}`);
  }

  const campusValue = singleQueryValue(query, "campusId");
  const campus = CampusIdSchema.safeParse(campusValue);
  if (!campus.success) {
    throw new BadRequestException("campusId is required and must identify a supported campus");
  }

  const cursor = singleQueryValue(query, "cursor");
  if (cursor !== undefined && !SIGNED_CATALOG_CURSOR_PATTERN.test(cursor)) {
    throw new BadRequestException("cursor is invalid");
  }
  const from = parseIsoDate(singleQueryValue(query, "from"), "from");
  const to = parseIsoDate(singleQueryValue(query, "to"), "to");
  if (from !== undefined && to !== undefined && from > to) {
    throw new BadRequestException("from must not follow to");
  }
  if ((from === undefined) !== (to === undefined)) {
    throw new BadRequestException("from and to must be provided together");
  }
  if (from !== undefined && to !== undefined) {
    const rangeDays = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000;
    if (rangeDays > MAX_EXPLICIT_RANGE_DAYS) {
      throw new BadRequestException("the requested date range must not exceed 183 days");
    }
  }

  return {
    campusId: campus.data,
    ...(cursor === undefined ? {} : { cursor }),
    ...(from === undefined ? {} : { from }),
    limit: parseLimit(singleQueryValue(query, "limit")),
    ...(to === undefined ? {} : { to }),
  };
}
