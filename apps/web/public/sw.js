const CACHE_PREFIX = "campus-field-guide-";
const SHELL_CACHE = `${CACHE_PREFIX}shell-v3`;
const PAGE_CACHES = {
  // Bump these when changing the privacy boundary below. It removes page
  // responses cached by prior Service Worker versions, including any old
  // /plan response that could have been written before it became private.
  en: `${CACHE_PREFIX}pages-en-v5`,
  "zh-CN": `${CACHE_PREFIX}pages-zh-CN-v5`,
};
const ASSET_CACHE = `${CACHE_PREFIX}assets-v3`;
const CURRENT_CACHES = new Set([SHELL_CACHE, ...Object.values(PAGE_CACHES), ASSET_CACHE]);
const clientLocales = new Map();
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

// The plan workspace is the vault UI. Its data must stay in dedicated browser
// vault storage, never in a Service Worker response cache. `/vault` and the
// reserved internal namespace protect future vault-only routes as well.
function isVaultPath(pathname) {
  return (
    pathname === "/plan" ||
    pathname.startsWith("/plan/") ||
    pathname === "/vault" ||
    pathname.startsWith("/vault/") ||
    pathname === "/__uga-vault" ||
    pathname.startsWith("/__uga-vault/")
  );
}

function isVaultRequest(request, pathname) {
  // Vault data has no network API. Still, make the boundary explicit for
  // navigation, module Worker, and any future endpoint that carries the
  // reserved vault marker. This returns before Cache Storage is consulted.
  return (
    isVaultPath(pathname) ||
    request.headers.has("x-uga-vault") ||
    new URL(request.url).searchParams.has("__uga_vault")
  );
}

function isExcludedPath(pathname) {
  return (
    isVaultPath(pathname) ||
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/v1" ||
    pathname.startsWith("/v1/")
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

// Keep the Service Worker message channel intentionally tiny. Vault RPC is
// exclusively a page <-> module Worker channel; this Worker never receives,
// stores, forwards, or replies with vault data. Reject surplus fields as a
// guard against accidentally routing a future vault payload through this API.
function isLocaleMessage(message) {
  if (typeof message !== "object" || message === null) return false;
  const keys = Object.keys(message);
  return (
    keys.length === 2 &&
    keys.includes("type") &&
    keys.includes("locale") &&
    message.type === "SET_LOCALE" &&
    (message.locale === "en" || message.locale === "zh-CN")
  );
}

self.addEventListener("message", (event) => {
  const message = event.data;
  if (!isLocaleMessage(message)) return;

  event.waitUntil(
    (async () => {
      if (typeof event.source?.id === "string") clientLocales.set(event.source.id, message.locale);
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(LOCALE_PREFERENCE_KEY, new Response(message.locale));
    })(),
  );
});

async function preferredLocale(request, clientId) {
  const requestedLocale = new URL(request.url).searchParams.get("locale");
  if (requestedLocale === "en" || requestedLocale === "zh-CN") return requestedLocale;

  const clientLocale = clientLocales.get(clientId);
  if (clientLocale === "en" || clientLocale === "zh-CN") return clientLocale;

  const shellCache = await caches.open(SHELL_CACHE);
  const preferenceResponse = await shellCache.match(LOCALE_PREFERENCE_KEY);
  const preference = preferenceResponse === undefined ? "en" : await preferenceResponse.text();
  return preference === "zh-CN" ? "zh-CN" : "en";
}

async function preferredOfflineShell(request, clientId) {
  const locale = await preferredLocale(request, clientId);
  const shellCache = await caches.open(SHELL_CACHE);
  return shellCache.match(OFFLINE_SHELLS[locale].key);
}

async function responseLocale(response) {
  if (!response.headers.get("content-type")?.includes("text/html")) return undefined;
  const html = await response.clone().text();
  return html.match(/<html[^>]*\slang="(en|zh-CN)"/u)?.[1];
}

async function networkFirstPage(request, clientId) {
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      const locale = (await responseLocale(response)) ?? (await preferredLocale(request, clientId));
      const cache = await caches.open(PAGE_CACHES[locale]);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const locale = await preferredLocale(request, clientId);
    const cache = await caches.open(PAGE_CACHES[locale]);
    return (
      (await cache.match(request)) ?? (await preferredOfflineShell(request, clientId)) ?? Response.error()
    );
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
  if (
    url.origin !== self.location.origin ||
    isExcludedPath(url.pathname) ||
    isVaultRequest(request, url.pathname)
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request, event.clientId));
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
