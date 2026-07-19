import { createElement } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import { AiWorkspace } from "../components/ai-workspace";
import { PreferencesProvider } from "../components/preferences";
import messages from "../messages/en.json";

describe("AI workspace secrets", () => {
  it("removes a legacy BYOK value and keeps the submitted key in memory only", async () => {
    window.localStorage.setItem("uga.byok", "legacy-secret");
    const user = userEvent.setup();
    render(
      createElement(PreferencesProvider, {
        children: createElement(NextIntlClientProvider, {
          children: createElement(AiWorkspace),
          locale: "en",
          messages,
        }),
        initialCampus: "tc",
        initialLocale: "en",
        initialTheme: "system",
      }),
    );

    await waitFor(() => expect(window.localStorage.getItem("uga.byok")).toBeNull());
    await user.click(screen.getByRole("tab", { name: "BYOK" }));
    const keyInput = screen.getByLabelText("Bring your own key");
    expect(keyInput).toHaveValue("");

    await user.type(keyInput, "new-secret");
    await user.click(screen.getByRole("button", { name: "Use for this tab" }));

    expect(keyInput).toHaveValue("new-secret");
    expect(window.localStorage.getItem("uga.byok")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Key kept in memory for this tab only.");
  });
});
