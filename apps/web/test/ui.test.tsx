import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createElement, type ReactNode } from "react";

import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import { AdminConsole } from "../components/admin-console";
import { PlanWorkspace } from "../components/plan-workspace";
import { PreferencesProvider } from "../components/preferences";
import { SchematicMap, SourceBadge } from "../components/ui";
import messages from "../messages/en.json";

type JsonObject = Record<string, unknown>;

const workspaceFile = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const tokens = JSON.parse(workspaceFile("../../../design-tokens.json")) as JsonObject;
const styles = workspaceFile("../app/styles.css");
const preview = workspaceFile("../../../design-preview.html");

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertValidTokenValue(type: string, value: unknown): void {
  if (type === "color") {
    expect(value).toEqual(
      expect.objectContaining({
        colorSpace: "srgb",
        components: expect.arrayContaining([expect.any(Number)]),
        hex: expect.stringMatching(/^#[0-9a-f]{6}$/iu),
      }),
    );
    expect((value as { components: unknown[] }).components).toHaveLength(3);
    return;
  }

  if (type === "dimension") {
    expect(value).toEqual({ value: expect.any(Number), unit: expect.stringMatching(/^(px|rem)$/u) });
    return;
  }

  if (type === "duration") {
    expect(value).toEqual({ value: expect.any(Number), unit: expect.stringMatching(/^(ms|s)$/u) });
    return;
  }

  if (type === "cubicBezier") {
    expect(value).toEqual([expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number)]);
    return;
  }

  if (type === "number") {
    expect(value).toEqual(expect.any(Number));
    return;
  }

  if (type === "fontFamily") {
    expect(value).toSatisfy(
      (candidate: unknown) =>
        typeof candidate === "string" ||
        (Array.isArray(candidate) &&
          candidate.length > 0 &&
          candidate.every((family) => typeof family === "string")),
    );
    return;
  }

  if (type === "shadow") {
    const shadows = Array.isArray(value) ? value : [value];
    for (const shadow of shadows) {
      expect(shadow).toEqual(
        expect.objectContaining({
          blur: expect.objectContaining({
            value: expect.any(Number),
            unit: expect.stringMatching(/^(px|rem)$/u),
          }),
          color: expect.objectContaining({ colorSpace: "srgb", components: expect.any(Array) }),
          offsetX: expect.objectContaining({
            value: expect.any(Number),
            unit: expect.stringMatching(/^(px|rem)$/u),
          }),
          offsetY: expect.objectContaining({
            value: expect.any(Number),
            unit: expect.stringMatching(/^(px|rem)$/u),
          }),
          spread: expect.objectContaining({
            value: expect.any(Number),
            unit: expect.stringMatching(/^(px|rem)$/u),
          }),
        }),
      );
    }
    return;
  }

  throw new Error(`Unexpected DTCG token type: ${type}`);
}

function collectDtcgTokens(
  group: JsonObject,
  inheritedType?: string,
  path: readonly string[] = [],
): JsonObject[] {
  const collected: JsonObject[] = [];
  const groupType = typeof group["$type"] === "string" ? group["$type"] : inheritedType;

  for (const [name, child] of Object.entries(group)) {
    if (name.startsWith("$")) continue;
    expect(child, `${[...path, name].join(".")} must be a token or group`).toSatisfy(isObject);
    if (!isObject(child)) continue;

    if ("$value" in child) {
      const type = typeof child["$type"] === "string" ? child["$type"] : groupType;
      expect(type, `${[...path, name].join(".")} must declare or inherit $type`).toEqual(expect.any(String));
      assertValidTokenValue(type as string, child["$value"]);
      collected.push(child);
    } else {
      collected.push(...collectDtcgTokens(child, groupType, [...path, name]));
    }
  }

  return collected;
}

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "u"));
  expect(match, `${selector} must have a CSS rule`).not.toBeNull();
  return match?.[1] ?? "";
}

function declarations(selector: string): Map<string, string> {
  return new Map<string, string>(
    [...cssRule(selector).matchAll(/(--[a-z0-9-]+):\s*([^;]+);/giu)].map((match): [string, string] => [
      match[1] ?? "",
      match[2] ?? "",
    ]),
  );
}

function normalizeCss(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("'", '"')
    .replace(/\s+/gu, " ")
    .replace(/\s*,\s*/gu, ", ")
    .trim();
}

function kebabCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/gu, "$1-$2").toLowerCase();
}

function dimensionToCss(value: { readonly unit: string; readonly value: number }): string {
  return value.value === 0 ? "0" : `${value.value}${value.unit}`;
}

function colorToCss(value: unknown): string {
  if (typeof value === "string") return value;
  return (value as { readonly hex: string }).hex;
}

function tokenValue(value: unknown): unknown {
  return isObject(value) && "$value" in value ? value["$value"] : value;
}

function tokenType(value: unknown, fallback: string): string {
  return isObject(value) && typeof value["$type"] === "string" ? value["$type"] : fallback;
}

function tokenToCss(value: unknown, fallbackType: string): string {
  const type = tokenType(value, fallbackType);
  const raw = tokenValue(value);
  if (typeof raw === "string" || typeof raw === "number") return String(raw);

  if (type === "color") return colorToCss(raw);
  if (type === "dimension" || type === "duration")
    return dimensionToCss(raw as { unit: string; value: number });
  if (type === "fontFamily") {
    return (raw as string[]).map((family) => (/\s/u.test(family) ? `"${family}"` : family)).join(", ");
  }
  if (type === "cubicBezier") return `cubic-bezier(${(raw as number[]).join(", ")})`;
  if (type === "shadow") {
    const shadow = raw as {
      blur: { unit: string; value: number };
      color: { alpha?: number; components: number[] };
      offsetX: { unit: string; value: number };
      offsetY: { unit: string; value: number };
      spread: { unit: string; value: number };
    };
    const rgb = shadow.color.components.map((component) => Math.round(component * 255)).join(" ");
    const alpha = `${Math.round((shadow.color.alpha ?? 1) * 100)}%`;
    return `${dimensionToCss(shadow.offsetX)} ${dimensionToCss(shadow.offsetY)} ${dimensionToCss(shadow.blur)} ${dimensionToCss(shadow.spread)} rgb(${rgb} / ${alpha})`;
  }

  throw new Error(`Cannot convert ${type} token to CSS`);
}

function expectedCssVariables(): { dark: Map<string, string>; root: Map<string, string> } {
  const root = new Map<string, string>();
  const dark = new Map<string, string>();
  const color = tokens["color"] as JsonObject;

  for (const [theme, target] of [
    ["light", root],
    ["dark", dark],
  ] as const) {
    for (const [name, value] of Object.entries(color[theme] as JsonObject)) {
      if (name.startsWith("$")) continue;
      target.set(`--color-${kebabCase(name)}`, tokenToCss(value, "color"));
    }
  }

  const groups = ["font", "space", "radius", "shadow", "breakpoint", "motion", "target", "focus"] as const;
  const walk = (groupName: string, group: JsonObject, path: readonly string[] = [], inheritedType = "") => {
    const type = typeof group["$type"] === "string" ? group["$type"] : inheritedType;
    for (const [name, value] of Object.entries(group)) {
      if (name.startsWith("$")) continue;
      if (isObject(value) && !("$value" in value)) {
        walk(groupName, value, [...path, name], type);
      } else {
        const variable = `--${[groupName, ...path, name].map(kebabCase).join("-")}`;
        root.set(variable, tokenToCss(value, type));
      }
    }
  };
  for (const groupName of groups) walk(groupName, tokens[groupName] as JsonObject);

  return { dark, root };
}

function renderWithProviders(children: ReactNode) {
  return render(
    createElement(NextIntlClientProvider, {
      children: createElement(PreferencesProvider, {
        children,
        initialCampus: "tc",
        initialLocale: "en",
        initialTheme: "light",
      }),
      locale: "en",
      messages,
      timeZone: "America/Chicago",
    }),
  );
}

describe("shared design components", () => {
  it("communicates freshness with text and links to provenance", async () => {
    render(
      createElement(SourceBadge, {
        freshness: "aging",
        label: "One Stop",
        updatedLabel: "checked 2 days ago",
        url: "https://onestop.umn.edu/",
      }),
    );

    expect(screen.getByText(/aging/u)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /one stop/iu });
    expect(link).toHaveAttribute("href", "https://onestop.umn.edu/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAccessibleName(/one stop.*new tab/iu);
    expect(link).toHaveClass("source-link");
  });

  it("gives a schematic map a text list equivalent instead of exposing only graphics", async () => {
    render(
      createElement(SchematicMap, {
        label: "Twin Cities schematic",
        points: [{ id: "lib", label: "Library", x: 20, y: 40 }],
      }),
    );

    expect(screen.getByRole("img", { name: "Twin Cities schematic" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Twin Cities schematic locations" })).toHaveTextContent(
      "Library",
    );
  });

  it("makes external provenance links at least 24 by 24 CSS pixels", () => {
    const rule = cssRule(".source-link");
    expect(rule).toMatch(/min-height:\s*var\(--target-minimum\)/u);
    expect(rule).toMatch(/min-width:\s*var\(--target-minimum\)/u);
  });
});

describe("portable design tokens", () => {
  it("uses valid typed DTCG token objects for every design value", () => {
    expect(collectDtcgTokens(tokens).length).toBeGreaterThan(0);
  });

  it("mirrors every portable token as a CSS custom property", () => {
    const expected = expectedCssVariables();
    const actualRoot = declarations(":root");
    const actualDark = declarations('[data-theme="dark"]');

    for (const [name, value] of expected.root) {
      expect(normalizeCss(actualRoot.get(name) ?? ""), `${name} must match design-tokens.json`).toBe(
        normalizeCss(value),
      );
    }
    for (const [name, value] of expected.dark) {
      expect(normalizeCss(actualDark.get(name) ?? ""), `${name} must match the dark token`).toBe(
        normalizeCss(value),
      );
    }
  });
});

describe("design system layout contracts", () => {
  it("uses the canonical content width, defined spacing, and shadows only for elevation", () => {
    expect(styles).toContain("width: min(100%, 90rem);");
    expect(styles).not.toContain("width: min(100%, 92rem);");
    expect(styles).not.toContain("--space-5");
    expect(cssRule(".panel")).not.toContain("box-shadow");
    expect(cssRule(".signal-card")).not.toContain("box-shadow");
  });

  it("keeps the standalone preview aligned to mobile navigation and canonical breakpoints", () => {
    expect(preview).toContain('class="mobile-nav"');
    expect(preview).toContain("font-size:clamp(36px,6vw,56px)");
    expect(preview).toContain("max-width:90rem");
    expect(preview).toMatch(/@media\s*\(max-width:72rem\)/u);
    expect(preview).toMatch(/@media\s*\(max-width:52rem\)/u);
    expect(preview).toMatch(/@media\s*\(max-width:40rem\)/u);
    expect(preview).not.toContain("760px");

    for (const [light, dark] of [
      ["#174F44", "#78C3AC"],
      ["#11667A", "#71C3D2"],
      ["#A44A31", "#F09B7D"],
      ["#F4F1E8", "#0F1917"],
      ["#FFFCF5", "#16231F"],
      ["#E7ECE6", "#263A34"],
    ]) {
      expect(preview).toContain(`data-dark="${dark}" data-light="${light}"`);
    }
  });
});

describe("scrollable data regions", () => {
  it("names the keyboard-focusable plan schedule overflow region", () => {
    renderWithProviders(createElement(PlanWorkspace));
    const table = screen.getByRole("table", { name: "Week schedule" });
    expect(table.parentElement).toHaveAttribute("role", "region");
    expect(table.parentElement).toHaveAccessibleName("Week schedule");
    expect(table.parentElement).toHaveAttribute("tabindex", "0");
  });

  it("names the keyboard-focusable admin source overflow region", () => {
    renderWithProviders(createElement(AdminConsole));
    const table = screen.getByRole("table", { name: "Source health" });
    expect(table.parentElement).toHaveAttribute("role", "region");
    expect(table.parentElement).toHaveAccessibleName("Source health");
    expect(table.parentElement).toHaveAttribute("tabindex", "0");
  });
});
