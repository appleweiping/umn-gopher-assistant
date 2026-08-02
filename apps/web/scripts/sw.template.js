const CACHE_PREFIX = "campus-field-guide-";
// The shell cache is the only HTML cache. Runtime navigation responses are
// never written to Cache Storage because a route that is public today may
// become authenticated later. Activation removes every legacy `pages-*`
// cache created by earlier workers.
const SHELL_CACHE = `${CACHE_PREFIX}shell-v5`;
const ASSET_CACHE = `${CACHE_PREFIX}assets-v4`;
const VAULT_WORKER_BUILD_DIGEST = "__UGA_VAULT_WORKER_DIGEST__";
const VAULT_RUNTIME_CACHE = `${CACHE_PREFIX}vault-runtime-${VAULT_WORKER_BUILD_DIGEST}`;
const CURRENT_CACHES = new Set([SHELL_CACHE, ASSET_CACHE, VAULT_RUNTIME_CACHE]);
const clientLocales = new Map();
let vaultWorkerPublication = Promise.resolve();
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
const PLAN_SHELLS = {
  en: {
    key: "/__campus-field-guide-vault-plan-shell-en",
    url: "/plan?__uga_vault_shell=1&locale=en",
  },
  "zh-CN": {
    key: "/__campus-field-guide-vault-plan-shell-zh-CN",
    url: "/plan?__uga_vault_shell=1&locale=zh-CN",
  },
};
const PLAN_SHELL_CACHE_CLASS = "public-vault-shell-v1";
const LOCALE_PREFERENCE_KEY = "/__campus-field-guide-offline-locale";
const VAULT_WORKER_BOOTSTRAP = "/__uga-vault/personal-vault.worker.mjs";
const EXPECTED_HASHED_VAULT_WORKER = `/__uga-vault/personal-vault.worker.${VAULT_WORKER_BUILD_DIGEST}.mjs`;
const HASHED_VAULT_WORKER_PATH = /^\/__uga-vault\/personal-vault\.worker\.([a-f0-9]{64})\.mjs$/u;
const HASHED_VAULT_WORKER_IMPORT = /^import "\.\/(personal-vault\.worker\.([a-f0-9]{64})\.mjs)";\n?$/u;
const SHELL_ASSETS = [
  "/manifest.webmanifest",
  "/theme-boot.js",
  "/icons/field-guide.svg",
  "/icons/field-guide-maskable.svg",
  "/brand/field-mark.svg",
];

function isPlanPath(pathname) {
  return pathname === "/plan" || pathname.startsWith("/plan/");
}

// `/vault` and `/__uga-vault` are reserved sensitive namespaces. The two
// content-addressed Worker URLs are the only exceptions and are handled by an
// explicit integrity-checking cache below.
function isReservedVaultPath(pathname) {
  return (
    pathname === "/vault" ||
    pathname.startsWith("/vault/") ||
    pathname === "/__uga-vault" ||
    pathname.startsWith("/__uga-vault/")
  );
}

function isVaultWorkerPath(url) {
  return (
    url.search === "" &&
    (url.pathname === VAULT_WORKER_BOOTSTRAP || HASHED_VAULT_WORKER_PATH.test(url.pathname))
  );
}

function isVaultRequest(request, url) {
  // Vault data has no network API. Keep headers and the reserved marker out of
  // Cache Storage even when they are attached to an otherwise public route.
  return (
    request.headers.has("x-uga-vault") ||
    url.searchParams.has("__uga_vault") ||
    isReservedVaultPath(url.pathname)
  );
}

function isExcludedPath(pathname) {
  return (
    isReservedVaultPath(pathname) ||
    pathname === "/auth" ||
    pathname.startsWith("/auth/") ||
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
  return new Request(new URL(pathname, self.location.origin), {
    cache: "reload",
    credentials: "omit",
  });
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

function isPublicPlanShell(response) {
  return (
    isCacheable(response) &&
    response.headers.get("content-type")?.includes("text/html") === true &&
    response.headers.get("x-uga-cache-class") === PLAN_SHELL_CACHE_CLASS &&
    !response.headers.has("set-cookie")
  );
}

async function installShells() {
  const shellCache = await caches.open(SHELL_CACHE);
  const shellHtml = [];

  for (const shell of Object.values(OFFLINE_SHELLS)) {
    const shellResponse = await fetch(sameOriginRequest(shell.url));
    if (!isCacheable(shellResponse)) {
      throw new Error(`Unable to cache offline shell: ${shellResponse.status}`);
    }
    shellHtml.push(await shellResponse.clone().text());
    await shellCache.put(shell.key, shellResponse);
  }

  for (const shell of Object.values(PLAN_SHELLS)) {
    // This request has no cookies, authorization, or other credentials. The
    // response marker is emitted only for the exact internal query shape.
    const shellResponse = await fetch(sameOriginRequest(shell.url));
    if (!isPublicPlanShell(shellResponse)) {
      throw new Error(`Refusing to cache unmarked Plan shell: ${shellResponse.status}`);
    }
    shellHtml.push(await shellResponse.clone().text());
    await shellCache.put(shell.key, shellResponse);
  }

  const assetUrls = new Set(SHELL_ASSETS);
  for (const html of shellHtml) {
    for (const chunkUrl of findStaticChunks(html)) assetUrls.add(chunkUrl);
  }
  await Promise.all([...assetUrls].map(sameOriginRequest).map((request) => fetchInto(shellCache, request)));
}

function hashedWorkerPathFromBootstrap(source) {
  const match = source.match(HASHED_VAULT_WORKER_IMPORT);
  return match === null ? undefined : `/__uga-vault/${match[1]}`;
}

function bytesToHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function validateHashedWorkerResponse(pathname, response) {
  const expectedDigest = pathname.match(HASHED_VAULT_WORKER_PATH)?.[1];
  if (
    expectedDigest === undefined ||
    !isCacheable(response) ||
    !response.headers.get("content-type")?.includes("javascript")
  ) {
    return false;
  }
  const digest = await crypto.subtle.digest("SHA-256", await response.clone().arrayBuffer());
  return bytesToHex(new Uint8Array(digest)) === expectedDigest;
}

async function fetchValidatedHashedWorker(pathname) {
  const response = await fetch(sameOriginRequest(pathname));
  if (!(await validateHashedWorkerResponse(pathname, response))) {
    throw new Error("Vault Worker content does not match its SHA-256 filename.");
  }
  return response;
}

async function publishVaultWorkerPair(bootstrapResponse) {
  if (
    !isCacheable(bootstrapResponse) ||
    !bootstrapResponse.headers.get("content-type")?.includes("javascript")
  ) {
    throw new Error("Vault Worker bootstrap is unavailable.");
  }
  const hashedPath = hashedWorkerPathFromBootstrap(await bootstrapResponse.clone().text());
  if (hashedPath !== EXPECTED_HASHED_VAULT_WORKER) {
    throw new Error("Vault Worker bootstrap does not match this Service Worker build.");
  }

  // Store the immutable artifact only after checking its bytes, then publish
  // the bootstrap. An interrupted refresh can therefore never point at a
  // missing or mismatched Worker.
  const hashedResponse = await fetchValidatedHashedWorker(hashedPath);
  const cache = await caches.open(VAULT_RUNTIME_CACHE);
  await cache.put(hashedPath, hashedResponse);
  await cache.put(VAULT_WORKER_BOOTSTRAP, bootstrapResponse);
}

function cacheVaultWorkerPair(bootstrapResponse) {
  // Serialize publications inside this Worker. Across an old/new Worker race,
  // both immutable hashes remain available, so whichever bootstrap pointer is
  // written last still references a complete artifact.
  const publication = vaultWorkerPublication.then(
    () => publishVaultWorkerPair(bootstrapResponse),
    () => publishVaultWorkerPair(bootstrapResponse),
  );
  vaultWorkerPublication = publication.catch(() => undefined);
  return publication;
}

async function pruneInactiveVaultWorkers() {
  const cache = await caches.open(VAULT_RUNTIME_CACHE);
  const bootstrap = await cache.match(VAULT_WORKER_BOOTSTRAP);
  if (bootstrap === undefined) return;
  const activeHashedPath = hashedWorkerPathFromBootstrap(await bootstrap.clone().text());
  if (activeHashedPath === undefined) return;
  const activeArtifact = await cache.match(activeHashedPath);
  if (
    activeArtifact === undefined ||
    !(await validateHashedWorkerResponse(activeHashedPath, activeArtifact))
  ) {
    return;
  }
  const cachedRequests = await cache.keys();
  await Promise.all(
    cachedRequests
      .filter((request) => {
        const pathname = new URL(request.url).pathname;
        return HASHED_VAULT_WORKER_PATH.test(pathname) && pathname !== activeHashedPath;
      })
      .map((request) => cache.delete(request)),
  );
}

async function installVaultWorker() {
  const bootstrapResponse = await fetch(sameOriginRequest(VAULT_WORKER_BOOTSTRAP));
  await cacheVaultWorkerPair(bootstrapResponse);
}

self.addEventListener("install", (event) => {
  event.waitUntil(Promise.all([installShells(), installVaultWorker(), self.skipWaiting()]));
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
      await pruneInactiveVaultWorkers();
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

async function preferredShell(shells, request, clientId) {
  const locale = await preferredLocale(request, clientId);
  const shellCache = await caches.open(SHELL_CACHE);
  return shellCache.match(shells[locale].key);
}

async function networkFirstPage(request, clientId) {
  try {
    // Do not cache arbitrary HTML, even when the current response appears
    // public. Authentication, personalization, or Set-Cookie can be added to
    // a route without requiring a coordinated Service Worker release.
    return await fetch(request);
  } catch {
    return (await preferredShell(OFFLINE_SHELLS, request, clientId)) ?? Response.error();
  }
}

async function networkFirstPlan(request, clientId) {
  try {
    // Deliberately do not cache this response: it may carry request-specific
    // metadata now or in a future authenticated deployment.
    return await fetch(request);
  } catch {
    return (await preferredShell(PLAN_SHELLS, request, clientId)) ?? Response.error();
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

async function networkFirstVaultBootstrap() {
  try {
    const response = await fetch(sameOriginRequest(VAULT_WORKER_BOOTSTRAP));
    await cacheVaultWorkerPair(response.clone());
    return response;
  } catch {
    const cache = await caches.open(VAULT_RUNTIME_CACHE);
    return (await cache.match(VAULT_WORKER_BOOTSTRAP)) ?? Response.error();
  }
}

async function cacheFirstHashedVaultWorker(pathname) {
  if (pathname !== EXPECTED_HASHED_VAULT_WORKER) return Response.error();
  const cache = await caches.open(VAULT_RUNTIME_CACHE);
  const cached = await cache.match(pathname);
  if (cached !== undefined) return cached;

  const response = await fetch(sameOriginRequest(pathname));
  if (!(await validateHashedWorkerResponse(pathname, response))) return Response.error();
  await cache.put(pathname, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // A sensitive marker always wins over the small Worker allow-list.
  if (request.headers.has("x-uga-vault") || url.searchParams.has("__uga_vault")) return;

  if (isVaultWorkerPath(url)) {
    event.respondWith(
      url.pathname === VAULT_WORKER_BOOTSTRAP
        ? networkFirstVaultBootstrap()
        : cacheFirstHashedVaultWorker(url.pathname),
    );
    return;
  }

  if (isExcludedPath(url.pathname) || isVaultRequest(request, url)) return;

  if (request.mode === "navigate" && isPlanPath(url.pathname)) {
    event.respondWith(networkFirstPlan(request, event.clientId));
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
