import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";

import type { ThemePreference } from "../components/preferences";
import { AppProviders } from "../components/app-providers";
import { AppShell } from "../components/app-shell";
import { campusIds, type CampusId, type Locale } from "../lib/data/registry";
import "./styles.css";

const localizedMetadata = {
  en: {
    description: "Independent bilingual assistant for five University of Minnesota campuses.",
    title: "Campus Field Guide",
  },
  "zh-CN": {
    description: "覆盖明尼苏达大学五个校区的独立中英双语助手。",
    title: "校园随身指南",
  },
} as const satisfies Record<Locale, { readonly description: string; readonly title: string }>;

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F1E8" },
    { media: "(prefers-color-scheme: dark)", color: "#0F1917" },
  ],
  width: "device-width",
  initialScale: 1,
};

function readCampus(value: string | undefined): CampusId {
  return campusIds.find((campusId) => campusId === value) ?? "tc";
}

function readLocale(value: string | undefined): Locale {
  return value === "zh-CN" ? "zh-CN" : "en";
}

function readRequestLocale(cookieLocale: string | undefined, offlineLocale: string | null): Locale {
  return offlineLocale === "en" || offlineLocale === "zh-CN" ? offlineLocale : readLocale(cookieLocale);
}

function readTheme(value: string | undefined): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export async function generateMetadata(): Promise<Metadata> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const locale = readRequestLocale(cookieStore.get("locale")?.value, headerStore.get("x-offline-locale"));
  const content = localizedMetadata[locale];
  return {
    title: { default: content.title, template: `%s · ${content.title}` },
    description: content.description,
    applicationName: content.title,
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, statusBarStyle: "default", title: content.title },
    icons: { icon: [{ url: "/icons/field-guide.svg", type: "image/svg+xml", sizes: "any" }] },
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const campus = readCampus(cookieStore.get("campus")?.value);
  const locale = readRequestLocale(cookieStore.get("locale")?.value, headerStore.get("x-offline-locale"));
  const theme = readTheme(cookieStore.get("theme")?.value);
  const nonce = headerStore.get("x-nonce");

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script src="/theme-boot.js" {...(nonce === null ? {} : { nonce })} />
      </head>
      <body>
        <AppProviders campus={campus} locale={locale} theme={theme}>
          <AppShell>{children}</AppShell>
        </AppProviders>
      </body>
    </html>
  );
}
