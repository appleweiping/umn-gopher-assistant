import { describe, expect, it } from "vitest";

import {
  dpopReplayKeysForTesting,
  RedisDpopReplayStore,
  type RedisDpopReplayStoreOptions,
} from "../src/auth/dpop-replay-store.js";

const JKT = Buffer.alloc(32, 71).toString("base64url");
const JTI = "proof-jti-cluster-contract";

function hashTag(key: string): string | undefined {
  return /\{([^{}]+)\}/u.exec(key)?.[1];
}

describe("Redis DPoP replay and quota contract", () => {
  it("co-locates nonce, proof, and rate keys while sharding subject/key partitions", () => {
    const first = dpopReplayKeysForTesting("student-one", JKT, JTI);
    const second = dpopReplayKeysForTesting("student-two", JKT, JTI);
    const rotated = dpopReplayKeysForTesting("student-one", Buffer.alloc(32, 72).toString("base64url"), JTI);
    const firstTags = first.map(hashTag);

    expect(first).toHaveLength(3);
    expect(new Set(firstTags).size).toBe(1);
    expect(firstTags[0]).toMatch(/^dpop:[A-Za-z0-9_-]{43}$/u);
    expect(hashTag(second[0])).not.toBe(firstTags[0]);
    expect(rotated.map(hashTag)).toEqual(firstTags);
    expect(first.join("\n")).not.toContain("student-one");
    expect(first.join("\n")).not.toContain(JKT);
  });

  it("shares a proof budget across key rotation while isolating another subject", async () => {
    let now = 1_000_000;
    const { InMemoryDpopReplayStore } = await import("../src/auth/dpop-replay-store.js");
    const store = new InMemoryDpopReplayStore(30_000, 30_000, () => now, 1, 10_000);
    const rotatedJkt = Buffer.alloc(32, 73).toString("base64url");

    await expect(store.consume("student-one", JKT, "!", undefined)).resolves.toMatchObject({
      status: "challenge",
    });
    await expect(store.consume("student-one", rotatedJkt, "短", undefined)).resolves.toMatchObject({
      status: "rate_limited",
    });
    await expect(store.consume("student-two", rotatedJkt, "😀", undefined)).resolves.toMatchObject({
      status: "challenge",
    });
    now += 10_001;
    await expect(store.consume("student-one", rotatedJkt, "after-window", undefined)).resolves.toMatchObject({
      status: "challenge",
    });
  });

  it("maps a Redis quota decision without creating a service-unavailable error", async () => {
    let evaluatedKeys: readonly string[] = [];
    const client = {
      close: () => Promise.resolve(),
      connect: () => Promise.resolve(),
      eval: (_script: string, options: { readonly arguments: string[]; readonly keys: string[] }) => {
        evaluatedKeys = options.keys;
        return Promise.resolve([2, "19"]);
      },
      isOpen: true,
      isReady: true,
      on: () => undefined,
    };
    const options: RedisDpopReplayStoreOptions = {
      client,
      nonceTtlSeconds: 300,
      operationTimeoutMs: 1_000,
      proofLimit: 600,
      proofWindowSeconds: 60,
      redisUrl: new URL("redis://:test@127.0.0.1:6379"),
      replayTtlSeconds: 120,
    };
    const store = new RedisDpopReplayStore(options);

    await expect(store.consume("student-one", JKT, JTI, undefined)).resolves.toEqual({
      retryAfterSeconds: 19,
      status: "rate_limited",
    });
    expect(new Set(evaluatedKeys.map(hashTag)).size).toBe(1);
  });
});
