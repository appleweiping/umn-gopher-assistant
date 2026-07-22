import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";

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
  expect(workerSource).toContain("function isPlanPath(pathname)");
  expect(workerSource).toContain("public-vault-shell-v1");
  expect(workerSource).toContain('credentials: "omit"');
  expect(workerSource).toContain("crypto.subtle.digest");
  expect(workerSource).toContain("HASHED_VAULT_WORKER_PATH");
  expect(workerSource).toContain('request.headers.has("x-uga-vault")');
  expect(workerSource).toContain('searchParams.has("__uga_vault")');
  expect(workerSource).toContain("function isLocaleMessage(message)");
  expect(workerSource).toContain("keys.length === 2");
  expect(workerSource).not.toMatch(/\bindexeddb\b/iu);
  expect(workerSource).not.toContain("postMessage(");

  const bootstrapResponse = await page.request.get("/__uga-vault/personal-vault.worker.mjs");
  expect(bootstrapResponse.ok()).toBe(true);
  expect(bootstrapResponse.headers()["cache-control"]).toContain("no-store");
  const bootstrapSource = await bootstrapResponse.text();
  const artifactMatch = bootstrapSource.match(
    /^import "\.\/(personal-vault\.worker\.([a-f0-9]{64})\.mjs)";\n?$/u,
  );
  expect(artifactMatch).not.toBeNull();
  const artifactFilename = artifactMatch?.[1] ?? "";
  const expectedDigest = artifactMatch?.[2] ?? "";
  const artifactResponse = await page.request.get(`/__uga-vault/${artifactFilename}`);
  expect(artifactResponse.ok()).toBe(true);
  expect(artifactResponse.headers()["cache-control"]).toContain("max-age=31536000");
  expect(artifactResponse.headers()["cache-control"]).toContain("immutable");
  expect(
    createHash("sha256")
      .update(await artifactResponse.body())
      .digest("hex"),
  ).toBe(expectedDigest);

  const normalPlanResponse = await page.request.get("/plan");
  expect(normalPlanResponse.headers()["x-uga-cache-class"]).toBeUndefined();
  const anonymousShellResponse = await page.request.get("/plan?__uga_vault_shell=1&locale=en");
  expect(anonymousShellResponse.headers()["x-uga-cache-class"]).toBe("public-vault-shell-v1");
  expect(anonymousShellResponse.headers()["set-cookie"]).toBeUndefined();
  const malformedShellResponse = await page.request.get(
    "/plan?__uga_vault_shell=1&locale=en&unexpected=private",
  );
  expect(malformedShellResponse.headers()["x-uga-cache-class"]).toBeUndefined();
  const cookieShellResponse = await page.request.get("/plan?__uga_vault_shell=1&locale=en", {
    headers: { cookie: "session=private" },
  });
  expect(cookieShellResponse.headers()["x-uga-cache-class"]).toBeUndefined();
  const authorizedShellResponse = await page.request.get("/plan?__uga_vault_shell=1&locale=en", {
    headers: { authorization: "Bearer private" },
  });
  expect(authorizedShellResponse.headers()["x-uga-cache-class"]).toBeUndefined();
});

test("serves strict security headers, a same-origin theme bootstrap, and cookie-localized metadata", async ({
  baseURL,
  context,
  page,
}) => {
  if (baseURL === undefined) throw new Error("The PWA test requires a configured baseURL.");
  await context.addCookies([
    { name: "locale", value: "zh-CN", url: baseURL },
    { name: "theme", value: "dark", url: baseURL },
  ]);

  const response = await page.goto("/today");
  expect(response).not.toBeNull();
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["content-security-policy"]).toContain("object-src 'none'");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).not.toContain("'unsafe-eval'");
  expect(headers["content-security-policy"]).not.toContain("'unsafe-inline'");
  expect(headers["content-security-policy"]).toContain("'wasm-unsafe-eval'");
  expect(headers["content-security-policy"]).toContain(
    "trusted-types nextjs nextjs#bundler uga#service-worker uga#vault-worker",
  );
  expect(headers["content-security-policy"]).toContain("require-trusted-types-for 'script'");
  expect(headers["content-security-policy"]).toMatch(/script-src[^;]*'nonce-[^']+'/u);
  expect(headers["content-security-policy"]).toMatch(/script-src[^;]*'strict-dynamic'/u);
  expect(headers["content-security-policy"]).toMatch(/worker-src[^;]*'self'/u);
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

  const rejectsUntrustedScriptUrl = await page.evaluate(() => {
    const script = document.createElement("script");
    try {
      script.src = "/theme-boot.js";
      return false;
    } catch (error) {
      return error instanceof TypeError;
    }
  });
  expect(rejectsUntrustedScriptUrl).toBe(true);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.getRegistration())).not.toBeNull();
});

test("keeps sensitive Plan requests and malformed vault-like messages outside Cache Storage", async ({
  context,
  page,
}) => {
  await page.goto("/today");
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  const result = await page.evaluate(async () => {
    const probe = `/plan?__uga_vault=${crypto.randomUUID()}`;
    const response = await fetch(probe, { cache: "no-store" });
    const cacheNames = await caches.keys();
    const cached = await Promise.all(
      cacheNames.map(async (cacheName) => {
        const cache = await caches.open(cacheName);
        return cache.match(probe);
      }),
    );

    // The PWA channel accepts exactly { type, locale }. A surplus field is a
    // vault-like message and must not be able to alter the offline locale.
    navigator.serviceWorker.controller?.postMessage({
      locale: "zh-CN",
      type: "SET_LOCALE",
      unexpectedVaultField: true,
    });

    return { cached: cached.some((entry) => entry !== undefined), status: response.status };
  });
  expect(result.status).toBe(200);
  expect(result.cached).toBe(false);

  await context.setOffline(true);
  try {
    await page.goto(`/sw-isolation-probe-${Date.now()}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("The field guide is still here");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  } finally {
    await context.setOffline(false);
  }
});

test("never caches visited HTML and keeps the Chinese offline shell available offline", async ({
  baseURL,
  context,
  page,
}) => {
  if (baseURL === undefined) throw new Error("The PWA test requires a configured baseURL.");
  await context.addCookies([{ name: "locale", value: "zh-CN", url: baseURL }]);
  const app = new CampusFieldGuidePage(page);
  await app.open("/explore");
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect(app.mainHeading).toHaveText("查找地点、服务、活动或课程");

  await expect.poll(() => page.evaluate(async () => Boolean(await caches.match("/explore")))).toBe(false);
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
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("校园指南仍可打开");

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
