import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssistantWorkbench } from "../components/assistant-workbench";
import messages from "../messages/en.json";
import zhMessages from "../messages/zh-CN.json";
import { aiCitation, aiResponse } from "./ai-fixtures";

function workbench(campus: "tc" | "duluth" = "tc", locale: "en" | "zh-CN" = "en") {
  return (
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? messages : zhMessages}>
      <AssistantWorkbench campus={campus} locale={locale} />
    </NextIntlClientProvider>
  );
}

function renderWorkbench(campus: "tc" | "duluth" = "tc", locale: "en" | "zh-CN" = "en") {
  return render(workbench(campus, locale));
}

async function submitQuestion(question = "When is the library open?") {
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Ask the campus knowledge index" }), question);
  await user.click(screen.getByRole("button", { name: "Search reviewed sources" }));
}

afterEach(() => vi.restoreAllMocks());

describe("AI retrieval workbench", () => {
  it("shows visible citation markers and complete official evidence cards for every paragraph", async () => {
    const secondCitation = aiCitation({
      contentSha256: "b".repeat(64),
      id: "tc-library-calendar",
      sourceId: "tc-library-calendar",
      sourceUrl: "https://www.lib.umn.edu/spaces",
      title: { en: "University Libraries spaces", "zh-CN": "大学图书馆空间" },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        aiResponse({
          citations: [aiCitation(), secondCitation],
          paragraphs: [
            {
              citationIds: ["tc-library-hours"],
              id: "paragraph-1",
              text: "Library hours vary by date.",
            },
            {
              citationIds: ["tc-library-calendar"],
              id: "paragraph-2",
              text: "Review the official spaces page before traveling.",
            },
          ],
        }),
      ),
    );
    renderWorkbench();
    await submitQuestion();

    const paragraphs = await screen.findAllByTestId("answer-paragraph");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toHaveTextContent("[1]");
    expect(paragraphs[1]).toHaveTextContent("[2]");
    const firstMarker = screen.getByRole("link", { name: "Citation 1: University Libraries hours" });
    expect(firstMarker).toHaveAttribute("href", "#ai-citation-tc-library-hours");
    const officialLink = screen.getByRole("link", {
      name: "Open official source: University Libraries hours Opens in a new tab.",
    });
    expect(officialLink).toHaveAttribute("href", "https://www.lib.umn.edu/services/hours");
    expect(officialLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getAllByText("Campus reviewed")).toHaveLength(2);
    expect(screen.getAllByText("Evidence summary:")).toHaveLength(2);
    expect(screen.getByText("5 reviewed documents considered")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Answer supported by reviewed evidence" })).toHaveFocus(),
    );
    firstMarker.click();
    expect(document.getElementById("ai-citation-tc-library-hours")).toHaveFocus();
  });

  it("announces no results without rendering an answer or citation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(aiResponse({ citations: [], paragraphs: [], state: "no-results" })),
    );
    renderWorkbench();
    await submitQuestion("quantum dragon parking");

    expect(await screen.findByRole("region", { name: "No reviewed answer found" })).toHaveTextContent(
      "did not generate an answer",
    );
    expect(screen.getByRole("heading", { name: "No reviewed answer found" })).toHaveFocus();
    expect(screen.queryByTestId("answer-paragraph")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Reviewed sources" })).not.toBeInTheDocument();
  });

  it("keeps stale and conflict uncertainty visible instead of silently resolving it", async () => {
    const stale = aiResponse({
      citations: [aiCitation({ freshnessState: "STALE" })],
      state: "stale",
    });
    const conflictingCitation = aiCitation({
      contentSha256: "b".repeat(64),
      freshnessState: "EXPIRED",
      id: "tc-library-conflict",
      sourceId: "tc-library-conflict",
      sourceUrl: "https://www.lib.umn.edu/about",
      title: { en: "University Libraries notice", "zh-CN": "大学图书馆通知" },
    });
    const conflict = aiResponse({
      citations: [aiCitation(), conflictingCitation],
      paragraphs: [
        {
          citationIds: ["tc-library-hours", "tc-library-conflict"],
          id: "paragraph-conflict",
          text: "The reviewed notices report different schedules.",
        },
      ],
      state: "conflict",
    });
    const upstream = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(stale))
      .mockResolvedValueOnce(Response.json(conflict));
    const view = renderWorkbench();
    await submitQuestion();
    expect(await screen.findByText(/historical context/iu)).toBeInTheDocument();

    view.unmount();
    renderWorkbench();
    await submitQuestion();
    expect(await screen.findByText(/reviewed sources disagree/iu)).toBeInTheDocument();
    expect(screen.getByText(/historical context/iu)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /citation/iu })).toHaveLength(2);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("announces loading, disables duplicate submission, and renders a sanitized failure", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    renderWorkbench();
    await submitQuestion();

    expect(screen.getByRole("status")).toHaveTextContent("Searching reviewed campus evidence");
    expect(screen.getByRole("button", { name: "Searching…" })).toBeDisabled();
    resolveResponse?.(
      Response.json(
        { detail: "redis://admin:secret@internal", failureCode: "AI_SERVICE_UNAVAILABLE" },
        { status: 503 },
      ),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("No answer was generated");
    expect(screen.getByRole("alert")).not.toHaveTextContent("redis://");
    expect(screen.getByRole("heading", { name: "The campus index is unavailable" })).toHaveFocus();
  });

  it("identifies invalid input, describes the correction, and returns focus to the query", async () => {
    const upstream = vi.spyOn(globalThis, "fetch");
    const user = userEvent.setup();
    renderWorkbench();
    const query = screen.getByRole("textbox", { name: "Ask the campus knowledge index" });
    fireEvent.change(query, { target: { value: "<library>" } });
    await user.click(screen.getByRole("button", { name: "Search reviewed sources" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Use plain text between 2 and 500 characters");
    expect(query).toHaveAttribute("aria-invalid", "true");
    expect(query).toHaveAttribute("aria-errormessage", "assistant-query-error");
    expect(query).toHaveFocus();
    expect(upstream).not.toHaveBeenCalled();
  });

  it("distinguishes a rate limit from a service outage", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ failureCode: "AI_RATE_LIMITED" }, { status: 429 }),
    );
    renderWorkbench();
    await submitQuestion();

    expect(await screen.findByRole("alert")).toHaveTextContent("Wait briefly before searching again");
    expect(screen.getByRole("heading", { name: "Search limit reached" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Ask the campus knowledge index" })).not.toHaveAttribute(
      "aria-invalid",
    );
  });

  it("clears evidence synchronously when the selected campus changes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(aiResponse()));
    const view = renderWorkbench();
    await submitQuestion();
    expect(await screen.findByTestId("answer-paragraph")).toBeInTheDocument();

    view.rerender(workbench("duluth"));

    expect(screen.queryByTestId("answer-paragraph")).not.toBeInTheDocument();
    expect(screen.getByText("Campus:").parentElement).toHaveTextContent("Duluth");
  });

  it("renders the Chinese query, state, citation metadata, and official link without English fallbacks", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        aiResponse({
          citations: [aiCitation({ excerpt: "开放时间会随日期变化，出发前请核对官方日程。" })],
          locale: "zh-CN",
          paragraphs: [
            {
              citationIds: ["tc-library-hours"],
              id: "paragraph-zh",
              text: "图书馆开放时间会随日期变化。",
            },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    renderWorkbench("tc", "zh-CN");
    await user.type(screen.getByRole("textbox", { name: "询问校园知识索引" }), "图书馆什么时候开放？");
    await user.click(screen.getByRole("button", { name: "检索已审阅来源" }));

    expect(await screen.findByRole("heading", { name: "答案已有审阅证据支持" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "打开官方来源：大学图书馆开放时间 将在新标签页打开。" }),
    ).toHaveAttribute("href", "https://www.lib.umn.edu/services/hours");
    expect(screen.getByText("校方已审阅")).toBeInTheDocument();
    expect(screen.getByText("已检查 5 份审阅文档")).toBeInTheDocument();
  });
});
