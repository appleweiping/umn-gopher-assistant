"use client";

import { useEffect } from "react";

import { usePreferences } from "./preferences";

export function ServiceWorkerRegistration() {
  const { locale } = usePreferences();

  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    let cancelled = false;

    const register = async () => {
      await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
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
