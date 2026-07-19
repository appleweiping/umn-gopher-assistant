import { createElement } from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlanWorkspace } from "../components/plan-workspace";
import { PreferencesProvider } from "../components/preferences";
import messages from "../messages/en.json";

function renderPlan() {
  return render(
    createElement(PreferencesProvider, {
      children: createElement(NextIntlClientProvider, {
        children: createElement(PlanWorkspace),
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

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Unable to read calendar blob")));
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Expected calendar text"));
        return;
      }
      resolve(reader.result);
    });
    reader.readAsText(blob);
  });
}

function eventStart(calendar: string, id: string): string {
  const event = calendar
    .split("BEGIN:VEVENT")
    .find((candidate) => candidate.includes(`UID:${id}@umn-gopher-assistant.local`));
  const start = event?.match(/DTSTART:(\d{8}T\d{6}Z)/u)?.[1];
  if (start === undefined) throw new Error(`Missing DTSTART for ${id}`);
  return start;
}

afterEach(() => vi.restoreAllMocks());

describe("plan calendar export", () => {
  it("maps repeated weekdays to the same explicit week while retaining conflict detection", async () => {
    const user = userEvent.setup();
    let exportedBlob: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      if (!(blob instanceof Blob)) throw new Error("Expected a calendar blob");
      exportedBlob = blob;
      return "blob:calendar";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    renderPlan();

    expect(screen.getByRole("alert")).toHaveTextContent("BIO ↔ WRITING");
    await user.click(screen.getByRole("button", { name: "Export ICS" }));
    if (exportedBlob === undefined) throw new Error("Expected an exported calendar blob");
    const calendar = await readBlob(exportedBlob);

    expect(eventStart(calendar, "bio")).toBe("20260831T140000Z");
    expect(eventStart(calendar, "writing")).toBe("20260831T144500Z");
    expect(eventStart(calendar, "stats")).toBe("20260902T160000Z");
  });
});
