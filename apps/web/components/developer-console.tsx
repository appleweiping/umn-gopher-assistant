"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type SubmitEventHandler } from "react";

import { usePreferences } from "./preferences";

export function DeveloperConsole() {
  const t = useTranslations("developer");
  const { campus, locale } = usePreferences();
  const [operation, setOperation] = useState("campus.resources.read");
  const [resource, setResource] = useState<string>(campus);
  const [preview, setPreview] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    setResource(campus);
    setPreview(null);
    setAcknowledged(false);
    setStatus("");
  }, [campus]);

  const makePreview: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    setPreview(
      JSON.stringify(
        { operation, resource, mode: "LOCAL_DEMO", externalWrite: false, confirmationRequired: true },
        null,
        2,
      ),
    );
    setAcknowledged(false);
    setStatus("");
  };

  const resetPreview = () => {
    setPreview(null);
    setAcknowledged(false);
    setStatus("");
  };

  return (
    <div className="developer-layout">
      <section className="contract-grid" aria-label={locale === "zh-CN" ? "契约" : "Contracts"}>
        <article className="contract-card">
          <span className="mono-chip">HTTP</span>
          <h2>{t("openapi")}</h2>
          <p>
            {locale === "zh-CN"
              ? "基础健康、校区、来源与校园世界契约；规划端点不等于已上线。"
              : "Foundation health, campus, source, and world contracts. Planned operations are not proof of runtime support."}
          </p>
          <a className="text-link" href="/contracts/openapi" rel="noreferrer" target="_blank">
            openapi/openapi.yaml →
          </a>
        </article>
        <article className="contract-card">
          <span className="mono-chip">EVENTS</span>
          <h2>{t("asyncapi")}</h2>
          <p>
            {locale === "zh-CN"
              ? "事件主题、载荷与边界定义；演示不会连接消息代理。"
              : "Event topics, payloads, and boundaries; the demo connects to no message broker."}
          </p>
          <a className="text-link" href="/contracts/asyncapi" rel="noreferrer" target="_blank">
            asyncapi/asyncapi.yaml →
          </a>
        </article>
        <article className="contract-card">
          <span className="mono-chip">AUTHZ</span>
          <h2>{t("scopes")}</h2>
          <ul className="mono-list">
            <li>campus:read</li>
            <li>source:read</li>
            <li>community:report</li>
            <li>world:publish</li>
          </ul>
        </article>
      </section>

      <section className="tooling-grid" aria-label={locale === "zh-CN" ? "工具" : "Tooling"}>
        <article>
          <h2>{t("sdk")}</h2>
          <p>TypeScript · {t("sdkDescription")}</p>
          <code>
            import {"{"} campuses {"}"} from &quot;@uga/sdk&quot;
          </code>
        </article>
        <article>
          <h2>{t("cli")}</h2>
          <p>{t("cliDescription")}</p>
          <code>uga sources list --campus tc</code>
        </article>
        <article>
          <h2>{t("mcp")}</h2>
          <p>
            {locale === "zh-CN"
              ? "读取可直接执行；写入必须先预览，再明确确认。"
              : "Reads may execute directly. Writes require preview, then explicit confirmation."}
          </p>
          <code>preview → confirm → audit</code>
        </article>
      </section>

      <section className="panel mcp-lab" aria-labelledby="mcp-lab-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">{locale === "zh-CN" ? "MCP 语义实验室" : "MCP semantics lab"}</p>
            <h2 id="mcp-lab-title">{locale === "zh-CN" ? "预览 → 确认" : "preview → confirm"}</h2>
          </div>
          <span className="trust-tag">{locale === "zh-CN" ? "仅限本地" : "local only"}</span>
        </div>
        <form className="mcp-form" onSubmit={makePreview}>
          <label>
            {locale === "zh-CN" ? "操作" : "Operation"}
            <select
              onChange={(event) => {
                setOperation(event.target.value);
                resetPreview();
              }}
              value={operation}
            >
              <option>campus.resources.read</option>
              <option>community.report.preview</option>
              <option>world.publish.preview</option>
            </select>
          </label>
          <label>
            {locale === "zh-CN" ? "资源" : "Resource"}
            <input
              onChange={(event) => {
                setResource(event.target.value);
                resetPreview();
              }}
              value={resource}
            />
          </label>
          <button className="button" type="submit">
            {t("preview")}
          </button>
        </form>
        {preview === null ? (
          <p className="empty-inline">
            {locale === "zh-CN" ? "先生成结构化预览。" : "Generate a structured preview first."}
          </p>
        ) : (
          <div className="operation-preview">
            <pre>
              <code>{preview}</code>
            </pre>
            <label className="check-row">
              <input
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                type="checkbox"
              />
              {locale === "zh-CN"
                ? "我理解这只是本地演示，不会执行外部写入。"
                : "I understand this is a local demo and performs no external write."}
            </label>
            <button
              className="button"
              disabled={!acknowledged}
              onClick={() => setStatus(t("confirmed"))}
              type="button"
            >
              {t("confirm")}
            </button>
          </div>
        )}
        <p role="status" aria-live="polite">
          {status}
        </p>
      </section>
    </div>
  );
}
