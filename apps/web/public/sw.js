const CACHE_PREFIX = "campus-field-guide-";
const SHELL_CACHE = `${CACHE_PREFIX}shell-v3`;
const PAGE_CACHE = `${CACHE_PREFIX}pages-v3`;
const ASSET_CACHE = `${CACHE_PREFIX}assets-v3`;
const CURRENT_CACHES = new Set([SHELL_CACHE, PAGE_CACHE, ASSET_CACHE]);
const OFFLINE_SHELLS = {
  en: {
    key: "/__campus-field-guide-offline-shell-en",
    url: "/offline?locale=en",
  },
  "zh-CN": {
    key: "/__campus-field-guide-offline-shell-zh-CN",
    url: "/offline?locale=zh-CN",
  },
};
const LOCALE_PREFERENCE_KEY = "/__campus-field-guide-offline-locale";
const SHELL_ASSETS = [
  "/manifest.webmanifest",
  "/theme-boot.js",
  "/icons/field-guide.svg",
  "/icons/field-guide-maskable.svg",
  "/brand/field-mark.svg",
];

function isExcludedPath(pathname) {
  return (
    pathname === "/api" || pathname.startsWith("/api/") || pathname === "/v1" || pathname.startsWith("/v1/")
  );
}

function isCacheable(response) {
  return response.ok && response.type !== "opaque";
}

function sameOriginRequest(pathname) {
  return new Request(new URL(pathname, self.location.origin), { cache: "reload", credentials: "omit" });
}

function findStaticChunks(html) {
  return [
    ...new Set(
      [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/gu)]
        .map((match) => match[1])
        .filter(Boolean),
    ),
  ].map((url) => url.replaceAll("&amp;", "&"));
}

async function fetchInto(cache, request) {
  const response = await fetch(request);
  if (!isCacheable(response)) throw new Error(`Unable to cache ${request.url}: ${response.status}`);
  await cache.put(request, response.clone());
  return response;
}

async function installOfflineShells() {
  const shellCache = await caches.open(SHELL_CACHE);
  const shellHtml = [];

  for (const shell of Object.values(OFFLINE_SHELLS)) {
    const shellRequest = sameOriginRequest(shell.url);
    const shellResponse = await fetch(shellRequest);
    if (!isCacheable(shellResponse)) {
      throw new Error(`Unable to cache offline shell: ${shellResponse.status}`);
    }
    shellHtml.push(await shellResponse.clone().text());
    await shellCache.put(shell.key, shellResponse);
  }

  const assetUrls = new Set(SHELL_ASSETS);
  for (const html of shellHtml) {
    for (const chunkUrl of findStaticChunks(html)) assetUrls.add(chunkUrl);
  }
  const assetRequests = [...assetUrls].map(sameOriginRequest);
  await Promise.all(assetRequests.map((request) => fetchInto(shellCache, request)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(Promise.all([installOfflineShells(), self.skipWaiting()]));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && !CURRENT_CACHES.has(key))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const message = event.data;
  if (
    typeof message !== "object" ||
    message === null ||
    message.type !== "SET_LOCALE" ||
    (message.locale !== "en" && message.locale !== "zh-CN")
  ) {
    return;
  }

  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(LOCALE_PREFERENCE_KEY, new Response(message.locale));
    })(),
  );
});

async function preferredOfflineShell(request) {
  const requestedLocale = new URL(request.url).searchParams.get("locale");
  if (requestedLocale === "en" || requestedLocale === "zh-CN") {
    return caches.match(OFFLINE_SHELLS[requestedLocale].key);
  }

  const shellCache = await caches.open(SHELL_CACHE);
  const preferenceResponse = await shellCache.match(LOCALE_PREFERENCE_KEY);
  const preference = preferenceResponse === undefined ? "en" : await preferenceResponse.text();
  const locale = preference === "zh-CN" ? "zh-CN" : "en";
  return shellCache.match(OFFLINE_SHELLS[locale].key);
}

async function networkFirstPage(request) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetch(request);
    if (isCacheable(response)) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) ?? (await preferredOfflineShell(request)) ?? Response.error();
  }
}

async function cacheFirstAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheable(response)) {
    const cache = await caches.open(ASSET_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isExcludedPath(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/brand/") ||
    url.pathname === "/theme-boot.js" ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(cacheFirstAsset(request));
  }
});
