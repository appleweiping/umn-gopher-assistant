import { createElement, type ReactNode } from "react";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import { AdminConsole } from "../components/admin-console";
import { DeveloperConsole } from "../components/developer-console";
import { PlanWorkspace } from "../components/plan-workspace";
import { PreferencesProvider } from "../components/preferences";
import { SchematicMap, SourceBadge } from "../components/ui";
import messages from "../messages/zh-CN.json";

function renderChinese(children: ReactNode) {
  return render(
    createElement(PreferencesProvider, {
      children: createElement(NextIntlClientProvider, {
        children,
        locale: "zh-CN",
        messages,
        timeZone: "America/Chicago",
      }),
      initialCampus: "tc",
      initialLocale: "zh-CN",
      initialTheme: "light",
    }),
  );
}

describe("Chinese localization completeness", () => {
  it("localizes shared freshness and map accessibility labels", () => {
    renderChinese(
      createElement(
        "div",
        null,
        createElement(SourceBadge, {
          freshness: "aging",
          label: "一站式学生服务",
          updatedLabel: "核验于 2026-07-19",
          url: "https://onestop.umn.edu/",
        }),
        createElement(SchematicMap, {
          label: "双城校区示意图",
          points: [{ id: "lib", label: "图书馆", x: 20, y: 40 }],
        }),
      ),
    );

    expect(screen.getByText("逐渐陈旧")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "一站式学生服务（在新标签页打开）" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "双城校区示意图 地点" })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/\b(?:aging|locations)\b/iu);
  });

  it("localizes route origins and destinations", () => {
    renderChinese(createElement(PlanWorkspace));
    const route = screen.getByRole("region", { name: "路线预演" });

    expect(within(route).getByRole("option", { name: "图书馆" })).toBeInTheDocument();
    expect(within(route).getByRole("option", { name: "科学楼" })).toBeInTheDocument();
    expect(route).not.toHaveTextContent(
      /Library|Student center|Transit stop|Science building|One Stop|Dining hall|Start|Destination/u,
    );
  });

  it("localizes admin source, moderation, and dialog state", async () => {
    const user = userEvent.setup();
    renderChinese(createElement(AdminConsole));

    expect(screen.getByRole("columnheader", { name: "校区" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "来源状态" })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/\b(?:Campus|Freshness)\b/u);

    await user.click(screen.getByRole("tab", { name: "审核队列" }));
    expect(screen.getByText("3 项待处理")).toBeInTheDocument();
    expect(screen.getByText("可能重复的住房信息")).toBeInTheDocument();
    expect(screen.getByText("中风险")).toBeInTheDocument();

    const [firstInspectButton] = screen.getAllByRole("button", { name: "检查" });
    if (firstInspectButton === undefined) throw new Error("Expected an inspect button");
    await user.click(firstInspectButton);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("风险")).toBeInTheDocument();
    expect(within(dialog).getByText("模式")).toBeInTheDocument();
    expect(within(dialog).getByText("只读演示")).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(
      /pending|low|medium|high|Possible duplicate|External payment|Category mismatch|Risk|Mode|read-only demo/u,
    );
  });

  it("localizes developer SDK and CLI descriptions", () => {
    renderChinese(createElement(DeveloperConsole));

    expect(screen.getByText("TypeScript · 稍后生成")).toBeInTheDocument();
    expect(screen.getByText("仅预览的命令语义")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/generated later|Preview-only command semantics/u);
  });
});
