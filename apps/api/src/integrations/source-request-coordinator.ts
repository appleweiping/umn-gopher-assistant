import {
  SourceCircuitOpenError,
  SourceQueueSaturatedError,
  SourceQueueTimeoutError,
  SourceRateLimitedError,
} from "./errors.js";

const MAX_CONCURRENCY_PER_SOURCE = 2;
const MAX_QUEUED_PER_SOURCE = 32;
const DEFAULT_MAX_QUEUE_WAIT_MS = 2_000;
const MAX_STARTS_PER_WINDOW = 30;
const RATE_WINDOW_MS = 60_000;
const FAILURE_THRESHOLD = 3;
const OPEN_DURATION_MS = 60_000;

interface SourceWaiter {
  start(): void;
}

interface SourceState {
  active: number;
  readonly waiting: SourceWaiter[];
  readonly inFlight: Map<string, Promise<unknown>>;
  readonly recentStartTimesMs: number[];
  consecutiveFailures: number;
  openUntilMs: number;
  halfOpenProbeRunning: boolean;
}

function newSourceState(): SourceState {
  return {
    active: 0,
    waiting: [],
    inFlight: new Map(),
    recentStartTimesMs: [],
    consecutiveFailures: 0,
    openUntilMs: 0,
    halfOpenProbeRunning: false,
  };
}

/**
 * Per-source bulkhead, request coalescer and circuit breaker.
 *
 * - at most two distinct upstream operations execute per source;
 * - at most thirty-two distinct operations wait per source;
 * - at most thirty upstream operations start per source per rolling minute;
 * - the same request key shares one Promise (including while queued);
 * - an optional dynamic guard is re-evaluated after acquiring a slot and
 *   immediately before an upstream start;
 * - three consecutive operation failures open the source for sixty seconds;
 * - after the cooldown, exactly one half-open probe may execute.
 */
export class SourceRequestCoordinator {
  readonly #maxQueueWaitMs: number;
  readonly #states = new Map<string, SourceState>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now, options: { readonly maxQueueWaitMs?: number } = {}) {
    this.#now = now;
    this.#maxQueueWaitMs = options.maxQueueWaitMs ?? DEFAULT_MAX_QUEUE_WAIT_MS;
    if (
      !Number.isSafeInteger(this.#maxQueueWaitMs) ||
      this.#maxQueueWaitMs < 1 ||
      this.#maxQueueWaitMs > 30_000
    ) {
      throw new RangeError("maxQueueWaitMs must be an integer from 1 through 30000");
    }
  }

  run<T>(
    sourceId: string,
    requestKey: string,
    operation: () => Promise<T>,
    beforeStart?: () => void,
  ): Promise<T> {
    if (sourceId.length === 0 || requestKey.length === 0) {
      throw new TypeError("sourceId and requestKey must be non-empty");
    }
    const state = this.#state(sourceId);
    const existing = state.inFlight.get(requestKey);
    if (existing !== undefined) return existing as Promise<T>;

    this.#assertMayQueue(sourceId, state);
    const pending = this.#execute(sourceId, state, operation, beforeStart);
    state.inFlight.set(requestKey, pending);
    const remove = () => {
      if (state.inFlight.get(requestKey) === pending) state.inFlight.delete(requestKey);
    };
    void pending.then(remove, remove);
    return pending;
  }

  #state(sourceId: string): SourceState {
    const existing = this.#states.get(sourceId);
    if (existing !== undefined) return existing;
    const created = newSourceState();
    this.#states.set(sourceId, created);
    return created;
  }

  #assertMayQueue(sourceId: string, state: SourceState): void {
    const now = this.#now();
    if (state.openUntilMs > now) {
      throw new SourceCircuitOpenError(sourceId, new Date(state.openUntilMs));
    }
    if (state.openUntilMs !== 0 && state.halfOpenProbeRunning) {
      throw new SourceCircuitOpenError(sourceId, new Date(Math.max(state.openUntilMs, now + 1)));
    }
    this.#assertWithinRateBudget(sourceId, state, now, false);
    if (state.active >= MAX_CONCURRENCY_PER_SOURCE && state.waiting.length >= MAX_QUEUED_PER_SOURCE) {
      throw new SourceQueueSaturatedError(sourceId);
    }
  }

  async #acquire(sourceId: string, state: SourceState): Promise<void> {
    if (state.active < MAX_CONCURRENCY_PER_SOURCE) {
      state.active += 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        const index = state.waiting.indexOf(waiter);
        if (index >= 0) state.waiting.splice(index, 1);
        reject(new SourceQueueTimeoutError(sourceId));
      }, this.#maxQueueWaitMs);
      const waiter: SourceWaiter = {
        start: () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve();
        },
      };
      state.waiting.push(waiter);
    });
  }

  #release(state: SourceState): void {
    const successor = state.waiting.shift();
    if (successor !== undefined) {
      // Transfer the occupied slot directly. Decrementing before the queued
      // continuation resumes would allow a new caller to steal the slot and
      // briefly exceed the concurrency bulkhead.
      successor.start();
      return;
    }
    state.active -= 1;
  }

  #beginOperation(sourceId: string, state: SourceState): boolean {
    const now = this.#now();
    if (state.openUntilMs > now) {
      throw new SourceCircuitOpenError(sourceId, new Date(state.openUntilMs));
    }
    if (state.openUntilMs !== 0) {
      if (state.halfOpenProbeRunning) {
        throw new SourceCircuitOpenError(sourceId, new Date(Math.max(state.openUntilMs, now + 1)));
      }
      this.#assertWithinRateBudget(sourceId, state, now, true);
      state.halfOpenProbeRunning = true;
      return true;
    }
    this.#assertWithinRateBudget(sourceId, state, now, true);
    return false;
  }

  #assertWithinRateBudget(sourceId: string, state: SourceState, now: number, consume: boolean): void {
    while (
      state.recentStartTimesMs.length > 0 &&
      now - (state.recentStartTimesMs[0] ?? now) >= RATE_WINDOW_MS
    ) {
      state.recentStartTimesMs.shift();
    }
    if (state.recentStartTimesMs.length >= MAX_STARTS_PER_WINDOW) {
      const oldest = state.recentStartTimesMs[0] ?? now;
      throw new SourceRateLimitedError(sourceId, new Date(oldest + RATE_WINDOW_MS));
    }
    if (consume) state.recentStartTimesMs.push(now);
  }

  #recordSuccess(state: SourceState): void {
    state.consecutiveFailures = 0;
    state.openUntilMs = 0;
    state.halfOpenProbeRunning = false;
  }

  #recordFailure(state: SourceState, wasHalfOpenProbe: boolean): void {
    state.halfOpenProbeRunning = false;
    state.consecutiveFailures = wasHalfOpenProbe ? FAILURE_THRESHOLD : state.consecutiveFailures + 1;
    if (state.consecutiveFailures >= FAILURE_THRESHOLD) {
      state.openUntilMs = this.#now() + OPEN_DURATION_MS;
    }
  }

  async #execute<T>(
    sourceId: string,
    state: SourceState,
    operation: () => Promise<T>,
    beforeStart?: () => void,
  ): Promise<T> {
    await this.#acquire(sourceId, state);
    let halfOpenProbe = false;
    try {
      // Policy and runtime switches can change while an operation is queued.
      // Run this outside the failure accounting so a local denial neither
      // consumes upstream rate budget nor trips the upstream circuit breaker.
      beforeStart?.();
      halfOpenProbe = this.#beginOperation(sourceId, state);
      try {
        const result = await operation();
        this.#recordSuccess(state);
        return result;
      } catch (error) {
        this.#recordFailure(state, halfOpenProbe);
        throw error;
      }
    } finally {
      this.#release(state);
    }
  }
}
