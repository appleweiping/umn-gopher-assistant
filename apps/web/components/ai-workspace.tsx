"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { useTranslations } from "next-intl";
import { useEffect, useState, type SubmitEventHandler } from "react";

import { AssistantWorkbench } from "./assistant-workbench";
import { usePreferences } from "./preferences";

export function AiWorkspace() {
  const t = useTranslations("ai");
  const { campus, locale } = usePreferences();
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:11434");
  const [status, setStatus] = useState("");

  useEffect(() => {
    window.localStorage.removeItem("uga.byok");
    setEndpoint(window.localStorage.getItem("uga.local-model") ?? "http://127.0.0.1:11434");
  }, []);

  const keepKeyInMemory: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    setStatus(
      locale === "zh-CN" ? "密钥仅保留在当前标签页的内存中。" : "Key kept in memory for this tab only.",
    );
  };

  const saveEndpoint: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    window.localStorage.setItem("uga.local-model", endpoint);
    setStatus(t("saved"));
  };

  return (
    <div className="ai-layout">
      <section className="panel ai-query-panel" aria-labelledby="retrieval-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">{locale === "zh-CN" ? "无密钥" : "No-key"}</p>
            <h2 id="retrieval-title">{locale === "zh-CN" ? "本地检索模式" : "Local retrieval mode"}</h2>
          </div>
          <span className="trust-tag">{locale === "zh-CN" ? "逐段引用" : "Paragraph citations"}</span>
        </div>
        <AssistantWorkbench campus={campus} locale={locale} />
        <div className="source-state-grid">
          <article className="state-card state-aging">
            <strong>{t("stale")}</strong>
            <p>
              {locale === "zh-CN"
                ? "若来源被标为陈旧，答案会停止给出确定性营业状态。"
                : "A stale source blocks definitive opening-status claims."}
            </p>
          </article>
          <article className="state-card state-conflict">
            <strong>{t("conflict")}</strong>
            <p>
              {locale === "zh-CN"
                ? "若两个来源日期不一致，界面会同时展示，而不是自行选择。"
                : "If dates disagree, both sources are shown instead of silently choosing one."}
            </p>
          </article>
        </div>
      </section>

      <aside className="panel model-settings" aria-labelledby="model-settings-title">
        <h2 id="model-settings-title">{t("settings")}</h2>
        <Tabs.Root defaultValue="retrieval">
          <Tabs.List className="tab-list" aria-label={t("settings")}>
            <Tabs.Trigger value="retrieval">{locale === "zh-CN" ? "检索" : "Retrieval"}</Tabs.Trigger>
            <Tabs.Trigger value="byok">BYOK</Tabs.Trigger>
            <Tabs.Trigger value="local">{locale === "zh-CN" ? "本地" : "Local"}</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="retrieval">
            <p>
              {locale === "zh-CN"
                ? "默认模式不调用生成模型，只匹配带来源的本地演示记录。"
                : "Default mode calls no generative model; it matches only local provenance-bearing demo records."}
            </p>
          </Tabs.Content>
          <Tabs.Content value="byok">
            <form className="settings-form" onSubmit={keepKeyInMemory}>
              <label>
                {t("byok")}
                <input
                  autoComplete="off"
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="sk-local-demo"
                  type="password"
                  value={apiKey}
                />
              </label>
              <p className="fine-print">
                {locale === "zh-CN"
                  ? "密钥只保留在当前标签页的内存中；刷新或关闭后即清除。本演示不会发送密钥。"
                  : "The key stays only in this tab's memory and is cleared on refresh or close. This demo does not send it."}
              </p>
              <button className="button" type="submit">
                {locale === "zh-CN" ? "仅用于当前标签页" : "Use for this tab"}
              </button>
            </form>
          </Tabs.Content>
          <Tabs.Content value="local">
            <form className="settings-form" onSubmit={saveEndpoint}>
              <label>
                {t("local")}
                <input onChange={(event) => setEndpoint(event.target.value)} type="url" value={endpoint} />
              </label>
              <p className="fine-print">
                {locale === "zh-CN"
                  ? "地址仅保存，不会在本批次发起连接。"
                  : "The address is saved, but this batch does not initiate a connection."}
              </p>
              <button className="button" type="submit">
                {locale === "zh-CN" ? "仅本地保存" : "Save locally"}
              </button>
            </form>
          </Tabs.Content>
        </Tabs.Root>
        <div className="vault-row">
          <div>
            <strong>{locale === "zh-CN" ? "私人资料库" : "Private vault"}</strong>
            <p>{t("private")}</p>
          </div>
          <input
            aria-label={locale === "zh-CN" ? "私人资料库已关闭" : "Private vault off"}
            checked={false}
            disabled
            readOnly
            type="checkbox"
          />
        </div>
        <p role="status" aria-live="polite">
          {status}
        </p>
      </aside>
    </div>
  );
}
