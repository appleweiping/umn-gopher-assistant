"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export default function OfflinePage() {
  const t = useTranslations("offline");
  return (
    <article className="page-stack narrow-page">
      <header className="page-header">
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1>{t("title")}</h1>
        <p>{t("summary")}</p>
      </header>
      <Link className="button button-inline" href="/today">
        {t("return")}
      </Link>
    </article>
  );
}
