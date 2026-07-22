import type { SourceObservation } from "@umn-gopher-assistant/contracts";

export const SOURCE_OBSERVATION_SINK = Symbol("SOURCE_OBSERVATION_SINK");

export interface SourceObservationSink {
  record(observation: SourceObservation): void;
}

/**
 * Bounded operational evidence only. Source bodies and normalized records are
 * structurally absent from the sink contract and therefore cannot be retained.
 */
export class BoundedSourceObservationSink implements SourceObservationSink {
  readonly #capacity: number;
  readonly #observations: SourceObservation[] = [];

  constructor(capacity = 1_000) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 100_000) {
      throw new RangeError("observation sink capacity must be between 1 and 100000");
    }
    this.#capacity = capacity;
  }

  record(observation: SourceObservation): void {
    this.#observations.push(Object.freeze({ ...observation }));
    if (this.#observations.length > this.#capacity) this.#observations.shift();
  }

  recent(): readonly SourceObservation[] {
    return Object.freeze([...this.#observations]);
  }
}
