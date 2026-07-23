import { createHash } from "node:crypto";

import { createClient } from "redis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { RedisAiRateLimiter } from "../src/ai/ai-rate-limiter.js";

const redisUrl = process.env["API_AI_INTEGRATION_REDIS_URL"];
const describeWithRedis = redisUrl === undefined ? describe.skip : describe;
const globalKey = "uga:ai:{rate}:global";

function digest(label: string): string {
  return createHash("sha256").update(label).digest("base64url");
}

describeWithRedis("distributed AI rate limiter against Redis", () => {
  if (redisUrl === undefined) return;

  const administrativeClient = createClient({
    disableOfflineQueue: true,
    socket: { connectTimeout: 1_000, reconnectStrategy: false },
    url: redisUrl,
  });
  administrativeClient.on("error", () => undefined);
  const clientA = digest("real-redis-client-a");
  const clientB = digest("real-redis-client-b");
  const networkA = digest("real-redis-network-a");
  const clientKey = (client: string) => `uga:ai:{rate}:client:${client}`;
  const networkKey = (network: string) => `uga:ai:{rate}:network:${network}`;

  beforeEach(async () => {
    if (!administrativeClient.isOpen) await administrativeClient.connect();
    await administrativeClient.del([globalKey, clientKey(clientA), clientKey(clientB), networkKey(networkA)]);
  });

  afterAll(async () => {
    if (!administrativeClient.isOpen) return;
    await administrativeClient.del([globalKey, clientKey(clientA), clientKey(clientB), networkKey(networkA)]);
    administrativeClient.destroy();
  });

  it("does not let a client over its own quota consume the shared quota", async () => {
    const limiter = new RedisAiRateLimiter({
      clientLimit: 2,
      globalLimit: 4,
      networkLimit: 3,
      redisUrl: new URL(redisUrl),
      windowSeconds: 30,
    });

    await expect(limiter.consume(clientA, networkA)).resolves.toMatchObject({ allowed: true, remaining: 1 });
    await expect(limiter.consume(clientA, networkA)).resolves.toMatchObject({ allowed: true, remaining: 0 });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(limiter.consume(clientA, networkA)).resolves.toMatchObject({
        allowed: false,
        remaining: 0,
      });
    }

    expect(await administrativeClient.get(globalKey)).toBe("2");
    expect(await administrativeClient.get(networkKey(networkA))).toBe("2");
    await expect(limiter.consume(clientB, networkA)).resolves.toMatchObject({ allowed: true, remaining: 1 });
    await expect(limiter.consume(clientB, networkA)).resolves.toMatchObject({ allowed: false, remaining: 0 });
    expect(await administrativeClient.get(networkKey(networkA))).toBe("4");
    expect(await administrativeClient.get(globalKey)).toBe("3");
    expect(await administrativeClient.pTTL(globalKey)).toBeGreaterThan(0);

    await limiter.onModuleDestroy();
  });

  it("updates counters atomically under concurrent requests", async () => {
    const limiter = new RedisAiRateLimiter({
      clientLimit: 8,
      globalLimit: 8,
      networkLimit: 8,
      redisUrl: new URL(redisUrl),
      windowSeconds: 30,
    });

    const decisions = await Promise.all(
      Array.from({ length: 20 }, async () => await limiter.consume(clientA, networkA)),
    );
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(8);
    expect(await administrativeClient.get(globalKey)).toBe("8");
    expect(await administrativeClient.get(networkKey(networkA))).toBe("8");
    expect(await administrativeClient.get(clientKey(clientA))).toBe("20");

    await limiter.onModuleDestroy();
  });
});
