import type {
  AcademicSession,
  CampusId,
  FreshnessState,
  PublicEvent,
  SourceObservation,
} from "@umn-gopher-assistant/contracts";

import { demoRecords, type Freshness, type Locale } from "../data/registry";

export interface PresentedSource {
  readonly label: string;
  readonly url: string;
}

const sessionsSource: Readonly<Record<Locale, string>> = {
  en: "UMN Sessions data service",
  "zh-CN": "UMN 学期数据服务",
};

export function freshnessForObservation(state: FreshnessState): Freshness {
  if (state === "FRESH") return "fresh";
  if (state === "STALE") return "stale";
  if (state === "EXPIRED") return "stale";
  return "unknown";
}

export function officialCatalogSource(
  campusId: CampusId,
  resource: "events" | "sessions",
  locale: Locale,
): PresentedSource {
  if (resource === "sessions") {
    return {
      label: sessionsSource[locale],
      url: "https://asr-custom.umn.edu/sessions_data_service/",
    };
  }
  const record = demoRecords.find(
    (candidate) => candidate.campus === campusId && candidate.kind === "events",
  );
  if (record === undefined) throw new TypeError(`Missing official events link for ${campusId}`);
  return { label: record.source.label[locale], url: record.source.url };
}

export function observedAtLabel(observation: SourceObservation, locale: Locale): string {
  const formatted = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Chicago",
  }).format(new Date(observation.observedAt));
  return locale === "zh-CN" ? `采集于 ${formatted}` : `observed ${formatted}`;
}

export function eventDateLabel(event: PublicEvent, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: event.allDay ? undefined : "short",
    timeZone: event.timeZone,
  }).format(new Date(event.startsAt));
}

export function sessionDateLabel(session: AcademicSession, locale: Locale): string {
  const formatter = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  });
  const begin = formatter.format(new Date(`${session.beginDate}T12:00:00.000Z`));
  const end = formatter.format(new Date(`${session.endDate}T12:00:00.000Z`));
  return `${begin} – ${end}`;
}

export function sourceForItem(item: AcademicSession | PublicEvent, locale: Locale): PresentedSource {
  return officialCatalogSource(item.campusId, "canonicalUrl" in item ? "events" : "sessions", locale);
}
