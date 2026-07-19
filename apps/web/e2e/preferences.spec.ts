import { expect, test } from "@playwright/test";

import { CampusFieldGuidePage, type CampusOption } from "./pages/app.page";

const campuses: readonly { readonly id: CampusOption; readonly name: string }[] = [
  { id: "tc", name: "Twin Cities" },
  { id: "duluth", name: "Duluth" },
  { id: "crookston", name: "Crookston" },
  { id: "morris", name: "Morris" },
  { id: "rochester", name: "Rochester" },
];

test("switches from English to Chinese and restores the locale after reload", async ({ page }) => {
  const app = new CampusFieldGuidePage(page);
  await app.open("/today");

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await app.languageToggle.click();

  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(app.mainHeading).toHaveText("把今天的校园生活放进一个可操作视图");
  await expect(app.primaryNavigation).toHaveAccessibleName("主导航");
  await expect(app.primaryLink("/today")).toHaveAttribute("aria-current", "page");
  await expect(app.primaryLink("/today")).toContainText("今日");
  await expect
    .poll(async () => (await page.context().cookies()).find(({ name }) => name === "locale")?.value)
    .toBe("zh-CN");

  await page.reload();
  await expect(app.languageToggle).toHaveText("English");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
});

test("persists every supported campus across a server render", async ({ page }) => {
  const app = new CampusFieldGuidePage(page);
  await app.open("/today");

  for (const campus of campuses) {
    await app.chooseCampus(campus.id);
    await expect(page.getByText(campus.name, { exact: true }).first()).toBeVisible();
    await expect
      .poll(async () => (await page.context().cookies()).find(({ name }) => name === "campus")?.value)
      .toBe(campus.id);
    await page.reload();
    await expect(app.campusSelect).toHaveValue(campus.id);
  }
});
