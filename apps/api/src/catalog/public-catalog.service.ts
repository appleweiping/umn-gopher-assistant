import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import {
  AcademicSessionSchema,
  PublicEventSchema,
  SourceObservationSchema,
  type AcademicSession,
  type PublicEvent,
  type SourceDescriptor,
  type SourceObservation,
} from "@umn-gopher-assistant/contracts";

import {
  IntegrationError,
  ObservedIntegrationError,
  SourceCircuitOpenError,
  SourceLicenseDeniedError,
  SourceQueueSaturatedError,
  SourceQueueTimeoutError,
  SourceRateLimitedError,
  type CampusEventOccurrence,
  type CampusSourceResult,
  type LiveWhaleEventsPageResult,
  type SourceHashObservation,
  type UmnAcademicSession,
} from "../integrations/index.js";
import { CatalogUnavailableException } from "../http/catalog-unavailable.exception.js";
import { reviewedTermIdsForRange } from "./academic-term-routing.js";
import {
  assertCatalogCursorQuery,
  assertEventCursorSnapshot,
  cursorOffset,
  eventCursorStart,
  nextCatalogCursor,
  nextEventCursor,
  normalizedSha256,
  type EventCursorStart,
} from "./catalog-cursor.js";
import type { CatalogQuery } from "./catalog-query.js";
import {
  CATALOG_CLOCK,
  catalogRange,
  resolveCatalogRange,
  type CatalogClock,
  type CatalogRange,
  type ResolvedCatalogQuery,
} from "./catalog-range.js";
import { PUBLIC_CATALOG_GATEWAY, type PublicCatalogGateway } from "./public-catalog.gateway.js";
import { SOURCE_OBSERVATION_SINK, type SourceObservationSink } from "./source-observation.sink.js";

export interface RetrievalCoverage {
  readonly nextUpstreamPage: number | null;
  readonly pagesFetched: number;
  readonly recordsFetched: number;
  readonly sourceTotalPages: number;
  readonly sourceTotalRecords: number;
  readonly truncatedByPolicy: boolean;
}

export interface CatalogPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly range: CatalogRange;
  readonly retrievalCoverage: RetrievalCoverage;
  readonly sourceObservations: readonly SourceObservation[];
}

type AcademicSessionContent = Omit<AcademicSession, "observedAt" | "sourceObservationId">;
type PublicEventContent = Omit<PublicEvent, "observedAt" | "sourceObservationId">;

interface PreparedCatalog<TContent> {
  readonly content: readonly TContent[];
  readonly recordsAccepted: number;
}

interface PreparedEventPage {
  readonly content: readonly PublicEventContent[];
  readonly observation: SourceObservation;
  readonly result: LiveWhaleEventsPageResult;
}

const VALIDATION_OBSERVATION_ID = "00000000-0000-4000-8000-000000000000";
const VALIDATION_OBSERVED_AT = "1970-01-01T00:00:00.000Z";
const MAX_EVENT_SOURCE_PAGES_PER_REQUEST = 3;

function sessionContent(record: UmnAcademicSession, sourceId: string): AcademicSessionContent {
  const candidate: AcademicSessionContent = {
    academicCareerCode: record.academicCareerId,
    beginDate: record.beginDate,
    campusId: record.campusId,
    endDate: record.endDate,
    enrollmentOpenDate: record.enrollmentOpenDate,
    id: record.sessionId,
    institutionCode: record.institutionCode,
    name: record.name,
    sessionCode: record.sessionCode,
    sourceId,
    termCode: record.termId,
  };
  AcademicSessionSchema.parse({
    ...candidate,
    observedAt: VALIDATION_OBSERVED_AT,
    sourceObservationId: VALIDATION_OBSERVATION_ID,
  });
  return candidate;
}

function eventContent(record: CampusEventOccurrence, sourceId: string): PublicEventContent | null {
  if (record.status === "HIDDEN") return null;
  const candidate: PublicEventContent = {
    allDay: record.allDay,
    campusId: record.campusId,
    canonicalUrl: record.sourceUrl,
    categories: [],
    descriptionText: null,
    endsAt: record.endAt,
    id: `livewhale:${record.campusId}:${record.upstreamId}:${String(Date.parse(record.startAt))}`,
    language: "en",
    location:
      record.location === null
        ? null
        : { address: null, coordinates: null, name: record.location, onlineUrl: null },
    sourceId,
    startsAt: record.startAt,
    status: record.status === "CANCELLED" ? "CANCELLED" : "SCHEDULED",
    timeZone: record.timeZone,
    title: record.title,
  };
  PublicEventSchema.parse({
    ...candidate,
    observedAt: VALIDATION_OBSERVED_AT,
    sourceObservationId: VALIDATION_OBSERVATION_ID,
  });
  return candidate;
}

function sessionFallsInRange(session: AcademicSessionContent, from: string, to: string): boolean {
  return session.endDate >= from && session.beginDate <= to;
}

function eventFallsInRange(record: CampusEventOccurrence, from: string, to: string): boolean {
  return (record.localEndDate ?? record.localStartDate) >= from && record.localStartDate <= to;
}

function appliedCacheDisposition(source: SourceDescriptor): SourceObservation["appliedCacheDisposition"] {
  if (source.cachePolicy === "NO_ACCESS") return "NO_ACCESS";
  if (source.cachePolicy === "METADATA_ONLY") return "OPERATIONAL_METADATA_ONLY";
  return "DISCARDED_AFTER_RESPONSE";
}

function parserVersion(source: SourceDescriptor): string {
  return source.resourceKinds.includes("ACADEMIC_SESSION") ? "umn-sessions@1.0.0" : "livewhale-events@1.0.0";
}

const OFFICIAL_FALLBACK_BY_SOURCE_ID: Readonly<Record<string, string>> = Object.freeze({
  "duluth-events-feed": "https://calendar.d.umn.edu/",
  "morris-events-feed": "https://events.morris.umn.edu/",
  "tc-events-feed": "https://events.tc.umn.edu/feed_builder",
  "umn-sessions-crookston": "https://asr-custom.umn.edu/sessions_data_service/",
  "umn-sessions-duluth": "https://asr-custom.umn.edu/sessions_data_service/",
  "umn-sessions-morris": "https://asr-custom.umn.edu/sessions_data_service/",
  "umn-sessions-rochester": "https://asr-custom.umn.edu/sessions_data_service/",
  "umn-sessions-tc": "https://asr-custom.umn.edu/sessions_data_service/",
});

function officialFallbackUrl(source: SourceDescriptor): string {
  return OFFICIAL_FALLBACK_BY_SOURCE_ID[source.id] ?? source.sourceUrl;
}

function successfulObservation(
  source: SourceDescriptor,
  result: CampusSourceResult<unknown>,
  durationMs: number,
  campusId: CatalogQuery["campusId"],
): SourceObservation {
  return SourceObservationSchema.parse({
    appliedCacheDisposition: appliedCacheDisposition(source),
    cachePolicy: source.cachePolicy,
    campusId,
    dataClassification: source.dataClassification,
    durationMs: Math.min(120_000, Math.max(0, durationMs)),
    failureCode: null,
    freshnessState: "FRESH",
    httpStatus: result.observation.httpStatus,
    licenseStatus: source.licenseStatus,
    observationId: randomUUID(),
    observedAt: result.observation.fetchedAt,
    outcome: "SUCCESS",
    parserVersion: parserVersion(source),
    rawByteLength: result.observation.byteLength,
    rawSha256: result.observation.sha256,
    recordsAccepted: result.records.length,
    recordsRejected: 0,
    sourceId: source.id,
  });
}

function attachObservation<TContent extends object>(
  content: readonly TContent[],
  observation: SourceObservation,
): readonly (TContent & { readonly observedAt: string; readonly sourceObservationId: string })[] {
  return content.map((record) => ({
    ...record,
    observedAt: observation.observedAt,
    sourceObservationId: observation.observationId,
  }));
}

function failureCode(error: unknown): string {
  if (error instanceof SourceLicenseDeniedError) return "SOURCE_DISABLED";
  if (error instanceof IntegrationError) return error.code;
  if (error instanceof Error && error.name === "ZodError") return "UPSTREAM_SCHEMA_DRIFT";
  return "UPSTREAM_ERROR";
}

function retryAfterSeconds(error: unknown): number {
  if (error instanceof SourceCircuitOpenError || error instanceof SourceRateLimitedError) {
    const remaining = Math.ceil((Date.parse(error.retryAt) - Date.now()) / 1_000);
    return Math.min(86_400, Math.max(1, remaining));
  }
  if (error instanceof SourceQueueSaturatedError || error instanceof SourceQueueTimeoutError) return 1;
  return error instanceof SourceLicenseDeniedError ? 3_600 : 60;
}

function failureOutcome(error: unknown): SourceObservation["outcome"] {
  if (error instanceof SourceLicenseDeniedError) return "DISABLED";
  if (error instanceof IntegrationError) {
    if (error.code === "TIMEOUT") return "TIMEOUT";
    if (
      error.code === "UPSTREAM_RATE_LIMITED" ||
      error.code === "LOCAL_RATE_LIMITED" ||
      error.code === "LOCAL_QUEUE_SATURATED" ||
      error.code === "LOCAL_QUEUE_TIMEOUT"
    )
      return "RATE_LIMITED";
    if (error.code === "UPSTREAM_SCHEMA_DRIFT") return "SCHEMA_MISMATCH";
    if (error.code === "LICENSE_DENIED") return "ACCESS_DENIED";
  }
  if (error instanceof Error && error.name === "ZodError") return "SCHEMA_MISMATCH";
  return "UPSTREAM_ERROR";
}

@Injectable()
export class PublicCatalogService {
  constructor(
    @Inject(PUBLIC_CATALOG_GATEWAY) private readonly gateway: PublicCatalogGateway,
    @Inject(CATALOG_CLOCK) private readonly clock: CatalogClock,
    @Inject(SOURCE_OBSERVATION_SINK) private readonly observationSink: SourceObservationSink,
  ) {}

  async listSessions(query: CatalogQuery): Promise<CatalogPage<AcademicSession>> {
    const effectiveQuery = resolveCatalogRange(query, this.clock());
    const source = this.gateway.source(effectiveQuery.campusId, "ACADEMIC_SESSION");
    assertCatalogCursorQuery(effectiveQuery.cursor, effectiveQuery, "sessions");
    const termIds = reviewedTermIdsForRange(effectiveQuery.from, effectiveQuery.to);
    if (termIds === null) {
      throw this.#unavailableByCode(
        source,
        effectiveQuery.campusId,
        "TERM_WINDOW_UNAVAILABLE",
        "DISABLED",
        0,
        86_400,
      );
    }
    const startedAt = Date.now();
    let result: CampusSourceResult<UmnAcademicSession>;
    let prepared: PreparedCatalog<AcademicSessionContent>;
    try {
      result = await this.gateway.fetchSessions(effectiveQuery.campusId, termIds);
      prepared = {
        content: result.records
          .map((record) => sessionContent(record, source.id))
          .filter((record) => sessionFallsInRange(record, effectiveQuery.from, effectiveQuery.to)),
        recordsAccepted: result.records.length,
      };
    } catch (error) {
      throw this.#unavailable(source, effectiveQuery.campusId, error, Date.now() - startedAt);
    }
    return this.#sessionPage(effectiveQuery, source, result, prepared, Date.now() - startedAt);
  }

  async listEvents(query: CatalogQuery): Promise<CatalogPage<PublicEvent>> {
    const effectiveQuery = resolveCatalogRange(query, this.clock());
    const source = this.gateway.source(effectiveQuery.campusId, "PUBLIC_EVENT");
    assertCatalogCursorQuery(effectiveQuery.cursor, effectiveQuery, "events");
    const initialCursor = eventCursorStart(effectiveQuery.cursor, effectiveQuery);
    const items: PublicEvent[] = [];
    const sourceObservations: SourceObservation[] = [];
    const seenEventContentSha256 = new Map<string, string>();
    let aggregateBytes = initialCursor.rawBytesBeforePage;
    let recordsFetched = 0;
    let sourceTotalPages: number | undefined;
    let sourceTotalRecords: number | undefined;
    let truncatedByPolicy = false;
    let nextCursor: string | null = null;
    let nextUpstreamPage: number | null = null;
    let currentCursor: EventCursorStart = initialCursor;

    for (let pageIndex = 0; pageIndex < MAX_EVENT_SOURCE_PAGES_PER_REQUEST; pageIndex += 1) {
      const prepared = await this.#eventPage(source, effectiveQuery, currentCursor.upstreamPage);
      sourceObservations.push(prepared.observation);
      this.#recordObservation(prepared.observation);
      const { pagination } = prepared.result;
      if (
        (sourceTotalPages !== undefined && sourceTotalPages !== pagination.sourceTotalPages) ||
        (sourceTotalRecords !== undefined && sourceTotalRecords !== pagination.sourceTotalRecords)
      ) {
        throw this.#unavailableByCode(
          source,
          effectiveQuery.campusId,
          "UPSTREAM_SCHEMA_DRIFT",
          "SCHEMA_MISMATCH",
          0,
          60,
        );
      }
      sourceTotalPages = pagination.sourceTotalPages;
      sourceTotalRecords = pagination.sourceTotalRecords;
      const pageSha256 = normalizedSha256(prepared.content);
      if (pageIndex === 0) {
        assertEventCursorSnapshot(
          currentCursor,
          prepared.result.observation.sha256,
          pageSha256,
          prepared.content.length,
        );
      }
      aggregateBytes += prepared.result.observation.byteLength;
      recordsFetched += prepared.result.records.length;
      if (aggregateBytes > pagination.policy.maxAggregateBytes) {
        truncatedByPolicy = true;
        break;
      }
      truncatedByPolicy ||= pagination.truncatedByPolicy;

      const registerEvent = (event: PublicEventContent): boolean => {
        const contentSha256 = normalizedSha256(event);
        const existingSha256 = seenEventContentSha256.get(event.id);
        if (existingSha256 === undefined) {
          seenEventContentSha256.set(event.id, contentSha256);
          return true;
        }
        if (existingSha256 !== contentSha256) {
          throw this.#unavailableByCode(
            source,
            effectiveQuery.campusId,
            "UPSTREAM_SCHEMA_DRIFT",
            "SCHEMA_MISMATCH",
            0,
            60,
          );
        }
        return false;
      };

      // Offset counts normalized upstream entries checked, not returned items.
      // Re-seeding the bound page prefix prevents a duplicate at a page
      // boundary from reappearing after a cursor continuation.
      for (let index = 0; index < currentCursor.offset; index += 1) {
        const priorEvent = prepared.content[index];
        if (priorEvent !== undefined) registerEvent(priorEvent);
      }
      const selectedContent: PublicEventContent[] = [];
      let end = currentCursor.offset;
      while (end < prepared.content.length && items.length + selectedContent.length < effectiveQuery.limit) {
        const candidate = prepared.content[end];
        end += 1;
        if (candidate !== undefined && registerEvent(candidate)) selectedContent.push(candidate);
      }
      items.push(
        ...attachObservation(selectedContent, prepared.observation).map((item) =>
          PublicEventSchema.parse(item),
        ),
      );

      const pageWasPartiallyConsumed = end < prepared.content.length;
      const successorPage = pagination.nextPage;
      const pageHasPolicyBoundedSuccessor = successorPage !== null;
      if (items.length >= effectiveQuery.limit || pageIndex + 1 >= MAX_EVENT_SOURCE_PAGES_PER_REQUEST) {
        const mayAdvanceWithinByteBudget =
          pageWasPartiallyConsumed || aggregateBytes < pagination.policy.maxAggregateBytes;
        if ((pageWasPartiallyConsumed || pageHasPolicyBoundedSuccessor) && mayAdvanceWithinByteBudget) {
          nextCursor = nextEventCursor(
            effectiveQuery,
            currentCursor.upstreamPage,
            end,
            prepared.result.observation.sha256,
            pageSha256,
            currentCursor.rawBytesBeforePage,
          );
          nextUpstreamPage = pageWasPartiallyConsumed ? currentCursor.upstreamPage : successorPage;
        } else if (pageHasPolicyBoundedSuccessor) {
          truncatedByPolicy = true;
        }
        break;
      }
      if (successorPage === null) break;
      currentCursor = {
        offset: 0,
        rawBytesBeforePage: aggregateBytes,
        upstreamPage: successorPage,
      };
    }

    return {
      items,
      nextCursor,
      range: catalogRange(effectiveQuery),
      retrievalCoverage: {
        nextUpstreamPage,
        pagesFetched: sourceObservations.length,
        recordsFetched,
        sourceTotalPages: sourceTotalPages ?? 0,
        sourceTotalRecords: sourceTotalRecords ?? 0,
        truncatedByPolicy,
      },
      sourceObservations,
    };
  }

  #sessionPage(
    query: ResolvedCatalogQuery,
    source: SourceDescriptor,
    result: CampusSourceResult<UmnAcademicSession>,
    prepared: PreparedCatalog<AcademicSessionContent>,
    durationMs: number,
  ): CatalogPage<AcademicSession> {
    const snapshotSha256 = normalizedSha256(prepared.content);
    const observation = successfulObservation(source, result, durationMs, query.campusId);
    const sourceObservation = { ...observation, recordsAccepted: prepared.recordsAccepted };
    this.#recordObservation(sourceObservation);
    const offset = cursorOffset(query.cursor, query, "sessions", snapshotSha256, prepared.content.length);
    const end = Math.min(offset + query.limit, prepared.content.length);
    const items = attachObservation(prepared.content.slice(offset, end), observation).map((item) =>
      AcademicSessionSchema.parse(item),
    );
    return {
      items,
      nextCursor: nextCatalogCursor(end, prepared.content.length, query, "sessions", snapshotSha256),
      range: catalogRange(query),
      retrievalCoverage: {
        nextUpstreamPage: null,
        pagesFetched: 1,
        recordsFetched: result.records.length,
        sourceTotalPages: 1,
        sourceTotalRecords: result.records.length,
        truncatedByPolicy: false,
      },
      sourceObservations: [sourceObservation],
    };
  }

  async #eventPage(
    source: SourceDescriptor,
    query: ResolvedCatalogQuery,
    upstreamPage: number,
  ): Promise<PreparedEventPage> {
    const startedAt = Date.now();
    try {
      const result = await this.gateway.fetchEvents(query.campusId, upstreamPage);
      const content = result.records
        .filter((record) => eventFallsInRange(record, query.from, query.to))
        .map((record) => eventContent(record, source.id))
        .filter((record): record is PublicEventContent => record !== null);
      return {
        content,
        observation: successfulObservation(source, result, Date.now() - startedAt, query.campusId),
        result,
      };
    } catch (error) {
      throw this.#unavailable(source, query.campusId, error, Date.now() - startedAt);
    }
  }

  #unavailable(
    source: SourceDescriptor,
    campusId: CatalogQuery["campusId"],
    error: unknown,
    durationMs: number,
  ): CatalogUnavailableException {
    return this.#unavailableByCode(
      source,
      campusId,
      failureCode(error),
      failureOutcome(error),
      durationMs,
      retryAfterSeconds(error),
      error instanceof ObservedIntegrationError ? error.observation : undefined,
    );
  }

  #unavailableByCode(
    source: SourceDescriptor,
    campusId: CatalogQuery["campusId"],
    code: string,
    outcome: SourceObservation["outcome"],
    durationMs: number,
    retrySeconds: number,
    transportObservation?: SourceHashObservation,
  ): CatalogUnavailableException {
    const observation = SourceObservationSchema.parse({
      appliedCacheDisposition:
        transportObservation === undefined
          ? source.cachePolicy === "NO_ACCESS"
            ? "NO_ACCESS"
            : "OPERATIONAL_METADATA_ONLY"
          : appliedCacheDisposition(source),
      cachePolicy: source.cachePolicy,
      campusId,
      dataClassification: source.dataClassification,
      durationMs: Math.min(120_000, Math.max(0, durationMs)),
      failureCode: code,
      freshnessState: source.freshnessState,
      httpStatus: transportObservation?.httpStatus ?? null,
      licenseStatus: source.licenseStatus,
      observationId: randomUUID(),
      observedAt: transportObservation?.fetchedAt ?? this.clock().toISOString(),
      outcome,
      parserVersion: parserVersion(source),
      rawByteLength: transportObservation?.byteLength ?? null,
      rawSha256: transportObservation?.sha256 ?? null,
      recordsAccepted: 0,
      recordsRejected: 0,
      sourceId: source.id,
    });
    this.#recordObservation(observation);
    return new CatalogUnavailableException({
      failureCode: code,
      officialUrl: officialFallbackUrl(source),
      retryAfterSeconds: retrySeconds,
      sourceId: source.id,
    });
  }

  #recordObservation(observation: SourceObservation): void {
    try {
      this.observationSink.record(observation);
    } catch {
      // Telemetry must not make a successfully validated public response fail.
    }
  }
}
