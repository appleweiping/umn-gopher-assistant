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
  await user.type(screen.getByRole("textbox", { name: "Ask the campus project-summary index" }), question);
  await user.click(screen.getByRole("button", { name: "Search project summaries" }));
}

afterEach(() => vi.restoreAllMocks());

describe("AI retrieval workbench", () => {
  it("shows project-summary provenance separately from the official verification link", async () => {
    const firstCitation = aiCitation();
    const secondCitation = aiCitation({
      contentSha256: "b".repeat(64),
      documentId: "tc-library-spaces-overview",
      id: "tc-library-calendar",
      title: { en: "Twin Cities library spaces starting point", "zh-CN": "双城校区图书馆空间入口" },
      verificationLink: {
        ...firstCitation.verificationLink,
        sourceId: "official-tc-library-spaces",
        sourceUrl: "https://www.lib.umn.edu/spaces",
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        aiResponse({
          citations: [firstCitation, secondCitation],
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
    const firstMarker = screen.getByRole("link", {
      name: "Project summary 1: Twin Cities library starting point",
    });
    expect(firstMarker).toHaveAttribute("href", "#ai-citation-tc-library-hours");
    const summaryLink = screen.getByRole("link", {
      name: "Open summary provenance: Twin Cities library starting point Opens in a new tab.",
    });
    expect(summaryLink).toHaveAttribute(
      "href",
      "https://github.com/appleweiping/umn-gopher-assistant/blob/main/apps/ai-knowledge/ai_knowledge/data/corpus.json",
    );
    expect(summaryLink).toHaveAttribute("rel", "noopener noreferrer");
    const officialLink = screen.getByRole("link", {
      name: "Open official page to verify: Twin Cities library starting point Opens in a new tab.",
    });
    expect(officialLink).toHaveAttribute("href", "https://www.lib.umn.edu/services/hours");
    expect(officialLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getAllByText("Project-authored; not independently verified")).toHaveLength(2);
    expect(screen.getAllByText("Project summary excerpt:")).toHaveLength(2);
    expect(screen.getByText("5 project summaries searched")).toBeInTheDocument();
    expect(screen.getByText(/written by the independent project, not UMN/iu)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Relevant project summary found" })).toHaveAttribute(
      "aria-describedby",
      "ai-answer-disclosure",
    );
    expect(screen.getByText("Schematic summary")).toHaveClass("ai-state-schematic");
    expect(document.body).not.toHaveTextContent(
      /reviewed evidence|reviewed sources|evidence-backed response/iu,
    );
    expect(document.body).not.toHaveTextContent(/\banswered\b/iu);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Relevant project summary found" })).toHaveFocus(),
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

    expect(
      await screen.findByRole("region", { name: "No matching project summary found" }),
    ).toHaveTextContent("no answer is shown");
    expect(screen.getByRole("heading", { name: "No matching project summary found" })).toHaveFocus();
    expect(screen.queryByTestId("answer-paragraph")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Summary provenance and verification links" }),
    ).not.toBeInTheDocument();
  });

  it("keeps stale and conflict uncertainty visible instead of silently resolving it", async () => {
    const stale = aiResponse({
      citations: [aiCitation({ summaryFreshnessState: "STALE" })],
      state: "stale",
    });
    const firstCitation = aiCitation();
    const conflictingCitation = aiCitation({
      contentSha256: "b".repeat(64),
      documentId: "tc-library-conflicting-overview",
      id: "tc-library-conflict",
      summaryFreshnessState: "EXPIRED",
      title: { en: "Twin Cities library notice summary", "zh-CN": "双城校区图书馆通知摘要" },
      verificationLink: {
        ...firstCitation.verificationLink,
        sourceId: "official-tc-library-about",
        sourceUrl: "https://www.lib.umn.edu/about",
      },
    });
    const conflict = aiResponse({
      citations: [firstCitation, conflictingCitation],
      paragraphs: [
        {
          citationIds: ["tc-library-hours", "tc-library-conflict"],
          id: "paragraph-conflict",
          text: "The project-authored summaries report different schedules.",
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
    expect(await screen.findByText(/historical orientation/iu)).toBeInTheDocument();

    view.unmount();
    renderWorkbench();
    await submitQuestion();
    expect(await screen.findByText(/project-authored summaries disagree/iu)).toBeInTheDocument();
    expect(screen.getByText(/historical orientation/iu)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /project summary \d/iu })).toHaveLength(2);
    expect(screen.getAllByRole("status")).toHaveLength(1);
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

    expect(screen.getByRole("status")).toHaveTextContent("Searching project-authored campus summaries");
    expect(screen.getByRole("button", { name: "Searching…" })).toBeDisabled();
    resolveResponse?.(
      Response.json(
        { detail: "redis://admin:secret@internal", failureCode: "AI_SERVICE_UNAVAILABLE" },
        { status: 503 },
      ),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("No answer is shown");
    expect(screen.getByRole("alert")).not.toHaveTextContent("redis://");
    expect(screen.getByRole("heading", { name: "The project-summary index is unavailable" })).toHaveFocus();
  });

  it("identifies invalid input, describes the correction, and returns focus to the query", async () => {
    const upstream = vi.spyOn(globalThis, "fetch");
    const user = userEvent.setup();
    renderWorkbench();
    const query = screen.getByRole("textbox", { name: "Ask the campus project-summary index" });
    fireEvent.change(query, { target: { value: "<library>" } });
    await user.click(screen.getByRole("button", { name: "Search project summaries" }));

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
    expect(screen.getByRole("textbox", { name: "Ask the campus project-summary index" })).not.toHaveAttribute(
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

  it("renders the Chinese schematic disclosure, provenance, and verification link without English fallbacks", async () => {
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
    await user.type(screen.getByRole("textbox", { name: "查询校园项目摘要索引" }), "图书馆什么时候开放？");
    await user.click(screen.getByRole("button", { name: "检索项目摘要" }));

    expect(await screen.findByRole("heading", { name: "找到相关的项目编写摘要" })).toBeInTheDocument();
    expect(screen.getByText(/本独立项目编写、并非明尼苏达大学发布/u)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "打开官方页面核验：双城校区图书馆入口 将在新标签页打开。" }),
    ).toHaveAttribute("href", "https://www.lib.umn.edu/services/hours");
    expect(
      screen.getByRole("link", { name: "查看摘要出处：双城校区图书馆入口 将在新标签页打开。" }),
    ).toHaveAttribute("href", expect.stringContaining("github.com/appleweiping/umn-gopher-assistant"));
    expect(screen.getByText("项目编写；尚未独立核验")).toBeInTheDocument();
    expect(screen.getByText("已检索 5 份项目摘要")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/已审阅来源|审阅证据|答案已有/u);
  });
});
