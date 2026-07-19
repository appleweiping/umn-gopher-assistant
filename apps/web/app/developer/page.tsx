"use client";

import { useTranslations } from "next-intl";

import { DeveloperConsole } from "../../components/developer-console";
import { PageIntro } from "../../components/page-intro";

export default function DeveloperPage() {
  const t = useTranslations("developer");
  return (
    <article className="page-stack">
      <PageIntro eyebrow={t("eyebrow")} summary={t("summary")} title={t("title")} />
      <DeveloperConsole />
    </article>
  );
}
