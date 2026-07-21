import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
] as const;

const nextConfig: NextConfig = {
  headers() {
    return Promise.resolve([
      { source: "/:path*", headers: [...securityHeaders] },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ]);
  },
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: [
    "@umn-gopher-assistant/config",
    "@umn-gopher-assistant/contracts",
    "@umn-gopher-assistant/crypto",
  ],
};

export default nextConfig;
