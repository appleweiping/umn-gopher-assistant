import type { CampusId } from "@umn-gopher-assistant/contracts";

import { IntegrationError, ObservedIntegrationError, UpstreamSchemaError } from "./errors.js";
import type { SourceLicenseGate } from "./license-gate.js";
import {
  expectArray,
  expectDateOnly,
  expectObject,
  expectString,
  normalizedRecordsMatch,
} from "./parsing.js";
import {
  buildSessionsUrl,
  INTEGRATION_ENDPOINT_IDS,
  normalizeSessionTermIds,
  type SafeJsonFetcher,
} from "./safe-json-fetcher.js";
import type { SourceRequestCoordinator } from "./source-request-coordinator.js";
import type { CampusSourceAdapter, CampusSourceResult, IntegrationSourceDescriptor } from "./types.js";

export type UmnAcademicInstitutionCode = "UMNTC" | "UMNDL" | "UMNCR" | "UMNMO";

export const UMN_INSTITUTION_BY_CAMPUS = Object.freeze({
  tc: "UMNTC",
  duluth: "UMNDL",
  crookston: "UMNCR",
  morris: "UMNMO",
  rochester: "UMNTC",
} satisfies Record<CampusId, UmnAcademicInstitutionCode>);

export interface UmnSessionRequest {
  /** Explicit trusted term codes; unfiltered all-history reads are forbidden. */
  readonly termIds: readonly string[];
}

export interface UmnAcademicSession {
  readonly sessionId: string;
  readonly campusId: CampusId;
  readonly institutionCode: UmnAcademicInstitutionCode;
  readonly academicCareerId: string;
  readonly termId: string;
  readonly sessionCode: string;
  readonly name: string;
  readonly beginDate: string;
  readonly endDate: string;
  readonly enrollmentOpenDate: string | null;
}

function sessionSource(campusId: CampusId): IntegrationSourceDescriptor {
  return Object.freeze({
    id: `umn-sessions-${campusId}`,
    campusIds: Object.freeze([campusId]),
    endpointId: INTEGRATION_ENDPOINT_IDS.sessions,
    sourceUrl: "https://sessions.umn.edu/sessions.json",
    // Public reachability is not license evidence. Remain LIVE_ONLY until the
    // source registry contains reviewed redistribution terms.
    licenseStatus: "LIVE_ONLY",
    rawContentPolicy: "HASH_OBSERVATION_ONLY",
  });
}

export const UMN_SESSIONS_SOURCES = Object.freeze({
  tc: sessionSource("tc"),
  duluth: sessionSource("duluth"),
  crookston: sessionSource("crookston"),
  morris: sessionSource("morris"),
  rochester: sessionSource("rochester"),
} satisfies Record<CampusId, IntegrationSourceDescriptor>);

function parseSession(
  input: unknown,
  index: number,
  campusId: CampusId,
  institutionCode: UmnAcademicInstitutionCode,
  expectedTermIds: ReadonlySet<string> | null,
): UmnAcademicSession {
  const path = `sessions[${String(index)}]`;
  const session = expectObject(input, path);
  const institution = expectObject(session["institution"], `${path}.institution`);
  const academicCareer = expectObject(session["academic_career"], `${path}.academic_career`);
  const term = expectObject(session["term"], `${path}.term`);
  const parsedInstitution = expectString(
    institution["institution_id"],
    `${path}.institution.institution_id`,
    16,
    /^UMN(?:TC|DL|CR|MO)$/iu,
  ).toUpperCase() as UmnAcademicInstitutionCode;
  if (parsedInstitution !== institutionCode) {
    throw new UpstreamSchemaError(
      `${path}.institution.institution_id`,
      "institution does not match the request",
    );
  }

  const termId = expectString(term["term_id"], `${path}.term.term_id`, 16, /^\d{4,16}$/u);
  if (expectedTermIds !== null && !expectedTermIds.has(termId)) {
    throw new UpstreamSchemaError(`${path}.term.term_id`, "term falls outside the requested filter");
  }
  if (term["strm"] !== undefined) {
    const strm = expectString(term["strm"], `${path}.term.strm`, 16, /^\d{4,16}$/u);
    if (strm !== termId) throw new UpstreamSchemaError(`${path}.term.strm`, "strm does not match term_id");
  }

  const beginDate = expectDateOnly(session["begin_date"], `${path}.begin_date`);
  const endDate = expectDateOnly(session["end_date"], `${path}.end_date`);
  if (endDate < beginDate) throw new UpstreamSchemaError(`${path}.end_date`, "end date precedes begin date");

  const correctedEnrollmentDate =
    session["enrollment_open_date"] === undefined
      ? null
      : expectDateOnly(session["enrollment_open_date"], `${path}.enrollment_open_date`);
  const documentedEnrollmentDate =
    session["enrollement_open_date"] === undefined
      ? null
      : expectDateOnly(session["enrollement_open_date"], `${path}.enrollement_open_date`);
  if (correctedEnrollmentDate === null && documentedEnrollmentDate === null) {
    throw new UpstreamSchemaError(
      `${path}.enrollment_open_date`,
      "expected enrollment_open_date or documented enrollement_open_date",
    );
  }
  if (
    correctedEnrollmentDate !== null &&
    documentedEnrollmentDate !== null &&
    correctedEnrollmentDate !== documentedEnrollmentDate
  ) {
    throw new UpstreamSchemaError(
      `${path}.enrollment_open_date`,
      "corrected and documented enrollment dates conflict",
    );
  }
  const enrollmentOpenDate = correctedEnrollmentDate ?? documentedEnrollmentDate;
  if (enrollmentOpenDate === null) {
    throw new UpstreamSchemaError(`${path}.enrollment_open_date`, "enrollment date is unavailable");
  }

  // The live service currently contains a small number of sessions whose
  // enrollment date follows the session end. The public contract already
  // models this field as nullable: do not publish a contradictory date and do
  // not discard an otherwise valid academic session because of this optional
  // metadata anomaly.
  const usableEnrollmentOpenDate = enrollmentOpenDate <= endDate ? enrollmentOpenDate : null;

  return Object.freeze({
    sessionId: expectString(session["session_id"], `${path}.session_id`, 128, /^[A-Z0-9_]+$/iu).toUpperCase(),
    campusId,
    institutionCode,
    academicCareerId: expectString(
      academicCareer["academic_career_id"],
      `${path}.academic_career.academic_career_id`,
      32,
      /^[A-Z0-9_-]+$/iu,
    ).toUpperCase(),
    termId,
    sessionCode: expectString(session["session_code"], `${path}.session_code`, 32, /^[A-Z0-9_-]+$/iu),
    name: expectString(session["session_name"], `${path}.session_name`, 256),
    beginDate,
    endDate,
    enrollmentOpenDate: usableEnrollmentOpenDate,
  });
}

export function parseUmnSessions(
  input: unknown,
  campusId: CampusId,
  expectedTermIds?: readonly string[],
): readonly UmnAcademicSession[] {
  const root = expectObject(input, "$");
  const sessions = expectArray(root["sessions"], "$.sessions", 50_000);
  const institutionCode = UMN_INSTITUTION_BY_CAMPUS[campusId];
  const expectedTerms =
    expectedTermIds === undefined ? null : new Set(normalizeSessionTermIds(expectedTermIds));
  const byId = new Map<string, UmnAcademicSession>();

  sessions.forEach((value, index) => {
    const parsed = parseSession(value, index, campusId, institutionCode, expectedTerms);
    const previous = byId.get(parsed.sessionId);
    if (previous === undefined) {
      byId.set(parsed.sessionId, parsed);
      return;
    }
    if (!normalizedRecordsMatch(previous, parsed)) {
      throw new UpstreamSchemaError(`sessions[${String(index)}].session_id`, "conflicting duplicate session");
    }
  });

  return Object.freeze(
    [...byId.values()].sort((left, right) => left.sessionId.localeCompare(right.sessionId)),
  );
}

export interface UmnSessionsAdapterOptions {
  readonly campusId: CampusId;
  readonly fetcher: SafeJsonFetcher;
  readonly licenseGate: SourceLicenseGate;
  readonly coordinator: SourceRequestCoordinator;
  readonly networkGuard?: () => void;
}

export class UmnSessionsAdapter implements CampusSourceAdapter<UmnSessionRequest, UmnAcademicSession> {
  readonly source: IntegrationSourceDescriptor;
  readonly #campusId: CampusId;
  readonly #fetcher: SafeJsonFetcher;
  readonly #licenseGate: SourceLicenseGate;
  readonly #networkGuard: () => void;
  readonly #coordinator: SourceRequestCoordinator;

  constructor(options: UmnSessionsAdapterOptions) {
    this.#campusId = options.campusId;
    this.source = UMN_SESSIONS_SOURCES[options.campusId];
    this.#fetcher = options.fetcher;
    this.#licenseGate = options.licenseGate;
    this.#networkGuard = options.networkGuard ?? (() => undefined);
    this.#coordinator = options.coordinator;
  }

  fetch(request: UmnSessionRequest, signal?: AbortSignal): Promise<CampusSourceResult<UmnAcademicSession>> {
    // This must remain before both the coordinator and transport: a disabled
    // source performs exactly zero network work, even when a matching request
    // is already in flight.
    this.#assertNetworkAllowed();
    const institutionCode = UMN_INSTITUTION_BY_CAMPUS[this.#campusId];
    const termIds = normalizeSessionTermIds(request.termIds);
    const url = buildSessionsUrl(institutionCode, termIds);
    return this.#coordinator.run(
      this.source.endpointId,
      url,
      async () => {
        const fetched = await this.#fetcher.fetchJson(INTEGRATION_ENDPOINT_IDS.sessions, url, signal);
        let records: readonly UmnAcademicSession[];
        try {
          records = parseUmnSessions(fetched.json, this.#campusId, termIds);
        } catch (error) {
          const parseError =
            error instanceof IntegrationError
              ? error
              : new IntegrationError(
                  "UPSTREAM_SCHEMA_DRIFT",
                  "Upstream Sessions response could not be normalized",
                  false,
                );
          throw new ObservedIntegrationError(parseError, fetched.observation);
        }
        return Object.freeze({
          records,
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
