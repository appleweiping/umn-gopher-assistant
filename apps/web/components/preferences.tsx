"use client";

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";

import { campuses, campusIds, type CampusId, type Locale } from "../lib/data/registry";

export type ThemePreference = "light" | "dark" | "system";

interface PreferencesValue {
  readonly campus: CampusId;
  readonly locale: Locale;
  readonly theme: ThemePreference;
  readonly setCampus: (campus: CampusId) => void;
  readonly setLocale: (locale: Locale) => void;
  readonly setTheme: (theme: ThemePreference) => void;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

function writeCookie(name: "campus" | "locale" | "theme", value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`;
}

function applyTheme(theme: ThemePreference): void {
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.dataset["theme"] = resolved;
  document.documentElement.style.colorScheme = resolved;
}

export function PreferencesProvider(props: {
  readonly initialCampus: CampusId;
  readonly initialLocale: Locale;
  readonly initialTheme: ThemePreference;
  readonly children: ReactNode;
}) {
  const [campus, updateCampus] = useState<CampusId>(props.initialCampus);
  const [locale, updateLocale] = useState<Locale>(props.initialLocale);
  const [theme, updateTheme] = useState<ThemePreference>(props.initialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<PreferencesValue>(
    () => ({
      campus,
      locale,
      theme,
      setCampus: (nextCampus) => {
        updateCampus(nextCampus);
        writeCookie("campus", nextCampus);
      },
      setLocale: (nextLocale) => {
        updateLocale(nextLocale);
        writeCookie("locale", nextLocale);
      },
      setTheme: (nextTheme) => {
        updateTheme(nextTheme);
        writeCookie("theme", nextTheme);
        applyTheme(nextTheme);
      },
    }),
    [campus, locale, theme],
  );

  return createElement(PreferencesContext.Provider, { value }, props.children);
}

export function usePreferences(): PreferencesValue {
  const context = useContext(PreferencesContext);
  if (context === null) throw new Error("usePreferences must be used inside PreferencesProvider");
  return context;
}

function isCampusId(value: string): value is CampusId {
  return campusIds.some((campusId) => campusId === value);
}

export function PreferenceControls() {
  const preferences = usePreferences();
  const isChinese = preferences.locale === "zh-CN";
  const campus = campuses.find((entry) => entry.id === preferences.campus) ?? campuses[0];
  const campusLabel = isChinese ? "校区" : "Campus";
  const themeLabels = isChinese
    ? { light: "浅色主题", dark: "深色主题", system: "跟随系统" }
    : { light: "Light theme", dark: "Dark theme", system: "System theme" };

  const handleCampus = (event: ChangeEvent<HTMLSelectElement>) => {
    if (isCampusId(event.target.value)) preferences.setCampus(event.target.value);
  };

  return createElement(
    "div",
    { className: "preference-controls" },
    createElement(
      "label",
      { className: "field-control" },
      createElement("span", { className: "sr-only" }, campusLabel),
      createElement(
        "select",
        { "aria-label": campusLabel, value: preferences.campus, onChange: handleCampus },
        campuses.map((entry) =>
          createElement("option", { key: entry.id, value: entry.id }, entry.name[preferences.locale]),
        ),
      ),
    ),
    createElement(
      "button",
      {
        className: "button button-quiet",
        type: "button",
        onClick: () => preferences.setLocale(isChinese ? "en" : "zh-CN"),
      },
      isChinese ? "English" : "中文",
    ),
    createElement(
      "div",
      { className: "theme-switcher", "aria-label": isChinese ? "主题" : "Theme", role: "group" },
      (["light", "dark", "system"] as const).map((option) =>
        createElement(
          "button",
          {
            "aria-label": themeLabels[option],
            "aria-pressed": preferences.theme === option,
            className: "icon-button",
            key: option,
            onClick: () => preferences.setTheme(option),
            title: themeLabels[option],
            type: "button",
          },
          option === "light" ? "☀" : option === "dark" ? "☾" : "◐",
        ),
      ),
    ),
    createElement(
      "span",
      { className: "sr-only", role: "status", "aria-live": "polite" },
      `${campus.name[preferences.locale]} · ${themeLabels[preferences.theme]}`,
    ),
  );
}
