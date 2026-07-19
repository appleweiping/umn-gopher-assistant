import { createElement } from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AssistantWorkbench } from "../components/assistant-workbench";

describe("AI retrieval workbench", () => {
  it("renders numbered source links for the citations attached to every answer paragraph", async () => {
    const user = userEvent.setup();
    render(createElement(AssistantWorkbench, { campus: "tc", locale: "en" }));
    await user.type(
      screen.getByRole("textbox", { name: "Ask the campus index" }),
      "When does the library close?",
    );
    await user.click(screen.getByRole("button", { name: "Search sources" }));

    expect(screen.getByTestId("answer-paragraph")).toHaveTextContent("[1]");
    expect(screen.getByRole("link", { name: /university libraries/iu })).toHaveAttribute(
      "href",
      "https://www.lib.umn.edu/",
    );
  });

  it("announces no results instead of showing an uncited generated answer", async () => {
    const user = userEvent.setup();
    render(createElement(AssistantWorkbench, { campus: "crookston", locale: "en" }));

    await user.type(screen.getByRole("textbox", { name: "Ask the campus index" }), "quantum dragon parking");
    await user.click(screen.getByRole("button", { name: "Search sources" }));

    expect(screen.getByRole("status")).toHaveTextContent("No matching reviewed source");
    expect(screen.queryByTestId("answer-paragraph")).not.toBeInTheDocument();
  });
});
