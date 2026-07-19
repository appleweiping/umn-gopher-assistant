"use client";

import { useTranslations } from "next-intl";

import { CommunityBoard } from "../../components/community-board";
import { PageIntro } from "../../components/page-intro";

export default function CommunityPage() {
  const t = useTranslations("community");
  return (
    <article className="page-stack">
      <PageIntro eyebrow={t("eyebrow")} summary={t("summary")} title={t("title")} />
      <CommunityBoard />
    </article>
  );
}
