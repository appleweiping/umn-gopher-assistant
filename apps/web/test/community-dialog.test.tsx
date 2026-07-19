import { createElement } from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import { CommunityBoard } from "../components/community-board";
import { PreferencesProvider } from "../components/preferences";
import messages from "../messages/en.json";

function renderCommunity() {
  return render(
    createElement(PreferencesProvider, {
      children: createElement(NextIntlClientProvider, {
        children: createElement(CommunityBoard),
        locale: "en",
        messages,
        timeZone: "America/Chicago",
      }),
      initialCampus: "tc",
      initialLocale: "en",
      initialTheme: "light",
    }),
  );
}

describe("community login dialog", () => {
  it("closes with Escape and the close button while restoring focus", async () => {
    const user = userEvent.setup();
    renderCommunity();
    const trigger = screen.getByRole("button", { name: "Create post" });

    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Sign in required to post" })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Sign in required to post" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Sign in required to post" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
