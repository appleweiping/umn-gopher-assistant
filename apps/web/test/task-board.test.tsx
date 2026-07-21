import { createElement } from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskBoard } from "../components/task-board";

const vault = {
  addTask: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  beginSetup: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  cancelSetup: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  confirmRecoverySaved: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  deleteLegacy: vi.fn(),
  error: null as string | null,
  exportLegacy: vi.fn(),
  legacyAvailable: false,
  legacyRaw: null as string | null,
  lock: vi.fn(),
  recover: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  recoveryCode: null as string | null,
  retryLegacyImport: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  status: "unlocked" as const,
  tasks: [{ id: "reading-response", title: "Draft reading response", done: false }],
  toggleTask: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  unlock: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
};

vi.mock("../components/personal-vault-provider", () => ({
  usePersonalVault: () => vault,
}));

describe("task board", () => {
  it("renders only vault-backed tasks and never writes task plaintext to localStorage", () => {
    render(createElement(TaskBoard, { locale: "en" }));

    fireEvent.click(screen.getByRole("checkbox", { name: /reading response/u }));
    expect(vault.toggleTask).toHaveBeenCalledWith("reading-response");

    fireEvent.change(screen.getByRole("textbox", { name: "New task" }), {
      target: { value: "Book tutoring" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    expect(vault.addTask).toHaveBeenCalledWith("Book tutoring");
    expect(window.localStorage.getItem("uga.tasks")).toBeNull();
    expect(screen.getByRole("button", { name: "Lock vault" })).toBeVisible();
  });
});
