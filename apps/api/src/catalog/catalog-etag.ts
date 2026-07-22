import { createEntityTag } from "../http/entity-tag.js";
import type { CatalogPage } from "./public-catalog.service.js";

function withoutKeys(
  value: Readonly<Record<string, unknown>>,
  excluded: ReadonlySet<string>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.has(key)));
}

const ITEM_VOLATILE_FIELDS = new Set(["observedAt", "sourceObservationId"]);
const OBSERVATION_VOLATILE_FIELDS = new Set(["durationMs", "observationId", "observedAt"]);

/**
 * Weak validators intentionally ignore fetch timing and generated observation
 * IDs while retaining every source/content digest and normalized public field.
 */
export function createCatalogPageEntityTag(page: CatalogPage<object>): string {
  const semanticRepresentation = {
    items: page.items.map((item) =>
      withoutKeys(item as Readonly<Record<string, unknown>>, ITEM_VOLATILE_FIELDS),
    ),
    nextCursor: page.nextCursor,
    range: page.range,
    retrievalCoverage: page.retrievalCoverage,
    sourceObservations: page.sourceObservations.map((observation) =>
      withoutKeys(observation, OBSERVATION_VOLATILE_FIELDS),
    ),
  };
  return `W/${createEntityTag(semanticRepresentation)}`;
}
