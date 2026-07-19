import { createElement } from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PreferenceControls, PreferencesProvider } from "../components/preferences";

describe("campus, locale, and theme preferences", () => {
  it("updates all three preferences and persists the campus and locale without hydration-only defaults", async () => {
    const user = userEvent.setup();
    render(
      createElement(PreferencesProvider, {
        children: createElement(PreferenceControls),
        initialCampus: "tc",
        initialLocale: "en",
        initialTheme: "system",
      }),
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "Campus" }), "morris");
    await user.click(screen.getByRole("button", { name: "Dark theme" }));
    await user.click(screen.getByRole("button", { name: "中文" }));

    expect(screen.getByRole("combobox", { name: "校区" })).toHaveValue("morris");
    expect(document.cookie).toContain("campus=morris");
    expect(document.cookie).toContain("locale=zh-CN");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("status")).toHaveTextContent("莫里斯校区");
  });
});
