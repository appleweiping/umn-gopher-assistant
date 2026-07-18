import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@umn-gopher-assistant/config", "@umn-gopher-assistant/contracts"],
};

export default nextConfig;
