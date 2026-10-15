import type { MetadataRoute } from "next";

/**
 * Web app manifest: makes the site installable (desktop and phone) as a
 * standalone window. Served at /manifest.webmanifest, which the proxy lets
 * through signed-out because browsers fetch it without cookies.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Music Vault",
    short_name: "Music Vault",
    description: "Your music library, on every device.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0d0d10",
    theme_color: "#0d0d10",
    categories: ["music", "entertainment"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
