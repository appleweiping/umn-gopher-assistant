"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import type { AcademicSession, PublicEvent } from "@umn-gopher-assistant/contracts";

import {
  eventDateLabel,
  freshnessForObservation,
  observedAtLabel,
  officialCatalogSource,
  sessionDateLabel,
} from "../lib/catalog/presentation";
import { observationForItem, type CatalogPage } from "../lib/catalog/client";
import { usePublicCatalog, type CatalogResourceState } from "../lib/catalog/use-public-catalog";
import { demoRecords, getCampus, type DemoKind } from "../lib/data/registry";
import { usePreferences } from "./preferences";
import { SourceBadge } from "./ui";

const signalKinds: readonly DemoKind[] = ["transit", "dining", "library", "safety"];

function CatalogFallback(props: {
  readonly resource: "events" | "sessions";
  readonly state: CatalogResourceState<AcademicSession | PublicEvent>;
}) {
  const t = useTranslations("catalog");
  const { locale } = usePreferences();
  const source = officialCatalogSource(props.state.campusId, props.resource, locale);
  if (props.state.status === "loading") {
    return (
      <p aria-live="polite" className="catalog-status" role="status">
        {props.resource === "events" ? t("loadingEvents") : t("loadingSessions")}
      </p>
    );
  }
  if (props.state.status === "unavailable") {
    const url = props.state.error?.officialUrl ?? source.url;
    return (
      <div aria-live="polite" className="notice notice-warning" role="status">
        <p>{props.state.reason === "DEEPLINK_ONLY" ? t("deepLinkOnly") : t("unavailable")}</p>
        <a href={url} rel="noopener noreferrer" target="_blank">
          {t("openSource", { source: source.label })}
        </a>
      </div>
    );
  }
  return null;
}

function CoverageNote<T extends AcademicSession | PublicEvent>(props: {
  readonly page: CatalogPage<T>;
  readonly visibleCount: number;
}) {
  const t = useTranslations("catalog");
  const viewLimited = props.visibleCount < props.page.items.length;
  const partial =
    props.page.nextCursor !== null ||
    viewLimited ||
    props.page.retrievalCoverage.nextUpstreamPage !== null ||
    props.page.retrievalCoverage.truncatedByPolicy;
  return partial ? (
    <p aria-live="polite" className="catalog-coverage" role="status">
      {viewLimited
        ? t("limitedView", { count: props.visibleCount, total: props.page.items.length })
        : t("partialCoverage", { count: props.visibleCount })}
    </p>
  ) : null;
}

function EventList(props: { readonly state: CatalogResourceState<PublicEvent> }) {
  const t = useTranslations("catalog");
  const { locale } = usePreferences();
  if (props.state.status !== "ready") return <CatalogFallback resource="events" state={props.state} />;
  const page = props.state.page;
  if (page.items.length === 0) {
    const observation = page.sourceObservations[page.sourceObservations.length - 1];
    const source = officialCatalogSource(props.state.campusId, "events", locale);
    return (
      <div>
        <p aria-live="polite" className="catalog-status" role="status">
          {t("noEvents", { from: page.range.from, to: page.range.to })}
        </p>
        {observation === undefined ? null : (
          <SourceBadge
            freshness={freshnessForObservation(observation.freshnessState)}
            label={source.label}
            updatedLabel={observedAtLabel(observation, locale)}
            url={source.url}
          />
        )}
        <CoverageNote page={page} visibleCount={0} />
      </div>
    );
  }
  return (
    <>
      <ol className="timeline-list catalog-list">
        {page.items.slice(0, 4).map((event) => {
          const observation = observationForItem(page, event);
          const source = officialCatalogSource(event.campusId, "events", locale);
          return (
            <li key={event.id}>
              <time dateTime={event.startsAt}>{eventDateLabel(event, locale)}</time>
              <span aria-hidden="true" className="timeline-marker" />
              <div>
                <span className="mini-label">
                  {event.status === "CANCELLED" ? t("cancelled") : t("event")}
                </span>
                <h3>{event.title}</h3>
                {event.location?.name === null || event.location === null ? null : (
                  <p>{event.location.name}</p>
                )}
                <SourceBadge
                  freshness={freshnessForObservation(observation.freshnessState)}
                  label={source.label}
                  updatedLabel={observedAtLabel(observation, locale)}
                  url={event.canonicalUrl}
                />
              </div>
            </li>
          );
        })}
      </ol>
      <CoverageNote page={page} visibleCount={Math.min(4, page.items.length)} />
    </>
  );
}

function SessionList(props: { readonly state: CatalogResourceState<AcademicSession> }) {
  const t = useTranslations("catalog");
  const { locale } = usePreferences();
  if (props.state.status !== "ready") return <CatalogFallback resource="sessions" state={props.state} />;
  const page = props.state.page;
  if (page.items.length === 0) {
    const observation = page.sourceObservations[0];
    const source = officialCatalogSource(props.state.campusId, "sessions", locale);
    return (
      <div>
        <p aria-live="polite" className="catalog-status" role="status">
          {t("noSessions", { from: page.range.from, to: page.range.to })}
        </p>
        {observation === undefined ? null : (
          <SourceBadge
            freshness={freshnessForObservation(observation.freshnessState)}
            label={source.label}
            updatedLabel={observedAtLabel(observation, locale)}
            url={source.url}
          />
        )}
        <CoverageNote page={page} visibleCount={0} />
      </div>
    );
  }
  return (
    <>
      <ul className="catalog-session-list">
        {page.items.slice(0, 3).map((session) => {
          const observation = observationForItem(page, session);
          const source = officialCatalogSource(session.campusId, "sessions", locale);
          return (
            <li key={session.id}>
              <div>
                <span className="mini-label">{t("academicSession")}</span>
                <h3>{session.name}</h3>
                <p>{sessionDateLabel(session, locale)}</p>
              </div>
              <SourceBadge
                freshness={freshnessForObservation(observation.freshnessState)}
                label={source.label}
                updatedLabel={observedAtLabel(observation, locale)}
                url={source.url}
              />
            </li>
          );
        })}
      </ul>
      <CoverageNote page={page} visibleCount={Math.min(3, page.items.length)} />
    </>
  );
}

export function TodayDashboard() {
  const t = useTranslations("today");
  const tCatalog = useTranslations("catalog");
  const { campus: campusId, locale } = usePreferences();
  const campus = getCampus(campusId);
  const catalog = usePublicCatalog(campusId);
  const initialIds = useMemo(
    () =>
      signalKinds
        .map((kind) => demoRecords.find((record) => record.campus === campusId && record.kind === kind)?.id)
        .filter((id): id is string => id !== undefined),
    [campusId],
  );
  const [orderedIds, setOrderedIds] = useState<readonly string[]>(initialIds);
  const [online, setOnline] = useState(true);

  useEffect(() => setOrderedIds(initialIds), [initialIds]);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= orderedIds.length) return;
    const next = [...orderedIds];
    const current = next[index];
    const swapped = next[target];
    if (current === undefined || swapped === undefined) return;
    next[index] = swapped;
    next[target] = current;
    setOrderedIds(next);
  };

  return (
    <div className="today-grid">
      <section aria-labelledby="timeline-title" className="panel timeline-panel">
        <div className="section-heading">
          <div>
            <p className="section-kicker">{campus.name[locale]}</p>
            <h2 id="timeline-title">{t("timeline")}</h2>
          </div>
        </div>
        <section aria-labelledby="upcoming-events-title" className="catalog-section">
          <h3 id="upcoming-events-title">{tCatalog("upcomingEvents")}</h3>
          <EventList state={catalog.events} />
        </section>
        <section aria-labelledby="academic-sessions-title" className="catalog-section">
          <h3 id="academic-sessions-title">{tCatalog("sessionDates")}</h3>
          <SessionList state={catalog.sessions} />
        </section>
        <Link className="text-link" href="/plan">
          {t("openPlan")}
        </Link>
      </section>

      <section aria-labelledby="signals-title" className="signal-section">
        <div className="section-heading">
          <div>
            <p className="section-kicker">{t("officialShortcuts")}</p>
            <h2 id="signals-title">{t("signals")}</h2>
          </div>
        </div>
        {!online ? (
          <p className="notice notice-warning" role="status">
            {t("offlineNote")}
          </p>
        ) : null}
        <div className="signal-grid">
          {orderedIds.map((id, index) => {
            const record = demoRecords.find((candidate) => candidate.id === id);
            if (record === undefined) return null;
            return (
              <article className="signal-card" key={record.id}>
                <div className="card-tools">
                  <button
                    aria-label={`${t("moveUp")}: ${record.title[locale]}`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    type="button"
                  >
                    ↑
                  </button>
                  <button
                    aria-label={`${t("moveDown")}: ${record.title[locale]}`}
                    disabled={index === orderedIds.length - 1}
                    onClick={() => move(index, 1)}
                    type="button"
                  >
                    ↓
                  </button>
                </div>
                <span aria-hidden="true" className={`kind-marker kind-${record.kind}`} />
                <h3>{record.title[locale]}</h3>
                <p>{tCatalog("externalStatusUnknown")}</p>
                <SourceBadge
                  freshness="unknown"
                  label={record.source.label[locale]}
                  updatedLabel={tCatalog("notObserved")}
                  url={record.source.url}
                />
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
