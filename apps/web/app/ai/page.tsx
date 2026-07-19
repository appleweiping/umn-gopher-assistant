"use client";

import { useTranslations } from "next-intl";

import { AiWorkspace } from "../../components/ai-workspace";
import { PageIntro } from "../../components/page-intro";

export default function AiPage() {
  const t = useTranslations("ai");
  return (
    <article className="page-stack">
      <PageIntro eyebrow={t("eyebrow")} summary={t("summary")} title={t("title")} />
      <AiWorkspace />
    </article>
  );
}
