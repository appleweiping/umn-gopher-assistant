import { createElement } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import { AiWorkspace } from "../components/ai-workspace";
import { PreferencesProvider } from "../components/preferences";
import messages from "../messages/en.json";

describe("AI workspace secrets", () => {
  it("purges legacy settings and leaves unimplemented model connections visibly disabled", async () => {
    window.localStorage.setItem("uga.byok", "legacy-secret");
    window.localStorage.setItem("uga.local-model", "http://private-model.internal");
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
    expect(window.localStorage.getItem("uga.local-model")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Bring your own key (BYOK)" }));
    const keyInput = screen.getByLabelText("Bring your own key");
    expect(keyInput).toBeDisabled();
    expect(screen.getByRole("button", { name: "Connection unavailable" })).toBeDisabled();
    expect(screen.getByText("BYOK is not connected")).toBeInTheDocument();
    expect(window.localStorage.getItem("uga.byok")).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Local" }));
    expect(screen.getByLabelText("Local model endpoint")).toBeDisabled();
    expect(screen.getByText("Local models are not connected")).toBeInTheDocument();
  });
});
