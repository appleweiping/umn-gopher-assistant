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

test("keeps visited project pages and every offline-shell chunk available offline", async ({
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
    const shell = await caches.match("/__campus-field-guide-offline-shell");
    if (!shell) return { chunkCount: 0, missing: ["offline shell"] };
    const html = await shell.clone().text();
    const chunkUrls = [
      ...new Set(
        [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/gu)]
          .map((match) => match[1])
          .filter((chunkUrl): chunkUrl is string => chunkUrl !== undefined),
      ),
    ];
    const missing = [];
    for (const chunkUrl of chunkUrls) {
      if (!(await caches.match(chunkUrl.replaceAll("&amp;", "&")))) missing.push(chunkUrl);
    }
    return { chunkCount: chunkUrls.length, missing };
  });
  expect(shellCacheState.chunkCount).toBeGreaterThan(0);
  expect(shellCacheState.missing).toEqual([]);

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("查找地点、服务、活动或课程");

    await page.goto("/not-previously-visited", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("The field guide is still here");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  } finally {
    await context.setOffline(false);
  }
});
