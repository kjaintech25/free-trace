"use client";

import { useEffect, useRef } from "react";
import { acquireWakeLock, releaseWakeLock } from "@/lib/wakeLock";

/**
 * Holds the screen wake lock for as long as `enabled` is true and the Trace
 * screen is mounted (SPEC §6.3: "Screen wake lock active while this screen
 * is open"; SPEC §10 item 5: re-acquire after backgrounding).
 *
 * The sentinel lives in a ref, not state — it is a resource handle nothing
 * ever renders from, so putting it in state would just be an extra render
 * every time the browser releases it out from under us (SPEC §9 quality bar,
 * same reasoning as the debounce timer in TraceScreen).
 */
export function useWakeLock(enabled: boolean): void {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const acquire = async () => {
      const sentinel = await acquireWakeLock();
      if (cancelled) {
        // Enabled flipped false (or we unmounted) while the request was in
        // flight — hand it straight back rather than holding a lock nobody
        // wants any more.
        void releaseWakeLock(sentinel);
        return;
      }
      sentinelRef.current = sentinel;
    };

    void acquire();

    // SPEC §10 item 5: the platform itself drops the lock when the tab is
    // backgrounded, so re-request it once the page is visible again rather
    // than assuming the original sentinel is still good. `pageshow` covers
    // the bfcache-restore case Safari uses for back/forward navigation,
    // which does not always fire `visibilitychange`.
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void acquire();
      } else {
        const current = sentinelRef.current;
        sentinelRef.current = null;
        void releaseWakeLock(current);
      }
    };
    const handlePageShow = () => {
      if (document.visibilityState === "visible") {
        void acquire();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
      const current = sentinelRef.current;
      sentinelRef.current = null;
      void releaseWakeLock(current);
    };
  }, [enabled]);
}
