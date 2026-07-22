import { createHash } from "node:crypto";

import { IntegrationError, ObservedIntegrationError } from "./errors.js";
import type { SourceHashObservation } from "./types.js";

export const INTEGRATION_ENDPOINT_IDS = Object.freeze({
  sessions: "umn-sessions",
  twinCitiesEvents: "tc-livewhale-events",
  duluthEvents: "duluth-livewhale-events",
} as const);

export type IntegrationEndpointId = (typeof INTEGRATION_ENDPOINT_IDS)[keyof typeof INTEGRATION_ENDPOINT_IDS];

interface EndpointPolicy {
  readonly id: IntegrationEndpointId;
  readonly origin: string;
  readonly pathname: string;
  validateSearch(searchParams: URLSearchParams): boolean;
}

const LIVEWHALE_PATH = "/live/json/v2/events/response_fields/location,status/paginate/50";
const INSTITUTION_FILTER = /^institution_id=UMN(?:TC|DL|CR|MO)$/u;
const TERM_ID = /^\d{4,16}$/u;
export const MAX_SESSION_TERM_FILTERS = 3;
export const MAX_LIVEWHALE_PAGES = 20;
export const MAX_LIVEWHALE_RECORDS = 1_000;
export const MAX_LIVEWHALE_AGGREGATE_BYTES = 8 * 1_024 * 1_024;

function hasOnlyOneParameter(searchParams: URLSearchParams, name: string): boolean {
  return [...searchParams.keys()].every((key) => key === name) && searchParams.getAll(name).length <= 1;
}

function liveWhaleSearchIsAllowed(searchParams: URLSearchParams): boolean {
  if (!hasOnlyOneParameter(searchParams, "page")) return false;
  const page = searchParams.get("page");
  return (
    page !== null &&
    /^(?:0|[1-9]\d*)$/u.test(page) &&
    Number(page) >= 1 &&
    Number(page) <= MAX_LIVEWHALE_PAGES
  );
}

function sessionsSearchIsAllowed(searchParams: URLSearchParams): boolean {
  if (!hasOnlyOneParameter(searchParams, "q")) return false;
  const query = searchParams.get("q");
  if (query === null) return false;
  const parts = query.split(",");
  if (parts.length !== 2 || !INSTITUTION_FILTER.test(parts[0] ?? "")) return false;
  const termFilter = parts[1] ?? "";
  if (!termFilter.startsWith("term_id=")) return false;
  const rawTermIds = termFilter.slice("term_id=".length).split("|");
  if (
    rawTermIds.length === 0 ||
    rawTermIds.length > MAX_SESSION_TERM_FILTERS ||
    rawTermIds.some((termId) => !TERM_ID.test(termId))
  ) {
    return false;
  }
  const canonicalTermIds = [...new Set(rawTermIds)].sort();
  return canonicalTermIds.length === rawTermIds.length && canonicalTermIds.join("|") === rawTermIds.join("|");
}

const ENDPOINT_POLICIES = new Map<IntegrationEndpointId, EndpointPolicy>([
  [
    INTEGRATION_ENDPOINT_IDS.sessions,
    {
      id: INTEGRATION_ENDPOINT_IDS.sessions,
      origin: "https://sessions.umn.edu",
      pathname: "/sessions.json",
      validateSearch: sessionsSearchIsAllowed,
    },
  ],
  [
    INTEGRATION_ENDPOINT_IDS.twinCitiesEvents,
    {
      id: INTEGRATION_ENDPOINT_IDS.twinCitiesEvents,
      origin: "https://events.tc.umn.edu",
      pathname: LIVEWHALE_PATH,
      validateSearch: liveWhaleSearchIsAllowed,
    },
  ],
  [
    INTEGRATION_ENDPOINT_IDS.duluthEvents,
    {
      id: INTEGRATION_ENDPOINT_IDS.duluthEvents,
      origin: "https://calendar.d.umn.edu",
      pathname: LIVEWHALE_PATH,
      validateSearch: liveWhaleSearchIsAllowed,
    },
  ],
]);

export type IntegrationFetch = (input: string | URL, init: RequestInit) => Promise<Response>;

export interface SafeJsonFetcherOptions {
  readonly fetch?: IntegrationFetch;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly now?: () => Date;
}

export interface SafeJsonFetchResult {
  readonly json: unknown;
  readonly observation: SourceHashObservation;
}

interface ByteStreamReadResult {
  readonly done: boolean;
  readonly value?: Uint8Array;
}

function assertBoundedInteger(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer from ${String(minimum)} through ${String(maximum)}`);
  }
}

function contentTypeIsJson(value: string): boolean {
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/json" || /^application\/[a-z0-9!#$&^_.+-]+\+json$/u.test(mediaType);
}

function parseAllowedTarget(endpointId: IntegrationEndpointId, input: string | URL): URL {
  const policy = ENDPOINT_POLICIES.get(endpointId);
  if (policy === undefined) {
    throw new IntegrationError("TARGET_NOT_ALLOWED", "Unknown integration endpoint identifier");
  }

  let target: URL;
  try {
    target = new URL(input);
  } catch (error) {
    throw new IntegrationError(
      "TARGET_NOT_ALLOWED",
      "Integration target is not a valid absolute URL",
      false,
      {
        cause: error,
      },
    );
  }

  const allowed =
    target.protocol === "https:" &&
    target.username === "" &&
    target.password === "" &&
    target.port === "" &&
    target.hash === "" &&
    target.origin === policy.origin &&
    target.pathname === policy.pathname &&
    policy.validateSearch(target.searchParams);

  if (!allowed) {
    throw new IntegrationError(
      "TARGET_NOT_ALLOWED",
      `Target is outside the fixed allowlist for ${policy.id}`,
    );
  }
  return target;
}

async function cancelWithoutMasking(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeout: Promise<never>,
): Promise<void> {
  try {
    await Promise.race([reader.cancel(), timeout]);
  } catch {
    // The size violation remains the primary failure.
  }
}

export class SafeJsonFetcher {
  readonly #fetch: IntegrationFetch;
  readonly #timeoutMs: number;
  readonly #maxBytes: number;
  readonly #now: () => Date;

  constructor(options: SafeJsonFetcherOptions = {}) {
    const timeoutMs = options.timeoutMs ?? 5_000;
    const maxBytes = options.maxBytes ?? 2 * 1_024 * 1_024;
    assertBoundedInteger(timeoutMs, 1, 30_000, "timeoutMs");
    assertBoundedInteger(maxBytes, 1, 8 * 1_024 * 1_024, "maxBytes");

    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = timeoutMs;
    this.#maxBytes = maxBytes;
    this.#now = options.now ?? (() => new Date());
  }

  async fetchJson(
    endpointId: IntegrationEndpointId,
    input: string | URL,
    signal?: AbortSignal,
  ): Promise<SafeJsonFetchResult> {
    // Validate before invoking the injected transport. This is an SSRF boundary,
    // not merely a post-fetch assertion.
    const target = parseAllowedTarget(endpointId, input);
    const timeoutController = new AbortController();
    const requestSignal =
      signal === undefined ? timeoutController.signal : AbortSignal.any([signal, timeoutController.signal]);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutError = new IntegrationError(
      "TIMEOUT",
      `Upstream JSON request exceeded ${String(this.#timeoutMs)} ms`,
      true,
    );
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        timeoutController.abort(timeoutError);
        reject(timeoutError);
      }, this.#timeoutMs);
    });

    let response: Response;
    try {
      response = await Promise.race([
        this.#fetch(target, {
          method: "GET",
          headers: { Accept: "application/json" },
          redirect: "manual",
          credentials: "omit",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          signal: requestSignal,
        }),
        timeout,
      ]);
      if (response.status >= 300 && response.status < 400) {
        throw new IntegrationError("UPSTREAM_REDIRECT", "Upstream redirects are forbidden", true);
      }
      if (response.status === 429) {
        throw new IntegrationError("UPSTREAM_RATE_LIMITED", "Upstream rate limit reached", true);
      }
      if (response.status >= 500) {
        throw new IntegrationError("UPSTREAM_SERVER_ERROR", "Upstream service failed", true);
      }
      if (response.status !== 200) {
        throw new IntegrationError("UPSTREAM_CLIENT_ERROR", "Upstream returned a non-success status");
      }

      // Native fetch leaves url empty only for synthetic Response objects used by
      // tests. A populated final URL must be byte-for-byte the approved target.
      if (response.url !== "" && new URL(response.url).href !== target.href) {
        throw new IntegrationError("UPSTREAM_REDIRECT", "Upstream response URL changed unexpectedly", true);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentTypeIsJson(contentType)) {
        throw new IntegrationError("INVALID_CONTENT_TYPE", "Upstream response is not JSON");
      }

      const contentLength = response.headers.get("content-length");
      if (contentLength !== null && /^\d+$/u.test(contentLength) && Number(contentLength) > this.#maxBytes) {
        throw new IntegrationError("RESPONSE_TOO_LARGE", "Upstream response exceeds the hard byte limit");
      }
      if (response.body === null) {
        throw new IntegrationError("INVALID_JSON", "Upstream JSON response has no body");
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      const digest = createHash("sha256");
      let byteLength = 0;
      try {
        for (;;) {
          const chunk = (await Promise.race([reader.read(), timeout])) as ByteStreamReadResult;
          if (chunk.done) break;
          if (chunk.value === undefined) {
            throw new IntegrationError("INVALID_JSON", "Upstream byte stream returned an invalid chunk");
          }
          const value = chunk.value;
          byteLength += value.byteLength;
          if (byteLength > this.#maxBytes) {
            await cancelWithoutMasking(reader, timeout);
            throw new IntegrationError("RESPONSE_TOO_LARGE", "Upstream response exceeds the hard byte limit");
          }
          digest.update(value);
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }

      const observation: SourceHashObservation = Object.freeze({
        algorithm: "SHA-256",
        sha256: digest.digest("hex"),
        byteLength,
        fetchedAt: this.#now().toISOString(),
        sourceUrl: target.href,
        httpStatus: 200,
        contentType,
        rawContentPersisted: false,
      });

      let decoded: string;
      try {
        decoded = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, byteLength));
      } catch {
        throw new ObservedIntegrationError(
          new IntegrationError("INVALID_JSON", "Upstream response is not valid UTF-8 JSON"),
          observation,
        );
      }

      let json: unknown;
      try {
        json = JSON.parse(decoded) as unknown;
      } catch {
        throw new ObservedIntegrationError(
          new IntegrationError("INVALID_JSON", "Upstream response contains malformed JSON"),
          observation,
        );
      }

      return {
        json,
        observation,
      };
    } catch (error) {
      if (timeoutController.signal.aborted) throw timeoutError;
      throw error;
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  }
}

export function normalizeSessionTermIds(termIds: readonly string[]): readonly string[] {
  if (!Array.isArray(termIds) || termIds.length === 0 || termIds.length > MAX_SESSION_TERM_FILTERS) {
    throw new RangeError(`termIds must contain 1 through ${String(MAX_SESSION_TERM_FILTERS)} entries`);
  }
  const normalized = termIds.map((termId) => {
    if (typeof termId !== "string" || !TERM_ID.test(termId)) {
      throw new TypeError("Each termId must contain 4 through 16 decimal digits");
    }
    return termId;
  });
  if (new Set(normalized).size !== normalized.length) throw new TypeError("termIds must be unique");
  return Object.freeze(normalized.sort());
}

export function buildSessionsUrl(
  institutionCode: "UMNTC" | "UMNDL" | "UMNCR" | "UMNMO",
  termIds: readonly string[],
): string {
  const normalizedTermIds = normalizeSessionTermIds(termIds);
  return `https://sessions.umn.edu/sessions.json?q=institution_id=${institutionCode},term_id=${normalizedTermIds.join("|")}`;
}

export function buildLiveWhaleUrl(campus: "tc" | "duluth", page = 1): string {
  assertBoundedInteger(page, 1, MAX_LIVEWHALE_PAGES, "page");
  const origin = campus === "tc" ? "https://events.tc.umn.edu" : "https://calendar.d.umn.edu";
  const base = `${origin}${LIVEWHALE_PATH}`;
  return `${base}?page=${String(page)}`;
}
