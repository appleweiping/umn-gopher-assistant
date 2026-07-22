import type { SourceHashObservation } from "./types.js";

export type IntegrationErrorCode =
  | "CIRCUIT_OPEN"
  | "INVALID_CONTENT_TYPE"
  | "INVALID_JSON"
  | "LICENSE_DENIED"
  | "LOCAL_QUEUE_SATURATED"
  | "LOCAL_QUEUE_TIMEOUT"
  | "LOCAL_RATE_LIMITED"
  | "RESPONSE_TOO_LARGE"
  | "TARGET_NOT_ALLOWED"
  | "TIMEOUT"
  | "UPSTREAM_CLIENT_ERROR"
  | "UPSTREAM_RATE_LIMITED"
  | "UPSTREAM_REDIRECT"
  | "UPSTREAM_SCHEMA_DRIFT"
  | "UPSTREAM_SERVER_ERROR";

/**
 * A deliberately small, non-sensitive error exposed by the integration
 * boundary. Raw response bodies and upstream implementation details never
 * become part of the error message or metadata.
 */
export class IntegrationError extends Error {
  readonly code: IntegrationErrorCode;
  readonly retryable: boolean;

  constructor(code: IntegrationErrorCode, message: string, retryable = false, options?: ErrorOptions) {
    super(message, options);
    this.name = "IntegrationError";
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * Carries integrity-only metadata for a response whose transport completed
 * before normalization failed. The raw response is deliberately unavailable.
 */
export class ObservedIntegrationError extends IntegrationError {
  readonly observation: SourceHashObservation;

  constructor(error: IntegrationError, observation: SourceHashObservation) {
    super(error.code, error.message, error.retryable, { cause: error });
    this.name = "ObservedIntegrationError";
    this.observation = Object.freeze({ ...observation });
  }
}

export class SourceLicenseDeniedError extends IntegrationError {
  readonly sourceId: string;

  constructor(sourceId: string, reason: string) {
    super("LICENSE_DENIED", `Network access is disabled for source ${sourceId}: ${reason}`);
    this.name = "SourceLicenseDeniedError";
    this.sourceId = sourceId;
  }
}

export class SourceCircuitOpenError extends IntegrationError {
  readonly sourceId: string;
  readonly retryAt: string;

  constructor(sourceId: string, retryAt: Date) {
    super("CIRCUIT_OPEN", `Circuit is open for source ${sourceId} until ${retryAt.toISOString()}`, true);
    this.name = "SourceCircuitOpenError";
    this.sourceId = sourceId;
    this.retryAt = retryAt.toISOString();
  }
}

export class SourceQueueSaturatedError extends IntegrationError {
  readonly sourceId: string;

  constructor(sourceId: string) {
    super("LOCAL_QUEUE_SATURATED", `The bounded request queue is full for source ${sourceId}`, true);
    this.name = "SourceQueueSaturatedError";
    this.sourceId = sourceId;
  }
}

export class SourceQueueTimeoutError extends IntegrationError {
  readonly sourceId: string;

  constructor(sourceId: string) {
    super("LOCAL_QUEUE_TIMEOUT", `The bounded request queue wait expired for source ${sourceId}`, true);
    this.name = "SourceQueueTimeoutError";
    this.sourceId = sourceId;
  }
}

export class SourceRateLimitedError extends IntegrationError {
  readonly sourceId: string;
  readonly retryAt: string;

  constructor(sourceId: string, retryAt: Date) {
    super(
      "LOCAL_RATE_LIMITED",
      `The local request budget is exhausted for source ${sourceId} until ${retryAt.toISOString()}`,
      true,
    );
    this.name = "SourceRateLimitedError";
    this.sourceId = sourceId;
    this.retryAt = retryAt.toISOString();
  }
}

export class UpstreamSchemaError extends IntegrationError {
  readonly field: string;

  constructor(field: string, message: string) {
    super("UPSTREAM_SCHEMA_DRIFT", `Upstream schema rejected at ${field}: ${message}`);
    this.name = "UpstreamSchemaError";
    this.field = field;
  }
}
