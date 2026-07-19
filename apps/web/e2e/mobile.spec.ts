import { expect, test } from "@playwright/test";

import { CampusFieldGuidePage } from "./pages/app.page";

test("supports touch navigation, keyboard shortcuts, and mobile preferences", async ({ page }) => {
  const app = new CampusFieldGuidePage(page);
  await app.open("/today");

  await expect(app.mobileNavigation).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    )
    .toBe(true);
  for (const link of await app.mobileNavigation.getByRole("link").all()) {
    expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(app.main).toBeFocused();

  await page.keyboard.press("/");
  await expect(page.getByRole("dialog", { name: "Search everything" })).toBeVisible();
  await expect(page.locator("#global-search")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Search campus index" })).toBeFocused();

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "中文" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

  await app.mobileLink("/explore").click();
  await expect(page).toHaveURL(/\/explore$/u);
  await expect(app.mobileLink("/explore")).toHaveAttribute("aria-current", "page");
  await expect(app.mainHeading).toHaveText("查找地点、服务、活动或课程");
});
