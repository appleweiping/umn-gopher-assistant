"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import type { AcademicSession, PublicEvent } from "@umn-gopher-assistant/contracts";

import { observationForItem } from "../lib/catalog/client";
import {
  eventDateLabel,
  freshnessForObservation,
  observedAtLabel,
  officialCatalogSource,
  sessionDateLabel,
} from "../lib/catalog/presentation";
import { usePublicCatalog } from "../lib/catalog/use-public-catalog";
import { demoRecords, type DemoRecord, type Freshness, type LocalizedText } from "../lib/data/registry";
import { filterExploreItems, type ExploreItem, type ExploreType } from "../lib/explore";
import { usePreferences } from "./preferences";
import { SourceBadge } from "./ui";

const types: readonly ExploreType[] = ["place", "service", "event", "course"];

function typeForKind(kind: DemoRecord["kind"]): ExploreType {
  if (kind === "map") return "place";
  if (kind === "events") return "event";
  if (kind === "calendar") return "course";
  return "service";
}

type ResultOrigin = "event" | "official-link" | "session";

interface CatalogExploreItem extends ExploreItem {
  readonly description: string;
  readonly freshness: Freshness;
  readonly origin: ResultOrigin;
  readonly sourceLabel: LocalizedText;
  readonly sourceUrl: string;
  readonly updatedLabel: LocalizedText;
}

function localized(value: string): LocalizedText {
  return { en: value, "zh-CN": value };
}

function staticItem(record: DemoRecord, locale: "en" | "zh-CN"): CatalogExploreItem {
  return {
    campus: record.campus,
    description:
      locale === "zh-CN"
        ? "官方站外入口；本应用未核验当前状态。"
        : "Official external entry; current status is not checked by this app.",
    freshness: "unknown",
    id: `official:${record.id}`,
    openNow: false,
    origin: "official-link",
    sourceLabel: record.source.label,
    sourceUrl: record.source.url,
    title: record.title,
    type: typeForKind(record.kind),
    updatedLabel: {
      en: "not observed by this app",
      "zh-CN": "本应用未采集状态",
    },
  };
}

function eventItem(event: PublicEvent, observationLabel: string, locale: "en" | "zh-CN"): CatalogExploreItem {
  const source = officialCatalogSource(event.campusId, "events", locale);
  const description = [
    eventDateLabel(event, locale),
    event.location?.name ?? event.location?.address ?? undefined,
  ]
    .filter((value): value is string => value !== undefined)
    .join(" · ");
  return {
    campus: event.campusId,
    description,
    freshness: "fresh",
    id: `event:${event.id}`,
    openNow: false,
    origin: "event",
    sourceLabel: localized(source.label),
    sourceUrl: event.canonicalUrl,
    title: localized(event.title),
    type: "event",
    updatedLabel: localized(observationLabel),
  };
}

function sessionItem(
  session: AcademicSession,
  observationLabel: string,
  locale: "en" | "zh-CN",
): CatalogExploreItem {
  const source = officialCatalogSource(session.campusId, "sessions", locale);
  return {
    campus: session.campusId,
    description: sessionDateLabel(session, locale),
    freshness: "fresh",
    id: `session:${session.id}`,
    openNow: false,
    origin: "session",
    sourceLabel: localized(source.label),
    sourceUrl: source.url,
    title: localized(session.name),
    type: "course",
    updatedLabel: localized(observationLabel),
  };
}

export function ExploreWorkspace() {
  const t = useTranslations("explore");
  const tCatalog = useTranslations("catalog");
  const tCommon = useTranslations("common");
  const searchParams = useSearchParams();
  const { campus, locale } = usePreferences();
  const catalog = usePublicCatalog(campus);
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [selectedTypes, setSelectedTypes] = useState<readonly ExploreType[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => setQuery(searchParams.get("q") ?? ""), [searchParams]);

  const requestedKind = searchParams.get("kind");
  const sourceRecords = useMemo(
    () =>
      demoRecords.filter(
        (record) => record.campus === campus && (requestedKind !== "service" || record.kind === "service"),
      ),
    [campus, requestedKind],
  );
  const eventPage = catalog.events.status === "ready" ? catalog.events.page : undefined;
  const sessionPage = catalog.sessions.status === "ready" ? catalog.sessions.page : undefined;
  const items = useMemo(() => {
    const combined: CatalogExploreItem[] = sourceRecords.map((record) => staticItem(record, locale));
    if (requestedKind === "service") return combined;
    if (eventPage !== undefined) {
      combined.push(
        ...eventPage.items.map((event) => {
          const observation = observationForItem(eventPage, event);
          const item = eventItem(event, observedAtLabel(observation, locale), locale);
          return { ...item, freshness: freshnessForObservation(observation.freshnessState) };
        }),
      );
    }
    if (sessionPage !== undefined) {
      combined.push(
        ...sessionPage.items.map((session) => {
          const observation = observationForItem(sessionPage, session);
          const item = sessionItem(session, observedAtLabel(observation, locale), locale);
          return { ...item, freshness: freshnessForObservation(observation.freshnessState) };
        }),
      );
    }
    return combined;
  }, [eventPage, locale, requestedKind, sessionPage, sourceRecords]);
  const results = filterExploreItems(items, {
    campus,
    locale,
    onlyOpen: false,
    query,
    types: selectedTypes,
  });
  const selected = selectedId === null ? undefined : items.find((record) => record.id === selectedId);
  const mapLinks = sourceRecords.filter((record) => record.kind === "map");
  const typeLabels: Record<ExploreType, string> =
    locale === "zh-CN"
      ? { place: "地点", service: "服务", event: "活动", course: "学期" }
      : { place: "Places", service: "Services", event: "Events", course: "Sessions" };

  const toggleType = (type: ExploreType) =>
    setSelectedTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );

  const partial = [catalog.events, catalog.sessions].some(
    (state) =>
      state.status === "ready" &&
      (state.page.nextCursor !== null ||
        state.page.retrievalCoverage.nextUpstreamPage !== null ||
        state.page.retrievalCoverage.truncatedByPolicy),
  );

  return (
    <div className="explore-workspace">
      <aside aria-label={t("types")} className="filter-panel">
        <label htmlFor="explore-query">{t("query")}</label>
        <input
          id="explore-query"
          onChange={(event) => setQuery(event.target.value)}
          type="search"
          value={query}
        />
        <fieldset>
          <legend>{t("types")}</legend>
          {types.map((type) => (
            <label className="check-row" key={type}>
              <input
                checked={selectedTypes.includes(type)}
                onChange={() => toggleType(type)}
                type="checkbox"
              />
              {typeLabels[type]}
            </label>
          ))}
        </fieldset>
        <p className="fine-print">{t("openStatusNote")}</p>
        <button
          className="button button-quiet"
          onClick={() => {
            setQuery("");
            setSelectedTypes([]);
          }}
          type="button"
        >
          {t("clearFilters")}
        </button>
      </aside>

      <section aria-labelledby="results-title" className="results-panel">
        <div aria-atomic="true" aria-live="polite" className="catalog-load-summary" role="status">
          {catalog.events.status === "loading" || catalog.sessions.status === "loading" ? (
            <p>{tCatalog("loadingCombined")}</p>
          ) : null}
          {catalog.events.status === "unavailable" ? (
            <p>
              {catalog.events.reason === "DEEPLINK_ONLY"
                ? tCatalog("deepLinkOnly")
                : tCatalog("eventsUnavailable")}
            </p>
          ) : null}
          {catalog.sessions.status === "unavailable" ? <p>{tCatalog("sessionsUnavailable")}</p> : null}
          {partial ? <p>{tCatalog("partialCoverage", { count: results.length })}</p> : null}
          {catalog.events.status === "ready" && catalog.events.loadMoreError !== undefined ? (
            <p>{tCatalog("loadMoreFailed", { resource: tCatalog("eventsResource") })}</p>
          ) : null}
          {catalog.sessions.status === "ready" && catalog.sessions.loadMoreError !== undefined ? (
            <p>{tCatalog("loadMoreFailed", { resource: tCatalog("sessionsResource") })}</p>
          ) : null}
        </div>
        <div className="catalog-load-actions">
          {catalog.events.status === "ready" && catalog.events.page.nextCursor !== null ? (
            <button
              className="button button-quiet"
              disabled={catalog.events.loadingMore}
              onClick={catalog.events.loadMore}
              type="button"
            >
              {catalog.events.loadingMore ? tCatalog("loadingMore") : tCatalog("loadMoreEvents")}
            </button>
          ) : null}
          {catalog.sessions.status === "ready" && catalog.sessions.page.nextCursor !== null ? (
            <button
              className="button button-quiet"
              disabled={catalog.sessions.loadingMore}
              onClick={catalog.sessions.loadMore}
              type="button"
            >
              {catalog.sessions.loadingMore ? tCatalog("loadingMore") : tCatalog("loadMoreSessions")}
            </button>
          ) : null}
        </div>
        <Tabs.Root defaultValue="list">
          <div className="section-heading">
            <h2 id="results-title">
              {t("results")}{" "}
              <span aria-live="polite" className="result-count">
                {results.length}
              </span>
            </h2>
            <Tabs.List aria-label={t("resultView")} className="segmented">
              <Tabs.Trigger value="list">{t("list")}</Tabs.Trigger>
              <Tabs.Trigger value="map">{t("map")}</Tabs.Trigger>
            </Tabs.List>
          </div>
          <Tabs.Content value="list">
            {results.length === 0 ? (
              <div className="empty-state">
                <span aria-hidden="true">⌁</span>
                <p>{t("none")}</p>
              </div>
            ) : (
              <ul className="result-list">
                {results.map((item) => (
                  <li key={item.id}>
                    <article>
                      <div>
                        <span className="mini-label">
                          {typeLabels[item.type]} ·{" "}
                          {item.origin === "official-link" ? t("officialEntry") : t("liveResult")}
                        </span>
                        <h3>{item.title[locale]}</h3>
                        <p>{item.description}</p>
                        <SourceBadge
                          freshness={item.freshness}
                          label={item.sourceLabel[locale]}
                          updatedLabel={item.updatedLabel[locale]}
                          url={item.sourceUrl}
                        />
                      </div>
                      <button
                        className="button button-quiet"
                        onClick={() => setSelectedId(item.id)}
                        type="button"
                      >
                        {tCommon("details")}
                      </button>
                    </article>
                  </li>
                ))}
              </ul>
            )}
          </Tabs.Content>
          <Tabs.Content value="map">
            <div className="official-map-panel">
              <p>{t("mapAccuracyNote")}</p>
              <ul>
                {mapLinks.map((record) => (
                  <li key={record.id}>
                    <a href={record.source.url} rel="noopener noreferrer" target="_blank">
                      {record.source.label[locale]}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </Tabs.Content>
        </Tabs.Root>
      </section>

      <Dialog.Root
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        open={selected !== undefined}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <div className="dialog-heading">
              <div>
                <p className="eyebrow">{selected === undefined ? "" : typeLabels[selected.type]}</p>
                <Dialog.Title>{selected?.title[locale]}</Dialog.Title>
              </div>
              <Dialog.Close asChild>
                <button aria-label={tCommon("close")} className="icon-button" type="button">
                  ×
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description>{selected?.description}</Dialog.Description>
            {selected === undefined ? null : (
              <>
                <SourceBadge
                  freshness={selected.freshness}
                  label={selected.sourceLabel[locale]}
                  updatedLabel={selected.updatedLabel[locale]}
                  url={selected.sourceUrl}
                />
                <a
                  className="button button-inline"
                  href={selected.sourceUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {tCommon("officialLink")}
                </a>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
