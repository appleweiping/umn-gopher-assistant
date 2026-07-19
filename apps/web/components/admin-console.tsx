"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { demoRecords } from "../lib/data/registry";
import { usePreferences } from "./preferences";

const queue = [
  {
    age: { en: "18m", "zh-CN": "18 分钟" },
    id: "mod-104",
    reasonKey: "reasonDuplicate",
    risk: "medium",
  },
  {
    age: { en: "42m", "zh-CN": "42 分钟" },
    id: "mod-103",
    reasonKey: "reasonPayment",
    risk: "high",
  },
  { age: { en: "2h", "zh-CN": "2 小时" }, id: "mod-101", reasonKey: "reasonCategory", risk: "low" },
] as const;

const riskKeys = { high: "riskHigh", low: "riskLow", medium: "riskMedium" } as const;

export function AdminConsole() {
  const t = useTranslations("admin");
  const tCommon = useTranslations("common");
  const { locale } = usePreferences();
  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
  const selected = queue.find((item) => item.id === selectedQueueId);
  const records = demoRecords.slice(0, 10);

  return (
    <div className="admin-console">
      <div className="notice notice-warning">
        <strong>{tCommon("readOnly")}</strong> —{" "}
        {locale === "zh-CN"
          ? "访客模式不会执行审核、发布或熔断操作。"
          : "Visitor mode cannot moderate, publish, or change circuit breakers."}
      </div>
      <Tabs.Root defaultValue="sources">
        <Tabs.List
          className="tab-list admin-tabs"
          aria-label={locale === "zh-CN" ? "运营区域" : "Operations sections"}
        >
          <Tabs.Trigger value="sources">{t("sources")}</Tabs.Trigger>
          <Tabs.Trigger value="moderation">{t("moderation")}</Tabs.Trigger>
          <Tabs.Trigger value="knowledge">{t("knowledge")}</Tabs.Trigger>
          <Tabs.Trigger value="publishing">{t("publishing")}</Tabs.Trigger>
          <Tabs.Trigger value="audit">{t("audit")}</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="sources">
          <section className="panel">
            <div className="section-heading">
              <h2>{t("sources")}</h2>
              <span className="trust-tag">10 / {demoRecords.length}</span>
            </div>
            <div aria-label={t("sources")} className="table-scroll" role="region" tabIndex={0}>
              <table className="data-table">
                <caption className="sr-only">{t("sources")}</caption>
                <thead>
                  <tr>
                    <th scope="col">ID</th>
                    <th scope="col">{t("campus")}</th>
                    <th scope="col">{t("license")}</th>
                    <th scope="col">{t("freshness")}</th>
                    <th scope="col">{t("breaker")}</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id}>
                      <th scope="row">{record.id}</th>
                      <td>{record.campus}</td>
                      <td>
                        <span className="mono-chip">{record.licensing}</span>
                      </td>
                      <td>{tCommon(record.freshness)}</td>
                      <td>{record.freshness === "stale" ? t("open") : t("closed")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </Tabs.Content>
        <Tabs.Content value="moderation">
          <section className="panel">
            <div className="section-heading">
              <h2>{t("moderation")}</h2>
              <span className="trust-tag">{t("pending", { count: queue.length })}</span>
            </div>
            <ul className="queue-list">
              {queue.map((item) => (
                <li key={item.id}>
                  <div>
                    <span className={`risk risk-${item.risk}`}>{t(riskKeys[item.risk])}</span>
                    <strong>{t(item.reasonKey)}</strong>
                    <small>
                      {item.id} · {item.age[locale]}
                    </small>
                  </div>
                  <button
                    className="button button-quiet"
                    onClick={() => setSelectedQueueId(item.id)}
                    type="button"
                  >
                    {locale === "zh-CN" ? "检查" : "Inspect"}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </Tabs.Content>
        <Tabs.Content value="knowledge">
          <section className="panel operations-placeholder">
            <h2>{t("knowledge")}</h2>
            <p>
              {locale === "zh-CN"
                ? "12 条待复核记录；下一次演示发布窗口为周二。所有更改都需要来源与审阅人。"
                : "12 records await review; the next demo release window is Tuesday. Every change requires a source and reviewer."}
            </p>
            <progress max="20" value="8">
              8 / 20
            </progress>
          </section>
        </Tabs.Content>
        <Tabs.Content value="publishing">
          <section className="panel operations-placeholder">
            <h2>{t("publishing")}</h2>
            <p>
              {locale === "zh-CN"
                ? "五个二维示意清单通过检查；三维包保持禁用。"
                : "Five 2D schematic manifests pass checks; 3D packages remain disabled."}
            </p>
            <ul className="status-list">
              <li>
                tc/world-v0.1 <span>{locale === "zh-CN" ? "就绪" : "ready"}</span>
              </li>
              <li>
                duluth/world-v0.1 <span>{locale === "zh-CN" ? "就绪" : "ready"}</span>
              </li>
              <li>
                rochester/world-v0.1 <span>{locale === "zh-CN" ? "待复核" : "review"}</span>
              </li>
            </ul>
          </section>
        </Tabs.Content>
        <Tabs.Content value="audit">
          <section className="panel">
            <h2>{t("audit")}</h2>
            <ol className="audit-list">
              <li>
                <time>10:42</time>
                <span>demo.viewer</span>
                <strong>source.health.list</strong>
                <code>request demo-7bc</code>
              </li>
              <li>
                <time>10:38</time>
                <span>demo.system</span>
                <strong>world.manifest.validate</strong>
                <code>5 records</code>
              </li>
              <li>
                <time>10:31</time>
                <span>demo.viewer</span>
                <strong>moderation.queue.preview</strong>
                <code>{locale === "zh-CN" ? "只读" : "read only"}</code>
              </li>
            </ol>
          </section>
        </Tabs.Content>
      </Tabs.Root>
      <Dialog.Root
        onOpenChange={(open) => {
          if (!open) setSelectedQueueId(null);
        }}
        open={selected !== undefined}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <div className="dialog-heading">
              <Dialog.Title>{selected?.id}</Dialog.Title>
              <Dialog.Close asChild>
                <button
                  aria-label={locale === "zh-CN" ? "关闭" : "Close"}
                  className="icon-button"
                  type="button"
                >
                  ×
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description>{selected === undefined ? "" : t(selected.reasonKey)}</Dialog.Description>
            <dl className="detail-list">
              <div>
                <dt>{t("risk")}</dt>
                <dd>{selected === undefined ? "" : t(riskKeys[selected.risk])}</dd>
              </div>
              <div>
                <dt>{t("mode")}</dt>
                <dd>{t("readOnlyDemo")}</dd>
              </div>
            </dl>
            <p className="notice notice-warning">
              {locale === "zh-CN"
                ? "没有可用的批准或移除操作。"
                : "Approve and remove actions are unavailable."}
            </p>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
