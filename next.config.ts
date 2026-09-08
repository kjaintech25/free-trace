import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root. Without this, Turbopack can walk up and find a
  // stray package-lock.json outside the repo and warn on every build.
  turbopack: { root: __dirname },
};

export default nextConfig;
