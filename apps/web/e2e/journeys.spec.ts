import { expect, test } from "@playwright/test";

import { CampusFieldGuidePage } from "./pages/app.page";

test("moves from Today through Explore to Plan without losing the app shell", async ({ page }) => {
  const app = new CampusFieldGuidePage(page);
  await app.open("/today");
  await expect(app.mainHeading).toHaveText("Your campus day, in one working view");

  await app.primaryLink("/explore").click();
  await expect(page).toHaveURL(/\/explore$/u);
  await expect(app.primaryLink("/explore")).toHaveAttribute("aria-current", "page");
  await page.getByRole("searchbox", { name: "Search the campus index" }).fill("transit");
  await expect(page.locator("#results-title .result-count")).toHaveText("1");
  await expect(page.getByRole("heading", { name: "Campus transit" })).toBeVisible();

  await app.primaryLink("/plan").click();
  await expect(page).toHaveURL(/\/plan$/u);
  await expect(app.primaryLink("/plan")).toHaveAttribute("aria-current", "page");
  await expect(app.mainHeading).toHaveText("Build a week you can actually follow");
});
