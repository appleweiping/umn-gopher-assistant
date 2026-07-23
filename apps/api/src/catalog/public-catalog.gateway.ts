import { sources } from "@umn-gopher-assistant/config";
import type { CampusId, SourceDescriptor, SourceResourceKind } from "@umn-gopher-assistant/contracts";

import {
  LiveWhaleEventsAdapter,
  SafeJsonFetcher,
  SourceLicenseDeniedError,
  SourceRequestCoordinator,
  StaticSourceLicenseGate,
  UmnSessionsAdapter,
  type CampusSourceResult,
  type IntegrationFetch,
  type LiveWhaleEventsPageResult,
  type UmnAcademicSession,
} from "../integrations/index.js";

export const PUBLIC_CATALOG_GATEWAY = Symbol("PUBLIC_CATALOG_GATEWAY");

export interface PublicCatalogGateway {
  fetchEvents(campusId: CampusId, page: number, signal?: AbortSignal): Promise<LiveWhaleEventsPageResult>;
  fetchSessions(
    campusId: CampusId,
    termIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<CampusSourceResult<UmnAcademicSession>>;
  source(campusId: CampusId, resourceKind: "ACADEMIC_SESSION" | "PUBLIC_EVENT"): SourceDescriptor;
}

export interface ConfiguredPublicCatalogGatewayOptions {
  readonly fetch?: IntegrationFetch;
  readonly now?: () => Date;
  readonly sourceRegistry?: readonly SourceDescriptor[];
  readonly sourceSwitchResolver?: SourceSwitchResolver;
  readonly upstreamTimeoutMs?: number;
}

const MAX_REVIEW_AGE_MS = 366 * 24 * 60 * 60 * 1_000;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

function currentReviewTimestamp(descriptor: SourceDescriptor, now: Date): string | null {
  const reviewedAt = descriptor.termsReviewedAt;
  const expiresAt = descriptor.termsReviewExpiresAt;
  if (reviewedAt === null || expiresAt === null) return null;
  const reviewedAtMs = Date.parse(reviewedAt);
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(reviewedAtMs) || !Number.isFinite(expiresAtMs)) return null;
  const ageMs = now.getTime() - reviewedAtMs;
  return ageMs >= -MAX_FUTURE_CLOCK_SKEW_MS && ageMs <= MAX_REVIEW_AGE_MS && now.getTime() < expiresAtMs
    ? reviewedAt
    : null;
}

function hasCurrentReview(descriptor: SourceDescriptor, now: Date): boolean {
  return currentReviewTimestamp(descriptor, now) !== null;
}

export interface SourceSwitchResolver {
  isEnabled(descriptor: SourceDescriptor): boolean;
}

export function sourceSwitchEnvironmentName(descriptor: SourceDescriptor): string {
  return `API_${descriptor.killSwitch.key.replaceAll(/[^A-Za-z0-9]/gu, "_").toUpperCase()}`;
}

/** Reads each request so a supervised runtime can change the switch without rebuilding adapters. */
export class EnvironmentSourceSwitchResolver implements SourceSwitchResolver {
  readonly #environment: () => Readonly<Record<string, string | undefined>>;

  constructor(environment: () => Readonly<Record<string, string | undefined>> = () => process.env) {
    this.#environment = environment;
  }

  isEnabled(descriptor: SourceDescriptor): boolean {
    const override = this.#environment()[sourceSwitchEnvironmentName(descriptor)];
    if (override === undefined) return descriptor.killSwitch.defaultState === "ENABLED";
    if (override === "ENABLED") return true;
    if (override === "DISABLED") return false;
    // A malformed safety switch must never fall through to an enabled default.
    return false;
  }
}

function sourceKey(campusId: CampusId, resourceKind: SourceResourceKind): string {
  return `${resourceKind}:${campusId}`;
}

/**
 * Owns the fail-closed join between reviewed source policy and concrete adapters.
 * A descriptor that is disabled, deep-link-only, unapproved, prohibited, or has
 * no allowlisted adapter is rejected before the transport can be invoked.
 */
export class ConfiguredPublicCatalogGateway implements PublicCatalogGateway {
  readonly #eventsAdapters: ReadonlyMap<CampusId, LiveWhaleEventsAdapter>;
  readonly #now: () => Date;
  readonly #sessionAdapters: ReadonlyMap<CampusId, UmnSessionsAdapter>;
  readonly #sourcesByKey: ReadonlyMap<string, SourceDescriptor>;
  readonly #sourceSwitchResolver: SourceSwitchResolver;

  constructor(options: ConfiguredPublicCatalogGatewayOptions = {}) {
    const sourceRegistry = options.sourceRegistry ?? sources;
    this.#now = options.now ?? (() => new Date());
    this.#sourceSwitchResolver = options.sourceSwitchResolver ?? new EnvironmentSourceSwitchResolver();
    const sourcesByKey = new Map<string, SourceDescriptor>();
    for (const descriptor of sourceRegistry) {
      for (const resourceKind of descriptor.resourceKinds) {
        if (resourceKind !== "ACADEMIC_SESSION" && resourceKind !== "PUBLIC_EVENT") continue;
        for (const campusId of descriptor.campusIds) {
          const key = sourceKey(campusId, resourceKind);
          if (sourcesByKey.has(key)) {
            throw new Error(`Duplicate catalog source policy for ${key}`);
          }
          sourcesByKey.set(key, descriptor);
        }
      }
    }
    this.#sourcesByKey = sourcesByKey;

    const fetcher = new SafeJsonFetcher({
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      now: this.#now,
      timeoutMs: options.upstreamTimeoutMs ?? 12_000,
    });
    const coordinator = new SourceRequestCoordinator();
    const licenseGate = new StaticSourceLicenseGate(
      sourceRegistry
        .filter((descriptor) =>
          descriptor.resourceKinds.some(
            (resourceKind) => resourceKind === "ACADEMIC_SESSION" || resourceKind === "PUBLIC_EVENT",
          ),
        )
        .flatMap((descriptor) => {
          const reviewedAt = currentReviewTimestamp(descriptor, this.#now());
          return reviewedAt === null
            ? []
            : [
                {
                  enabled: true,
                  licenseStatus: descriptor.licenseStatus,
                  reviewedAt,
                  sourceId: descriptor.id,
                },
              ];
        }),
    );

    this.#sessionAdapters = new Map(
      (["tc", "duluth", "crookston", "morris", "rochester"] as const).map((campusId) => [
        campusId,
        new UmnSessionsAdapter({
          campusId,
          coordinator,
          fetcher,
          licenseGate,
          networkGuard: () => this.#assertNetworkEnabled(this.source(campusId, "ACADEMIC_SESSION")),
        }),
      ]),
    );
    this.#eventsAdapters = new Map(
      (["tc", "duluth"] as const).map((campusId) => [
        campusId,
        new LiveWhaleEventsAdapter({
          campusId,
          coordinator,
          fetcher,
          licenseGate,
          networkGuard: () => this.#assertNetworkEnabled(this.source(campusId, "PUBLIC_EVENT")),
        }),
      ]),
    );
  }

  source(campusId: CampusId, resourceKind: "ACADEMIC_SESSION" | "PUBLIC_EVENT"): SourceDescriptor {
    const descriptor = this.#sourcesByKey.get(sourceKey(campusId, resourceKind));
    if (descriptor === undefined) {
      throw new Error(`Catalog source policy is missing for ${resourceKind}:${campusId}`);
    }
    return descriptor;
  }

  fetchSessions(
    campusId: CampusId,
    termIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<CampusSourceResult<UmnAcademicSession>> {
    const descriptor = this.source(campusId, "ACADEMIC_SESSION");
    this.#assertNetworkEnabled(descriptor);
    const adapter = this.#sessionAdapters.get(campusId);
    if (adapter === undefined) {
      throw new SourceLicenseDeniedError(descriptor.id, "no reviewed adapter is available");
    }
    return adapter.fetch({ termIds }, signal);
  }

  fetchEvents(campusId: CampusId, page: number, signal?: AbortSignal): Promise<LiveWhaleEventsPageResult> {
    const descriptor = this.source(campusId, "PUBLIC_EVENT");
    this.#assertNetworkEnabled(descriptor);
    const adapter = this.#eventsAdapters.get(campusId);
    if (adapter === undefined) {
      throw new SourceLicenseDeniedError(descriptor.id, "no reviewed adapter is available");
    }
    return adapter.fetch({ page }, signal);
  }

  #assertNetworkEnabled(descriptor: SourceDescriptor): void {
    let enabled = false;
    try {
      enabled = this.#sourceSwitchResolver.isEnabled(descriptor);
    } catch {
      enabled = false;
    }
    if (!enabled) {
      throw new SourceLicenseDeniedError(descriptor.id, "the source kill switch is disabled");
    }
    if (descriptor.licenseStatus !== "LIVE_ONLY" && descriptor.licenseStatus !== "OPEN_REUSE") {
      throw new SourceLicenseDeniedError(
        descriptor.id,
        `${descriptor.licenseStatus} permits an official deep link only`,
      );
    }
    if (!hasCurrentReview(descriptor, this.#now())) {
      throw new SourceLicenseDeniedError(descriptor.id, "the source terms review is missing or expired");
    }
  }
}
