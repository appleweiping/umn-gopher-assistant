import { operationDefinitions } from "./generated/operations.js";
import type { OperationDefinition, OperationId } from "./generated/operations.js";
import type { components, operations } from "./generated/schema.js";
import { validateImplementedRequestBody, validateImplementedSuccessBody } from "./generated/validators.js";

export type AccessTokenProvider = () => Promise<string | undefined> | string | undefined;
export type ProblemDetails = components["schemas"]["Problem"];
export type ProtocolErrorCode =
  | "invalid-success-body"
  | "malformed-success-json"
  | "response-request-mismatch"
  | "response-body-too-large"
  | "unexpected-error-status"
  | "unexpected-not-modified"
  | "unexpected-success-content-type"
  | "unexpected-success-status";

type ParametersFor<Id extends OperationId> = operations[Id] extends {
  readonly parameters: infer Parameters;
}
  ? Parameters
  : never;

type QueryFor<Id extends OperationId> =
  ParametersFor<Id> extends {
    readonly query?: infer Query;
  }
    ? Exclude<Query, undefined>
    : never;

type PathFor<Id extends OperationId> =
  ParametersFor<Id> extends {
    readonly path: infer Path;
  }
    ? Path
    : never;

type HeaderFor<Id extends OperationId> =
  ParametersFor<Id> extends {
    readonly header?: infer Header;
  }
    ? Exclude<Header, undefined>
    : never;

type ExtractIdempotencyKey<Header> = Header extends {
  readonly "Idempotency-Key": infer Key;
}
  ? Key
  : never;

type IdempotencyKeyFor<Id extends OperationId> = ExtractIdempotencyKey<HeaderFor<Id>>;

type ExtractJsonBody<RequestBody> = RequestBody extends {
  readonly content: { readonly "application/json": infer Body };
}
  ? Body
  : never;

type BodyFor<Id extends OperationId> = ExtractJsonBody<
  operations[Id] extends { readonly requestBody?: infer RequestBody }
    ? Exclude<RequestBody, undefined>
    : never
>;

type QueryOption<Id extends OperationId> = [QueryFor<Id>] extends [never]
  ? { readonly query?: never }
  : { readonly query?: QueryFor<Id> };

type PathOption<Id extends OperationId> = [PathFor<Id>] extends [never]
  ? { readonly path?: never }
  : { readonly path: PathFor<Id> };

type BodyOption<Id extends OperationId> = [BodyFor<Id>] extends [never]
  ? { readonly body?: never }
  : { readonly body: BodyFor<Id> };

type IdempotencyOption<Id extends OperationId> = [IdempotencyKeyFor<Id>] extends [never]
  ? { readonly idempotencyKey?: string }
  : { readonly idempotencyKey: IdempotencyKeyFor<Id> };

export type OperationRequest<Id extends OperationId> = {
  /** An ETag from a previous response, sent as If-None-Match. */
  readonly etag?: string;
  /** Additional headers. Authorization and protocol headers are controlled by the SDK. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Client-generated correlation ID. */
  readonly requestId?: string;
  readonly signal?: AbortSignal;
} & BodyOption<Id> &
  IdempotencyOption<Id> &
  PathOption<Id> &
  QueryOption<Id>;

type RequiresOptions<Id extends OperationId> = [BodyFor<Id> | IdempotencyKeyFor<Id> | PathFor<Id>] extends [
  never,
]
  ? false
  : true;

export type OperationArguments<Id extends OperationId> =
  RequiresOptions<Id> extends true
    ? readonly [options: OperationRequest<Id>]
    : readonly [options?: OperationRequest<Id>];

type ResponsesFor<Id extends OperationId> = operations[Id] extends {
  readonly responses: infer Responses;
}
  ? Responses
  : never;

type SuccessfulStatus = 200 | 201 | 202 | 204 | 206;
type StatusFor<Id extends OperationId> = Extract<keyof ResponsesFor<Id>, SuccessfulStatus>;
type SuccessfulResponseFor<Id extends OperationId> = ResponsesFor<Id>[StatusFor<Id>];
type JsonContent<Response> = Response extends {
  readonly content: { readonly "application/json": infer Body };
}
  ? Body
  : undefined;

export interface NotModifiedResult {
  readonly etag?: string;
  readonly notModified: true;
  readonly rateLimit?: RateLimitMetadata;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;
  readonly status: 304;
  readonly traceId?: string;
}

export interface SuccessResult<Id extends OperationId> {
  readonly data: JsonContent<SuccessfulResponseFor<Id>>;
  readonly etag?: string;
  readonly notModified: false;
  readonly rateLimit?: RateLimitMetadata;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;
  readonly status: StatusFor<Id>;
  readonly traceId?: string;
}

export interface RateLimitMetadata {
  /** Maximum requests in the active client window. */
  readonly limit?: number;
  /** Requests remaining in the active client window. */
  readonly remaining?: number;
  /** Whole seconds until the active client window resets (not an epoch timestamp). */
  readonly resetAfterSeconds?: number;
}

export interface ResponseMetadata {
  readonly rateLimit?: RateLimitMetadata;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;
  readonly traceId?: string;
}

type NotModifiedFor<Id extends OperationId> =
  (typeof operationDefinitions)[Id]["supportsNotModified"] extends true ? NotModifiedResult : never;

export type OperationResult<Id extends OperationId> = NotModifiedFor<Id> | SuccessResult<Id>;

export interface GopherClientOptions {
  readonly accessToken?: AccessTokenProvider | string;
  readonly baseUrl: string | URL;
  /** Native fetch-compatible implementation, primarily for runtimes and tests. */
  readonly fetch?: typeof fetch;
  /** Maximum decoded RFC 9457 error body size. Defaults to 64 KiB. */
  readonly maxErrorResponseBodyBytes?: number;
  /** Maximum decoded successful JSON body size. Defaults to 2 MiB. */
  readonly maxSuccessResponseBodyBytes?: number;
}

export const DEFAULT_MAX_ERROR_RESPONSE_BODY_BYTES = 64 * 1024;
export const DEFAULT_MAX_SUCCESS_RESPONSE_BODY_BYTES = 2 * 1024 * 1024;
export const ABSOLUTE_MAX_RESPONSE_BODY_BYTES = 8 * 1024 * 1024;

// Additional headers are intentionally allowlisted. Authentication, routing,
// method override, proxy, framing, cache validators, and correlation headers
// all have dedicated SDK behavior or are reserved for the user agent.
const allowedAdditionalHeaders = new Set(["accept-language"]);

function normalizeBaseUrl(value: string | URL): URL {
  const baseUrl = new URL(value);
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new TypeError("baseUrl must use HTTP or HTTPS");
  }
  const hostname = baseUrl.hostname.toLowerCase();
  const loopback =
    hostname === "localhost" || hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/u.test(hostname);
  if (baseUrl.protocol === "http:" && !loopback) {
    throw new TypeError("baseUrl must use HTTPS unless it is an explicit loopback host");
  }
  if (baseUrl.username || baseUrl.password) {
    throw new TypeError("baseUrl must not contain credentials");
  }
  baseUrl.search = "";
  baseUrl.hash = "";
  if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";
  return baseUrl;
}

function appendQuery(url: URL, query: unknown): void {
  if (!query || typeof query !== "object") return;

  for (const [key, rawValue] of Object.entries(query).sort(([left], [right]) => left.localeCompare(right))) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (value === undefined || value === null) continue;
      if (!["boolean", "number", "string"].includes(typeof value)) {
        throw new TypeError(`Query parameter ${key} must be a primitive or primitive array`);
      }
      url.searchParams.append(key, String(value));
    }
  }
}

function interpolatePath(template: string, values: unknown): string {
  const pathValues = values && typeof values === "object" ? (values as Record<string, unknown>) : {};
  return template.replace(/\{([^}]+)\}/gu, (_match, name: string) => {
    const value = pathValues[name];
    if (typeof value !== "string" && typeof value !== "number") {
      throw new TypeError(`Missing path parameter ${name}`);
    }
    return encodeURIComponent(String(value));
  });
}

function isProblemDetails(value: unknown, expectedStatus: number): value is ProblemDetails {
  if (!value || typeof value !== "object") return false;
  const problem = value as Record<string, unknown>;
  return (
    typeof problem["type"] === "string" &&
    typeof problem["title"] === "string" &&
    typeof problem["status"] === "number" &&
    Number.isInteger(problem["status"]) &&
    problem["status"] >= 400 &&
    problem["status"] <= 599 &&
    problem["status"] === expectedStatus &&
    typeof problem["detail"] === "string" &&
    typeof problem["instance"] === "string" &&
    typeof problem["traceId"] === "string"
  );
}

interface ParsedJson {
  readonly tooLarge?: boolean;
  readonly valid: boolean;
  readonly value?: unknown;
}

function boundedIntegerHeader(headers: Headers, name: string, minimum: number): number | undefined {
  const raw = headers.get(name);
  if (raw === null || !/^(?:0|[1-9]\d*)$/u.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= minimum ? value : undefined;
}

function responseMetadata(response: Response, requestId: string | undefined): ResponseMetadata {
  const limit = boundedIntegerHeader(response.headers, "ratelimit-limit", 1);
  const remaining = boundedIntegerHeader(response.headers, "ratelimit-remaining", 0);
  const resetAfterSeconds = boundedIntegerHeader(response.headers, "ratelimit-reset", 1);
  const retryAfterSeconds = boundedIntegerHeader(response.headers, "retry-after", 1);
  const rateLimit =
    limit === undefined && remaining === undefined && resetAfterSeconds === undefined
      ? undefined
      : {
          ...(limit === undefined ? {} : { limit }),
          ...(remaining === undefined ? {} : { remaining }),
          ...(resetAfterSeconds === undefined ? {} : { resetAfterSeconds }),
        };
  return {
    ...(rateLimit === undefined ? {} : { rateLimit }),
    ...(requestId === undefined ? {} : { requestId, traceId: requestId }),
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  };
}

function matchesResponseRequestBindings(
  definition: OperationDefinition,
  requestBody: unknown,
  responseBody: unknown,
): boolean {
  if (definition.responseRequestBindings.length === 0) return true;
  if (
    requestBody === null ||
    typeof requestBody !== "object" ||
    responseBody === null ||
    typeof responseBody !== "object"
  ) {
    return false;
  }
  const requestRecord = requestBody as Readonly<Record<string, unknown>>;
  const responseRecord = responseBody as Readonly<Record<string, unknown>>;
  return definition.responseRequestBindings.every(
    (name) => Object.hasOwn(requestRecord, name) && Object.is(requestRecord[name], responseRecord[name]),
  );
}

function normalizeResponseBodyLimit(value: number | undefined, fallback: number, optionName: string): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > ABSOLUTE_MAX_RESPONSE_BODY_BYTES) {
    throw new RangeError(
      `${optionName} must be an integer between 1 and ${ABSOLUTE_MAX_RESPONSE_BODY_BYTES}`,
    );
  }
  return limit;
}

function declaredBodyExceedsLimit(response: Response, limit: number): boolean {
  const contentEncoding = response.headers.get("content-encoding");
  if (contentEncoding !== null) {
    const codings = contentEncoding.split(",").map((coding) => coding.trim().toLowerCase());
    if (codings.some((coding) => coding !== "identity")) return false;
  }

  const rawLength = response.headers.get("content-length");
  if (rawLength === null || !/^\d+$/u.test(rawLength)) return false;

  const declaredLength = Number(rawLength);
  // Any all-digit value that cannot be represented safely is necessarily far
  // beyond the configurable cap (except arbitrary leading zeroes, which Number
  // normalizes safely to zero).
  return !Number.isSafeInteger(declaredLength) || declaredLength > limit;
}

function ignoreCancellation(cancellation: Promise<void>): void {
  void cancellation.catch(() => undefined);
}

function cancelUnlockedBody(response: Response): void {
  if (response.body === null) return;
  try {
    ignoreCancellation(response.body.cancel());
  } catch {
    // Cancellation is best-effort and must not replace the stable SDK error.
  }
}

async function parseJson(response: Response, limit: number): Promise<ParsedJson> {
  if (declaredBodyExceedsLimit(response, limit)) {
    cancelUnlockedBody(response);
    return { tooLarge: true, valid: false };
  }

  if (response.body === null) return { valid: false };

  const reader = response.body.getReader();
  let bytes = new Uint8Array(Math.min(limit, 8 * 1024));
  let byteLength = 0;
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      const nextByteLength = byteLength + chunk.value.byteLength;
      if (nextByteLength > limit) {
        try {
          ignoreCancellation(reader.cancel());
        } catch {
          // Cancellation is best-effort and must not replace the stable SDK error.
        }
        return { tooLarge: true, valid: false };
      }
      if (nextByteLength > bytes.byteLength) {
        let nextCapacity = bytes.byteLength;
        while (nextCapacity < nextByteLength) {
          nextCapacity = Math.min(limit, Math.max(nextByteLength, Math.max(1, nextCapacity * 2)));
        }
        const expanded = new Uint8Array(nextCapacity);
        expanded.set(bytes.subarray(0, byteLength));
        bytes = expanded;
      }
      bytes.set(chunk.value, byteLength);
      byteLength = nextByteLength;
      chunk = await reader.read();
    }
  } finally {
    reader.releaseLock();
  }

  const text = new TextDecoder().decode(bytes.subarray(0, byteLength));
  if (!text) return { valid: false };
  try {
    return { valid: true, value: JSON.parse(text) as unknown };
  } catch {
    return { valid: false };
  }
}

export class GopherApiError extends Error {
  readonly rateLimit: RateLimitMetadata | undefined;
  readonly problem: ProblemDetails;
  readonly requestId: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly status: number;
  readonly traceId: string;

  constructor(problem: ProblemDetails, requestId?: string, metadata: ResponseMetadata = {}) {
    super(`${problem.status} ${problem.title}`);
    this.name = "GopherApiError";
    this.problem = problem;
    this.requestId = requestId;
    this.rateLimit = metadata.rateLimit;
    this.retryAfterSeconds = metadata.retryAfterSeconds;
    this.status = problem.status;
    this.traceId = problem.traceId;
  }

  toJSON(): {
    problem: ProblemDetails;
    rateLimit?: RateLimitMetadata;
    requestId?: string;
    retryAfterSeconds?: number;
    status: number;
    traceId: string;
  } {
    return {
      problem: this.problem,
      ...(this.rateLimit === undefined ? {} : { rateLimit: this.rateLimit }),
      ...(this.requestId === undefined ? {} : { requestId: this.requestId }),
      ...(this.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: this.retryAfterSeconds }),
      status: this.status,
      traceId: this.traceId,
    };
  }
}

export class GopherProtocolError extends Error {
  readonly code: ProtocolErrorCode;
  readonly operationId: OperationId;
  readonly requestId: string | undefined;
  readonly responseMetadata: ResponseMetadata;
  readonly status: number;

  constructor(
    code: ProtocolErrorCode,
    operationId: OperationId,
    status: number,
    requestId?: string,
    responseMetadata: ResponseMetadata = {},
  ) {
    super(`API protocol violation (${code}) for ${operationId}`);
    this.name = "GopherProtocolError";
    this.code = code;
    this.operationId = operationId;
    this.requestId = requestId;
    this.responseMetadata = responseMetadata;
    this.status = status;
  }

  toJSON(): {
    code: ProtocolErrorCode;
    operationId: OperationId;
    requestId?: string;
    responseMetadata?: ResponseMetadata;
    status: number;
  } {
    return {
      code: this.code,
      operationId: this.operationId,
      ...(this.requestId === undefined ? {} : { requestId: this.requestId }),
      ...(Object.keys(this.responseMetadata).length === 0 ? {} : { responseMetadata: this.responseMetadata }),
      status: this.status,
    };
  }
}

interface RuntimeRequestOptions {
  readonly body?: unknown;
  readonly etag?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly idempotencyKey?: string;
  readonly path?: unknown;
  readonly query?: unknown;
  readonly requestId?: string;
  readonly signal?: AbortSignal;
}

export class GopherClient {
  readonly #accessToken: AccessTokenProvider | string | undefined;
  readonly #baseUrl: URL;
  readonly #fetch: typeof fetch;
  readonly #maxErrorResponseBodyBytes: number;
  readonly #maxSuccessResponseBodyBytes: number;

  constructor(options: GopherClientOptions) {
    this.#baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#accessToken = options.accessToken;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#maxErrorResponseBodyBytes = normalizeResponseBodyLimit(
      options.maxErrorResponseBodyBytes,
      DEFAULT_MAX_ERROR_RESPONSE_BODY_BYTES,
      "maxErrorResponseBodyBytes",
    );
    this.#maxSuccessResponseBodyBytes = normalizeResponseBodyLimit(
      options.maxSuccessResponseBodyBytes,
      DEFAULT_MAX_SUCCESS_RESPONSE_BODY_BYTES,
      "maxSuccessResponseBodyBytes",
    );
  }

  async request<Id extends OperationId>(
    operationId: Id,
    ...args: OperationArguments<Id>
  ): Promise<OperationResult<Id>> {
    const definitions: Readonly<Record<string, OperationDefinition | undefined>> = operationDefinitions;
    const definition = definitions[operationId];
    if (definition === undefined) throw new TypeError(`Unknown operation: ${operationId}`);
    const options = (args[0] ?? {}) as RuntimeRequestOptions;

    if (definition.idempotencyKeyRequired && !options.idempotencyKey) {
      throw new TypeError(`${operationId} requires an idempotencyKey`);
    }

    const pathname = interpolatePath(definition.path, options.path).replace(/^\//u, "");
    const url = new URL(pathname, this.#baseUrl);
    if (url.origin !== this.#baseUrl.origin) {
      throw new TypeError(`${operationId} resolved outside the configured API origin`);
    }
    appendQuery(url, options.query);

    const headers = new Headers({ Accept: "application/json" });
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      if (!allowedAdditionalHeaders.has(name.toLowerCase())) {
        throw new TypeError(`Header ${name} is not an allowed additional request header`);
      }
      headers.set(name, value);
    }
    if (options.etag) headers.set("If-None-Match", options.etag);
    if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
    if (options.requestId) headers.set("X-Request-Id", options.requestId);

    if (!definition.public) {
      const token = typeof this.#accessToken === "function" ? await this.#accessToken() : this.#accessToken;
      if (token) headers.set("Authorization", `Bearer ${token}`);
    }

    let requestBody = options.body;
    if (definition.runtimeStatus === "implemented" && requestBody !== undefined) {
      const validation = validateImplementedRequestBody(operationId, requestBody);
      if (!validation.success) {
        throw new TypeError(`${operationId} request body does not match the generated OpenAPI contract`);
      }
      requestBody = validation.data;
    }

    let body: string | undefined;
    if (requestBody !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(requestBody);
    }

    const request = new Request(url, {
      ...(body === undefined ? {} : { body }),
      credentials: "omit",
      headers,
      method: definition.method,
      // Following a redirect could move a bearer token or state-changing body to another origin.
      redirect: "error",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const response = await this.#fetch(request);
    const etag = response.headers.get("etag") ?? undefined;
    const requestId = response.headers.get("x-request-id") ?? undefined;
    const metadata = responseMetadata(response, requestId);

    if (response.status === 304) {
      if (!definition.supportsNotModified || !options.etag) {
        cancelUnlockedBody(response);
        throw new GopherProtocolError(
          "unexpected-not-modified",
          operationId,
          response.status,
          requestId,
          metadata,
        );
      }
      const result: NotModifiedResult = {
        ...(etag === undefined ? {} : { etag }),
        notModified: true,
        ...metadata,
        status: 304,
      };
      return result as OperationResult<Id>;
    }

    if (!response.ok) {
      if (response.status < 400 || response.status > 599) {
        cancelUnlockedBody(response);
        throw new GopherProtocolError(
          "unexpected-error-status",
          operationId,
          response.status,
          requestId,
          metadata,
        );
      }
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      let parsed: ParsedJson = { valid: false };
      if (contentType === "application/problem+json") {
        parsed = await parseJson(response, this.#maxErrorResponseBodyBytes);
      } else {
        cancelUnlockedBody(response);
      }
      if (parsed.tooLarge) {
        throw new GopherProtocolError(
          "response-body-too-large",
          operationId,
          response.status,
          requestId,
          metadata,
        );
      }
      const problem: ProblemDetails =
        contentType === "application/problem+json" &&
        parsed.valid &&
        isProblemDetails(parsed.value, response.status)
          ? parsed.value
          : {
              detail: "The server returned an error without valid RFC 9457 details.",
              instance: url.pathname,
              status: response.status,
              title: response.statusText || "HTTP Error",
              traceId: requestId ?? "unavailable",
              type: "about:blank",
            };
      throw new GopherApiError(problem, requestId, metadata);
    }

    if (!definition.successStatuses.includes(response.status)) {
      cancelUnlockedBody(response);
      throw new GopherProtocolError(
        "unexpected-success-status",
        operationId,
        response.status,
        requestId,
        metadata,
      );
    }

    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType === undefined || !definition.successMediaTypes.includes(contentType)) {
      cancelUnlockedBody(response);
      throw new GopherProtocolError(
        "unexpected-success-content-type",
        operationId,
        response.status,
        requestId,
        metadata,
      );
    }
    const parsed = await parseJson(response, this.#maxSuccessResponseBodyBytes);
    if (parsed.tooLarge) {
      throw new GopherProtocolError(
        "response-body-too-large",
        operationId,
        response.status,
        requestId,
        metadata,
      );
    }
    if (!parsed.valid) {
      throw new GopherProtocolError(
        "malformed-success-json",
        operationId,
        response.status,
        requestId,
        metadata,
      );
    }

    let successBody = parsed.value;
    if (definition.runtimeStatus === "implemented") {
      const validation = validateImplementedSuccessBody(operationId, response.status, successBody);
      if (!validation.success) {
        throw new GopherProtocolError(
          "invalid-success-body",
          operationId,
          response.status,
          requestId,
          metadata,
        );
      }
      successBody = validation.data;
    }

    if (!matchesResponseRequestBindings(definition, requestBody, successBody)) {
      throw new GopherProtocolError(
        "response-request-mismatch",
        operationId,
        response.status,
        requestId,
        metadata,
      );
    }

    return {
      data: successBody as JsonContent<SuccessfulResponseFor<Id>>,
      ...(etag === undefined ? {} : { etag }),
      notModified: false,
      ...metadata,
      status: response.status as StatusFor<Id>,
    };
  }
}
