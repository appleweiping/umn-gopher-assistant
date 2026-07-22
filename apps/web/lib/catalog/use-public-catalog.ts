"use client";

import type {
  AcademicSession,
  CampusId,
  PublicEvent,
  SourceObservation,
} from "@umn-gopher-assistant/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { CatalogRequestError, fetchCatalogPage, type CatalogPage, type CatalogResource } from "./client";

export const liveEventCampuses = new Set<CampusId>(["tc", "duluth"]);

type StoredCatalogResourceState<T extends AcademicSession | PublicEvent> =
  | { readonly campusId: CampusId; readonly status: "loading" }
  | {
      readonly campusId: CampusId;
      readonly loadMoreError?: Error;
      readonly loadingMore: boolean;
      readonly page: CatalogPage<T>;
      readonly status: "ready";
    }
  | {
      readonly campusId: CampusId;
      readonly error?: CatalogRequestError;
      readonly reason: "DEEPLINK_ONLY" | "UNAVAILABLE";
      readonly status: "unavailable";
    };

export type CatalogResourceState<T extends AcademicSession | PublicEvent> =
  | Exclude<StoredCatalogResourceState<T>, { readonly status: "ready" }>
  | {
      readonly campusId: CampusId;
      readonly loadMore: () => void;
      readonly loadMoreError?: Error;
      readonly loadingMore: boolean;
      readonly page: CatalogPage<T>;
      readonly status: "ready";
    };

function stableItemContent(item: AcademicSession | PublicEvent): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(item).filter(([key]) => key !== "observedAt" && key !== "sourceObservationId"),
    ),
  );
}

function mergePages<T extends AcademicSession | PublicEvent>(
  current: CatalogPage<T>,
  next: CatalogPage<T>,
): CatalogPage<T> {
  if (current.range.from !== next.range.from || current.range.to !== next.range.to) {
    throw new TypeError("A catalog continuation changed its requested date range");
  }
  const itemsById = new Map(current.items.map((item) => [item.id, item] as const));
  const uniqueNextItems: T[] = [];
  for (const item of next.items) {
    const existing = itemsById.get(item.id);
    if (existing !== undefined) {
      if (stableItemContent(existing) !== stableItemContent(item)) {
        throw new TypeError("A catalog continuation repeated an item ID with conflicting content");
      }
      continue;
    }
    itemsById.set(item.id, item);
    uniqueNextItems.push(item);
  }
  const observations = new Map<string, SourceObservation>();
  for (const observation of [...current.sourceObservations, ...next.sourceObservations]) {
    const existing = observations.get(observation.observationId);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(observation)) {
      throw new TypeError("A catalog continuation reused a provenance ID with different evidence");
    }
    observations.set(observation.observationId, observation);
  }
  return {
    items: [...current.items, ...uniqueNextItems],
    nextCursor: next.nextCursor,
    range: current.range,
    retrievalCoverage: next.retrievalCoverage,
    sourceObservations: [...observations.values()],
  };
}

function useCatalogResource<T extends AcademicSession | PublicEvent>(
  resource: CatalogResource,
  campusId: CampusId,
  enabled: boolean,
): CatalogResourceState<T> {
  const generation = useRef(0);
  const continuationController = useRef<AbortController | null>(null);
  const [state, setState] = useState<StoredCatalogResourceState<T>>(
    enabled ? { campusId, status: "loading" } : { campusId, reason: "DEEPLINK_ONLY", status: "unavailable" },
  );

  useEffect(() => {
    generation.current += 1;
    const currentGeneration = generation.current;
    continuationController.current?.abort(new DOMException("Campus changed", "AbortError"));
    continuationController.current = null;
    if (!enabled) {
      setState({ campusId, reason: "DEEPLINK_ONLY", status: "unavailable" });
      return;
    }

    const controller = new AbortController();
    setState({ campusId, status: "loading" });
    const request =
      resource === "events"
        ? fetchCatalogPage("events", campusId, { signal: controller.signal })
        : fetchCatalogPage("sessions", campusId, { signal: controller.signal });
    void request.then(
      (page) => {
        if (generation.current !== currentGeneration || controller.signal.aborted) return;
        setState({ campusId, loadingMore: false, page: page as CatalogPage<T>, status: "ready" });
      },
      (error: unknown) => {
        if (generation.current !== currentGeneration || controller.signal.aborted) return;
        setState({
          campusId,
          ...(error instanceof CatalogRequestError ? { error } : {}),
          reason: "UNAVAILABLE",
          status: "unavailable",
        });
      },
    );
    return () => {
      controller.abort(new DOMException("Campus changed", "AbortError"));
      continuationController.current?.abort(new DOMException("Catalog view closed", "AbortError"));
      continuationController.current = null;
    };
  }, [campusId, enabled, resource]);

  const loadMore = useCallback(() => {
    if (state.status !== "ready" || state.loadingMore || state.page.nextCursor === null) return;
    const currentGeneration = generation.current;
    const controller = new AbortController();
    continuationController.current?.abort(new DOMException("Superseded", "AbortError"));
    continuationController.current = controller;
    const cursor = state.page.nextCursor;
    const window = { from: state.page.range.from, to: state.page.range.to };
    setState({ campusId: state.campusId, loadingMore: true, page: state.page, status: "ready" });
    const request =
      resource === "events"
        ? fetchCatalogPage("events", campusId, { cursor, signal: controller.signal, window })
        : fetchCatalogPage("sessions", campusId, { cursor, signal: controller.signal, window });
    void request.then(
      (page) => {
        if (generation.current !== currentGeneration || controller.signal.aborted) return;
        setState((current) => {
          if (current.status !== "ready" || current.campusId !== campusId) return current;
          try {
            return {
              campusId,
              loadingMore: false,
              page: mergePages(current.page, page as CatalogPage<T>),
              status: "ready",
            };
          } catch (error) {
            return {
              ...current,
              loadMoreError: error instanceof Error ? error : new Error("Catalog continuation failed"),
              loadingMore: false,
            };
          }
        });
      },
      (error: unknown) => {
        if (generation.current !== currentGeneration || controller.signal.aborted) return;
        setState((current) =>
          current.status === "ready" && current.campusId === campusId
            ? {
                ...current,
                loadMoreError: error instanceof Error ? error : new Error("Catalog continuation failed"),
                loadingMore: false,
              }
            : current,
        );
      },
    );
  }, [campusId, resource, state]);

  if (state.campusId !== campusId) {
    return enabled
      ? { campusId, status: "loading" }
      : { campusId, reason: "DEEPLINK_ONLY", status: "unavailable" };
  }
  return state.status === "ready" ? { ...state, loadMore } : state;
}

export function usePublicCatalog(campusId: CampusId): {
  readonly events: CatalogResourceState<PublicEvent>;
  readonly sessions: CatalogResourceState<AcademicSession>;
} {
  return {
    events: useCatalogResource<PublicEvent>("events", campusId, liveEventCampuses.has(campusId)),
    sessions: useCatalogResource<AcademicSession>("sessions", campusId, true),
  };
}
