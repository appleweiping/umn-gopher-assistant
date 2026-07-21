"use client";

import { useEffect } from "react";

import { usePreferences } from "./preferences";

const SERVICE_WORKER_PATH = "/sw.js";
const SERVICE_WORKER_TRUSTED_TYPES_POLICY = "uga#service-worker";

interface TrustedScriptUrlFactory {
  readonly createScriptURL: (value: string) => unknown;
}

interface TrustedTypesApi {
  readonly createPolicy: (
    name: string,
    rules: { readonly createScriptURL: (value: string) => string },
  ) => TrustedScriptUrlFactory;
}

let serviceWorkerTrustedTypesPolicy: TrustedScriptUrlFactory | undefined;

function trustedServiceWorkerUrl(): unknown {
  const trustedTypesApi = (window as Window & { readonly trustedTypes?: TrustedTypesApi }).trustedTypes;
  if (trustedTypesApi === undefined) return SERVICE_WORKER_PATH;
  serviceWorkerTrustedTypesPolicy ??= trustedTypesApi.createPolicy(SERVICE_WORKER_TRUSTED_TYPES_POLICY, {
    createScriptURL(value: string) {
      const url = new URL(value, window.location.origin);
      if (
        url.origin !== window.location.origin ||
        url.pathname !== SERVICE_WORKER_PATH ||
        url.search !== ""
      ) {
        throw new TypeError("Only the same-origin Service Worker URL is trusted.");
      }
      return url.pathname;
    },
  });
  return serviceWorkerTrustedTypesPolicy.createScriptURL(SERVICE_WORKER_PATH);
}

export function ServiceWorkerRegistration() {
  const { locale } = usePreferences();

  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    let cancelled = false;

    const register = async () => {
      await navigator.serviceWorker.register(trustedServiceWorkerUrl() as string, {
        scope: "/",
        updateViaCache: "none",
      });
      const registration = await navigator.serviceWorker.ready;
      if (!cancelled) registration.active?.postMessage({ locale, type: "SET_LOCALE" });
    };

    void register();
    return () => {
      cancelled = true;
    };
  }, [locale]);
  return null;
}
