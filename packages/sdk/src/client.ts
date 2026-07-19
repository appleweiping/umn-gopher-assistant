import { operationDefinitions } from "./generated/operations.js";
import type { OperationDefinition, OperationId } from "./generated/operations.js";
import type { components, operations } from "./generated/schema.js";

export type AccessTokenProvider = () => Promise<string | undefined> | string | undefined;
export type ProblemDetails = components["schemas"]["Problem"];
export type ProtocolErrorCode =
  | "malformed-success-json"
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
  readonly requestId?: string;
  readonly status: 304;
}

export interface SuccessResult<Id extends OperationId> {
  readonly data: JsonContent<SuccessfulResponseFor<Id>>;
  readonly etag?: string;
  readonly notModified: false;
  readonly requestId?: string;
  readonly status: StatusFor<Id>;
}

type NotModifiedFor<Id extends OperationId> =
  (typeof operationDefinitions)[Id]["supportsNotModified"] extends true ? NotModifiedResult : never;

export type OperationResult<Id extends OperationId> = NotModifiedFor<Id> | SuccessResult<Id>;

export interface GopherClientOptions {
  readonly accessToken?: AccessTokenProvider | string;
  readonly baseUrl: string | URL;
  /** Native fetch-compatible implementation, primarily for runtimes and tests. */
  readonly fetch?: typeof fetch;
}

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
  readonly valid: boolean;
  readonly value?: unknown;
}

async function parseJson(response: Response): Promise<ParsedJson> {
  const text = await response.text();
  if (!text) return { valid: false };
  try {
    return { valid: true, value: JSON.parse(text) as unknown };
  } catch {
    return { valid: false };
  }
}

export class GopherApiError extends Error {
  readonly problem: ProblemDetails;
  readonly requestId: string | undefined;
  readonly status: number;

  constructor(problem: ProblemDetails, requestId?: string) {
    super(`${problem.status} ${problem.title}`);
    this.name = "GopherApiError";
    this.problem = problem;
    this.requestId = requestId;
    this.status = problem.status;
  }

  toJSON(): { problem: ProblemDetails; requestId?: string; status: number } {
    return {
      problem: this.problem,
      ...(this.requestId === undefined ? {} : { requestId: this.requestId }),
      status: this.status,
    };
  }
}

export class GopherProtocolError extends Error {
  readonly code: ProtocolErrorCode;
  readonly operationId: OperationId;
  readonly requestId: string | undefined;
  readonly status: number;

  constructor(code: ProtocolErrorCode, operationId: OperationId, status: number, requestId?: string) {
    super(`API protocol violation (${code}) for ${operationId}`);
    this.name = "GopherProtocolError";
    this.code = code;
    this.operationId = operationId;
    this.requestId = requestId;
    this.status = status;
  }

  toJSON(): {
    code: ProtocolErrorCode;
    operationId: OperationId;
    requestId?: string;
    status: number;
  } {
    return {
      code: this.code,
      operationId: this.operationId,
      ...(this.requestId === undefined ? {} : { requestId: this.requestId }),
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

  constructor(options: GopherClientOptions) {
    this.#baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#accessToken = options.accessToken;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
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

    let body: string | undefined;
    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
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

    if (response.status === 304) {
      if (!definition.supportsNotModified || !options.etag) {
        throw new GopherProtocolError("unexpected-not-modified", operationId, response.status, requestId);
      }
      const result: NotModifiedResult = {
        ...(etag === undefined ? {} : { etag }),
        notModified: true,
        ...(requestId === undefined ? {} : { requestId }),
        status: 304,
      };
      return result as OperationResult<Id>;
    }

    const parsed = await parseJson(response);
    if (!response.ok) {
      if (response.status < 400 || response.status > 599) {
        throw new GopherProtocolError("unexpected-error-status", operationId, response.status, requestId);
      }
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
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
      throw new GopherApiError(problem, requestId);
    }

    if (!definition.successStatuses.includes(response.status)) {
      throw new GopherProtocolError("unexpected-success-status", operationId, response.status, requestId);
    }

    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType === undefined || !definition.successMediaTypes.includes(contentType)) {
      throw new GopherProtocolError(
        "unexpected-success-content-type",
        operationId,
        response.status,
        requestId,
      );
    }
    if (!parsed.valid) {
      throw new GopherProtocolError("malformed-success-json", operationId, response.status, requestId);
    }

    return {
      data: parsed.value as JsonContent<SuccessfulResponseFor<Id>>,
      ...(etag === undefined ? {} : { etag }),
      notModified: false,
      ...(requestId === undefined ? {} : { requestId }),
      status: response.status as StatusFor<Id>,
    };
  }
}
