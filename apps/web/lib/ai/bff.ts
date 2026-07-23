import {
  AiQueryRequestSchema,
  AiQueryResponseSchema,
  type AiQueryRequest,
} from "@umn-gopher-assistant/contracts";

import { internalApiBaseUrl } from "../catalog/bff";
import {
  aiInternalProofHeaders,
  establishAiSession,
  loadAiSessionRuntime,
  resolveAiNetworkId,
  type AiSessionDependencies,
} from "./session";

const JSON_REQUEST_MEDIA_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/iu;
const JSON_RESPONSE_MEDIA_TYPE = /^application\/(?:problem\+)?json(?:\s*;|$)/iu;
const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
const UPSTREAM_TIMEOUT_MS = 10_000;
const TRACE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;

export interface AiQueryProxyOptions extends AiSessionDependencies {
  readonly environment?: NodeJS.ProcessEnv;
}

class InvalidAiRequestError extends Error {
  readonly status: 400 | 403 | 413 | 415;

  constructor(status: 400 | 403 | 413 | 415) {
    super("Invalid AI query request");
    this.name = "InvalidAiRequestError";
    this.status = status;
  }
}

class InvalidAiUpstreamResponseError extends Error {
  constructor() {
    super("Invalid AI query response");
    this.name = "InvalidAiUpstreamResponseError";
  }
}

interface AiProxyProblemOptions {
  readonly detail: string;
  readonly failureCode: string;
  readonly request: Request;
  readonly status: 400 | 403 | 413 | 415 | 429 | 502 | 503;
  readonly title: string;
  readonly traceId: string;
}

function problemResponse(options: AiProxyProblemOptions): Response {
  const requestUrl = new URL(options.request.url);
  return Response.json(
    {
      detail: options.detail,
      failureCode: options.failureCode,
      instance: requestUrl.pathname,
      status: options.status,
      title: options.title,
      traceId: options.traceId,
      type: `https://gopher-assistant.example/problems/ai-${options.failureCode.toLowerCase()}`,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/problem+json",
        "X-Request-Id": options.traceId,
      },
      status: options.status,
    },
  );
}

function assertSameOrigin(request: Request): void {
  const expectedOrigin = new URL(request.url).origin;
  if (request.headers.get("origin") !== expectedOrigin) throw new InvalidAiRequestError(403);
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") throw new InvalidAiRequestError(403);
}

function declaredLength(request: Request): number | undefined {
  const value = request.headers.get("content-length");
  if (value === null) return undefined;
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) throw new InvalidAiRequestError(400);
  const length = Number(value);
  if (!Number.isSafeInteger(length)) throw new InvalidAiRequestError(400);
  if (length > MAX_REQUEST_BYTES) throw new InvalidAiRequestError(413);
  return length;
}

async function readBoundedBody(
  response: Request | Response,
  limit: number,
  onOverflow: () => Error,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && /^\d+$/u.test(contentLength) && Number(contentLength) > limit) {
    await discardBody(response);
    throw onOverflow();
  }
  if (response.body === null) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let complete = false;
  try {
    while (!complete) {
      const next = await reader.read();
      if (next.done) {
        complete = true;
        continue;
      }
      total += next.value.byteLength;
      if (total > limit) {
        await reader.cancel("Body exceeded its byte limit");
        throw onOverflow();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

function parseJson(bytes: Uint8Array, invalid: () => Error): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw invalid();
  }
}

async function parseRequest(request: Request): Promise<AiQueryRequest> {
  assertSameOrigin(request);
  if (!JSON_REQUEST_MEDIA_TYPE.test(request.headers.get("content-type") ?? "")) {
    throw new InvalidAiRequestError(415);
  }
  const expectedLength = declaredLength(request);
  const bytes = await readBoundedBody(request, MAX_REQUEST_BYTES, () => new InvalidAiRequestError(413));
  if (expectedLength !== undefined && bytes.byteLength !== expectedLength) {
    throw new InvalidAiRequestError(400);
  }
  const parsed = AiQueryRequestSchema.safeParse(parseJson(bytes, () => new InvalidAiRequestError(400)));
  if (!parsed.success) throw new InvalidAiRequestError(400);
  return parsed.data;
}

function requestFailure(request: Request, error: InvalidAiRequestError, traceId: string): Response {
  if (error.status === 403) {
    return problemResponse({
      detail: "This request must originate from the same application origin.",
      failureCode: "CROSS_ORIGIN_REQUEST_REJECTED",
      request,
      status: 403,
      title: "Forbidden",
      traceId,
    });
  }
  if (error.status === 413) {
    return problemResponse({
      detail: "The AI query request exceeds the allowed size.",
      failureCode: "AI_QUERY_TOO_LARGE",
      request,
      status: 413,
      title: "Content Too Large",
      traceId,
    });
  }
  if (error.status === 415) {
    return problemResponse({
      detail: "The AI query request must use application/json.",
      failureCode: "UNSUPPORTED_MEDIA_TYPE",
      request,
      status: 415,
      title: "Unsupported Media Type",
      traceId,
    });
  }
  return problemResponse({
    detail: "The AI query request does not match the supported contract.",
    failureCode: "INVALID_AI_QUERY",
    request,
    status: 400,
    title: "Bad Request",
    traceId,
  });
}

async function discardBody(response: Request | Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response is deliberately discarded; transport cleanup is best effort.
  }
}

function upstreamTraceId(response: Response, fallback: string): string {
  const candidate = response.headers.get("x-request-id");
  return candidate !== null && TRACE_ID.test(candidate) ? candidate : fallback;
}

function copySafeRateLimitHeaders(source: Headers, target: Headers): void {
  for (const name of ["ratelimit-limit", "ratelimit-remaining", "ratelimit-reset"] as const) {
    const value = source.get(name);
    const minimum = name === "ratelimit-remaining" ? 0 : 1;
    if (
      value !== null &&
      /^(?:0|[1-9]\d*)$/u.test(value) &&
      Number.isSafeInteger(Number(value)) &&
      Number(value) >= minimum
    ) {
      target.set(name, value);
    }
  }
}

function attachSessionCookie(response: Response, setCookie: string | undefined): Response {
  if (setCookie !== undefined) response.headers.append("Set-Cookie", setCookie);
  return response;
}

function upstreamFailure(request: Request, response: Response, fallbackTraceId: string): Response {
  const traceId = upstreamTraceId(response, fallbackTraceId);
  const retryAfter = response.headers.get("retry-after");
  const headers = new Headers();
  if (retryAfter !== null && /^\d{1,4}$/u.test(retryAfter) && Number(retryAfter) <= 3_600) {
    headers.set("Retry-After", retryAfter);
  }
  copySafeRateLimitHeaders(response.headers, headers);

  let problem: Response;
  if (response.status === 400 || response.status === 413 || response.status === 422) {
    problem = problemResponse({
      detail: "The campus query could not be accepted. Review the question and try again.",
      failureCode: "AI_QUERY_REJECTED",
      request,
      status: 400,
      title: "Bad Request",
      traceId,
    });
  } else if (response.status === 429) {
    problem = problemResponse({
      detail: "Too many campus queries were submitted. Wait before trying again.",
      failureCode: "AI_RATE_LIMITED",
      request,
      status: 429,
      title: "Too Many Requests",
      traceId,
    });
  } else {
    problem = problemResponse({
      detail: "The reviewed campus index is temporarily unavailable.",
      failureCode: "AI_SERVICE_UNAVAILABLE",
      request,
      status: response.status === 503 ? 503 : 502,
      title: response.status === 503 ? "Service Unavailable" : "Bad Gateway",
      traceId,
    });
  }
  for (const [name, value] of headers) problem.headers.set(name, value);
  return problem;
}

export async function handleAiQueryProxy(
  request: Request,
  options: AiQueryProxyOptions = {},
): Promise<Response> {
  const traceId = crypto.randomUUID();
  const environment = options.environment ?? process.env;
  let runtime: ReturnType<typeof loadAiSessionRuntime>;
  let session: ReturnType<typeof establishAiSession>;
  try {
    runtime = loadAiSessionRuntime(environment);
    session = establishAiSession(request, runtime, options);
  } catch {
    return problemResponse({
      detail: "The campus query service is not configured for this environment.",
      failureCode: "AI_API_MISCONFIGURED",
      request,
      status: 503,
      title: "Service Unavailable",
      traceId,
    });
  }
  const finalize = (response: Response) => attachSessionCookie(response, session.setCookie);
  let networkId: string;
  try {
    networkId = resolveAiNetworkId(request, session.sessionId, runtime, options);
  } catch {
    return finalize(
      problemResponse({
        detail: "A trusted network assertion is required before campus queries can be accepted.",
        failureCode: "AI_INGRESS_ASSERTION_REQUIRED",
        request,
        status: 503,
        title: "Service Unavailable",
        traceId,
      }),
    );
  }

  let query: AiQueryRequest;
  try {
    query = await parseRequest(request);
  } catch (error) {
    return finalize(
      requestFailure(
        request,
        error instanceof InvalidAiRequestError ? error : new InvalidAiRequestError(400),
        traceId,
      ),
    );
  }

  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL("/v1/ai/query", internalApiBaseUrl(environment));
  } catch {
    return finalize(
      problemResponse({
        detail: "The campus query service is not configured for this environment.",
        failureCode: "AI_API_MISCONFIGURED",
        request,
        status: 503,
        title: "Service Unavailable",
        traceId,
      }),
    );
  }

  const controller = new AbortController();
  const abortFromRequest = () => controller.abort(request.signal.reason);
  if (request.signal.aborted) abortFromRequest();
  else request.signal.addEventListener("abort", abortFromRequest, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Timed out", "TimeoutError")),
    UPSTREAM_TIMEOUT_MS,
  );

  try {
    const proofHeaders = aiInternalProofHeaders(session.sessionId, networkId, traceId, runtime, options);
    const upstream = await fetch(upstreamUrl, {
      body: JSON.stringify(query),
      cache: "no-store",
      credentials: "omit",
      headers: {
        Accept: "application/json, application/problem+json",
        "Content-Type": "application/json",
        "X-Request-Id": traceId,
        ...proofHeaders,
      },
      method: "POST",
      redirect: "error",
      signal: controller.signal,
    });
    if (!upstream.ok) {
      await discardBody(upstream);
      return finalize(upstreamFailure(request, upstream, traceId));
    }
    if (!JSON_RESPONSE_MEDIA_TYPE.test(upstream.headers.get("content-type") ?? "")) {
      await discardBody(upstream);
      throw new InvalidAiUpstreamResponseError();
    }
    const bytes = await readBoundedBody(
      upstream,
      MAX_RESPONSE_BYTES,
      () => new InvalidAiUpstreamResponseError(),
    );
    const parsed = AiQueryResponseSchema.safeParse(
      parseJson(bytes, () => new InvalidAiUpstreamResponseError()),
    );
    if (!parsed.success || parsed.data.campusId !== query.campusId || parsed.data.locale !== query.locale) {
      throw new InvalidAiUpstreamResponseError();
    }
    const responseTraceId = upstreamTraceId(upstream, traceId);
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      "X-Request-Id": responseTraceId,
    });
    copySafeRateLimitHeaders(upstream.headers, headers);
    return finalize(
      Response.json(parsed.data, {
        headers,
        status: 200,
      }),
    );
  } catch (error) {
    if (request.signal.aborted) {
      return finalize(
        problemResponse({
          detail: "The campus query request was cancelled.",
          failureCode: "AI_REQUEST_CANCELLED",
          request,
          status: 503,
          title: "Service Unavailable",
          traceId,
        }),
      );
    }
    return finalize(
      problemResponse({
        detail:
          error instanceof InvalidAiUpstreamResponseError
            ? "The campus query service returned an invalid response."
            : "The reviewed campus index is temporarily unavailable.",
        failureCode:
          error instanceof InvalidAiUpstreamResponseError
            ? "INVALID_AI_UPSTREAM_RESPONSE"
            : "AI_SERVICE_UNAVAILABLE",
        request,
        status: error instanceof InvalidAiUpstreamResponseError ? 502 : 503,
        title: error instanceof InvalidAiUpstreamResponseError ? "Bad Gateway" : "Service Unavailable",
        traceId,
      }),
    );
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abortFromRequest);
  }
}
