import type { NextConfig } from "next";

/* A per-build identifier, evaluated once when this config is loaded, i.e. once
   per build. The service worker's cache name is keyed to it (public/sw.js), and
   components/RegisterSW.tsx registers the script as `/sw.js?v=<this>`, so every
   deploy is a new script URL: a fresh worker, a fresh cache, and the previous
   build's cache dropped on activate. On Vercel the commit sha is always
   present; locally it falls back to when the build started. */
const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? `local-${Date.now().toString(36)}`;

const nextConfig: NextConfig = {
  // Pin the workspace root. Without this, Turbopack can walk up and find a
  // stray package-lock.json outside the repo and warn on every build.
  turbopack: { root: __dirname },

  // Inlined into the client bundle at build time; read by components/RegisterSW.tsx.
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },

  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          // The worker script must never come from the HTTP cache, or a deploy
          // can be shadowed by a stale copy of the previous one for a day.
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          // Lets the worker claim the whole origin even though it is served
          // from /public. Redundant while the script sits at the root, and
          // exactly what breaks silently if it ever moves.
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
