"use client";

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";

import messagesEn from "../messages/en.json";
import messagesZh from "../messages/zh-CN.json";
import type { CampusId, Locale } from "../lib/data/registry";
import { PreferencesProvider, type ThemePreference, usePreferences } from "./preferences";

function IntlBridge({ children }: { readonly children: ReactNode }) {
  const { locale } = usePreferences();
  const messages = locale === "zh-CN" ? messagesZh : messagesEn;
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="America/Chicago">
      {children}
    </NextIntlClientProvider>
  );
}

export function AppProviders(props: {
  readonly campus: CampusId;
  readonly locale: Locale;
  readonly theme: ThemePreference;
  readonly children: ReactNode;
}) {
  return (
    <PreferencesProvider initialCampus={props.campus} initialLocale={props.locale} initialTheme={props.theme}>
      <IntlBridge>{props.children}</IntlBridge>
    </PreferencesProvider>
  );
}
