"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode, type SubmitEventHandler } from "react";

import { getCampus } from "../lib/data/registry";
import { Icon, type IconName } from "./icon";
import { PreferenceControls, usePreferences } from "./preferences";
import { ServiceWorkerRegistration } from "./service-worker-registration";

const primaryNav = [
  { href: "/today", icon: "today", key: "today" },
  { href: "/explore", icon: "explore", key: "explore" },
  { href: "/plan", icon: "plan", key: "plan" },
  { href: "/community", icon: "community", key: "community" },
  { href: "/world", icon: "world", key: "world" },
  { href: "/ai", icon: "ai", key: "ai" },
] as const satisfies readonly { readonly href: string; readonly icon: IconName; readonly key: string }[];

const secondaryNav = [
  { href: "/admin", icon: "admin", key: "admin" },
  { href: "/developer", icon: "developer", key: "developer" },
] as const satisfies readonly { readonly href: string; readonly icon: IconName; readonly key: string }[];

function NavLink({
  href,
  icon,
  label,
  active,
}: {
  readonly href: string;
  readonly icon: IconName;
  readonly label: string;
  readonly active: boolean;
}) {
  return (
    <Link aria-current={active ? "page" : undefined} className="nav-link" href={href}>
      <Icon className="nav-icon" name={icon} />
      <span>{label}</span>
    </Link>
  );
}

function ConnectivityStatus() {
  const t = useTranslations("shell");
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return (
    <span className={`connectivity ${online ? "is-online" : "is-offline"}`} role="status">
      <span aria-hidden="true" className="status-dot" />
      {online ? t("online") : t("offline")}
    </span>
  );
}

function GlobalSearch() {
  const t = useTranslations("shell");
  const router = useRouter();
  const { locale } = usePreferences();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const quickQueries =
    locale === "zh-CN" ? { library: "图书馆", transit: "交通" } : { library: "library", transit: "transit" };
  const exploreQuery = (value: string) => `/explore?q=${encodeURIComponent(value)}`;
  useEffect(() => {
    const openWithShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      const isTyping =
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName));
      if (event.key !== "/" || event.altKey || event.ctrlKey || event.metaKey || isTyping) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", openWithShortcut);
    return () => window.removeEventListener("keydown", openWithShortcut);
  }, []);
  const submit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const value = query.trim();
    router.push(value.length > 0 ? `/explore?q=${encodeURIComponent(value)}` : "/explore");
    setOpen(false);
  };
  return (
    <Dialog.Root onOpenChange={setOpen} open={open}>
      <Dialog.Trigger asChild>
        <button aria-keyshortcuts="/" className="search-trigger" type="button">
          <Icon name="search" />
          <span>{t("search")}</span>
          <kbd>/</kbd>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content aria-describedby="global-search-description" className="dialog-content search-dialog">
          <div className="dialog-heading">
            <div>
              <Dialog.Title>{t("searchTitle")}</Dialog.Title>
              <Dialog.Description id="global-search-description">{t("searchHint")}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button aria-label={t("close")} className="icon-button" type="button">
                ×
              </button>
            </Dialog.Close>
          </div>
          <form className="search-form" onSubmit={submit} role="search">
            <label className="sr-only" htmlFor="global-search">
              {t("search")}
            </label>
            <input
              autoFocus
              id="global-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchHint")}
              type="search"
              value={query}
            />
            <button className="button" type="submit">
              {t("searchAction")}
            </button>
          </form>
          <div className="quick-search-links">
            <Link href={exploreQuery(quickQueries.library)} onClick={() => setOpen(false)}>
              {t("quickLibrary")}
            </Link>
            <Link href={exploreQuery(quickQueries.transit)} onClick={() => setOpen(false)}>
              {t("quickTransit")}
            </Link>
            <Link href="/explore?kind=service" onClick={() => setOpen(false)}>
              {t("quickOneStop")}
            </Link>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function AppShell({ children }: { readonly children: ReactNode }) {
  const tNav = useTranslations("nav");
  const tShell = useTranslations("shell");
  const pathname = usePathname();
  const preferences = usePreferences();
  const campus = getCampus(preferences.campus);
  const mobileMain = primaryNav.filter((item) => ["today", "explore", "plan", "ai"].includes(item.key));
  const mobileMore = [...primaryNav.filter((item) => !mobileMain.includes(item)), ...secondaryNav];
  const themeOptions =
    preferences.locale === "zh-CN"
      ? ([
          { id: "light", label: "浅色主题" },
          { id: "dark", label: "深色主题" },
          { id: "system", label: "跟随系统" },
        ] as const)
      : ([
          { id: "light", label: "Light theme" },
          { id: "dark", label: "Dark theme" },
          { id: "system", label: "System theme" },
        ] as const);

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">
        {tShell("skip")}
      </a>
      <aside className="sidebar">
        <Link aria-label={tShell("product")} className="brand-lockup" href="/today">
          <img alt="" className="brand-mark" height="40" src="/brand/field-mark.svg" width="40" />
          <span>
            <strong>{tShell("product")}</strong>
            <small>{tShell("independent")}</small>
          </span>
        </Link>
        <nav aria-label={tNav("primary")} className="sidebar-nav">
          {primaryNav.map((item) => (
            <NavLink
              active={pathname.startsWith(item.href)}
              href={item.href}
              icon={item.icon}
              key={item.href}
              label={tNav(item.key)}
            />
          ))}
        </nav>
        <div className="sidebar-rule" />
        <nav aria-label={tNav("secondary")} className="sidebar-nav sidebar-nav-secondary">
          {secondaryNav.map((item) => (
            <NavLink
              active={pathname.startsWith(item.href)}
              href={item.href}
              icon={item.icon}
              key={item.href}
              label={tNav(item.key)}
            />
          ))}
        </nav>
        <p className="sidebar-disclaimer">{tShell("independent")}</p>
      </aside>

      <header className="context-bar">
        <div className="mobile-brand">
          <img alt="" height="32" src="/brand/field-mark.svg" width="32" />
          <span>{tShell("product")}</span>
        </div>
        <div className="campus-context">
          <span>{campus.name[preferences.locale]}</span>
          <small>{campus.city[preferences.locale]}</small>
        </div>
        <GlobalSearch />
        <ConnectivityStatus />
        <PreferenceControls />
      </header>

      <main className="app-main" id="main-content" tabIndex={-1}>
        {children}
      </main>

      <nav aria-label={tNav("mobile")} className="mobile-nav">
        {mobileMain.map((item) => (
          <NavLink
            active={pathname.startsWith(item.href)}
            href={item.href}
            icon={item.icon}
            key={item.href}
            label={tNav(item.key)}
          />
        ))}
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button className="nav-link mobile-more" type="button">
              <Icon className="nav-icon" name="more" />
              <span>{tNav("more")}</span>
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" className="menu-content" sideOffset={8}>
              {mobileMore.map((item) => (
                <DropdownMenu.Item asChild key={item.href}>
                  <Link className="menu-item" href={item.href}>
                    <Icon name={item.icon} />
                    {tNav(item.key)}
                  </Link>
                </DropdownMenu.Item>
              ))}
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Label className="menu-label">
                {preferences.locale === "zh-CN" ? "偏好" : "Preferences"}
              </DropdownMenu.Label>
              <DropdownMenu.Item asChild>
                <button
                  className="menu-item"
                  onClick={() => preferences.setLocale(preferences.locale === "zh-CN" ? "en" : "zh-CN")}
                  type="button"
                >
                  {preferences.locale === "zh-CN" ? "English" : "中文"}
                </button>
              </DropdownMenu.Item>
              {themeOptions.map((option) => (
                <DropdownMenu.Item asChild key={option.id}>
                  <button
                    aria-checked={preferences.theme === option.id}
                    className="menu-item"
                    onClick={() => preferences.setTheme(option.id)}
                    role="menuitemradio"
                    type="button"
                  >
                    {option.label}
                  </button>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </nav>
      <ServiceWorkerRegistration />
    </div>
  );
}
