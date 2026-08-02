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
const aiTest = test.extend({});

// Network interception must reach the AI BFF in every engine. A previously
// installed service worker can otherwise answer before page.route sees the
// request, making the accessibility fixture exercise runtime configuration.
aiTest.use({ serviceWorkers: "block" });

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

aiTest("AI schematic summaries reflow at 320 CSS pixels and preserve keyboard focus", async ({ page }) => {
  const longToken = "campus".repeat(80);
  const response = aiResponse({
    citations: [
      aiCitation({
        excerpt: `Project-authored summary ${longToken}`,
        title: { en: `Library summary ${longToken}`, "zh-CN": `图书馆项目摘要${longToken}` },
      }),
    ],
    paragraphs: [
      {
        citationIds: ["tc-library-hours"],
        id: "paragraph-long-summary",
        text: `The project-authored summary contains a deliberately long token: ${longToken}`,
      },
    ],
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ height: 900, width: 320 });
  await page.route("**/api/ai/query", async (route) => {
    await route.fulfill({ body: JSON.stringify(response), contentType: "application/json", status: 200 });
  });
  await page.goto("/ai");
  const query = page.getByRole("textbox", { name: "Ask the campus project-summary index" });
  await page.getByRole("button", { name: "When is the library open?" }).click();
  await expect(query).toHaveValue("When is the library open?");
  await query.fill("library research help");
  await page.getByRole("button", { name: "Search project summaries" }).click();

  await expect(page.getByRole("heading", { name: "Relevant project summary found" })).toBeFocused();
  await expect(page.getByText(/written by the independent project, not UMN/iu)).toBeVisible();
  await expect(page.getByText("Schematic summary")).toHaveClass(/ai-state-schematic/u);
  await expectNoViolations(page);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).toBe(true);

  await page.getByRole("link", { name: /Project summary 1:/u }).click();
  await expect(page.locator("#ai-citation-tc-library-hours")).toBeFocused();
  await page.getByRole("tab", { name: "Bring your own key (BYOK)" }).click();
  await expectNoViolations(page);
});

aiTest("AI no-result and input-error states expose names, guidance, and focus", async ({ page }) => {
  await page.route("**/api/ai/query", async (route) => {
    await route.fulfill({
      body: JSON.stringify(aiResponse({ citations: [], paragraphs: [], state: "no-results" })),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.goto("/ai");
  const query = page.getByRole("textbox", { name: "Ask the campus project-summary index" });
  await query.fill("quantum dragon parking");
  await page.getByRole("button", { name: "Search project summaries" }).click();
  await expect(page.getByRole("heading", { name: "No matching project summary found" })).toBeFocused();
  await expectNoViolations(page);

  await query.fill("<library>");
  await page.getByRole("button", { name: "Search project summaries" }).click();
  await expect(query).toBeFocused();
  await expect(query).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert", { name: "Revise the question" })).toContainText(
    "Use plain text between 2 and 500 characters",
  );
  await expectNoViolations(page);
});

aiTest("Chinese AI schematic provenance and verification links are accessible", async ({ page }) => {
  const response = aiResponse({
    citations: [aiCitation({ excerpt: "此项目摘要提供图书馆入口；当前信息请通过官方页面核验。" })],
    locale: "zh-CN",
    paragraphs: [
      {
        citationIds: ["tc-library-hours"],
        id: "paragraph-zh-summary",
        text: "此项目摘要提供双城校区图书馆入口。",
      },
    ],
  });
  await page.route("**/api/ai/query", async (route) => {
    await route.fulfill({ body: JSON.stringify(response), contentType: "application/json", status: 200 });
  });
  await page.goto("/ai");
  await page.getByRole("button", { name: "中文" }).click();
  await page.getByRole("textbox", { name: "查询校园项目摘要索引" }).fill("图书馆在哪里？");
  await page.getByRole("button", { name: "检索项目摘要" }).click();

  await expect(page.getByRole("heading", { name: "找到相关的项目编写摘要" })).toBeFocused();
  await expect(page.getByText(/本独立项目编写、并非明尼苏达大学发布/u)).toBeVisible();
  await expect(page.getByRole("link", { name: /查看摘要出处/u })).toBeVisible();
  await expect(page.getByRole("link", { name: /打开官方页面核验/u })).toBeVisible();
  await expectNoViolations(page);
});
