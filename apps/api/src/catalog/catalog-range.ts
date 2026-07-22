import { BadRequestException } from "@nestjs/common";

import type { CatalogQuery } from "./catalog-query.js";

export const CATALOG_CLOCK = Symbol("CATALOG_CLOCK");
export type CatalogClock = () => Date;

export interface ResolvedCatalogQuery extends Omit<CatalogQuery, "from" | "to"> {
  readonly from: string;
  readonly rangeWasDefaulted: boolean;
  readonly to: string;
}

export interface CatalogRange {
  readonly defaulted: boolean;
  readonly from: string;
  readonly to: string;
}

const DEFAULT_RANGE_DAYS = 120;

function centralDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Chicago",
    year: "numeric",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value["year"]}-${value["month"]}-${value["day"]}`;
}

function addDays(date: string, days: number): string {
  const instant = new Date(`${date}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

export function resolveCatalogRange(query: CatalogQuery, now: Date): ResolvedCatalogQuery {
  if (!Number.isFinite(now.getTime())) throw new TypeError("Catalog clock returned an invalid date");
  if ((query.from === undefined) !== (query.to === undefined)) {
    throw new BadRequestException("from and to must be provided together");
  }
  if (query.from !== undefined && query.to !== undefined) {
    return { ...query, from: query.from, rangeWasDefaulted: false, to: query.to };
  }
  const from = centralDate(now);
  return {
    ...query,
    from,
    rangeWasDefaulted: true,
    to: addDays(from, DEFAULT_RANGE_DAYS),
  };
}

export function catalogRange(query: ResolvedCatalogQuery): CatalogRange {
  return { defaulted: query.rangeWasDefaulted, from: query.from, to: query.to };
}
