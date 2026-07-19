import { describe, expect, it } from "vitest";

import { BoundedFixedWindowRateLimiter, ConcurrencyGate, resolveClientAddress } from "../src/limits.js";

describe("MCP boundary limits", () => {
  it("bounds concurrent work and releases a lease exactly once", () => {
    const gate = new ConcurrencyGate(1);
    const release = gate.tryAcquire();

    expect(release).toBeTypeOf("function");
    expect(gate.active).toBe(1);
    expect(gate.tryAcquire()).toBeUndefined();

    release?.();
    release?.();
    expect(gate.active).toBe(0);
    expect(gate.tryAcquire()).toBeTypeOf("function");
  });

  it("enforces a fixed window, reports retry delay, and resets after expiry", () => {
    let now = 1_000;
    const limiter = new BoundedFixedWindowRateLimiter({
      maxEntries: 10,
      now: () => now,
      windowMs: 2_000,
    });

    expect(limiter.consume([{ key: "subject:a", limit: 2 }])).toMatchObject({ allowed: true });
    expect(limiter.consume([{ key: "subject:a", limit: 2 }])).toMatchObject({ allowed: true });
    expect(limiter.consume([{ key: "subject:a", limit: 2 }])).toEqual({
      allowed: false,
      retryAfterSeconds: 2,
    });

    now = 3_001;
    expect(limiter.consume([{ key: "subject:a", limit: 2 }])).toMatchObject({ allowed: true });
  });

  it("keeps subjects isolated and applies multi-key decisions atomically", () => {
    const limiter = new BoundedFixedWindowRateLimiter({
      maxEntries: 10,
      now: () => 5_000,
      windowMs: 60_000,
    });

    expect(limiter.consume([{ key: "subject:a", limit: 1 }])).toMatchObject({ allowed: true });
    expect(limiter.consume([{ key: "subject:b", limit: 1 }])).toMatchObject({ allowed: true });
    expect(
      limiter.consume([
        { key: "subject:c", limit: 2 },
        { key: "client:shared", limit: 1 },
      ]),
    ).toMatchObject({ allowed: true });
    expect(
      limiter.consume([
        { key: "subject:c", limit: 2 },
        { key: "client:shared", limit: 1 },
      ]),
    ).toMatchObject({ allowed: false });

    // The rejected multi-key decision must not consume the subject's second slot.
    expect(limiter.consume([{ key: "subject:c", limit: 2 }])).toMatchObject({ allowed: true });
  });

  it("stays memory-bounded, fails closed at capacity, and lazily removes expired keys", () => {
    let now = 0;
    const limiter = new BoundedFixedWindowRateLimiter({
      maxEntries: 2,
      now: () => now,
      windowMs: 1_000,
    });

    expect(limiter.consume([{ key: "network:a", limit: 1 }])).toMatchObject({ allowed: true });
    expect(limiter.consume([{ key: "network:b", limit: 1 }])).toMatchObject({ allowed: true });
    expect(limiter.size).toBe(2);
    expect(limiter.consume([{ key: "network:c", limit: 1 }])).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(limiter.size).toBe(2);

    now = 1_001;
    expect(limiter.consume([{ key: "network:c", limit: 1 }])).toMatchObject({ allowed: true });
    expect(limiter.size).toBe(1);
  });

  it("ignores forwarded addresses from untrusted peers and resolves a trusted proxy chain", () => {
    expect(resolveClientAddress("127.0.0.1", "198.51.100.10", new Set())).toBe("127.0.0.1");
    expect(
      resolveClientAddress("127.0.0.1", "198.51.100.10, 192.0.2.20", new Set(["127.0.0.1", "192.0.2.20"])),
    ).toBe("198.51.100.10");
    expect(() => resolveClientAddress("127.0.0.1", "not-an-address", new Set(["127.0.0.1"]))).toThrow(
      /forwarded/u,
    );
    expect(() =>
      resolveClientAddress("127.0.0.1", "2001:db8::1, 2001:0db8:0:0:0:0:0:1", new Set(["127.0.0.1"])),
    ).toThrow(/duplicate/iu);
  });
});
