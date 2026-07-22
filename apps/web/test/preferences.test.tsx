import { createElement } from "react";

import { render, screen, waitFor } from "@testing-library/react";
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

  it("restores valid non-sensitive cookies after an anonymous offline shell hydrates", async () => {
    document.cookie = "campus=duluth; path=/";
    document.cookie = "locale=zh-CN; path=/";
    document.cookie = "theme=dark; path=/";

    render(
      createElement(PreferencesProvider, {
        children: createElement(PreferenceControls),
        initialCampus: "tc",
        initialLocale: "en",
        initialTheme: "system",
      }),
    );

    await waitFor(() => expect(screen.getByRole("combobox", { name: "校区" })).toHaveValue("duluth"));
    expect(screen.getByRole("button", { name: "深色主题" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("ignores malformed or unsupported preference cookies", async () => {
    document.cookie = "campus=not-a-campus; path=/";
    document.cookie = "locale=fr; path=/";
    document.cookie = "theme=neon; path=/";

    render(
      createElement(PreferencesProvider, {
        children: createElement(PreferenceControls),
        initialCampus: "morris",
        initialLocale: "en",
        initialTheme: "light",
      }),
    );

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Campus" })).toHaveValue("morris"));
    expect(screen.getByRole("button", { name: "Light theme" })).toHaveAttribute("aria-pressed", "true");
  });
});
