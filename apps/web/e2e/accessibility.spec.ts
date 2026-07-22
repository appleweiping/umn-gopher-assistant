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
