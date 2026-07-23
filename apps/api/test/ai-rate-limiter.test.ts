import { describe, expect, it } from "vitest";

import { RedisAiRateLimiter, type RedisRateLimitClient } from "../src/ai/ai-rate-limiter.js";
import { AiUnavailableException } from "../src/http/ai-unavailable.exception.js";

class FakeRedisClient implements RedisRateLimitClient {
  destroyCalls = 0;
  evalPromise: Promise<unknown> | undefined;
  isOpen = false;
  isReady = false;
  result: unknown = [1, 11, 60_000, 60_000];
  captured:
    | {
        readonly script: string;
        readonly options: { readonly arguments: string[]; readonly keys: string[] };
      }
    | undefined;

  async close(): Promise<void> {
    this.isOpen = false;
    this.isReady = false;
  }

  async connect(): Promise<void> {
    this.isOpen = true;
    this.isReady = true;
  }

  destroy(): void {
    this.destroyCalls += 1;
    this.isOpen = false;
    this.isReady = false;
  }

  async eval(
    script: string,
    options: { readonly arguments: string[]; readonly keys: string[] },
  ): Promise<unknown> {
    this.captured = { options, script };
    return this.evalPromise ?? this.result;
  }

  on(): this {
    return this;
  }
}

function limiter(client: FakeRedisClient, operationTimeoutMs = 1_000): RedisAiRateLimiter {
  return new RedisAiRateLimiter({
    client,
    clientLimit: 12,
    globalLimit: 600,
    networkLimit: 120,
    operationTimeoutMs,
    redisUrl: new URL("redis://:secret@127.0.0.1:6379"),
    windowSeconds: 60,
  });
}

describe("distributed AI rate limiter", () => {
  it("executes one atomic three-key Redis script in a shared cluster slot", async () => {
    const client = new FakeRedisClient();
    const subject = "a".repeat(43);
    const network = "n".repeat(43);
    await expect(limiter(client).consume(subject, network)).resolves.toEqual({
      allowed: true,
      limit: 12,
      remaining: 11,
      resetAfterSeconds: 60,
      retryAfterSeconds: 60,
    });
    expect(client.captured?.options.arguments).toEqual(["12", "120", "600", "60000"]);
    expect(client.captured?.options.keys).toEqual([
      `uga:ai:{rate}:client:${subject}`,
      `uga:ai:{rate}:network:${network}`,
      "uga:ai:{rate}:global",
    ]);
    expect(client.captured?.script).toContain("INCR");
    expect(client.captured?.script).toContain("PEXPIRE");
    expect(client.captured?.script.indexOf("if clientCount >")).toBeLessThan(
      client.captured?.script.indexOf("local networkCount") ?? -1,
    );
    expect(client.captured?.script.indexOf("if networkCount >")).toBeLessThan(
      client.captured?.script.indexOf("local globalCount") ?? -1,
    );
  });

  it("returns a bounded denial and fails closed on malformed Redis output", async () => {
    const client = new FakeRedisClient();
    client.result = [0, 0, 1_001, 2_001];
    await expect(limiter(client).consume("b".repeat(43), "n".repeat(43))).resolves.toEqual({
      allowed: false,
      limit: 12,
      remaining: 0,
      resetAfterSeconds: 2,
      retryAfterSeconds: 3,
    });
    client.result = "not-an-array";
    await expect(limiter(client).consume("b".repeat(43), "n".repeat(43))).rejects.toBeInstanceOf(
      AiUnavailableException,
    );
  });

  it("rejects non-digest keys before contacting Redis", async () => {
    const client = new FakeRedisClient();
    await expect(limiter(client).consume("raw-client-address", "n".repeat(43))).rejects.toThrow("SHA-256");
    await expect(limiter(client).consume("a".repeat(43), "raw-network-address")).rejects.toThrow("SHA-256");
    expect(client.isOpen).toBe(false);
  });

  it("fails closed and destroys a half-open client when a Redis command stalls", async () => {
    const client = new FakeRedisClient();
    client.evalPromise = new Promise(() => undefined);
    await expect(limiter(client, 10).consume("c".repeat(43), "n".repeat(43))).rejects.toMatchObject({
      failureCode: "AI_RATE_LIMITER_UNAVAILABLE",
    });
    expect(client.destroyCalls).toBe(1);
    expect(client.isOpen).toBe(false);
  });
});
