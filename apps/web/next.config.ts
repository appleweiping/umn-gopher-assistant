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
      {
        // This tiny bootstrap points at the current content-addressed Worker.
        // Revalidate it on every online Worker start; the Service Worker owns
        // the explicit offline copy and never treats this URL as immutable.
        source: "/__uga-vault/personal-vault.worker.mjs",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
      {
        source: "/__uga-vault/personal-vault.worker.:hash([a-f0-9]{64}).mjs",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
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
