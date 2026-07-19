"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";

import { getCampus } from "../lib/data/registry";
import { usePreferences } from "./preferences";

const posts = [
  {
    id: "qa-1",
    category: "q-and-a",
    title: { en: "Where is quiet study after 6 pm?", "zh-CN": "晚上六点后哪里适合安静学习？" },
    body: {
      en: "Looking for a low-noise space near transit. Please share an official hours link if possible.",
      "zh-CN": "想找靠近交通站点的低噪音空间，如能附上官方营业时间链接更好。",
    },
    author: "NorthStar27",
    age: "18m",
    campus: "tc",
  },
  {
    id: "market-1",
    category: "secondhand",
    title: { en: "Desk lamp, $12 — campus pickup", "zh-CN": "台灯 12 美元，仅校园自取" },
    body: {
      en: "Working lamp, no delivery. Inspect in a public place; no deposits or in-app payment.",
      "zh-CN": "功能正常，不配送。请在公共场所验货，不收定金、不支持应用内付款。",
    },
    author: "LakeReader",
    age: "1h",
    campus: "duluth",
  },
  {
    id: "lost-1",
    category: "lost",
    title: { en: "Found keys near the library", "zh-CN": "图书馆附近捡到钥匙" },
    body: {
      en: "Turned them in to the public safety desk. Describe the tag through the official lost-property process.",
      "zh-CN": "已交到公共安全服务台，请通过正式失物流程描述钥匙牌。",
    },
    author: "FieldNotes",
    age: "2h",
    campus: "morris",
  },
  {
    id: "housing-1",
    category: "housing",
    title: { en: "Roommate checklist for spring", "zh-CN": "春季室友沟通清单" },
    body: {
      en: "A discussion checklist only—budget, commute, guests, quiet hours. Verify leases independently.",
      "zh-CN": "仅提供沟通清单：预算、通勤、访客与安静时间。租约需自行核验。",
    },
    author: "RaptorStudy",
    age: "4h",
    campus: "rochester",
  },
  {
    id: "ride-1",
    category: "rides",
    title: { en: "Weekend shuttle planning thread", "zh-CN": "周末班车计划讨论" },
    body: {
      en: "Compare plans here, then verify the operator schedule before travel. Never send a deposit to hold a seat.",
      "zh-CN": "可在此比较计划，出发前需核对运营方时刻；切勿支付占座定金。",
    },
    author: "GoldenPrairie",
    age: "5h",
    campus: "crookston",
  },
  {
    id: "study-1",
    category: "study",
    title: { en: "Statistics review group", "zh-CN": "统计学复习小组" },
    body: {
      en: "Two one-hour sessions this week. Meet in a reservable public study room.",
      "zh-CN": "本周两次，每次一小时，在可预约的公共自习室见面。",
    },
    author: "DataTrail",
    age: "1d",
    campus: "tc",
  },
  {
    id: "event-1",
    category: "events",
    title: { en: "Low-key museum afternoon", "zh-CN": "轻松博物馆下午活动" },
    body: {
      en: "Informal meetup. Check the venue page for admission and accessibility details.",
      "zh-CN": "非正式见面活动，请在场馆页面核对入场与无障碍信息。",
    },
    author: "PaperMap",
    age: "1d",
    campus: "duluth",
  },
] as const;

export function CommunityBoard() {
  const t = useTranslations("community");
  const { campus, locale } = usePreferences();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<"detail" | "report" | "login">("detail");
  const [reportReason, setReportReason] = useState("scam");
  const [status, setStatus] = useState("");
  const dialogTriggerRef = useRef<HTMLElement | null>(null);
  const selected = posts.find((post) => post.id === selectedId);
  const categories =
    locale === "zh-CN"
      ? {
          all: "全部",
          "q-and-a": "问答",
          secondhand: "二手",
          lost: "失物",
          housing: "住房",
          rides: "拼车",
          study: "学习组",
          events: "活动",
        }
      : {
          all: "All",
          "q-and-a": "Q&A",
          secondhand: "Secondhand",
          lost: "Lost & found",
          housing: "Housing",
          rides: "Rides",
          study: "Study groups",
          events: "Events",
        };
  const reportReasons =
    locale === "zh-CN"
      ? { scam: "诈骗", harassment: "骚扰", privacy: "隐私", other: "其他" }
      : { scam: "Scam", harassment: "Harassment", privacy: "Privacy", other: "Other" };
  const filtered = useMemo(
    () =>
      posts.filter(
        (post) =>
          post.campus === campus &&
          (category === "all" || post.category === category) &&
          post.title[locale].toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale)),
      ),
    [campus, category, locale, query],
  );
  const openDialog = (id: string | null, mode: "detail" | "report" | "login") => {
    dialogTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedId(id);
    setDialogMode(mode);
    setStatus("");
  };

  return (
    <div className="community-layout">
      <aside className="community-safety">
        <strong>{locale === "zh-CN" ? "交易与身份安全" : "Transaction & identity safety"}</strong>
        <p>{t("scam")}</p>
        <p>{t("noAnonymous")}</p>
      </aside>
      <section className="community-board" aria-label={locale === "zh-CN" ? "社区帖子" : "Community posts"}>
        <div className="board-toolbar">
          <label className="grow-field">
            {t("search")}
            <input onChange={(event) => setQuery(event.target.value)} type="search" value={query} />
          </label>
          <label>
            {t("category")}
            <select onChange={(event) => setCategory(event.target.value)} value={category}>
              {Object.entries(categories).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button className="button" onClick={() => openDialog(null, "login")} type="button">
            {locale === "zh-CN" ? "发布帖子" : "Create post"}
          </button>
        </div>
        {filtered.length === 0 ? (
          <p className="empty-state">
            {locale === "zh-CN" ? "此校区没有匹配的帖子。" : "No matching posts for this campus."}
          </p>
        ) : (
          <ul className="post-list">
            {filtered.map((post) => (
              <li key={post.id}>
                <article>
                  <div className="post-meta">
                    <span>{categories[post.category]}</span>
                    <span>{post.age}</span>
                    <span>{getCampus(post.campus).name[locale]}</span>
                  </div>
                  <h2>{post.title[locale]}</h2>
                  <p>{post.body[locale]}</p>
                  <footer>
                    <span>@{post.author}</span>
                    <div>
                      <button
                        className="text-button"
                        onClick={() => openDialog(post.id, "report")}
                        type="button"
                      >
                        {t("report")}
                      </button>
                      <button
                        className="button button-quiet"
                        onClick={() => openDialog(post.id, "detail")}
                        type="button"
                      >
                        {locale === "zh-CN" ? "查看帖子" : "View post"}
                      </button>
                    </div>
                  </footer>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog.Root
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
            setDialogMode("detail");
          }
        }}
        open={selectedId !== null || dialogMode === "login"}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="dialog-content"
            onCloseAutoFocus={(event) => {
              if (dialogTriggerRef.current === null) return;
              event.preventDefault();
              dialogTriggerRef.current.focus();
              dialogTriggerRef.current = null;
            }}
          >
            <div className="dialog-heading">
              <Dialog.Title>
                {dialogMode === "login"
                  ? t("login")
                  : dialogMode === "report"
                    ? t("report")
                    : selected?.title[locale]}
              </Dialog.Title>
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
            {dialogMode === "login" ? (
              <>
                <Dialog.Description>
                  {locale === "zh-CN"
                    ? "真实版本将使用校园账号门槛，并保留明确署名；本批次不接入 SSO。"
                    : "The production path will require a campus account and accountable identity. SSO is not connected in this batch."}
                </Dialog.Description>
                <p className="notice notice-warning">{t("noAnonymous")}</p>
              </>
            ) : dialogMode === "report" ? (
              <>
                <Dialog.Description>
                  {locale === "zh-CN"
                    ? "预览举报内容；此只读演示不会发送到服务器。"
                    : "Preview the report; this read-only demo does not send it to a server."}
                </Dialog.Description>
                <fieldset>
                  <legend>{locale === "zh-CN" ? "原因" : "Reason"}</legend>
                  {(["scam", "harassment", "privacy", "other"] as const).map((reason) => (
                    <label className="check-row" key={reason}>
                      <input
                        checked={reportReason === reason}
                        name="report-reason"
                        onChange={() => setReportReason(reason)}
                        type="radio"
                      />
                      {reportReasons[reason]}
                    </label>
                  ))}
                </fieldset>
                <button
                  className="button"
                  onClick={() =>
                    setStatus(
                      locale === "zh-CN"
                        ? "本地举报预览已完成；没有发送外部请求。"
                        : "Local report preview completed; no external request was sent.",
                    )
                  }
                  type="button"
                >
                  {locale === "zh-CN" ? "完成本地预览" : "Complete local preview"}
                </button>
                <p role="status">{status}</p>
              </>
            ) : (
              <>
                <Dialog.Description>{selected?.body[locale]}</Dialog.Description>
                <dl className="detail-list">
                  <div>
                    <dt>{locale === "zh-CN" ? "作者" : "Author"}</dt>
                    <dd>@{selected?.author}</dd>
                  </div>
                  <div>
                    <dt>{locale === "zh-CN" ? "支付" : "Payment"}</dt>
                    <dd>{locale === "zh-CN" ? "应用内支付不可用" : "In-app payment unavailable"}</dd>
                  </div>
                </dl>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
