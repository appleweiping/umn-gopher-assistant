"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { createIcsCalendar, findScheduleConflicts } from "../lib/planner";
import { usePreferences } from "./preferences";
import { TaskBoard } from "./task-board";

const blocks = [
  { id: "bio", day: "mon", startMinutes: 540, endMinutes: 600, title: "BIOL 1001", room: "Science 210" },
  {
    id: "writing",
    day: "mon",
    startMinutes: 585,
    endMinutes: 645,
    title: "WRIT 1301",
    room: "Humanities 18",
  },
  { id: "stats", day: "wed", startMinutes: 660, endMinutes: 720, title: "STAT 2011", room: "Learning Lab" },
  { id: "studio", day: "fri", startMinutes: 840, endMinutes: 930, title: "DES 1200", room: "Studio 4" },
] as const;

const dayLabels = {
  en: { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday" },
  "zh-CN": { mon: "周一", tue: "周二", wed: "周三", thu: "周四", fri: "周五" },
} as const;

function minutes(value: number): string {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function PlanWorkspace() {
  const t = useTranslations("plan");
  const { locale } = usePreferences();
  const [start, setStart] = useState("Library");
  const [destination, setDestination] = useState("Science building");
  const [status, setStatus] = useState("");
  const conflicts = findScheduleConflicts(blocks);
  const days = ["mon", "tue", "wed", "thu", "fri"] as const;

  const exportCalendar = () => {
    const calendar = createIcsCalendar({
      calendarName: "Campus Field Guide demo week",
      events: blocks.map((block, index) => ({
        id: block.id,
        title: block.title,
        location: block.room,
        startsAt: `2026-09-0${1 + index}T${minutes(block.startMinutes)}:00-05:00`,
        endsAt: `2026-09-0${1 + index}T${minutes(block.endMinutes)}:00-05:00`,
      })),
    });
    const url = URL.createObjectURL(new Blob([calendar], { type: "text/calendar;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "campus-field-guide-demo.ics";
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus(t("exported"));
  };

  return (
    <div className="plan-layout">
      <section className="panel schedule-panel" aria-labelledby="schedule-title">
        <div className="section-heading">
          <h2 id="schedule-title">{t("schedule")}</h2>
          <button className="button button-quiet" onClick={exportCalendar} type="button">
            {t("export")}
          </button>
        </div>
        {conflicts.length > 0 ? (
          <p className="notice notice-danger" role="alert">
            <strong>{t("conflict")}:</strong>{" "}
            {conflicts
              .map(([first, second]) => `${first.toUpperCase()} ↔ ${second.toUpperCase()}`)
              .join(", ")}
          </p>
        ) : null}
        <div aria-label={t("schedule")} className="table-scroll" role="region" tabIndex={0}>
          <table className="schedule-table">
            <caption className="sr-only">{t("schedule")}</caption>
            <thead>
              <tr>
                {days.map((day) => (
                  <th key={day} scope="col">
                    {dayLabels[locale][day]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {days.map((day) => (
                  <td key={day}>
                    {blocks
                      .filter((block) => block.day === day)
                      .map((block) => (
                        <article className="schedule-block" key={block.id}>
                          <time>
                            {minutes(block.startMinutes)}–{minutes(block.endMinutes)}
                          </time>
                          <strong>{block.title}</strong>
                          <span>{block.room}</span>
                        </article>
                      ))}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="fine-print">{t("disclaimer")}</p>
        <p className="sr-only" role="status" aria-live="polite">
          {status}
        </p>
      </section>

      <TaskBoard locale={locale} />

      <section className="panel route-rehearsal" aria-labelledby="route-title">
        <div className="section-heading">
          <h2 id="route-title">{t("route")}</h2>
          <span className="trust-tag">
            {locale === "zh-CN" ? "文字预演 · 非导航" : "Text rehearsal · not navigation"}
          </span>
        </div>
        <div className="route-fields">
          <label>
            {locale === "zh-CN" ? "起点" : "Start"}
            <select onChange={(event) => setStart(event.target.value)} value={start}>
              <option>Library</option>
              <option>Student center</option>
              <option>Transit stop</option>
            </select>
          </label>
          <label>
            {locale === "zh-CN" ? "终点" : "Destination"}
            <select onChange={(event) => setDestination(event.target.value)} value={destination}>
              <option>Science building</option>
              <option>One Stop</option>
              <option>Dining hall</option>
            </select>
          </label>
        </div>
        <ol className="route-steps">
          <li>
            <span>1</span>
            <div>
              <strong>
                {locale === "zh-CN" ? `从${start}主入口出发` : `Leave from the main ${start} entrance`}
              </strong>
              <p>{locale === "zh-CN" ? "确认当前开放的出口。" : "Confirm the exit is currently open."}</p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>
                {locale === "zh-CN" ? "沿有照明的公共通道前行" : "Follow the lit public corridor"}
              </strong>
              <p>
                {locale === "zh-CN"
                  ? "这是文字演示，不保证无障碍通行。"
                  : "This text demo does not guarantee an accessible path."}
              </p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>
                {locale === "zh-CN"
                  ? `在${destination}标识处停下核对`
                  : `Stop at the ${destination} sign and verify`}
              </strong>
              <p>
                {locale === "zh-CN"
                  ? "紧急情况请遵循现场人员与官方指引。"
                  : "In an emergency, follow staff and official instructions."}
              </p>
            </div>
          </li>
        </ol>
      </section>
    </div>
  );
}
