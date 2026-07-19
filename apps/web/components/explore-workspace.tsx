"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { filterExploreItems, type ExploreItem, type ExploreType } from "../lib/explore";
import { demoRecords } from "../lib/data/registry";
import { usePreferences } from "./preferences";
import { SchematicMap, SourceBadge } from "./ui";

const types: readonly ExploreType[] = ["place", "service", "event", "course"];

function typeForKind(kind: (typeof demoRecords)[number]["kind"]): ExploreType {
  if (kind === "map") return "place";
  if (kind === "events") return "event";
  if (kind === "calendar") return "course";
  return "service";
}

export function ExploreWorkspace() {
  const t = useTranslations("explore");
  const tCommon = useTranslations("common");
  const searchParams = useSearchParams();
  const { campus, locale } = usePreferences();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [selectedTypes, setSelectedTypes] = useState<readonly ExploreType[]>([]);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => setQuery(searchParams.get("q") ?? ""), [searchParams]);

  const requestedKind = searchParams.get("kind");
  const sourceRecords = demoRecords.filter(
    (record) => record.campus === campus && (requestedKind !== "service" || record.kind === "service"),
  );
  const items = useMemo(
    () =>
      sourceRecords.map<ExploreItem>((record) => ({
        id: record.id,
        campus: record.campus,
        type: typeForKind(record.kind),
        openNow: false,
        title: record.title,
      })),
    [sourceRecords],
  );
  const results = filterExploreItems(items, { query, locale, campus, types: selectedTypes, onlyOpen });
  const selected = selectedId === null ? undefined : sourceRecords.find((record) => record.id === selectedId);
  const typeLabels: Record<ExploreType, string> =
    locale === "zh-CN"
      ? { place: "地点", service: "服务", event: "活动", course: "课程" }
      : { place: "Places", service: "Services", event: "Events", course: "Courses" };

  const toggleType = (type: ExploreType) =>
    setSelectedTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );

  return (
    <div className="explore-workspace">
      <aside className="filter-panel" aria-label={t("types")}>
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
        <label className="check-row">
          <input checked={onlyOpen} onChange={(event) => setOnlyOpen(event.target.checked)} type="checkbox" />
          {t("openOnly")}
        </label>
        <button
          className="button button-quiet"
          onClick={() => {
            setQuery("");
            setSelectedTypes([]);
            setOnlyOpen(false);
          }}
          type="button"
        >
          {locale === "zh-CN" ? "清除筛选" : "Clear filters"}
        </button>
      </aside>

      <section className="results-panel" aria-labelledby="results-title">
        <Tabs.Root defaultValue="list">
          <div className="section-heading">
            <h2 id="results-title">
              {t("results")}{" "}
              <span className="result-count" aria-live="polite">
                {results.length}
              </span>
            </h2>
            <Tabs.List aria-label={locale === "zh-CN" ? "结果视图" : "Result view"} className="segmented">
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
                {results.map((item) => {
                  const record = sourceRecords.find((candidate) => candidate.id === item.id);
                  if (record === undefined) return null;
                  return (
                    <li key={item.id}>
                      <article>
                        <div>
                          <span className="mini-label">
                            {typeLabels[item.type]} · {item.openNow ? tCommon("open") : tCommon("demo")}
                          </span>
                          <h3>{item.title[locale]}</h3>
                          <p>
                            {locale === "zh-CN"
                              ? "项目自编摘要；当前详情请打开来源。"
                              : "Project-authored summary; open the source for current details."}
                          </p>
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
                  );
                })}
              </ul>
            )}
          </Tabs.Content>
          <Tabs.Content value="map">
            <SchematicMap
              label={locale === "zh-CN" ? "校区示意地图" : "Campus schematic map"}
              points={results.map((item, index) => ({
                id: item.id,
                label: item.title[locale],
                x: 14 + ((index * 17) % 72),
                y: 12 + ((index * 13) % 48),
              }))}
            />
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
                <p className="eyebrow">{selected?.kind}</p>
                <Dialog.Title>{selected?.title[locale]}</Dialog.Title>
              </div>
              <Dialog.Close asChild>
                <button
                  aria-label={locale === "zh-CN" ? "关闭" : "Close"}
                  className="icon-button"
                  type="button"
                >
                  ×
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description>
              {locale === "zh-CN"
                ? "这是项目自编演示条目。来源链接用于核对最新官方信息。"
                : "This is a project-authored demo entry. Use the source link to verify current official information."}
            </Dialog.Description>
            {selected === undefined ? null : (
              <>
                <SourceBadge
                  freshness={selected.freshness}
                  label={selected.source.label[locale]}
                  updatedLabel="2026-07-19"
                  url={selected.source.url}
                />
                <a
                  className="button button-inline"
                  href={selected.source.url}
                  rel="noreferrer"
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
