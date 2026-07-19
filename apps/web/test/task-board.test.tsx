import { createElement } from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TaskBoard } from "../components/task-board";

describe("task board", () => {
  it("lets a student complete and add locally persisted tasks", async () => {
    render(createElement(TaskBoard, { locale: "en" }));

    fireEvent.click(screen.getByRole("checkbox", { name: /reading response/u }));
    expect(screen.getByRole("checkbox", { name: /reading response/u })).toBeChecked();

    fireEvent.change(screen.getByRole("textbox", { name: "New task" }), {
      target: { value: "Book tutoring" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    expect(screen.getByRole("checkbox", { name: "Book tutoring" })).not.toBeChecked();
    expect(window.localStorage.getItem("uga.tasks")).toContain("Book tutoring");
    expect(screen.getByRole("status")).toHaveTextContent("Task added");
  });
});
