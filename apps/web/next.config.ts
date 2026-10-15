import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @musicvault/core ships raw TypeScript source (no build step) — Next must
  // compile it alongside the app.
  transpilePackages: ["@musicvault/core"],
  // The service worker must never be served from an HTTP cache, or an update
  // waits for that cache to expire.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
