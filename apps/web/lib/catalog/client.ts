import {
  AcademicSessionSchema,
  PublicEventSchema,
  SourceObservationSchema,
  type AcademicSession,
  type CampusId,
  type PublicEvent,
  type SourceObservation,
} from "@umn-gopher-assistant/contracts";

import { isSignedCatalogCursor } from "./cursor";

export type CatalogResource = "events" | "sessions";

export interface CatalogRange {
  readonly defaulted: boolean;
  readonly from: string;
  readonly to: string;
}

export interface RetrievalCoverage {
  readonly nextUpstreamPage: number | null;
  readonly pagesFetched: number;
  readonly recordsFetched: number;
  readonly sourceTotalPages: number;
  readonly sourceTotalRecords: number;
  readonly truncatedByPolicy: boolean;
}

export interface CatalogPage<T extends AcademicSession | PublicEvent> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly range: CatalogRange;
  readonly retrievalCoverage: RetrievalCoverage;
  readonly sourceObservations: readonly SourceObservation[];
}

export interface CatalogDateWindow {
  readonly from: string;
  readonly to: string;
}

interface CatalogProblem {
  readonly detail: string;
  readonly failureCode?: string;
  readonly officialUrl?: string;
  readonly status: number;
  readonly title: string;
  readonly traceId?: string;
}

export class CatalogRequestError extends Error {
  readonly failureCode: string | undefined;
  readonly officialUrl: string | undefined;
  readonly status: number;
  readonly traceId: string | undefined;

  constructor(problem: CatalogProblem) {
    super(problem.detail);
    this.name = "CatalogRequestError";
    this.failureCode = problem.failureCode;
    this.officialUrl = problem.officialUrl;
    this.status = problem.status;
    this.traceId = problem.traceId;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key));
}

function integer(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function parseRange(value: unknown): CatalogRange {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["defaulted", "from", "to"]) ||
    typeof value["defaulted"] !== "boolean" ||
    typeof value["from"] !== "string" ||
    typeof value["to"] !== "string" ||
    !realIsoDate(value["from"]) ||
    !realIsoDate(value["to"]) ||
    value["from"] > value["to"]
  ) {
    throw new TypeError("Catalog response contains an invalid date range");
  }
  return { defaulted: value["defaulted"], from: value["from"], to: value["to"] };
}

function realIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
  );
}

function parseCoverage(value: unknown): RetrievalCoverage {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "nextUpstreamPage",
      "pagesFetched",
      "recordsFetched",
      "sourceTotalPages",
      "sourceTotalRecords",
      "truncatedByPolicy",
    ]) ||
    (value["nextUpstreamPage"] !== null && !integer(value["nextUpstreamPage"], 1)) ||
    !integer(value["pagesFetched"], 1) ||
    !integer(value["recordsFetched"]) ||
    !integer(value["sourceTotalPages"]) ||
    !integer(value["sourceTotalRecords"]) ||
    typeof value["truncatedByPolicy"] !== "boolean"
  ) {
    throw new TypeError("Catalog response contains invalid retrieval coverage");
  }
  return {
    nextUpstreamPage: value["nextUpstreamPage"],
    pagesFetched: value["pagesFetched"],
    recordsFetched: value["recordsFetched"],
    sourceTotalPages: value["sourceTotalPages"],
    sourceTotalRecords: value["sourceTotalRecords"],
    truncatedByPolicy: value["truncatedByPolicy"],
  };
}

function parseProblem(value: unknown, responseStatus: number): CatalogProblem {
  if (!isRecord(value)) {
    return {
      detail: "The catalog service returned an unreadable error.",
      status: responseStatus,
      title: "Error",
    };
  }
  const officialUrl = typeof value["officialUrl"] === "string" ? value["officialUrl"] : undefined;
  let safeOfficialUrl: string | undefined;
  if (officialUrl !== undefined) {
    try {
      const parsed = new URL(officialUrl);
      if (parsed.protocol === "https:" && parsed.username === "" && parsed.password === "") {
        safeOfficialUrl = parsed.href;
      }
    } catch {
      // Ignore an invalid fallback URL rather than rendering an unsafe link.
    }
  }
  return {
    detail:
      typeof value["detail"] === "string"
        ? value["detail"]
        : "The catalog service could not complete this request.",
    ...(typeof value["failureCode"] === "string" ? { failureCode: value["failureCode"] } : {}),
    ...(safeOfficialUrl === undefined ? {} : { officialUrl: safeOfficialUrl }),
    status: responseStatus,
    title: typeof value["title"] === "string" ? value["title"] : "Error",
    ...(typeof value["traceId"] === "string" ? { traceId: value["traceId"] } : {}),
  };
}

function parsePage(
  value: unknown,
  resource: CatalogResource,
  requestedCampus: CampusId,
): CatalogPage<AcademicSession | PublicEvent> {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["items", "nextCursor", "range", "retrievalCoverage", "sourceObservations"]) ||
    !Array.isArray(value["items"]) ||
    !Array.isArray(value["sourceObservations"]) ||
    (value["nextCursor"] !== null &&
      (typeof value["nextCursor"] !== "string" || !isSignedCatalogCursor(value["nextCursor"])))
  ) {
    throw new TypeError("Catalog response does not match the expected page contract");
  }

  const itemResult =
    resource === "events"
      ? PublicEventSchema.array().safeParse(value["items"])
      : AcademicSessionSchema.array().safeParse(value["items"]);
  const observationResult = SourceObservationSchema.array().min(1).safeParse(value["sourceObservations"]);
  if (!itemResult.success || !observationResult.success) {
    throw new TypeError("Catalog response contains invalid records or provenance");
  }

  const observationsById = new Map(
    observationResult.data.map((observation) => [observation.observationId, observation] as const),
  );
  if (observationsById.size !== observationResult.data.length) {
    throw new TypeError("Catalog response contains duplicate source observations");
  }
  if (
    observationResult.data.some(
      (observation) => observation.outcome !== "SUCCESS" || observation.campusId !== requestedCampus,
    )
  ) {
    throw new TypeError("Successful catalog pages require successful observations for the requested campus");
  }
  const itemIds = new Set(itemResult.data.map((item) => item.id));
  if (itemIds.size !== itemResult.data.length)
    throw new TypeError("Catalog response contains duplicate item IDs");
  for (const item of itemResult.data) {
    const observation = observationsById.get(item.sourceObservationId);
    if (
      item.campusId !== requestedCampus ||
      observation?.campusId !== requestedCampus ||
      observation.sourceId !== item.sourceId ||
      observation.observedAt !== item.observedAt
    ) {
      throw new TypeError("Catalog item provenance does not match the requested campus");
    }
  }

  const retrievalCoverage = parseCoverage(value["retrievalCoverage"]);
  if (
    retrievalCoverage.pagesFetched !== observationResult.data.length ||
    retrievalCoverage.recordsFetched > retrievalCoverage.sourceTotalRecords
  ) {
    throw new TypeError("Catalog retrieval coverage does not match its source observations");
  }
  return {
    items: itemResult.data,
    nextCursor: value["nextCursor"],
    range: parseRange(value["range"]),
    retrievalCoverage,
    sourceObservations: observationResult.data,
  };
}

function centralIsoDate(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new TypeError("Catalog date clock is invalid");
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Chicago",
    year: "numeric",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values["year"]}-${values["month"]}-${values["day"]}`;
}

export function catalogDateWindow(now = new Date(), days = 120): CatalogDateWindow {
  if (!Number.isSafeInteger(days) || days < 0 || days > 183) {
    throw new RangeError("Catalog date window must be between 0 and 183 days");
  }
  const from = centralIsoDate(now);
  const end = new Date(`${from}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + days);
  return { from, to: end.toISOString().slice(0, 10) };
}

export async function fetchCatalogPage(
  resource: "events",
  campusId: CampusId,
  options: { readonly cursor?: string; readonly signal: AbortSignal; readonly window?: CatalogDateWindow },
): Promise<CatalogPage<PublicEvent>>;
export async function fetchCatalogPage(
  resource: "sessions",
  campusId: CampusId,
  options: { readonly cursor?: string; readonly signal: AbortSignal; readonly window?: CatalogDateWindow },
): Promise<CatalogPage<AcademicSession>>;
export async function fetchCatalogPage(
  resource: CatalogResource,
  campusId: CampusId,
  options: { readonly cursor?: string; readonly signal: AbortSignal; readonly window?: CatalogDateWindow },
): Promise<CatalogPage<AcademicSession | PublicEvent>> {
  const window = options.window ?? catalogDateWindow();
  const query = new URLSearchParams({
    campusId,
    from: window.from,
    limit: "50",
    to: window.to,
  });
  if (options.cursor !== undefined) {
    if (!isSignedCatalogCursor(options.cursor)) throw new TypeError("Catalog cursor is invalid");
    query.set("cursor", options.cursor);
  }
  const response = await fetch(`/api/catalog/${resource}?${query.toString()}`, {
    cache: "no-store",
    credentials: "omit",
    headers: { Accept: "application/json, application/problem+json" },
    redirect: "error",
    signal: options.signal,
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CatalogRequestError({
      detail: "The catalog service returned malformed JSON.",
      failureCode: "MALFORMED_CATALOG_RESPONSE",
      status: response.status,
      title: "Invalid response",
    });
  }
  if (!response.ok) throw new CatalogRequestError(parseProblem(body, response.status));
  try {
    return parsePage(body, resource, campusId);
  } catch {
    throw new CatalogRequestError({
      detail: "The catalog response failed local contract validation.",
      failureCode: "CATALOG_CONTRACT_MISMATCH",
      status: 502,
      title: "Invalid response",
    });
  }
}

export function observationForItem(
  page: CatalogPage<AcademicSession | PublicEvent>,
  item: AcademicSession | PublicEvent,
): SourceObservation {
  const observation = page.sourceObservations.find(
    (candidate) => candidate.observationId === item.sourceObservationId,
  );
  if (observation === undefined) throw new TypeError("Catalog item is missing its source observation");
  return observation;
}
