"use client";

import { useEffect } from "react";

/**
 * Registers `public/sw.js` (ticket T-12). Renders nothing.
 *
 * Two things matter here and both are deliberate:
 *
 * 1. **Production only.** The worker is cache-first over `/_next/static`, so on
 *    a dev server it would happily serve the chunks from before your last edit
 *    and make a correct change look broken.
 * 2. **On `load`, not on mount.** Installing the worker downloads the whole
 *    shell. Doing that during hydration competes with the first paint on the
 *    one screen where that is most expensive — and on a phone, on cellular.
 *
 * The `?v=` is NEXT_PUBLIC_BUILD_ID, inlined at build time by `next.config.ts`.
 * A new deploy is a new script URL, which is what makes the browser install a
 * fresh worker and drop the previous build's cache.
 */
export default function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      const build = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
      navigator.serviceWorker.register(`/sw.js?v=${build}`).catch(() => {
        /* Registration rejects in private windows and on unsupported browsers.
           The app works fine without a worker — just not offline — so this is a
           silent, non-blocking degradation, never a user-visible error. */
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
