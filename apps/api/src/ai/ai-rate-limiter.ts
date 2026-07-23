import { channel } from "node:diagnostics_channel";

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { createClient } from "redis";

import { AiUnavailableException } from "../http/ai-unavailable.exception.js";
import { loadApiRuntimeConfig } from "../runtime-config.js";
import type { AiRateLimitDecision, AiRateLimiter } from "./ai.types.js";

const CLIENT_KEY = /^[A-Za-z0-9_-]{43}$/u;
const operationalEvents = channel("umn-gopher-assistant.ai.rate-limit");
const RATE_LIMIT_SCRIPT = `
local clientCount = redis.call('INCR', KEYS[1])
if clientCount == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[4]) end
local clientTtl = redis.call('PTTL', KEYS[1])
local remaining = math.max(0, tonumber(ARGV[1]) - clientCount)
if clientCount > tonumber(ARGV[1]) then
  local clientRetryMs = math.max(clientTtl, 1000)
  return {0, remaining, clientRetryMs, clientRetryMs}
end
local networkCount = redis.call('INCR', KEYS[2])
if networkCount == 1 then redis.call('PEXPIRE', KEYS[2], ARGV[4]) end
local networkTtl = redis.call('PTTL', KEYS[2])
if networkCount > tonumber(ARGV[2]) then
  return {0, remaining, math.max(clientTtl, 1000), math.max(networkTtl, 1000)}
end
local globalCount = redis.call('INCR', KEYS[3])
if globalCount == 1 then redis.call('PEXPIRE', KEYS[3], ARGV[4]) end
local globalTtl = redis.call('PTTL', KEYS[3])
if globalCount > tonumber(ARGV[3]) then
  return {0, remaining, math.max(clientTtl, 1000), math.max(globalTtl, 1000)}
end
local clientResetMs = math.max(clientTtl, 1000)
return {1, remaining, clientResetMs, clientResetMs}
`;

export interface RedisAiRateLimiterOptions {
  readonly client?: RedisRateLimitClient;
  readonly clientLimit: number;
  readonly globalLimit: number;
  readonly networkLimit: number;
  readonly operationTimeoutMs?: number;
  readonly redisUrl: URL;
  readonly windowSeconds: number;
}

export interface RedisRateLimitClient {
  readonly isOpen: boolean;
  readonly isReady: boolean;
  close(): Promise<unknown>;
  connect(): Promise<unknown>;
  destroy?(): unknown;
  eval(script: string, options: { readonly arguments: string[]; readonly keys: string[] }): Promise<unknown>;
  on(event: "error", listener: (error: Error) => void): unknown;
}

class RedisOperationTimeoutError extends Error {
  constructor() {
    super("Redis rate-limit operation exceeded its deadline");
    this.name = "RedisOperationTimeoutError";
  }
}

function beforeDeadline<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new RedisOperationTimeoutError()), milliseconds);
    timeout.unref();
    operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error("Redis operation failed", { cause: error }));
      },
    );
  });
}

function positiveInteger(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${String(maximum)}`);
  }
  return value;
}

function parseRedisResult(value: unknown): readonly [number, number, number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value.some((item) => typeof item !== "number" || !Number.isSafeInteger(item))
  ) {
    throw new TypeError("Redis returned an invalid AI rate-limit result");
  }
  return value as unknown as readonly [number, number, number, number];
}

export class RedisAiRateLimiter implements AiRateLimiter, OnModuleDestroy {
  readonly #client: RedisRateLimitClient;
  readonly #clientLimit: number;
  readonly #globalLimit: number;
  readonly #networkLimit: number;
  readonly #operationTimeoutMs: number;
  readonly #windowMilliseconds: number;
  #connecting: Promise<unknown> | undefined;

  constructor(options: RedisAiRateLimiterOptions) {
    this.#clientLimit = positiveInteger(options.clientLimit, "clientLimit", 1_000);
    this.#globalLimit = positiveInteger(options.globalLimit, "globalLimit", 100_000);
    this.#networkLimit = positiveInteger(options.networkLimit, "networkLimit", 100_000);
    if (this.#networkLimit < this.#clientLimit) {
      throw new RangeError("networkLimit must be greater than or equal to clientLimit");
    }
    if (this.#globalLimit < this.#networkLimit) {
      throw new RangeError("globalLimit must be greater than or equal to networkLimit");
    }
    this.#windowMilliseconds = positiveInteger(options.windowSeconds, "windowSeconds", 3_600) * 1_000;
    this.#operationTimeoutMs = positiveInteger(
      options.operationTimeoutMs ?? 1_000,
      "operationTimeoutMs",
      10_000,
    );
    this.#client =
      options.client ??
      createClient({
        commandOptions: { timeout: this.#operationTimeoutMs },
        commandsQueueMaxLength: 100,
        disableOfflineQueue: true,
        socket: { connectTimeout: 1_000, reconnectStrategy: false },
        url: options.redisUrl.href,
      });
    // node-redis requires an error listener. Errors are mapped at the request
    // boundary and deliberately not logged because connection URLs may contain secrets.
    this.#client.on("error", () => operationalEvents.publish({ code: "AI_REDIS_CLIENT_ERROR" }));
  }

  async #connect(): Promise<void> {
    if (this.#client.isReady) return;
    if (this.#connecting === undefined) {
      if (this.#client.isOpen) {
        // With reconnect disabled, an open-but-not-ready client outside our
        // tracked connect attempt is not safe to enqueue commands against.
        this.#client.destroy?.();
      }
      this.#connecting = this.#client.connect().finally(() => {
        this.#connecting = undefined;
      });
    }
    await beforeDeadline(this.#connecting, this.#operationTimeoutMs);
  }

  async consume(clientKey: string, networkKey: string): Promise<AiRateLimitDecision> {
    if (!CLIENT_KEY.test(clientKey)) throw new TypeError("clientKey must be a SHA-256 base64url digest");
    if (!CLIENT_KEY.test(networkKey)) throw new TypeError("networkKey must be a SHA-256 base64url digest");
    try {
      await this.#connect();
      const raw = await beforeDeadline(
        this.#client.eval(RATE_LIMIT_SCRIPT, {
          arguments: [
            String(this.#clientLimit),
            String(this.#networkLimit),
            String(this.#globalLimit),
            String(this.#windowMilliseconds),
          ],
          keys: [
            `uga:ai:{rate}:client:${clientKey}`,
            `uga:ai:{rate}:network:${networkKey}`,
            "uga:ai:{rate}:global",
          ],
        }),
        this.#operationTimeoutMs,
      );
      const [allowed, remaining, resetMilliseconds, retryMilliseconds] = parseRedisResult(raw);
      return {
        allowed: allowed === 1,
        limit: this.#clientLimit,
        remaining: Math.max(0, remaining),
        resetAfterSeconds: Math.max(1, Math.ceil(resetMilliseconds / 1_000)),
        retryAfterSeconds: Math.max(1, Math.ceil(retryMilliseconds / 1_000)),
      };
    } catch (error) {
      if (
        error instanceof TypeError &&
        (error.message.startsWith("clientKey") || error.message.startsWith("networkKey"))
      ) {
        throw error;
      }
      operationalEvents.publish({ code: "AI_REDIS_OPERATION_FAILED" });
      this.#client.destroy?.();
      throw new AiUnavailableException("AI_RATE_LIMITER_UNAVAILABLE", 10);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.#client.isOpen) return;
    if (this.#client.destroy !== undefined) {
      this.#client.destroy();
      return;
    }
    await beforeDeadline(this.#client.close(), this.#operationTimeoutMs).catch(() => undefined);
  }
}

@Injectable()
export class ConfiguredRedisAiRateLimiter extends RedisAiRateLimiter {
  constructor() {
    super(loadApiRuntimeConfig().ai.rateLimit);
  }
}
