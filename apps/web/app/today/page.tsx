"use client";

import { useTranslations } from "next-intl";

import { PageIntro } from "../../components/page-intro";
import { TodayDashboard } from "../../components/today-dashboard";

export default function TodayPage() {
  const t = useTranslations("today");
  return (
    <article className="page-stack">
      <PageIntro eyebrow={t("eyebrow")} summary={t("summary")} title={t("title")} />
      <TodayDashboard />
    </article>
  );
}
