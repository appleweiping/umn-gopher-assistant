"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { demoRecords, getCampus, type DemoKind } from "../lib/data/registry";
import { usePreferences } from "./preferences";
import { SourceBadge } from "./ui";

const signalKinds: readonly DemoKind[] = ["transit", "dining", "library", "safety"];

const timeline = {
  en: [
    { time: "08:15", type: "Class", title: "Biology seminar", detail: "Science classroom · authored demo" },
    { time: "11:30", type: "Task", title: "Submit reading response", detail: "Saved in this browser" },
    {
      time: "15:00",
      type: "Event",
      title: "Student organization fair",
      detail: "Verify venue at the cited events source",
    },
  ],
  "zh-CN": [
    { time: "08:15", type: "课程", title: "生物学研讨课", detail: "理科教室 · 项目自编演示" },
    { time: "11:30", type: "任务", title: "提交阅读回应", detail: "保存在此浏览器" },
    { time: "15:00", type: "活动", title: "学生组织交流会", detail: "请通过活动来源核对场地" },
  ],
} as const;

export function TodayDashboard() {
  const t = useTranslations("today");
  const { campus: campusId, locale } = usePreferences();
  const campus = getCampus(campusId);
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
          <span className="weather-chip">
            <strong>72°F</strong>
            {locale === "zh-CN" ? "晴间多云 · 演示" : "Partly cloudy · demo"}
          </span>
        </div>
        <ol className="timeline-list">
          {timeline[locale].map((item) => (
            <li key={`${item.time}-${item.title}`}>
              <time>{item.time}</time>
              <span className="timeline-marker" aria-hidden="true" />
              <div>
                <span className="mini-label">{item.type}</span>
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        <Link className="text-link" href="/plan">
          {locale === "zh-CN" ? "打开完整计划 →" : "Open the full plan →"}
        </Link>
      </section>

      <section aria-labelledby="signals-title" className="signal-section">
        <div className="section-heading">
          <div>
            <p className="section-kicker">{locale === "zh-CN" ? "可重排" : "Reorderable"}</p>
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
            const summaries: Record<DemoKind, string> = {
              calendar: locale === "zh-CN" ? "查看学期日期" : "Review term dates",
              map: locale === "zh-CN" ? "打开示意入口" : "Open map entry",
              transit: locale === "zh-CN" ? "班次需要联网核对" : "Schedule needs a live check",
              dining: locale === "zh-CN" ? "菜单由餐饮平台维护" : "Menus are maintained by dining platforms",
              events: locale === "zh-CN" ? "查看活动来源" : "Review event source",
              library: locale === "zh-CN" ? "营业时间随学期变化" : "Hours vary by term",
              safety: locale === "zh-CN" ? "不是实时警报替代品" : "Not a replacement for live alerts",
              service: locale === "zh-CN" ? "查看办事指南" : "Open service guidance",
            };
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
                <span className={`kind-marker kind-${record.kind}`} aria-hidden="true" />
                <h3>{record.title[locale]}</h3>
                <p>{summaries[record.kind]}</p>
                <SourceBadge
                  freshness={record.freshness}
                  label={record.source.label[locale]}
                  updatedLabel={locale === "zh-CN" ? "核验于 2026-07-19" : "checked 2026-07-19"}
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
