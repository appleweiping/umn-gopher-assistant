import { Injectable } from "@nestjs/common";
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  AiQueryResponseSchema,
  type AiQueryRequest,
  type AiQueryResponse,
} from "@umn-gopher-assistant/contracts";

import { AiUnavailableException } from "../http/ai-unavailable.exception.js";
import { loadApiRuntimeConfig } from "../runtime-config.js";
import type { AiKnowledgeClient } from "./ai.types.js";

const JSON_MEDIA_TYPE = /^application\/json(?:\s*;|$)/iu;
const TRACE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const SERVICE_NONCE = /^[A-Za-z0-9_-]{22}$/u;
const SERVICE_NONCE_BYTES = 16;

class AiUpstreamProtocolError extends Error {
  constructor() {
    super("AI knowledge response failed its private service contract");
    this.name = "AiUpstreamProtocolError";
  }
}

class AiUpstreamRequestRejectedError extends Error {
  constructor() {
    super("AI knowledge service rejected a request accepted by the public contract");
    this.name = "AiUpstreamRequestRejectedError";
  }
}

interface ByteStreamReadResult {
  readonly done: boolean;
  readonly value?: Uint8Array;
}

export interface AiKnowledgeClientOptions {
  readonly baseUrl: URL;
  readonly fetch?: typeof fetch;
  readonly maxResponseBytes: number;
  readonly nonceSource?: () => Uint8Array;
  readonly now?: () => number;
  readonly requestClock?: () => number;
  readonly serviceHmacKey: Uint8Array;
  readonly timeoutMs: number;
}

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be between ${String(minimum)} and ${String(maximum)}`);
  }
  return value;
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes) {
      await cancelResponseBody(response);
      throw new AiUpstreamProtocolError();
    }
  }
  if (response.body === null) throw new AiUpstreamProtocolError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    for (;;) {
      const next = (await reader.read()) as ByteStreamReadResult;
      if (next.done) break;
      if (next.value === undefined) throw new AiUpstreamProtocolError();
      const value = next.value;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel("AI response exceeded its byte limit");
        throw new AiUpstreamProtocolError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel("AI knowledge response will not be consumed");
  } catch {
    // Connection cleanup is best effort and must not replace the redacted protocol error.
  }
}

export class AiCircuitBreaker {
  readonly #cooldownMs: number;
  readonly #failureThreshold: number;
  readonly #now: () => number;
  #consecutiveFailures = 0;
  #openUntil = 0;
  #probeInFlight = false;

  constructor(options: {
    readonly cooldownMs?: number;
    readonly failureThreshold?: number;
    readonly now?: () => number;
  }) {
    this.#cooldownMs = boundedInteger(options.cooldownMs ?? 30_000, "cooldownMs", 1_000, 300_000);
    this.#failureThreshold = boundedInteger(options.failureThreshold ?? 3, "failureThreshold", 1, 100);
    this.#now = options.now ?? Date.now;
  }

  acquire(): { readonly probe: boolean } {
    const now = this.#now();
    if (this.#openUntil > now) {
      throw new AiUnavailableException(
        "AI_CIRCUIT_OPEN",
        Math.max(1, Math.ceil((this.#openUntil - now) / 1_000)),
      );
    }
    if (this.#openUntil !== 0) {
      if (this.#probeInFlight) throw new AiUnavailableException("AI_CIRCUIT_OPEN", 5);
      this.#probeInFlight = true;
      return { probe: true };
    }
    return { probe: false };
  }

  success(): void {
    this.#consecutiveFailures = 0;
    this.#openUntil = 0;
    this.#probeInFlight = false;
  }

  failure(probe: boolean): void {
    this.#probeInFlight = false;
    this.#consecutiveFailures += 1;
    if (probe || this.#consecutiveFailures >= this.#failureThreshold) {
      this.#openUntil = this.#now() + this.#cooldownMs;
    }
  }

  neutral(): void {
    this.#probeInFlight = false;
  }
}

export class HttpAiKnowledgeClient implements AiKnowledgeClient {
  readonly #breaker: AiCircuitBreaker;
  readonly #fetch: typeof fetch;
  readonly #maxResponseBytes: number;
  readonly #nonceSource: () => Uint8Array;
  readonly #queryUrl: URL;
  readonly #requestClock: () => number;
  readonly #serviceHmacKey: Uint8Array;
  readonly #timeoutMs: number;

  constructor(options: AiKnowledgeClientOptions) {
    if (
      options.baseUrl.username ||
      options.baseUrl.password ||
      options.baseUrl.search ||
      options.baseUrl.hash
    ) {
      throw new TypeError("AI knowledge base URL must not contain credentials, a query, or a fragment");
    }
    if (options.baseUrl.protocol !== "http:" && options.baseUrl.protocol !== "https:") {
      throw new TypeError("AI knowledge base URL must use HTTP or HTTPS");
    }
    this.#queryUrl = new URL("v1/query", `${options.baseUrl.href.replace(/\/+$/u, "")}/`);
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#maxResponseBytes = boundedInteger(options.maxResponseBytes, "maxResponseBytes", 16_384, 1_048_576);
    this.#nonceSource = options.nonceSource ?? (() => randomBytes(SERVICE_NONCE_BYTES));
    if (options.serviceHmacKey.byteLength < 32 || options.serviceHmacKey.byteLength > 64) {
      throw new RangeError("serviceHmacKey must contain 32 through 64 bytes");
    }
    this.#serviceHmacKey = new Uint8Array(options.serviceHmacKey);
    this.#requestClock = options.requestClock ?? Date.now;
    this.#timeoutMs = boundedInteger(options.timeoutMs, "timeoutMs", 250, 10_000);
    this.#breaker = new AiCircuitBreaker({ ...(options.now === undefined ? {} : { now: options.now }) });
  }

  async query(request: AiQueryRequest, traceId: string): Promise<AiQueryResponse> {
    if (!TRACE_ID.test(traceId))
      throw new TypeError("traceId must satisfy the public correlation ID contract");
    const nonceBytes = this.#nonceSource();
    if (!(nonceBytes instanceof Uint8Array) || nonceBytes.byteLength !== SERVICE_NONCE_BYTES) {
      throw new TypeError("AI service nonce source must return exactly 128 bits");
    }
    const nonce = Buffer.from(nonceBytes).toString("base64url");
    if (!SERVICE_NONCE.test(nonce)) throw new TypeError("AI service nonce must be canonical base64url");
    const lease = this.#breaker.acquire();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new DOMException("Timed out", "TimeoutError")),
      this.#timeoutMs,
    );
    timeout.unref();
    try {
      const body = JSON.stringify(request);
      const timestamp = String(Math.floor(this.#requestClock() / 1_000));
      const bodySha256 = createHash("sha256").update(body, "utf8").digest("hex");
      const canonical = `POST\n/v1/query\n${bodySha256}\n${traceId}\n${timestamp}\n${nonce}`;
      const signature = createHmac("sha256", this.#serviceHmacKey).update(canonical, "utf8").digest("hex");
      const response = await this.#fetch(
        new Request(this.#queryUrl, {
          body,
          credentials: "omit",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Ai-Service-Nonce": nonce,
            "X-Ai-Service-Signature": signature,
            "X-Ai-Service-Timestamp": timestamp,
            "X-Request-Id": traceId,
          },
          method: "POST",
          redirect: "error",
          signal: controller.signal,
        }),
      );
      if ([400, 413, 415, 422].includes(response.status)) {
        await cancelResponseBody(response);
        throw new AiUpstreamRequestRejectedError();
      }
      if (response.status !== 200 || !JSON_MEDIA_TYPE.test(response.headers.get("content-type") ?? "")) {
        await cancelResponseBody(response);
        throw new AiUpstreamProtocolError();
      }
      const bytes = await readBoundedBody(response, this.#maxResponseBytes);
      let candidate: unknown;
      try {
        candidate = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
      } catch {
        throw new AiUpstreamProtocolError();
      }
      const parsed = AiQueryResponseSchema.safeParse(candidate);
      if (
        !parsed.success ||
        parsed.data.campusId !== request.campusId ||
        parsed.data.locale !== request.locale
      ) {
        throw new AiUpstreamProtocolError();
      }
      this.#breaker.success();
      return parsed.data;
    } catch (error) {
      if (error instanceof AiUpstreamRequestRejectedError) {
        this.#breaker.neutral();
        throw new AiUnavailableException("AI_UPSTREAM_CONTRACT_DRIFT");
      }
      this.#breaker.failure(lease.probe);
      if (error instanceof AiUnavailableException) throw error;
      throw new AiUnavailableException(
        error instanceof AiUpstreamProtocolError ? "AI_UPSTREAM_PROTOCOL" : "AI_UPSTREAM_UNAVAILABLE",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

@Injectable()
export class ConfiguredAiKnowledgeClient extends HttpAiKnowledgeClient {
  constructor() {
    const config = loadApiRuntimeConfig().ai;
    super({
      baseUrl: config.knowledgeBaseUrl,
      maxResponseBytes: config.maxResponseBytes,
      serviceHmacKey: config.serviceHmacKey,
      timeoutMs: config.requestTimeoutMs,
    });
  }
}
