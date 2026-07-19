"use client";

import { useTranslations } from "next-intl";

import { PageIntro } from "../../components/page-intro";
import { WorldCatalog } from "../../components/world-catalog";

export default function WorldPage() {
  const t = useTranslations("world");
  return (
    <article className="page-stack">
      <PageIntro eyebrow={t("eyebrow")} summary={t("summary")} title={t("title")} />
      <WorldCatalog />
    </article>
  );
}
