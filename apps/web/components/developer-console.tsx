"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type SubmitEventHandler } from "react";

import { usePreferences } from "./preferences";

export function DeveloperConsole() {
  const t = useTranslations("developer");
  const { campus, locale } = usePreferences();
  const [operation, setOperation] = useState("campuses_list");
  const [resource, setResource] = useState<string>(campus);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    setResource(campus);
    setPreview(null);
  }, [campus]);

  const makePreview: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    setPreview(
      JSON.stringify(
        {
          arguments: operation === "campuses_list" ? {} : { campusId: resource },
          externalWrite: false,
          mode: "READ_ONLY_PREVIEW",
          tool: operation,
        },
        null,
        2,
      ),
    );
  };

  const resetPreview = () => {
    setPreview(null);
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
            <li>personal:read / personal:write</li>
            <li>community:read / community:write</li>
            <li>messages:read / messages:write</li>
            <li>world:read / world:write</li>
            <li>admin:read / admin:write</li>
          </ul>
        </article>
      </section>

      <section className="tooling-grid" aria-label={locale === "zh-CN" ? "工具" : "Tooling"}>
        <article>
          <h2>{t("sdk")}</h2>
          <p>TypeScript · {t("sdkDescription")}</p>
          <code>
            import {"{"} GopherClient {"}"} from &quot;@umn-gopher-assistant/sdk&quot;
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
              ? "远程 Streamable HTTP 服务当前只注册三个校园读取工具，不注册写工具。"
              : "The remote Streamable HTTP server currently registers exactly three campus read tools and no writes."}
          </p>
          <code>campuses_list · sources_list · world_manifest_get</code>
        </article>
      </section>

      <section className="panel mcp-lab" aria-labelledby="mcp-lab-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">{locale === "zh-CN" ? "MCP 读取工具" : "MCP read tools"}</p>
            <h2 id="mcp-lab-title">{locale === "zh-CN" ? "只读请求预览" : "Read-only request preview"}</h2>
          </div>
          <span className="trust-tag">{locale === "zh-CN" ? "无写入" : "no writes"}</span>
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
              <option>campuses_list</option>
              <option>sources_list</option>
              <option>world_manifest_get</option>
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
            {locale === "zh-CN"
              ? "生成结构化参数预览；此页面不会调用 MCP 服务器。"
              : "Generate a structured argument preview; this page does not call the MCP server."}
          </p>
        ) : (
          <div className="operation-preview">
            <pre>
              <code>{preview}</code>
            </pre>
            <p className="empty-inline">
              {locale === "zh-CN"
                ? "当前服务器没有写工具；未来写工具必须采用预览、明确确认和幂等键。"
                : "No write tools are registered. Future writes must require preview, explicit confirmation, and an idempotency key."}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
