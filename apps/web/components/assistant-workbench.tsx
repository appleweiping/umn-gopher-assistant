"use client";

import { createElement, useState, type ChangeEvent, type SubmitEventHandler } from "react";

import {
  answerQuestion,
  type AssistantAnswer,
  type AssistantCampusId,
  type AssistantLocale,
} from "../lib/assistant";

export function AssistantWorkbench(props: {
  readonly campus: AssistantCampusId;
  readonly locale: AssistantLocale;
}) {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const isChinese = props.locale === "zh-CN";
  const examples = isChinese
    ? ["图书馆几点闭馆？", "学期什么时候开始？"]
    : ["When does the library close?", "When does the term begin?"];

  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    setAnswer(answerQuestion({ campus: props.campus, locale: props.locale, query }));
  };

  return createElement(
    "div",
    { className: "assistant-workbench" },
    createElement(
      "div",
      {
        className: "example-prompts",
        "aria-label": isChinese ? "示例问题" : "Example questions",
        role: "group",
      },
      examples.map((example) =>
        createElement(
          "button",
          { className: "prompt-chip", key: example, onClick: () => setQuery(example), type: "button" },
          example,
        ),
      ),
    ),
    createElement(
      "form",
      { className: "assistant-form", onSubmit: submit, role: "search" },
      createElement(
        "label",
        { htmlFor: "assistant-query" },
        isChinese ? "询问校园资料库" : "Ask the campus index",
      ),
      createElement("textarea", {
        id: "assistant-query",
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setQuery(event.currentTarget.value),
        rows: 3,
        value: query,
      }),
      createElement(
        "button",
        { className: "button", type: "submit" },
        isChinese ? "检索来源" : "Search sources",
      ),
    ),
    answer?.state === "no-results"
      ? createElement(
          "p",
          { className: "notice notice-warning", role: "status", "aria-live": "polite" },
          isChinese
            ? "没有匹配的已审阅来源。请改写问题或直接打开校园服务目录。"
            : "No matching reviewed source. Rephrase the question or open the campus service directory.",
        )
      : null,
    answer !== null && answer.state !== "no-results"
      ? createElement(
          "section",
          { className: "answer-panel", "aria-label": isChinese ? "检索答案" : "Retrieved answer" },
          answer.paragraphs.map((paragraph, paragraphIndex) =>
            createElement(
              "p",
              { "data-testid": "answer-paragraph", key: `${paragraph.text}-${paragraphIndex}` },
              paragraph.text,
              " ",
              paragraph.citationIds.map((citationId) => {
                const citationIndex = answer.citations.findIndex((citation) => citation.id === citationId);
                return createElement("sup", { key: citationId }, `[${citationIndex + 1}]`);
              }),
            ),
          ),
          createElement(
            "ol",
            { className: "citation-list", "aria-label": isChinese ? "来源" : "Sources" },
            answer.citations.map((citation) =>
              createElement(
                "li",
                { key: citation.id },
                createElement(
                  "a",
                  { href: citation.url, rel: "noreferrer", target: "_blank" },
                  citation.label,
                ),
              ),
            ),
          ),
        )
      : null,
  );
}
