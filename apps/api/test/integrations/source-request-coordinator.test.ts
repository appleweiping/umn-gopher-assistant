import { describe, expect, it, vi } from "vitest";

import {
  SourceCircuitOpenError,
  SourceQueueSaturatedError,
  SourceQueueTimeoutError,
  SourceRateLimitedError,
  SourceRequestCoordinator,
} from "../../src/integrations/index.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("SourceRequestCoordinator", () => {
  it("single-flights identical requests, including while they are pending", async () => {
    const coordinator = new SourceRequestCoordinator();
    const operation = deferred<string>();
    const invoke = vi.fn(() => operation.promise);

    const first = coordinator.run("sessions", "UMNTC", invoke);
    const second = coordinator.run("sessions", "UMNTC", invoke);
    expect(second).toBe(first);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));

    operation.resolve("ok");
    await expect(first).resolves.toBe("ok");
    await Promise.resolve();
    expect(coordinator.run("sessions", "UMNTC", async () => "fresh")).not.toBe(first);
  });

  it("runs no more than two distinct operations per source", async () => {
    const coordinator = new SourceRequestCoordinator();
    const gates = [deferred<null>(), deferred<null>(), deferred<null>()];
    let active = 0;
    let maximumActive = 0;
    let started = 0;
    const operations = gates.map((gate, index) =>
      coordinator.run("events", `page-${String(index)}`, async () => {
        started += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await gate.promise;
        active -= 1;
      }),
    );

    await vi.waitFor(() => expect(started).toBe(2));
    expect(maximumActive).toBe(2);
    gates[0]?.resolve(null);
    await vi.waitFor(() => expect(started).toBe(3));
    gates[1]?.resolve(null);
    gates[2]?.resolve(null);
    await Promise.all(operations);
    expect(maximumActive).toBe(2);
  });

  it("keeps concurrency bulkheads independent per source", async () => {
    const coordinator = new SourceRequestCoordinator();
    const gate = deferred<null>();
    let active = 0;
    let maximumActive = 0;
    const operation = async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await gate.promise;
      active -= 1;
    };
    const pending = [
      coordinator.run("tc-events", "one", operation),
      coordinator.run("tc-events", "two", operation),
      coordinator.run("duluth-events", "one", operation),
      coordinator.run("duluth-events", "two", operation),
    ];
    await vi.waitFor(() => expect(maximumActive).toBe(4));
    gate.resolve(null);
    await Promise.all(pending);
  });

  it("rejects distinct work when a source queue reaches its hard bound", async () => {
    const coordinator = new SourceRequestCoordinator();
    const gate = deferred<null>();
    const pending = Array.from({ length: 34 }, (_, index) =>
      coordinator.run("events", `queued-${String(index)}`, async () => gate.promise),
    );

    expect(() => coordinator.run("events", "queue-overflow", async () => undefined)).toThrow(
      SourceQueueSaturatedError,
    );
    gate.resolve(null);
    await Promise.allSettled(pending);
  });

  it("limits upstream starts per source with a rolling one-minute budget", async () => {
    let now = 10_000;
    const coordinator = new SourceRequestCoordinator(() => now);
    for (let index = 0; index < 30; index += 1) {
      await coordinator.run("sessions", `request-${String(index)}`, async () => "ok");
    }

    expect(() => coordinator.run("sessions", "rate-limited", async () => "no")).toThrow(
      SourceRateLimitedError,
    );
    now += 59_999;
    expect(() => coordinator.run("sessions", "still-limited", async () => "no")).toThrow(
      SourceRateLimitedError,
    );
    now += 1;
    await expect(coordinator.run("sessions", "budget-restored", async () => "ok")).resolves.toBe("ok");
  });

  it("keeps rate budgets independent per source", async () => {
    const coordinator = new SourceRequestCoordinator(() => 42);
    for (let index = 0; index < 30; index += 1) {
      await coordinator.run("tc-events", `request-${String(index)}`, async () => "ok");
    }

    expect(() => coordinator.run("tc-events", "blocked", async () => "no")).toThrow(SourceRateLimitedError);
    await expect(coordinator.run("duluth-events", "allowed", async () => "ok")).resolves.toBe("ok");
  });

  it("rechecks a queued operation guard immediately before starting network work", async () => {
    const coordinator = new SourceRequestCoordinator();
    const firstGate = deferred<null>();
    const secondGate = deferred<null>();
    const first = coordinator.run("events", "first", async () => firstGate.promise);
    const second = coordinator.run("events", "second", async () => secondGate.promise);
    let allowed = true;
    const operation = vi.fn(async () => "must-not-run");
    const queued = coordinator.run("events", "queued", operation, () => {
      if (!allowed) throw new Error("source disabled while queued");
    });

    allowed = false;
    firstGate.resolve(null);
    await expect(queued).rejects.toThrow("source disabled while queued");
    expect(operation).not.toHaveBeenCalled();
    secondGate.resolve(null);
    await Promise.all([first, second]);
  });

  it("expires queued work before the web proxy timeout and never starts its operation", async () => {
    const coordinator = new SourceRequestCoordinator(Date.now, { maxQueueWaitMs: 5 });
    const firstGate = deferred<null>();
    const secondGate = deferred<null>();
    const first = coordinator.run("events", "first", async () => firstGate.promise);
    const second = coordinator.run("events", "second", async () => secondGate.promise);
    const operation = vi.fn(async () => "must-not-run");

    await expect(coordinator.run("events", "queued", operation)).rejects.toBeInstanceOf(
      SourceQueueTimeoutError,
    );
    expect(operation).not.toHaveBeenCalled();
    firstGate.resolve(null);
    secondGate.resolve(null);
    await Promise.all([first, second]);
  });

  it("hands an occupied slot directly to a waiter without exceeding the bulkhead", async () => {
    const coordinator = new SourceRequestCoordinator();
    const gates = [deferred<null>(), deferred<null>(), deferred<null>(), deferred<null>()];
    let active = 0;
    let maximumActive = 0;
    const run = (index: number) =>
      coordinator.run("events", `handoff-${String(index)}`, async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await gates[index]?.promise;
        active -= 1;
      });
    const first = run(0);
    const second = run(1);
    const queued = run(2);
    await vi.waitFor(() => expect(active).toBe(2));
    gates[0]?.resolve(null);
    const newcomer = run(3);
    await vi.waitFor(() => expect(active).toBe(2));
    gates[1]?.resolve(null);
    gates[2]?.resolve(null);
    gates[3]?.resolve(null);
    await Promise.all([first, second, queued, newcomer]);
    expect(maximumActive).toBe(2);
  });

  it("does not charge a denied pre-start guard to the upstream circuit", async () => {
    const coordinator = new SourceRequestCoordinator();
    for (let index = 0; index < 40; index += 1) {
      await expect(
        coordinator.run(
          "sessions",
          `denied-${String(index)}`,
          async () => "must-not-run",
          () => {
            throw new Error("policy denied");
          },
        ),
      ).rejects.toThrow("policy denied");
    }

    await expect(coordinator.run("sessions", "allowed", async () => "ok")).resolves.toBe("ok");
  });

  it("opens after three consecutive failures for exactly sixty seconds", async () => {
    let now = 1_000;
    const coordinator = new SourceRequestCoordinator(() => now);
    for (const key of ["one", "two", "three"]) {
      await expect(
        coordinator.run("sessions", key, async () => {
          throw new Error("upstream failed");
        }),
      ).rejects.toThrow("upstream failed");
    }

    expect(() => coordinator.run("sessions", "blocked", async () => "no")).toThrow(SourceCircuitOpenError);
    now += 59_999;
    expect(() => coordinator.run("sessions", "still-blocked", async () => "no")).toThrow(
      SourceCircuitOpenError,
    );
    now += 1;
    await expect(coordinator.run("sessions", "probe", async () => "recovered")).resolves.toBe("recovered");
    await expect(coordinator.run("sessions", "normal", async () => "normal")).resolves.toBe("normal");
  });

  it("permits only one half-open probe and reopens on probe failure", async () => {
    let now = 0;
    const coordinator = new SourceRequestCoordinator(() => now);
    for (let index = 0; index < 3; index += 1) {
      await coordinator
        .run("events", `failure-${String(index)}`, async () => Promise.reject(new Error("x")))
        .catch(() => undefined);
    }
    now = 60_000;
    const probe = deferred<null>();
    const first = coordinator.run("events", "probe", () => probe.promise);
    const competing = coordinator.run("events", "other", async () => undefined);
    await expect(competing).rejects.toBeInstanceOf(SourceCircuitOpenError);
    probe.reject(new Error("probe failed"));
    await expect(first).rejects.toThrow("probe failed");
    expect(() => coordinator.run("events", "blocked-again", async () => undefined)).toThrow(
      SourceCircuitOpenError,
    );
  });

  it("resets the consecutive-failure count after a success", async () => {
    let now = 0;
    const coordinator = new SourceRequestCoordinator(() => now);
    for (const key of ["failure-1", "failure-2"]) {
      await coordinator.run("source", key, async () => Promise.reject(new Error("x"))).catch(() => undefined);
    }
    await coordinator.run("source", "success", async () => "ok");
    for (const key of ["failure-3", "failure-4"]) {
      await coordinator.run("source", key, async () => Promise.reject(new Error("x"))).catch(() => undefined);
    }
    now += 1;
    await expect(coordinator.run("source", "not-open", async () => "ok")).resolves.toBe("ok");
  });
});
