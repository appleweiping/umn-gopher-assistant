import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthStatusControl } from "../components/auth-status-control";
import { PreferencesProvider } from "../components/preferences";

vi.mock("next/navigation", () => ({ usePathname: () => "/plan" }));

function renderControl(locale: "en" | "zh-CN" = "en") {
  return render(
    <PreferencesProvider initialCampus="tc" initialLocale={locale} initialTheme="light">
      <AuthStatusControl />
    </PreferencesProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("token-free authentication control", () => {
  it("offers a bounded return path to an anonymous user", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } }),
      ),
    );
    renderControl();

    const link = await screen.findByRole("link", { name: "Sign in" });
    expect(link).toHaveAttribute("href", "/auth/login?returnTo=%2Fplan");
  });

  it("shows only opaque signed-in state and a POST logout action", async () => {
    const body = { authenticated: true, expiresAt: 2_000_000_000 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(body)),
    );
    const { container } = renderControl("zh-CN");

    expect(await screen.findByText("私人同步已登录")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出" })).toHaveAttribute("type", "submit");
    const form = container.querySelector("form");
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "/auth/logout");
    expect(container).not.toHaveTextContent(/token|subject|email|access/iu);
  });

  it("fails closed when the session shape contains surplus identity data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ authenticated: true, expiresAt: 2_000_000_000, subject: "leak" })),
    );
    renderControl();

    expect(await screen.findByText("Sign-in unavailable")).toBeInTheDocument();
    expect(screen.queryByText("leak")).not.toBeInTheDocument();
  });
});
