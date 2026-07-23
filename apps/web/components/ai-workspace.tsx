"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { AssistantWorkbench } from "./assistant-workbench";
import { usePreferences } from "./preferences";

export function AiWorkspace() {
  const t = useTranslations("ai");
  const { campus, locale } = usePreferences();

  useEffect(() => {
    window.localStorage.removeItem("uga.byok");
    window.localStorage.removeItem("uga.local-model");
  }, []);

  return (
    <div className="ai-layout">
      <section className="panel ai-query-panel" aria-labelledby="retrieval-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">{t("noKey")}</p>
            <h2 id="retrieval-title">{t("retrievalTitle")}</h2>
          </div>
          <span className="trust-tag">{t("paragraphCitations")}</span>
        </div>
        <p className="retrieval-boundary">{t("retrievalBoundary")}</p>
        <AssistantWorkbench campus={campus} locale={locale} />
      </section>

      <aside className="panel model-settings" aria-labelledby="model-settings-title">
        <div className="model-settings-heading">
          <div>
            <p className="section-kicker">{t("connectionStatus")}</p>
            <h2 id="model-settings-title">{t("settings")}</h2>
          </div>
          <span className="ai-state ai-state-answered">{t("retrievalAvailable")}</span>
        </div>
        <Tabs.Root defaultValue="retrieval">
          <Tabs.List className="tab-list" aria-label={t("settings")}>
            <Tabs.Trigger value="retrieval">{t("retrievalTab")}</Tabs.Trigger>
            <Tabs.Trigger aria-label={t("byokTab")} value="byok">
              BYOK
            </Tabs.Trigger>
            <Tabs.Trigger value="local">{t("localTab")}</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="retrieval">
            <p>{t("retrievalConnected")}</p>
            <dl className="connection-details">
              <div>
                <dt>{t("generation")}</dt>
                <dd>{t("generationOff")}</dd>
              </div>
              <div>
                <dt>{t("privateData")}</dt>
                <dd>{t("privateDataOff")}</dd>
              </div>
            </dl>
          </Tabs.Content>
          <Tabs.Content value="byok">
            <div className="unavailable-connection" role="note">
              <span className="connection-disabled">{t("disabled")}</span>
              <h3>{t("byokNotConnected")}</h3>
              <p>{t("byokDisabledBody")}</p>
              <label htmlFor="disabled-byok-key">{t("byok")}</label>
              <input
                autoComplete="off"
                disabled
                id="disabled-byok-key"
                placeholder={t("notCollected")}
                type="password"
              />
              <button className="button" disabled type="button">
                {t("connectUnavailable")}
              </button>
            </div>
          </Tabs.Content>
          <Tabs.Content value="local">
            <div className="unavailable-connection" role="note">
              <span className="connection-disabled">{t("disabled")}</span>
              <h3>{t("localNotConnected")}</h3>
              <p>{t("localDisabledBody")}</p>
              <label htmlFor="disabled-local-endpoint">{t("local")}</label>
              <input disabled id="disabled-local-endpoint" placeholder={t("notCollected")} type="url" />
              <button className="button" disabled type="button">
                {t("connectUnavailable")}
              </button>
            </div>
          </Tabs.Content>
        </Tabs.Root>
        <div className="vault-row">
          <div>
            <strong>{t("privateVault")}</strong>
            <p>{t("private")}</p>
          </div>
          <input aria-label={t("privateVaultOff")} checked={false} disabled readOnly type="checkbox" />
        </div>
      </aside>
    </div>
  );
}
