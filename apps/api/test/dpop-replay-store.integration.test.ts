import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { RedisDpopReplayStore } from "../src/auth/dpop-replay-store.js";

const runRedisIntegration = process.env["DPOP_REDIS_INTEGRATION"] === "1";

describe.runIf(runRedisIntegration)("real Redis DPoP Lua integration", () => {
  it("atomically challenges, accepts, detects replay, quotas, and isolates partitions", async () => {
    const store = new RedisDpopReplayStore({
      nonceTtlSeconds: 30,
      operationTimeoutMs: 2_000,
      proofLimit: 3,
      proofWindowSeconds: 10,
      redisUrl: new URL(
        process.env["API_DPOP_REDIS_URL"] ?? "redis://:local-redis-password-only@127.0.0.1:6379",
      ),
      replayTtlSeconds: 30,
    });
    const subject = `redis-smoke-${randomUUID()}`;
    const jkt = Buffer.alloc(32, 81).toString("base64url");

    try {
      const challenge = await store.consume(subject, jkt, "redis-proof-jti-0001", undefined);
      expect(challenge.status).toBe("challenge");
      if (challenge.status !== "challenge") throw new Error("expected nonce challenge");

      await expect(store.consume(subject, jkt, "redis-proof-jti-0002", challenge.nonce)).resolves.toEqual({
        status: "accepted",
      });
      await expect(store.consume(subject, jkt, "redis-proof-jti-0002", challenge.nonce)).resolves.toEqual({
        status: "replay",
      });
      await expect(
        store.consume(subject, jkt, "redis-proof-jti-0003", challenge.nonce),
      ).resolves.toMatchObject({ status: "rate_limited" });
      await expect(
        store.consume(`${subject}-isolated`, jkt, "redis-proof-jti-0001", undefined),
      ).resolves.toMatchObject({ status: "challenge" });
    } finally {
      await store.onModuleDestroy();
    }
  });
});
