import {
  GopherProtocolError,
  operationDefinitions,
  validateImplementedSuccessBody,
} from "@umn-gopher-assistant/sdk";

import { CliError } from "./errors.js";
import { ExitCode } from "./exit-codes.js";
import { fetchNoRedirect, readJson, type HttpDependencies } from "./http.js";
import { resolveRawRequestUrl, validateRawRequestPath, type ValidatedRawRequest } from "./url-policy.js";

export type RawMethod = "GET" | "HEAD";
const allowedRawMethods: ReadonlySet<string> = new Set(["GET", "HEAD"]);

export interface RawResponse {
  readonly data: unknown;
  readonly etag: string | null;
  readonly operationId: string;
  readonly requestId: string | null;
  readonly status: number;
}

export type AccessTokenResolver = () => Promise<string>;

function statusError(status: number, traceId?: string): CliError {
  const details = { status, ...(traceId === undefined ? {} : { traceId }) };
  if (status === 401) {
    return new CliError(ExitCode.auth, "authentication-required", "Authentication is required.", details);
  }
  if (status === 403) {
    return new CliError(ExitCode.permission, "permission-denied", "Permission was denied.", details);
  }
  if (status === 409) {
    return new CliError(
      ExitCode.conflict,
      "api-conflict",
      "The request conflicts with current state.",
      details,
    );
  }
  if (status === 429 || status >= 500) {
    return new CliError(
      ExitCode.unavailable,
      "service-unavailable",
      "The service is temporarily unavailable.",
      details,
    );
  }
  return new CliError(ExitCode.protocol, "api-error", "The API rejected the request.", details);
}

function safeProblemTraceId(value: unknown, status: number): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const problem = value as Record<string, unknown>;
  return problem["status"] === status && typeof problem["traceId"] === "string"
    ? problem["traceId"].slice(0, 256)
    : undefined;
}

export class RawApiClient {
  readonly #accessToken: AccessTokenResolver;
  readonly #baseUrl: URL;
  readonly #http: HttpDependencies;

  constructor(options: {
    readonly accessToken: AccessTokenResolver;
    readonly baseUrl: URL;
    readonly http: HttpDependencies;
  }) {
    this.#accessToken = options.accessToken;
    this.#baseUrl = options.baseUrl;
    this.#http = options.http;
  }

  async request(method: RawMethod, input: string, signal?: AbortSignal): Promise<RawResponse> {
    if (!allowedRawMethods.has(method)) {
      throw new CliError(ExitCode.usage, "raw-method-forbidden", "Raw requests permit only GET and HEAD.");
    }
    const validated: ValidatedRawRequest = validateRawRequestPath(input);
    const definition = operationDefinitions[validated.operationId];
    const headers = new Headers({ Accept: "application/json" });
    if (!definition.public) headers.set("Authorization", `Bearer ${await this.#accessToken()}`);
    const response = await fetchNoRedirect(
      this.#http,
      resolveRawRequestUrl(this.#baseUrl, validated.pathAndQuery),
      { headers, method },
      signal,
    );
    const requestId = response.headers.get("x-request-id") ?? undefined;
    if (!response.ok) {
      const problem = method === "HEAD" ? undefined : await readJson(response);
      throw statusError(response.status, safeProblemTraceId(problem, response.status));
    }
    const declaredSuccessStatuses: ReadonlySet<number> = new Set(definition.successStatuses);
    if (!declaredSuccessStatuses.has(response.status)) {
      throw new GopherProtocolError(
        "unexpected-success-status",
        validated.operationId,
        response.status,
        requestId,
      );
    }

    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    const declaredSuccessMediaTypes: ReadonlySet<string> = new Set(definition.successMediaTypes);
    if (method === "HEAD") {
      if (response.body !== null) {
        throw new GopherProtocolError(
          "invalid-success-body",
          validated.operationId,
          response.status,
          requestId,
        );
      }
      if (contentType !== undefined && !declaredSuccessMediaTypes.has(contentType)) {
        throw new GopherProtocolError(
          "unexpected-success-content-type",
          validated.operationId,
          response.status,
          requestId,
        );
      }
      return {
        data: null,
        etag: response.headers.get("etag"),
        operationId: validated.operationId,
        requestId: requestId ?? null,
        status: response.status,
      };
    }

    if (contentType === undefined || !declaredSuccessMediaTypes.has(contentType)) {
      throw new GopherProtocolError(
        "unexpected-success-content-type",
        validated.operationId,
        response.status,
        requestId,
      );
    }
    const data = await readJson(response);
    const validation = validateImplementedSuccessBody(validated.operationId, response.status, data);
    if (!validation.success) {
      throw new GopherProtocolError(
        validation.reason === "unexpected-success-status"
          ? "unexpected-success-status"
          : "invalid-success-body",
        validated.operationId,
        response.status,
        requestId,
      );
    }
    return {
      data: validation.data,
      etag: response.headers.get("etag"),
      operationId: validated.operationId,
      requestId: requestId ?? null,
      status: response.status,
    };
  }
}
