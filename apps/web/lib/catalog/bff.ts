import { CampusIdSchema } from "@umn-gopher-assistant/contracts";

import { isSignedCatalogCursor } from "./cursor";

const QUERY_KEYS = ["campusId", "cursor", "from", "limit", "to"] as const;
const QUERY_KEY_SET = new Set<string>(QUERY_KEYS);
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const JSON_MEDIA_TYPE = /^application\/(?:problem\+)?json(?:\s*;|$)/iu;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const MAX_RANGE_DAYS = 183;
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;

type CatalogResource = "events" | "sessions";

class InvalidUpstreamResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUpstreamResponseError";
  }
}

const UPSTREAM_PATHS: Readonly<Record<CatalogResource, string>> = {
  events: "/v1/events",
  sessions: "/v1/academics/sessions",
};

interface ProxyProblemOptions {
  readonly detail: string;
  readonly failureCode: string;
  readonly request: Request;
  readonly status: 400 | 502 | 503;
  readonly title: string;
}

function problemResponse(options: ProxyProblemOptions): Response {
  const requestUrl = new URL(options.request.url);
  return Response.json(
    {
      detail: options.detail,
      failureCode: options.failureCode,
      instance: `${requestUrl.pathname}${requestUrl.search}`,
      status: options.status,
      title: options.title,
      traceId: crypto.randomUUID(),
      type: `https://gopher-assistant.example/problems/catalog-proxy-${options.failureCode.toLowerCase()}`,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/problem+json",
      },
      status: options.status,
    },
  );
}

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

export function internalApiBaseUrl(environment: NodeJS.ProcessEnv = process.env): URL {
  const production = environment.NODE_ENV === "production";
  const configured = environment["GOPHER_API_BASE_URL"];
  if (configured === undefined && production) {
    throw new TypeError("GOPHER_API_BASE_URL is required in production");
  }

  const url = new URL(configured ?? "http://127.0.0.1:4000");
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new TypeError(
      "GOPHER_API_BASE_URL must be an origin without credentials, path, query, or fragment",
    );
  }
  if (production && url.protocol !== "https:") {
    throw new TypeError("GOPHER_API_BASE_URL must use HTTPS in production");
  }
  if (!production && url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new TypeError("An HTTP GOPHER_API_BASE_URL is allowed only for a loopback development origin");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("GOPHER_API_BASE_URL must use HTTP or HTTPS");
  }
  return url;
}

function realIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
  );
}

export function catalogProxyQuery(requestUrl: URL): URLSearchParams {
  for (const key of requestUrl.searchParams.keys()) {
    if (!QUERY_KEY_SET.has(key)) throw new TypeError(`Unsupported query parameter: ${key}`);
  }
  for (const key of QUERY_KEYS) {
    if (requestUrl.searchParams.getAll(key).length > 1) {
      throw new TypeError(`${key} must be specified exactly once`);
    }
  }

  const campusId = requestUrl.searchParams.get("campusId");
  if (!CampusIdSchema.safeParse(campusId).success) {
    throw new TypeError("campusId is required and must identify a supported campus");
  }
  const cursor = requestUrl.searchParams.get("cursor");
  if (cursor !== null && !isSignedCatalogCursor(cursor)) throw new TypeError("cursor is invalid");
  const limit = requestUrl.searchParams.get("limit");
  if (limit !== null && !/^(?:[1-9]|[1-9]\d|100)$/u.test(limit)) {
    throw new TypeError("limit must be an integer between 1 and 100");
  }
  const from = requestUrl.searchParams.get("from");
  const to = requestUrl.searchParams.get("to");
  if ((from === null) !== (to === null)) throw new TypeError("from and to must be provided together");
  if (from !== null && to !== null) {
    if (!realIsoDate(from) || !realIsoDate(to)) throw new TypeError("from and to must be real ISO dates");
    if (from > to) throw new TypeError("from must not follow to");
    const days = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000;
    if (days > MAX_RANGE_DAYS)
      throw new TypeError(`date range must not exceed ${String(MAX_RANGE_DAYS)} days`);
  }

  const sanitized = new URLSearchParams();
  for (const key of QUERY_KEYS) {
    const value = requestUrl.searchParams.get(key);
    if (value !== null) sanitized.set(key, value);
  }
  return sanitized;
}

function safeEntityTag(value: string): boolean {
  if (value.length < 2 || value.length > 256) return false;
  const opaque = value.startsWith('W/"') ? value.slice(2) : value;
  if (!opaque.startsWith('"') || !opaque.endsWith('"')) return false;
  return Array.from(opaque.slice(1, -1)).every((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined &&
      (codePoint === 0x21 ||
        (codePoint >= 0x23 && codePoint <= 0x7e) ||
        (codePoint >= 0x80 && codePoint <= 0xff))
    );
  });
}

function safeIfNoneMatch(value: string | null): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (trimmed === "*") return trimmed;
  const tags = trimmed.split(",").map((tag) => tag.trim());
  return tags.length > 0 && tags.length <= 16 && tags.every(safeEntityTag) ? tags.join(", ") : undefined;
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/u.test(declaredLength) &&
    Number(declaredLength) > MAX_RESPONSE_BYTES
  ) {
    throw new InvalidUpstreamResponseError("Upstream response exceeds the catalog proxy byte limit");
  }
  if (response.body === null) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let complete = false;
  try {
    while (!complete) {
      const next = await reader.read();
      if (next.done) {
        complete = true;
        continue;
      }
      length += next.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel("Catalog response exceeded its byte limit");
        throw new InvalidUpstreamResponseError("Upstream response exceeds the catalog proxy byte limit");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function safeResponseHeaders(upstream: Response): Headers {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (upstream.status !== 304) {
    headers.set("Content-Type", upstream.headers.get("content-type") ?? "application/json");
  }
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter !== null && /^\d{1,5}$/u.test(retryAfter) && Number(retryAfter) <= 86_400) {
    headers.set("Retry-After", retryAfter);
  }
  const requestId = upstream.headers.get("x-request-id");
  if (requestId !== null && SAFE_REQUEST_ID.test(requestId)) headers.set("X-Request-Id", requestId);
  const entityTag = upstream.headers.get("etag");
  if (entityTag !== null && safeEntityTag(entityTag)) headers.set("ETag", entityTag);
  return headers;
}

export async function handleCatalogProxy(request: Request, resource: CatalogResource): Promise<Response> {
  let query: URLSearchParams;
  try {
    query = catalogProxyQuery(new URL(request.url));
  } catch {
    return problemResponse({
      detail: "The catalog request contains unsupported or invalid parameters.",
      failureCode: "INVALID_CATALOG_QUERY",
      request,
      status: 400,
      title: "Bad Request",
    });
  }
  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(UPSTREAM_PATHS[resource], internalApiBaseUrl());
    upstreamUrl.search = query.toString();
  } catch {
    return problemResponse({
      detail: "The catalog API connection is not configured for this environment.",
      failureCode: "CATALOG_API_MISCONFIGURED",
      request,
      status: 503,
      title: "Service Unavailable",
    });
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
    const headers = new Headers({ Accept: "application/json, application/problem+json" });
    const ifNoneMatch = safeIfNoneMatch(request.headers.get("if-none-match"));
    if (ifNoneMatch !== undefined) headers.set("If-None-Match", ifNoneMatch);
    const upstream = await fetch(upstreamUrl, {
      cache: "no-store",
      credentials: "omit",
      headers,
      redirect: "error",
      signal: controller.signal,
    });
    if (upstream.status === 304) {
      const responseHeaders = safeResponseHeaders(upstream);
      if (ifNoneMatch === undefined || !responseHeaders.has("ETag")) {
        throw new InvalidUpstreamResponseError(
          "Upstream returned 304 without a forwarded validator and safe ETag",
        );
      }
      return new Response(null, { headers: responseHeaders, status: 304 });
    }
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!JSON_MEDIA_TYPE.test(contentType)) {
      throw new InvalidUpstreamResponseError("Upstream returned a non-JSON response");
    }
    const body = await readBoundedBody(upstream);
    try {
      const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new InvalidUpstreamResponseError("Expected a JSON object");
      }
    } catch {
      throw new InvalidUpstreamResponseError("Upstream returned malformed JSON");
    }
    return new Response(Uint8Array.from(body).buffer, {
      headers: safeResponseHeaders(upstream),
      status: upstream.status,
      statusText: upstream.statusText,
    });
  } catch (error) {
    if (request.signal.aborted) {
      return problemResponse({
        detail: "The catalog request was cancelled.",
        failureCode: "CATALOG_REQUEST_CANCELLED",
        request,
        status: 503,
        title: "Service Unavailable",
      });
    }
    const malformed = error instanceof InvalidUpstreamResponseError;
    return problemResponse({
      detail: malformed
        ? "The catalog API returned an invalid response. Use the official source while service is restored."
        : "The catalog API is temporarily unavailable. Use the official source and try again later.",
      failureCode: malformed ? "INVALID_UPSTREAM_RESPONSE" : "CATALOG_API_UNAVAILABLE",
      request,
      status: malformed ? 502 : 503,
      title: malformed ? "Bad Gateway" : "Service Unavailable",
    });
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abortFromRequest);
  }
}
