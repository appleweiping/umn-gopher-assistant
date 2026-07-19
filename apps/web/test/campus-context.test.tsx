import { createElement, Fragment, type ReactNode } from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import { CommunityBoard } from "../components/community-board";
import { DeveloperConsole } from "../components/developer-console";
import { PreferenceControls, PreferencesProvider } from "../components/preferences";
import { WorldCatalog } from "../components/world-catalog";
import messages from "../messages/en.json";

function renderAtCampus(children: ReactNode, campus: "crookston" | "morris") {
  return render(
    createElement(NextIntlClientProvider, {
      children: createElement(PreferencesProvider, {
        children: createElement(Fragment, null, createElement(PreferenceControls), children),
        initialCampus: campus,
        initialLocale: "en",
        initialTheme: "system",
      }),
      locale: "en",
      messages,
      timeZone: "America/Chicago",
    }),
  );
}

describe("global campus context", () => {
  it("filters community posts to the selected campus", async () => {
    const user = userEvent.setup();
    renderAtCampus(createElement(CommunityBoard), "crookston");

    expect(screen.getByRole("heading", { name: "Weekend shuttle planning thread" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Where is quiet study after 6 pm?" }),
    ).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Campus" }), "morris");
    expect(screen.getByRole("heading", { name: "Found keys near the library" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Weekend shuttle planning thread" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the developer resource synchronized with the selected campus", async () => {
    const user = userEvent.setup();
    renderAtCampus(createElement(DeveloperConsole), "morris");

    expect(screen.getByRole("textbox", { name: "Resource" })).toHaveValue("morris");
    await user.selectOptions(screen.getByRole("combobox", { name: "Campus" }), "crookston");
    expect(screen.getByRole("textbox", { name: "Resource" })).toHaveValue("crookston");
  });

  it("keeps the schematic world synchronized with the selected campus", async () => {
    const user = userEvent.setup();
    renderAtCampus(createElement(WorldCatalog), "crookston");

    expect(screen.getByRole("button", { name: /Crookston/u })).toHaveAttribute("aria-pressed", "true");
    await user.selectOptions(screen.getByRole("combobox", { name: "Campus" }), "morris");
    expect(screen.getByRole("button", { name: /Morris/u })).toHaveAttribute("aria-pressed", "true");
  });
});
