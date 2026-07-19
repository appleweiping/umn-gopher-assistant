import { GopherApiError, GopherProtocolError } from "@umn-gopher-assistant/sdk";

import { ExitCode, type ExitCodeValue } from "./exit-codes.js";

export class CliError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, boolean | number | string | null>> | undefined;
  readonly exitCode: ExitCodeValue;

  constructor(
    exitCode: ExitCodeValue,
    code: string,
    message: string,
    details?: Readonly<Record<string, boolean | number | string | null>>,
  ) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.details = details;
    this.exitCode = exitCode;
  }
}

const secretAssignmentPattern =
  /((?:access[_-]?token|refresh[_-]?token|id[_-]?token|device[_-]?code|api[_-]?key|password|client[_-]?secret)\s*[=:]\s*)[^\s,;&]+/giu;
const jsonSecretPattern =
  /("(?:access[_-]?token|refresh[_-]?token|id[_-]?token|device[_-]?code|api[_-]?key|password|client[_-]?secret)"\s*:\s*")[^"]*/giu;
const bearerPattern = /\bBearer\s+[^\s,]+/giu;
const jwtPattern = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu;
const credentialQueryPattern =
  /([?&](?:access[_-]?token|refresh[_-]?token|id[_-]?token|device[_-]?code|api[_-]?key|password|secret|authorization)=)[^&#\s]*/giu;

export function redactText(value: string): string {
  return value
    .replace(jsonSecretPattern, "$1[REDACTED]")
    .replace(secretAssignmentPattern, "$1[REDACTED]")
    .replace(bearerPattern, "Bearer [REDACTED]")
    .replace(jwtPattern, "[REDACTED_JWT]")
    .replace(credentialQueryPattern, "$1[REDACTED]");
}

function fromApiError(error: GopherApiError): CliError {
  const status = error.status;
  if (status === 401) {
    return new CliError(ExitCode.auth, "authentication-required", "Authentication is required.", {
      status,
    });
  }
  if (status === 403) {
    return new CliError(ExitCode.permission, "permission-denied", "Permission was denied.", { status });
  }
  if (status === 409) {
    return new CliError(ExitCode.conflict, "api-conflict", "The request conflicts with current state.", {
      status,
    });
  }
  if (status === 429 || status >= 500) {
    return new CliError(
      ExitCode.unavailable,
      "service-unavailable",
      "The service is temporarily unavailable.",
      { status },
    );
  }
  return new CliError(ExitCode.protocol, "api-error", "The API rejected the request.", { status });
}

export function normalizeCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (error instanceof GopherApiError) return fromApiError(error);
  if (error instanceof GopherProtocolError) {
    return new CliError(ExitCode.protocol, "api-protocol-error", "The API response violated its contract.", {
      status: error.status,
    });
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return new CliError(ExitCode.unavailable, "request-cancelled", "The request was cancelled.");
  }
  return new CliError(ExitCode.internal, "internal-error", "Unexpected internal error.");
}
