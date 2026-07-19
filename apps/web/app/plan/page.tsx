"use client";

import { useTranslations } from "next-intl";

import { PageIntro } from "../../components/page-intro";
import { PlanWorkspace } from "../../components/plan-workspace";

export default function PlanPage() {
  const t = useTranslations("plan");
  return (
    <article className="page-stack">
      <PageIntro eyebrow={t("eyebrow")} summary={t("summary")} title={t("title")} />
      <PlanWorkspace />
    </article>
  );
}
