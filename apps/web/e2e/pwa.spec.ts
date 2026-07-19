import { expect, test } from "@playwright/test";

import { CampusFieldGuidePage } from "./pages/app.page";

test("publishes a compatible manifest and precisely excludes private and cross-origin requests", async ({
  page,
}) => {
  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({
    display: "standalone",
    id: "/",
    name: "Campus Field Guide",
    scope: "/",
    start_url: "/today",
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ purpose: "any", sizes: "192x192", type: "image/svg+xml" }),
      expect.objectContaining({ purpose: "any", sizes: "512x512", type: "image/svg+xml" }),
      expect.objectContaining({ purpose: "maskable", sizes: "512x512", type: "image/svg+xml" }),
    ]),
  );

  const workerResponse = await page.request.get("/sw.js");
  expect(workerResponse.ok()).toBe(true);
  const workerSource = await workerResponse.text();
  expect(workerSource).toContain("url.origin !== self.location.origin");
  expect(workerSource).toContain('pathname === "/v1"');
  expect(workerSource).toContain('pathname.startsWith("/v1/")');
  expect(workerSource).toContain('pathname === "/api"');
  expect(workerSource).toContain('pathname.startsWith("/api/")');
});

test("serves strict security headers, a same-origin theme bootstrap, and cookie-localized metadata", async ({
  context,
  page,
}) => {
  await context.addCookies([
    { name: "locale", value: "zh-CN", url: "http://127.0.0.1:3000" },
    { name: "theme", value: "dark", url: "http://127.0.0.1:3000" },
  ]);

  const response = await page.goto("/today");
  expect(response).not.toBeNull();
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["content-security-policy"]).toContain("object-src 'none'");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).not.toContain("'unsafe-eval'");
  expect(headers["content-security-policy"]).not.toContain("'unsafe-inline'");
  expect(headers["content-security-policy"]).toMatch(/script-src[^;]*'nonce-[^']+'/u);
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["permissions-policy"]).toContain("camera=()");

  await expect(page).toHaveTitle("校园随身指南");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    "覆盖明尼苏达大学五个校区的独立中英双语助手。",
  );
  await expect(page.locator('script[src="/theme-boot.js"][nonce]')).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("keeps visited project pages and the Chinese offline shell available offline", async ({
  context,
  page,
}) => {
  await context.addCookies([{ name: "locale", value: "zh-CN", url: "http://127.0.0.1:3000" }]);
  const app = new CampusFieldGuidePage(page);
  await app.open("/explore");
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect(app.mainHeading).toHaveText("查找地点、服务、活动或课程");

  await expect.poll(() => page.evaluate(async () => Boolean(await caches.match("/explore")))).toBe(true);
  const shellCacheState = await page.evaluate(async () => {
    const shellKeys = ["/__campus-field-guide-offline-shell-en", "/__campus-field-guide-offline-shell-zh-CN"];
    const missing: string[] = [];
    let chunkCount = 0;

    for (const shellKey of shellKeys) {
      const shell = await caches.match(shellKey);
      if (!shell) {
        missing.push(shellKey);
        continue;
      }
      const html = await shell.clone().text();
      const chunkUrls = [
        ...new Set(
          [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/gu)]
            .map((match) => match[1])
            .filter((chunkUrl): chunkUrl is string => chunkUrl !== undefined),
        ),
      ];
      chunkCount += chunkUrls.length;
      for (const chunkUrl of chunkUrls) {
        if (!(await caches.match(chunkUrl.replaceAll("&amp;", "&")))) {
          missing.push(`${shellKey}:${chunkUrl}`);
        }
      }
    }
    return { chunkCount, missing };
  });
  expect(shellCacheState.chunkCount).toBeGreaterThan(0);
  expect(shellCacheState.missing).toEqual([]);

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("查找地点、服务、活动或课程");

    await page.goto("/not-previously-visited", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("校园指南仍可打开");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page).toHaveTitle("校园随身指南");
  } finally {
    await context.setOffline(false);
  }
});

test("uses the English offline shell for an unvisited page", async ({ context, page }) => {
  await page.goto("/today");
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await context.setOffline(true);
  try {
    await page.goto("/another-unvisited-page", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("The field guide is still here");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveTitle("Campus Field Guide");
  } finally {
    await context.setOffline(false);
  }
});

test("does not reuse an English page after switching to Chinese offline", async ({ context, page }) => {
  const app = new CampusFieldGuidePage(page);
  await app.open("/explore");
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect(app.mainHeading).toHaveText("Find a place, service, event, or course");

  await app.languageToggle.click();
  await expect(app.mainHeading).toHaveText("查找地点、服务、活动或课程");
  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(app.mainHeading).toHaveText("校园指南仍可打开");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  } finally {
    await context.setOffline(false);
  }
});
