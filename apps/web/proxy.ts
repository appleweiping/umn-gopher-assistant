import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDevelopment = process.env.NODE_ENV === "development";
  const contentSecurityPolicy = [
    "default-src 'self'",
    "base-uri 'self'",
    `connect-src 'self'${isDevelopment ? " ws:" : ""}`,
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "img-src 'self' blob: data:",
    "manifest-src 'self'",
    "object-src 'none'",
    // Do not add `unsafe-eval`: the vault Worker depends on WebAssembly, not
    // JavaScript string evaluation. `wasm-unsafe-eval` is deliberately the
    // narrowest capability needed by the Argon2/WebAssembly implementation.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'`,
    `style-src 'self' 'nonce-${nonce}'${isDevelopment ? " 'unsafe-inline'" : ""}`,
    // Next creates these two policies for route chunks and its bundler. Keep
    // the allow-list closed so application code cannot mint arbitrary Trusted
    // Types policies, then require Trusted Types at every script sink.
    "trusted-types nextjs nextjs#bundler uga#service-worker uga#vault-worker",
    "require-trusted-types-for 'script'",
    "worker-src 'self'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  const offlineLocale =
    request.nextUrl.pathname === "/offline" ? request.nextUrl.searchParams.get("locale") : null;
  requestHeaders.delete("x-offline-locale");
  if (offlineLocale === "en" || offlineLocale === "zh-CN") {
    requestHeaders.set("x-offline-locale", offlineLocale);
  }
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!api|v1|_next/static|_next/image|icons|brand|sw\\.js|theme-boot\\.js|manifest\\.webmanifest|favicon\\.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
