"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { campuses, type CampusId } from "../lib/data/registry";
import { usePreferences } from "./preferences";
import { SchematicMap } from "./ui";

const campusWebsites: Record<CampusId, string> = {
  tc: "https://twin-cities.umn.edu/",
  duluth: "https://www.d.umn.edu/",
  crookston: "https://crk.umn.edu/",
  morris: "https://morris.umn.edu/",
  rochester: "https://r.umn.edu/",
};

export function WorldCatalog() {
  const t = useTranslations("world");
  const { campus: preferredCampus, locale } = usePreferences();
  const [active, setActive] = useState<CampusId>(preferredCampus);
  useEffect(() => setActive(preferredCampus), [preferredCampus]);
  const campus = campuses.find((entry) => entry.id === active) ?? campuses[0];
  const points = [
    { id: "welcome", label: locale === "zh-CN" ? "欢迎台" : "Welcome desk", x: 18, y: 48 },
    { id: "library", label: locale === "zh-CN" ? "图书馆" : "Library", x: 43, y: 27 },
    { id: "services", label: locale === "zh-CN" ? "学生服务" : "Student services", x: 72, y: 40 },
  ];

  return (
    <div className="world-layout">
      <section aria-labelledby="catalog-title" className="campus-catalog">
        <h2 id="catalog-title">{t("catalog")}</h2>
        <div className="campus-card-grid">
          {campuses.map((entry) => (
            <button
              aria-pressed={active === entry.id}
              className="campus-card"
              key={entry.id}
              onClick={() => setActive(entry.id)}
              type="button"
            >
              <span className="campus-code">{entry.academicInstitutionCode}</span>
              <strong>{entry.name[locale]}</strong>
              <small>{entry.city[locale]}</small>
            </button>
          ))}
        </div>
      </section>
      <section className="panel world-view" id="world-2d" aria-labelledby="world-view-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">{campus.academicInstitutionCode}</p>
            <h2 id="world-view-title">{campus.name[locale]}</h2>
          </div>
          <span className="trust-tag">{locale === "zh-CN" ? "示意 · 未核验" : "Schematic · unverified"}</span>
        </div>
        <div id="world-2d-map" tabIndex={-1}>
          <SchematicMap
            label={`${campus.name[locale]} ${locale === "zh-CN" ? "二维示意" : "2D schematic"}`}
            points={points}
          />
        </div>
        <div className="world-actions">
          <a className="button button-quiet" href="#world-2d-map">
            {t("twoD")}
          </a>
          <button
            className="button"
            disabled
            title={locale === "zh-CN" ? "后续批次实现" : "Planned for a later phase"}
            type="button"
          >
            {t("threeD")}
          </button>
        </div>
      </section>
      <aside className="world-manifest" aria-label={locale === "zh-CN" ? "校园世界清单" : "World manifest"}>
        <dl className="detail-list">
          <div>
            <dt>{t("verification")}</dt>
            <dd>{locale === "zh-CN" ? "未核验的项目自编示意" : "Unverified project-authored schematic"}</dd>
          </div>
          <div>
            <dt>{t("updated")}</dt>
            <dd>{locale === "zh-CN" ? "尚未发布世界资产" : "No world asset published"}</dd>
          </div>
          <div>
            <dt>{t("budget")}</dt>
            <dd>≤ 180 KB shell · 0 MB 3D</dd>
          </div>
          <div>
            <dt>{t("source")}</dt>
            <dd>
              <a href={campusWebsites[active]} rel="noreferrer" target="_blank">
                {campus.name[locale]}
              </a>
            </dd>
          </div>
        </dl>
        <p className="notice notice-warning">
          {locale === "zh-CN"
            ? "不得用于疏散、无障碍保证或安全关键导航。"
            : "Do not use for evacuation, accessibility guarantees, or safety-critical navigation."}
        </p>
      </aside>
    </div>
  );
}
