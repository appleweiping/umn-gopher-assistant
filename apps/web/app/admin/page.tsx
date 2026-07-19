"use client";

import { useTranslations } from "next-intl";

import { AdminConsole } from "../../components/admin-console";
import { PageIntro } from "../../components/page-intro";

export default function AdminPage() {
  const t = useTranslations("admin");
  const tCommon = useTranslations("common");
  return (
    <article className="page-stack">
      <PageIntro
        aside={<span className="trust-tag">{tCommon("readOnly")}</span>}
        eyebrow={t("eyebrow")}
        summary={t("summary")}
        title={t("title")}
      />
      <AdminConsole />
    </article>
  );
}
