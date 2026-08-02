import { randomUUID } from "node:crypto";

import { webAuthSessionStore, type AuthSessionStore } from "./redis-store";
import { loadWebAuthRuntime, type WebAuthRuntime } from "./runtime";

const NO_STORE_HEADERS = Object.freeze({
  "Cache-Control": "no-store, private, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
});

export interface WebAuthRouteContext {
  readonly runtime: WebAuthRuntime;
  readonly store: AuthSessionStore;
}

export async function webAuthRouteContext(): Promise<WebAuthRouteContext> {
  const runtime = loadWebAuthRuntime();
  return { runtime, store: await webAuthSessionStore(runtime) };
}

export function authHeaders(additional: HeadersInit = {}): Headers {
  const headers = new Headers(NO_STORE_HEADERS);
  new Headers(additional).forEach((value, key) => headers.set(key, value));
  return headers;
}

export function authRedirect(location: URL, cookies: readonly string[] = []): Response {
  const headers = authHeaders({ Location: location.toString(), Pragma: "no-cache" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { headers, status: 303 });
}

export function authProblem(status: 400 | 503, clearCookie?: string): Response {
  const traceId = randomUUID();
  const headers = authHeaders({
    "Content-Type": "application/problem+json",
    Pragma: "no-cache",
    "X-Request-Id": traceId,
  });
  if (clearCookie !== undefined) headers.append("Set-Cookie", clearCookie);
  return new Response(
    JSON.stringify({
      detail:
        status === 400
          ? "The authentication request could not be completed. Start a new sign-in attempt."
          : "Authentication is temporarily unavailable. Try again shortly.",
      instance: `urn:trace:${traceId}`,
      status,
      title: status === 400 ? "Authentication request rejected" : "Authentication unavailable",
      traceId,
      type:
        status === 400
          ? "https://gopher-assistant.invalid/problems/authentication-request"
          : "https://gopher-assistant.invalid/problems/authentication-unavailable",
    }),
    { headers, status },
  );
}

export function tokenFreeSessionResponse(
  body: Readonly<Record<string, boolean | number>>,
  cookie?: string,
): Response {
  const headers = authHeaders({
    "Content-Type": "application/json; charset=utf-8",
    Pragma: "no-cache",
    Vary: "Cookie",
  });
  if (cookie !== undefined) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(body), { headers, status: 200 });
}
