"use client";

import { useTranslations } from "next-intl";
import { Suspense } from "react";

import { ExploreWorkspace } from "../../components/explore-workspace";
import { PageIntro } from "../../components/page-intro";

export default function ExplorePage() {
  const t = useTranslations("explore");
  return (
    <article className="page-stack">
      <PageIntro eyebrow={t("eyebrow")} summary={t("summary")} title={t("title")} />
      <Suspense fallback={<div className="panel skeleton" aria-label={t("loading")} role="status" />}>
        <ExploreWorkspace />
      </Suspense>
    </article>
  );
}
