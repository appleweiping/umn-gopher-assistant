import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { aiCitation, aiResponse } from "../test/ai-fixtures";

const routes = [
  "/today",
  "/explore",
  "/plan",
  "/community",
  "/world",
  "/ai",
  "/admin",
  "/developer",
  "/offline",
] as const;
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  const summary = results.violations.map(({ id, impact, nodes }) => ({
    id,
    impact,
    targets: nodes.flatMap((node) => node.target),
  }));
  expect(results.violations, JSON.stringify(summary, null, 2)).toEqual([]);
}

async function resetVault(page: Page): Promise<void> {
  await page.goto("/plan");
  await page.evaluate(async () => {
    window.localStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("uga.personal-vault");
      request.addEventListener("success", () => resolve(), { once: true });
      request.addEventListener(
        "error",
        () => reject(request.error ?? new Error("Could not reset vault database.")),
        { once: true },
      );
      request.addEventListener("blocked", () => reject(new Error("Vault database reset was blocked.")), {
        once: true,
      });
    });
  });
  await page.reload();
}

for (const route of routes) {
  test(`${route} has no detectable WCAG A or AA violations`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator("#main-content").getByRole("heading", { level: 1 })).toBeVisible();

    await expectNoViolations(page);
  });
}

test("Chinese dark search dialog has no detectable WCAG A or AA violations", async ({ page }) => {
  await page.goto("/today");
  await page.getByRole("button", { name: "Dark theme" }).click();
  await page.getByRole("button", { name: "中文" }).click();
  await page.getByRole("button", { name: "搜索校园资料库" }).click();
  await expect(page.getByRole("dialog", { name: "搜索全部内容" })).toBeVisible();
  await expectNoViolations(page);
});

test("mobile More menu has no detectable WCAG A or AA violations", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/today");
  await page.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expectNoViolations(page);
});

test("vault recovery, unlocked, and locked states have no detectable WCAG A or AA violations", async ({
  page,
}) => {
  await resetVault(page);
  await page.getByRole("button", { name: "Create private vault" }).click();
  await expect(page.getByRole("heading", { name: "Recovery code (shown once)" })).toBeFocused();
  await expectNoViolations(page);

  await page.getByRole("button", { name: "I saved this recovery code securely" }).click();
  await expect(page.getByRole("button", { name: "Lock vault" })).toBeVisible();
  await expectNoViolations(page);

  await page.getByRole("button", { name: "Lock vault" }).click();
  await expect(page.getByRole("button", { name: "Unlock private vault" })).toBeVisible();
  await expectNoViolations(page);
});

test("legacy deletion confirmation dialog has no detectable WCAG A or AA violations", async ({ page }) => {
  await resetVault(page);
  await page.evaluate(() => window.localStorage.setItem("uga.tasks", "{broken"));
  await page.reload();
  await page.getByRole("button", { name: "Delete legacy data" }).click();
  await expect(page.getByRole("dialog", { name: "Delete legacy task data?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expectNoViolations(page);
});

test("AI evidence reflows at 320 CSS pixels and preserves keyboard focus", async ({ page }) => {
  const longToken = "campus".repeat(80);
  const response = aiResponse({
    citations: [
      aiCitation({
        excerpt: `Reviewed evidence ${longToken}`,
        title: { en: `University Libraries ${longToken}`, "zh-CN": `大学图书馆${longToken}` },
      }),
    ],
    paragraphs: [
      {
        citationIds: ["tc-library-hours"],
        id: "paragraph-long-evidence",
        text: `The reviewed record contains a deliberately long token: ${longToken}`,
      },
    ],
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ height: 900, width: 320 });
  await page.route("**/api/ai/query", async (route) => {
    await route.fulfill({ body: JSON.stringify(response), contentType: "application/json", status: 200 });
  });
  await page.goto("/ai");
  await page.getByRole("textbox", { name: "Ask the campus knowledge index" }).fill("library research help");
  await page.getByRole("button", { name: "Search reviewed sources" }).click();

  await expect(page.getByRole("heading", { name: "Answer supported by reviewed evidence" })).toBeFocused();
  await expectNoViolations(page);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).toBe(true);

  await page.getByRole("link", { name: /Citation 1:/u }).click();
  await expect(page.locator("#ai-citation-tc-library-hours")).toBeFocused();
  await page.getByRole("tab", { name: "Bring your own key (BYOK)" }).click();
  await expectNoViolations(page);
});

test("AI no-result and input-error states expose names, guidance, and focus", async ({ page }) => {
  await page.route("**/api/ai/query", async (route) => {
    await route.fulfill({
      body: JSON.stringify(aiResponse({ citations: [], paragraphs: [], state: "no-results" })),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.goto("/ai");
  const query = page.getByRole("textbox", { name: "Ask the campus knowledge index" });
  await query.fill("quantum dragon parking");
  await page.getByRole("button", { name: "Search reviewed sources" }).click();
  await expect(page.getByRole("heading", { name: "No reviewed answer found" })).toBeFocused();
  await expectNoViolations(page);

  await query.fill("<library>");
  await page.getByRole("button", { name: "Search reviewed sources" }).click();
  await expect(query).toBeFocused();
  await expect(query).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert", { name: "Revise the question" })).toContainText(
    "Use plain text between 2 and 500 characters",
  );
  await expectNoViolations(page);
});
