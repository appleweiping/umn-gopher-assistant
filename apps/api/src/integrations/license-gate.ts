import type { LicenseStatus } from "@umn-gopher-assistant/contracts";

import { SourceLicenseDeniedError } from "./errors.js";
import type { IntegrationSourceDescriptor } from "./types.js";

export interface SourceLicenseDecision {
  readonly sourceId: string;
  readonly enabled: boolean;
  readonly licenseStatus: LicenseStatus;
  readonly reviewedAt: string;
}

export interface SourceLicenseGate {
  assertNetworkAllowed(source: IntegrationSourceDescriptor): void;
}

/**
 * Fail-closed license gate. A source must have an explicit enabled decision,
 * and that decision must still match the adapter's declared license class.
 */
export class StaticSourceLicenseGate implements SourceLicenseGate {
  readonly #decisions: ReadonlyMap<string, SourceLicenseDecision>;

  constructor(decisions: readonly SourceLicenseDecision[]) {
    this.#decisions = new Map(
      decisions.map((decision) => [decision.sourceId, Object.freeze({ ...decision })]),
    );
  }

  assertNetworkAllowed(source: IntegrationSourceDescriptor): void {
    const decision = this.#decisions.get(source.id);
    if (decision === undefined) {
      throw new SourceLicenseDeniedError(source.id, "no reviewed decision exists");
    }
    if (!decision.enabled) {
      throw new SourceLicenseDeniedError(source.id, "the reviewed decision is disabled");
    }
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(decision.reviewedAt) ||
      !Number.isFinite(Date.parse(decision.reviewedAt)) ||
      new Date(decision.reviewedAt).toISOString() !== decision.reviewedAt
    ) {
      throw new SourceLicenseDeniedError(source.id, "no canonical terms review timestamp exists");
    }
    if (decision.licenseStatus !== source.licenseStatus) {
      throw new SourceLicenseDeniedError(source.id, "the adapter and reviewed decision disagree");
    }
    if (decision.licenseStatus !== "LIVE_ONLY" && decision.licenseStatus !== "OPEN_REUSE") {
      throw new SourceLicenseDeniedError(
        source.id,
        `${decision.licenseStatus} does not permit a network fetch`,
      );
    }
  }
}
