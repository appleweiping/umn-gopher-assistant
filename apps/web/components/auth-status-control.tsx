"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { usePreferences } from "./preferences";

type AuthState = "checking" | "anonymous" | "authenticated" | "unavailable";

function parseSession(value: unknown): "anonymous" | "authenticated" | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Readonly<Record<string, unknown>>;
  if (record["authenticated"] === false && Object.keys(record).length === 1) return "anonymous";
  if (
    record["authenticated"] === true &&
    typeof record["expiresAt"] === "number" &&
    Number.isSafeInteger(record["expiresAt"]) &&
    Object.keys(record).sort().join(",") === "authenticated,expiresAt"
  ) {
    return "authenticated";
  }
  return undefined;
}

export function AuthStatusControl() {
  const pathname = usePathname();
  const { locale } = usePreferences();
  const [state, setState] = useState<AuthState>("checking");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
          throw new Error("Authentication status unavailable");
        }
        const parsed = parseSession((await response.json()) as unknown);
        if (parsed === undefined) throw new Error("Authentication status invalid");
        setState(parsed);
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("unavailable");
      });
    return () => controller.abort();
  }, []);

  const labels =
    locale === "zh-CN"
      ? {
          authenticated: "私人同步已登录",
          checking: "正在检查登录",
          login: "登录",
          logout: "退出",
          unavailable: "登录暂不可用",
        }
      : {
          authenticated: "Private sync signed in",
          checking: "Checking sign-in",
          login: "Sign in",
          logout: "Sign out",
          unavailable: "Sign-in unavailable",
        };

  if (state === "authenticated") {
    return (
      <form action="/auth/logout" className="auth-status-control" method="post">
        <span className="auth-status-label" role="status">
          <span aria-hidden="true" className="status-dot is-private" />
          {labels.authenticated}
        </span>
        <button className="button button-quiet auth-status-action" type="submit">
          {labels.logout}
        </button>
      </form>
    );
  }

  if (state === "checking" || state === "unavailable") {
    return (
      <span className="auth-status-label" role="status">
        <span aria-hidden="true" className="status-dot" />
        {state === "checking" ? labels.checking : labels.unavailable}
      </span>
    );
  }

  const returnTo = pathname.startsWith("/auth/") ? "/plan" : pathname;
  return (
    <Link
      className="button button-quiet auth-status-action"
      href={`/auth/login?returnTo=${encodeURIComponent(returnTo)}`}
    >
      {labels.login}
    </Link>
  );
}
