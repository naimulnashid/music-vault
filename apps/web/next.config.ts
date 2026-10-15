import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @musicvault/core ships raw TypeScript source (no build step) — Next must
  // compile it alongside the app.
  transpilePackages: ["@musicvault/core"],
};

export default nextConfig;
