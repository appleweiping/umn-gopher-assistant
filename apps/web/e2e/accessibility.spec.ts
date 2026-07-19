import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

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
