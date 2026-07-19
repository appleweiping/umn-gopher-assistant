import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Campus Field Guide",
    short_name: "Field Guide",
    description: "Independent bilingual five-campus assistant.",
    id: "/",
    scope: "/",
    start_url: "/today",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: "#F4F1E8",
    theme_color: "#174F44",
    lang: "en",
    categories: ["education", "navigation", "productivity"],
    icons: [
      { src: "/icons/field-guide.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/field-guide.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
      {
        src: "/icons/field-guide-maskable.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
    prefer_related_applications: false,
  };
}
