import type { CampusId, LicenseStatus } from "@umn-gopher-assistant/contracts";

export interface IntegrationSourceDescriptor {
  readonly id: string;
  readonly campusIds: readonly CampusId[];
  readonly endpointId: string;
  readonly sourceUrl: string;
  readonly licenseStatus: LicenseStatus;
  /** LIVE_ONLY payload bytes are transient and must never be persisted. */
  readonly rawContentPolicy: "HASH_OBSERVATION_ONLY";
}

export interface SourceHashObservation {
  readonly algorithm: "SHA-256";
  readonly sha256: string;
  readonly byteLength: number;
  readonly fetchedAt: string;
  readonly sourceUrl: string;
  readonly httpStatus: 200;
  readonly contentType: string;
  readonly rawContentPersisted: false;
}

export interface CampusSourceResult<TRecord> {
  /** Parsed, field-allowlisted records for immediate request processing. */
  readonly records: readonly TRecord[];
  /** The only durable representation permitted for the upstream raw body. */
  readonly observation: SourceHashObservation;
}

export interface CampusSourceAdapter<TRequest, TRecord> {
  readonly source: IntegrationSourceDescriptor;
  fetch(request: TRequest, signal?: AbortSignal): Promise<CampusSourceResult<TRecord>>;
}
