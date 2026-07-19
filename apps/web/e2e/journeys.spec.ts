import { expect, test } from "@playwright/test";

import { CampusFieldGuidePage, type CampusOption } from "./pages/app.page";

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

test("Chinese quick searches return relevant campus results", async ({ page }) => {
  const app = new CampusFieldGuidePage(page);
  await app.open("/today");
  await app.languageToggle.click();

  await page.getByRole("button", { name: "搜索校园资料库" }).click();
  await page.getByRole("link", { name: "图书馆", exact: true }).click();
  await expect(page).toHaveURL(/\/explore\?q=/u);
  await expect(page.locator("#results-title .result-count")).not.toHaveText("0");
  await expect(page.getByRole("heading", { name: "大学图书馆" })).toBeVisible();

  await page.getByRole("button", { name: "搜索校园资料库" }).click();
  await page.getByRole("link", { name: "交通", exact: true }).click();
  await expect(page.locator("#results-title .result-count")).not.toHaveText("0");
  await expect(page.getByRole("heading", { name: "校园交通" })).toBeVisible();
});

test("Chinese service shortcut follows all five campus contexts", async ({ page }) => {
  const serviceResults: readonly { readonly campus: CampusOption; readonly title: string }[] = [
    { campus: "tc", title: "One Stop 办事指南" },
    { campus: "duluth", title: "One Stop 办事指南" },
    { campus: "crookston", title: "One Stop 办事指南" },
    { campus: "morris", title: "莫里斯 One Stop" },
    { campus: "rochester", title: "学生服务" },
  ];
  const app = new CampusFieldGuidePage(page);
  await app.open("/today");
  await app.languageToggle.click();
  await page.getByRole("button", { name: "搜索校园资料库" }).click();
  await page.getByRole("link", { name: "一站式学生服务", exact: true }).click();

  for (const result of serviceResults) {
    await app.chooseCampus(result.campus);
    await expect(page.locator("#results-title .result-count")).toHaveText("1");
    await expect(page.getByRole("heading", { name: result.title, exact: true })).toBeVisible();
  }
});
