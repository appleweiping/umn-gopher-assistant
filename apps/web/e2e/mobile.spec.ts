import { expect, test, type Page } from "@playwright/test";

import { CampusFieldGuidePage } from "./pages/app.page";

async function expectMobileLayoutToFit(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    )
    .toBe(true);

  const lastControl = page
    .locator(
      ".app-main a:visible, .app-main button:visible, .app-main input:visible, .app-main select:visible, .app-main textarea:visible, .app-main summary:visible, .app-main [tabindex]:visible",
    )
    .last();
  if ((await lastControl.count()) === 0) return;
  await lastControl.evaluate((element) => element.scrollIntoView({ behavior: "instant", block: "end" }));
  await expect
    .poll(async () => {
      const [controlBox, navigationBox] = await Promise.all([
        lastControl.boundingBox(),
        page.locator(".mobile-nav").boundingBox(),
      ]);
      if (controlBox === null || navigationBox === null) return false;
      return controlBox.y + controlBox.height <= navigationBox.y + 1;
    })
    .toBe(true);
}

test("supports touch navigation, keyboard shortcuts, and mobile preferences", async ({
  browserName,
  page,
}) => {
  const app = new CampusFieldGuidePage(page);
  await app.open("/today");

  await expect(app.mobileNavigation).toBeVisible();
  for (const link of await app.mobileNavigation.getByRole("link").all()) {
    expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  await expect(page.locator("body")).toBeFocused();
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  if (browserName === "webkit") {
    // Mobile WebKit's default sequential-navigation policy skips links and starts at controls.
    await expect(page.getByRole("button", { name: "Search campus index" })).toBeFocused();
  } else {
    await expect(skipLink).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(app.main).toBeFocused();
  }

  await page.keyboard.press("/");
  await expect(page.getByRole("dialog", { name: "Search everything" })).toBeVisible();
  await expect(page.locator("#global-search")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Search campus index" })).toBeFocused();

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "中文" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

  await expectMobileLayoutToFit(page);
  for (const route of ["/explore", "/plan", "/community", "/world"] as const) {
    await page.goto(route);
    await expect(page.locator("main h1")).toBeVisible();
    await expectMobileLayoutToFit(page);
  }

  await app.mobileLink("/explore").click();
  await expect(page).toHaveURL(/\/explore$/u);
  await expect(app.mobileLink("/explore")).toHaveAttribute("aria-current", "page");
  await expect(app.mainHeading).toHaveText("查找地点、服务、活动或课程");
});
