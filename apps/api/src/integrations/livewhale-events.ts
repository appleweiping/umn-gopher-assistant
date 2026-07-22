import { IntegrationError, ObservedIntegrationError, UpstreamSchemaError } from "./errors.js";
import type { SourceLicenseGate } from "./license-gate.js";
import {
  expectArray,
  expectInstant,
  expectInteger,
  expectObject,
  expectString,
  normalizedRecordsMatch,
  optionalString,
} from "./parsing.js";
import {
  buildLiveWhaleUrl,
  INTEGRATION_ENDPOINT_IDS,
  MAX_LIVEWHALE_AGGREGATE_BYTES,
  MAX_LIVEWHALE_PAGES,
  MAX_LIVEWHALE_RECORDS,
  type IntegrationEndpointId,
  type SafeJsonFetcher,
} from "./safe-json-fetcher.js";
import type { SourceRequestCoordinator } from "./source-request-coordinator.js";
import type { CampusSourceAdapter, CampusSourceResult, IntegrationSourceDescriptor } from "./types.js";

export type LiveWhaleCampusId = "tc" | "duluth";
export type CampusEventStatus = "LIVE" | "HIDDEN" | "CANCELLED";

export interface LiveWhaleEventRequest {
  readonly page?: number;
}

export interface CampusEventOccurrence {
  /** Stable occurrence identity: upstream event id plus normalized start. */
  readonly occurrenceId: string;
  readonly upstreamId: string;
  readonly campusId: LiveWhaleCampusId;
  readonly title: string;
  readonly startAt: string;
  readonly endAt: string | null;
  /** Source-local calendar dates; do not derive these by slicing UTC instants. */
  readonly localStartDate: string;
  readonly localEndDate: string | null;
  readonly timeZone: string;
  readonly allDay: boolean;
  readonly status: CampusEventStatus;
  readonly location: string | null;
  readonly sourceUrl: string;
}

export interface LiveWhalePagination {
  readonly page: number;
  readonly pageSize: 50;
  readonly sourceTotalPages: number;
  readonly sourceTotalRecords: number;
  readonly sourceHasNextPage: boolean;
  /** Next page inside this adapter's bounded retrieval policy. */
  readonly nextPage: number | null;
  readonly truncatedByPolicy: boolean;
  readonly policy: {
    readonly maxPages: number;
    readonly maxRecords: number;
    /**
     * Maximum accepted logical traversal bytes. A page that crosses this
     * budget is still independently stream-capped, then discarded rather
     * than returned and no successor cursor is issued.
     */
    readonly maxAggregateBytes: number;
  };
}

export interface LiveWhaleEventsPageResult extends CampusSourceResult<CampusEventOccurrence> {
  readonly pagination: LiveWhalePagination;
}

export interface ParsedLiveWhaleEventsPage {
  readonly records: readonly CampusEventOccurrence[];
  readonly pagination: LiveWhalePagination;
}

interface LocalizedInstant {
  readonly instant: string;
  readonly localDate: string;
}

function expectIanaTimeZone(value: unknown, path: string): string {
  const timeZone = expectString(
    value,
    path,
    64,
    /^(?:UTC|Etc\/[A-Za-z0-9_+-]+|[A-Za-z]+(?:[_-][A-Za-z]+)*\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)*)$/u,
  );
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone;
  } catch {
    throw new UpstreamSchemaError(path, "expected a valid IANA time zone");
  }
}

function localWallTime(instant: Date, timeZone: string): string {
  const fields = new Map(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return `${fields.get("year") ?? ""}-${fields.get("month") ?? ""}-${fields.get("day") ?? ""}T${fields.get("hour") ?? ""}:${fields.get("minute") ?? ""}:${fields.get("second") ?? ""}`;
}

function expectLocalizedInstant(value: unknown, path: string, timeZone: string): LocalizedInstant {
  const sourceValue = expectString(value, path, 64);
  const instant = expectInstant(sourceValue, path);
  if (localWallTime(new Date(instant), timeZone) !== sourceValue.slice(0, 19)) {
    throw new UpstreamSchemaError(path, "UTC offset and wall time do not match the declared time zone");
  }
  return Object.freeze({ instant, localDate: sourceValue.slice(0, 10) });
}

const LIVEWHALE_SOURCES = Object.freeze({
  tc: Object.freeze({
    id: "tc-events-feed",
    campusIds: Object.freeze(["tc"]),
    endpointId: INTEGRATION_ENDPOINT_IDS.twinCitiesEvents,
    sourceUrl: buildLiveWhaleUrl("tc"),
    licenseStatus: "LIVE_ONLY",
    rawContentPolicy: "HASH_OBSERVATION_ONLY",
  } as const satisfies IntegrationSourceDescriptor),
  duluth: Object.freeze({
    id: "duluth-events-feed",
    campusIds: Object.freeze(["duluth"]),
    endpointId: INTEGRATION_ENDPOINT_IDS.duluthEvents,
    sourceUrl: buildLiveWhaleUrl("duluth"),
    licenseStatus: "LIVE_ONLY",
    rawContentPolicy: "HASH_OBSERVATION_ONLY",
  } as const satisfies IntegrationSourceDescriptor),
});

export const TC_LIVEWHALE_SOURCE = LIVEWHALE_SOURCES.tc;
export const DULUTH_LIVEWHALE_SOURCE = LIVEWHALE_SOURCES.duluth;

function eventArray(input: unknown): readonly unknown[] {
  if (Array.isArray(input)) return expectArray(input, "$", 1_000);
  const root = expectObject(input, "$");
  if (root["errors"] !== undefined) throw new UpstreamSchemaError("$.errors", "upstream reported errors");
  if (root["data"] !== undefined) return expectArray(root["data"], "$.data", 1_000);
  if (root["results"] !== undefined) return expectArray(root["results"], "$.results", 1_000);
  throw new UpstreamSchemaError("$", "expected LiveWhale data or results array");
}

function assertOfficialEventUrl(value: unknown, path: string, campusId: LiveWhaleCampusId): string {
  const text = expectString(value, path, 2_048);
  let url: URL;
  try {
    url = new URL(text);
  } catch (error) {
    throw new UpstreamSchemaError(
      path,
      `invalid event URL: ${error instanceof Error ? error.name : "error"}`,
    );
  }
  const hasUnsafeAuthority =
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.hash !== "";
  const isUmnHost = url.hostname === "umn.edu" || url.hostname.endsWith(".umn.edu");
  const isCleanUmnUrl = isUmnHost && url.search === "";
  const isBoundedDuluthCampusGroupsUrl =
    campusId === "duluth" &&
    url.hostname === "duluthumn.campusgroups.com" &&
    url.pathname === "/rsvp" &&
    [...url.searchParams.keys()].every((key) => key === "id") &&
    url.searchParams.getAll("id").length === 1 &&
    /^\d{1,16}$/u.test(url.searchParams.get("id") ?? "");
  if (hasUnsafeAuthority || (!isCleanUmnUrl && !isBoundedDuluthCampusGroupsUrl)) {
    throw new UpstreamSchemaError(path, "event URL is outside the bounded UMN HTTPS domain");
  }
  return url.href;
}

function parseEvent(input: unknown, index: number, campusId: LiveWhaleCampusId): CampusEventOccurrence {
  const path = `events[${String(index)}]`;
  const event = expectObject(input, path);
  const idValue = event["id"];
  const upstreamId =
    typeof idValue === "number"
      ? String(expectInteger(idValue, `${path}.id`, 1, Number.MAX_SAFE_INTEGER))
      : expectString(idValue, `${path}.id`, 64, /^[A-Za-z0-9_-]+$/u);
  const timeZone = expectIanaTimeZone(event["timezone"], `${path}.timezone`);
  const start = expectLocalizedInstant(event["date_iso"], `${path}.date_iso`, timeZone);
  const end =
    event["date2_iso"] === null || event["date2_iso"] === undefined
      ? null
      : expectLocalizedInstant(event["date2_iso"], `${path}.date2_iso`, timeZone);
  if (end !== null && end.instant < start.instant) {
    throw new UpstreamSchemaError(`${path}.date2_iso`, "end instant precedes start instant");
  }

  const allDayValue = event["is_all_day"];
  if (allDayValue !== null && allDayValue !== undefined && allDayValue !== 0 && allDayValue !== 1) {
    throw new UpstreamSchemaError(`${path}.is_all_day`, "expected null, zero, or one");
  }

  const rawStatus = expectInteger(event["status"], `${path}.status`, 1, 2);
  const canceledValue = event["is_canceled"];
  if (canceledValue !== null && canceledValue !== undefined && canceledValue !== 0 && canceledValue !== 1) {
    throw new UpstreamSchemaError(`${path}.is_canceled`, "expected null, zero, or one");
  }
  const status: CampusEventStatus = canceledValue === 1 ? "CANCELLED" : rawStatus === 1 ? "LIVE" : "HIDDEN";

  return Object.freeze({
    occurrenceId: `livewhale:${campusId}:${upstreamId}:${start.instant}`,
    upstreamId,
    campusId,
    title: expectString(event["title"], `${path}.title`, 512),
    startAt: start.instant,
    endAt: end?.instant ?? null,
    localStartDate: start.localDate,
    localEndDate: end?.localDate ?? null,
    timeZone,
    allDay: allDayValue === 1,
    status,
    location: optionalString(event["location"], `${path}.location`, 512),
    sourceUrl: assertOfficialEventUrl(event["url"], `${path}.url`, campusId),
  });
}

export function parseLiveWhaleEvents(
  input: unknown,
  campusId: LiveWhaleCampusId,
): readonly CampusEventOccurrence[] {
  const byOccurrence = new Map<string, CampusEventOccurrence>();
  eventArray(input).forEach((value, index) => {
    const parsed = parseEvent(value, index, campusId);
    const previous = byOccurrence.get(parsed.occurrenceId);
    if (previous === undefined) {
      byOccurrence.set(parsed.occurrenceId, parsed);
      return;
    }
    if (!normalizedRecordsMatch(previous, parsed)) {
      throw new UpstreamSchemaError(`events[${String(index)}]`, "conflicting duplicate occurrence");
    }
  });
  return Object.freeze(
    [...byOccurrence.values()].sort(
      (left, right) =>
        left.startAt.localeCompare(right.startAt) || left.upstreamId.localeCompare(right.upstreamId),
    ),
  );
}

export function parseLiveWhaleEventsPage(
  input: unknown,
  campusId: LiveWhaleCampusId,
  expectedPage: number,
): ParsedLiveWhaleEventsPage {
  const root = expectObject(input, "$");
  const meta = expectObject(root["meta"], "$.meta");
  const page = expectInteger(meta["page"], "$.meta.page", 1, Number.MAX_SAFE_INTEGER);
  if (page !== expectedPage) throw new UpstreamSchemaError("$.meta.page", "page does not match the request");
  const pageSize = expectInteger(meta["per_page"], "$.meta.per_page", 1, 1_000);
  if (pageSize !== 50) throw new UpstreamSchemaError("$.meta.per_page", "expected the fixed page size 50");
  const sourceTotalPages = expectInteger(
    meta["total_pages"],
    "$.meta.total_pages",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const sourceTotalRecords = expectInteger(
    meta["total_results"],
    "$.meta.total_results",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const calculatedTotalPages = Math.ceil(sourceTotalRecords / pageSize);
  if (
    sourceTotalPages !== calculatedTotalPages ||
    (sourceTotalPages === 0 ? page !== 1 : page > sourceTotalPages)
  ) {
    throw new UpstreamSchemaError("$.meta", "pagination totals are internally inconsistent");
  }

  const records = parseLiveWhaleEvents(input, campusId);
  if (records.length > 50) throw new UpstreamSchemaError("$.data", "page exceeds the fixed record limit");
  if (records.length > sourceTotalRecords) {
    throw new UpstreamSchemaError("$.data", "page record count exceeds the declared source total");
  }
  const boundedTotalPages = Math.min(
    sourceTotalPages,
    MAX_LIVEWHALE_PAGES,
    Math.ceil(MAX_LIVEWHALE_RECORDS / 50),
  );
  const sourceHasNextPage = page < sourceTotalPages;
  const nextPage = page < boundedTotalPages ? page + 1 : null;

  return Object.freeze({
    records,
    pagination: Object.freeze({
      page,
      pageSize: 50,
      sourceTotalPages,
      sourceTotalRecords,
      sourceHasNextPage,
      nextPage,
      truncatedByPolicy: sourceTotalPages > boundedTotalPages || sourceTotalRecords > MAX_LIVEWHALE_RECORDS,
      policy: Object.freeze({
        maxPages: MAX_LIVEWHALE_PAGES,
        maxRecords: MAX_LIVEWHALE_RECORDS,
        maxAggregateBytes: MAX_LIVEWHALE_AGGREGATE_BYTES,
      }),
    }),
  });
}

export interface LiveWhaleEventsAdapterOptions {
  readonly campusId: LiveWhaleCampusId;
  readonly fetcher: SafeJsonFetcher;
  readonly licenseGate: SourceLicenseGate;
  readonly coordinator: SourceRequestCoordinator;
  readonly networkGuard?: () => void;
}

export class LiveWhaleEventsAdapter implements CampusSourceAdapter<
  LiveWhaleEventRequest,
  CampusEventOccurrence
> {
  readonly source: IntegrationSourceDescriptor;
  readonly #campusId: LiveWhaleCampusId;
  readonly #endpointId: IntegrationEndpointId;
  readonly #fetcher: SafeJsonFetcher;
  readonly #licenseGate: SourceLicenseGate;
  readonly #networkGuard: () => void;
  readonly #coordinator: SourceRequestCoordinator;

  constructor(options: LiveWhaleEventsAdapterOptions) {
    this.#campusId = options.campusId;
    this.source = LIVEWHALE_SOURCES[options.campusId];
    this.#endpointId = this.source.endpointId as IntegrationEndpointId;
    this.#fetcher = options.fetcher;
    this.#licenseGate = options.licenseGate;
    this.#networkGuard = options.networkGuard ?? (() => undefined);
    this.#coordinator = options.coordinator;
  }

  fetch(request: LiveWhaleEventRequest = {}, signal?: AbortSignal): Promise<LiveWhaleEventsPageResult> {
    this.#assertNetworkAllowed();
    const url = buildLiveWhaleUrl(this.#campusId, request.page ?? 1);
    return this.#coordinator.run(
      this.#endpointId,
      url,
      async () => {
        const fetched = await this.#fetcher.fetchJson(this.#endpointId, url, signal);
        let parsed: ParsedLiveWhaleEventsPage;
        try {
          parsed = parseLiveWhaleEventsPage(fetched.json, this.#campusId, request.page ?? 1);
        } catch (error) {
          const parseError =
            error instanceof IntegrationError
              ? error
              : new IntegrationError(
                  "UPSTREAM_SCHEMA_DRIFT",
                  "Upstream LiveWhale response could not be normalized",
                  false,
                );
          throw new ObservedIntegrationError(parseError, fetched.observation);
        }
        return Object.freeze({
          records: parsed.records,
          pagination: parsed.pagination,
          observation: fetched.observation,
        });
      },
      () => this.#assertNetworkAllowed(),
    );
  }

  #assertNetworkAllowed(): void {
    this.#licenseGate.assertNetworkAllowed(this.source);
    this.#networkGuard();
  }
}
