"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CameraFeed } from "@/components/CameraFeed";
import { TraceControls } from "@/components/TraceControls";
import { TraceOverlay } from "@/components/TraceOverlay";
import { Button } from "@/components/ui";
import { useWakeLock } from "@/components/useWakeLock";
import {
  clampTransform,
  IDENTITY_TRANSFORM,
  type OverlayTransform,
} from "@/lib/overlayTransform";
import { readPreferences } from "@/lib/preferences";
import {
  getReference,
  updateReference,
  type Reference,
  type ReferencePatch,
} from "@/lib/storage";

/**
 * Trailing debounce for writes back to the reference (SPEC §6.3: "opacity
 * persists back to the reference record on change (debounced)"). Long enough
 * that dragging the slider across its full range is one write, short enough
 * that letting go and closing the app immediately still saves.
 */
export const PERSIST_DEBOUNCE_MS = 400;

/**
 * How long the control bar waits with no interaction before collapsing to a
 * pill (SPEC §6.3). Restarted by any pointer/touch/key activity anywhere on
 * the screen, including a gesture on the overlay or a slider drag — not just
 * activity on the bar itself.
 */
export const IDLE_MS = 4000;

/**
 * Route-parameter id from `next/navigation`'s `useParams`, in the shapes
 * Next.js actually returns it (a single segment is a string; a catch-all
 * would be an array — this route has neither, but the type is unions
 * regardless, so narrow rather than cast).
 */
function paramSegmentToId(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].length > 0) {
    return value[0];
  }
  return undefined;
}

/**
 * Parses `/trace/<id>` out of the current URL directly, as a fallback for
 * when `useParams` has nothing yet (KNOWN_ISSUES.md §3 / SPEC's id-neutral
 * shell requirement). Only ever consulted client-side.
 */
function idFromPathname(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const match = /^\/trace\/([^/?#]+)/.exec(window.location.pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; reference: Reference }
  | { status: "missing"; message: string };

/**
 * The Trace screen (SPEC §6.3) — camera, overlay and controls, plus the state
 * that ties them together.
 *
 * SPEC §11, the load-bearing structural rule: `transform` below is the ONLY
 * home for the overlay's placement. Every renderer downstream is a pure
 * function of it, T-10's gestures will `setTransform` and nothing else, and a
 * Phase 2 tracker would do the same. Adding a second placement value anywhere
 * — a separate rotation, an offset held in a ref, a CSS class that translates
 * — breaks the property the whole architecture rests on.
 *
 * `flipX` lives inside that object but is deliberately NOT persisted: SPEC §5
 * gives the reference record no flip field, so a flip lasts for the session
 * and the reference reopens unflipped.
 *
 * `id` is the SERVER-rendered route param (app/trace/[id]/page.tsx awaits
 * `params` and passes it down). It is used only as a last-resort fallback:
 * every actual read/write below goes through `effectiveId`, computed on the
 * client from `useParams()` first and `window.location.pathname` second
 * (KNOWN_ISSUES.md §3) — the offline service-worker fallback serves the same
 * cached HTML shell for any reference, so the id baked into that shell's
 * server render can be stale and must never be trusted on its own.
 */
export function TraceScreen({ id }: { id: string }) {
  const router = useRouter();
  const routeParams = useParams<{ id?: string | string[] }>();
  // Pure derivation from render inputs — no state, no effect. Recomputed
  // every render, but it is a cheap regex and its VALUE is stable across
  // renders as long as the URL and params are, so it is safe as a dependency
  // below without an extra memo.
  const effectiveId =
    paramSegmentToId(routeParams?.id) ?? idFromPathname() ?? id;
  const [load, setLoad] = useState<LoadState>({ status: "loading" });

  // --- overlay state -------------------------------------------------------
  const [transform, setTransform] =
    useState<OverlayTransform>(IDENTITY_TRANSFORM);
  const [opacity, setOpacity] = useState(100);
  const [inverted, setInverted] = useState(false);
  // Session-only, by design: SPEC §5's reference record has no lock field, so
  // a lock lasts until the screen is closed and never reaches storage. The
  // gesture layer reads it and drops every sample while it is true.
  const [locked, setLocked] = useState(false);

  // --- collapsing control chrome (T-11, SPEC §6.3/§9) ----------------------
  // Starts expanded; the mount effect below arms the first collapse timer.
  // No immediate `setChromeExpanded(true)` call on mount is needed — this
  // default value already is that — which keeps the mount effect free of a
  // synchronous setState (react-hooks/set-state-in-effect).
  const [chromeExpanded, setChromeExpanded] = useState(true);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Called from event handlers only (never from render or an effect body),
  // so the setState here does not trip react-hooks/set-state-in-effect.
  const resetIdleTimer = useCallback(() => {
    setChromeExpanded(true);
    if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      setChromeExpanded(false);
    }, IDLE_MS);
  }, []);

  useEffect(() => {
    idleTimerRef.current = setTimeout(() => {
      setChromeExpanded(false);
    }, IDLE_MS);
    return () => {
      if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
    };
  }, []);

  // Any pointer/touch/key activity anywhere on the screen restarts the idle
  // timer — including a gesture on the overlay or a drag on the slider, not
  // just a tap on the bar itself (SPEC §6.3). Registered once, on the screen
  // root, with capture: a listener on the root sees every event before (or
  // regardless of) whether a descendant stops its propagation, which the
  // gesture layer's Pointer Event handlers do not do, but nothing downstream
  // should have to know this depends on that.
  const handleIdleReset = useCallback(() => {
    resetIdleTimer();
  }, [resetIdleTimer]);

  // --- wake lock (T-11, carried T-13 wiring) --------------------------------
  // Read once on mount — Settings (T-13) is the only screen that writes this
  // preference, so there is nothing to react to changing while Trace is open.
  // `null` (not the eventual default) until the read resolves: starting the
  // hook `enabled` on an assumed `true` would acquire the lock immediately
  // and then release it a moment later for anyone whose real preference is
  // `false`, which is a pointless flash of platform activity for no reason —
  // waiting one microtask is unnoticeable and readPreferences() already
  // resolves `true` on its own when nothing is stored (SPEC's stated
  // default), so nothing is lost by waiting for it here.
  const [keepAwake, setKeepAwake] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void readPreferences().then((preferences) => {
      if (!cancelled) setKeepAwake(preferences.keepAwake);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useWakeLock(keepAwake === true);

  // --- debounced persistence ----------------------------------------------
  const pendingRef = useRef<ReferencePatch | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const patch = pendingRef.current;
    pendingRef.current = null;
    if (patch === null) return;

    // Fire and forget: this also runs from an unmount cleanup, where there is
    // no component left to await it. A failed write is invisible to the user
    // on purpose — losing a slider position is not worth interrupting a
    // drawing over, and the reference itself is untouched (SPEC §9 covers the
    // failures the user CAN act on; this is not one of them).
    void updateReference(effectiveId, patch)
      .then((result) => {
        if (!result.ok) {
          console.error("Free Trace: could not save trace settings", result.error);
        }
      })
      .catch((error: unknown) => {
        console.error("Free Trace: could not save trace settings", error);
      });
  }, [effectiveId]);

  const schedule = useCallback(
    (patch: ReferencePatch) => {
      const previous = pendingRef.current;
      const merged: ReferencePatch = { ...previous, ...patch };
      // `settings` is a nested object: a plain spread would let an invert
      // toggle discard a settings field a future caller had queued.
      if (previous?.settings || patch.settings) {
        merged.settings = { ...previous?.settings, ...patch.settings };
      }
      pendingRef.current = merged;

      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, PERSIST_DEBOUNCE_MS);
    },
    [flush],
  );

  // Flush on unmount (and if the id ever changed): closing the screen inside
  // the debounce window must still save, or the last drag of the slider — the
  // one the user actually settled on — is the one that gets lost.
  useEffect(() => () => flush(), [flush]);

  // --- load ---------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const result = await getReference(effectiveId);
      if (cancelled) return;

      if (!result.ok) {
        console.error("Free Trace: could not open reference", result.error);
        setLoad({ status: "missing", message: result.error.message });
        return;
      }

      setLoad({ status: "ready", reference: result.value });
      setOpacity(result.value.lastOpacity);
      setInverted(result.value.settings.inverted);
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveId]);

  // --- handlers -----------------------------------------------------------
  const handleOpacityChange = useCallback(
    (next: number) => {
      setOpacity(next);
      schedule({ lastOpacity: next });
    },
    [schedule],
  );

  const handleInvertToggle = useCallback(() => {
    const next = !inverted;
    setInverted(next);
    schedule({ settings: { inverted: next } });
  }, [inverted, schedule]);

  // The gesture layer's single exit point (T-10). Through clampTransform for
  // the same reason as the flip below: there is exactly one door into this
  // state object and the validator is nailed to it.
  const handleTransformChange = useCallback((next: OverlayTransform) => {
    setTransform((previous) => clampTransform(next, previous));
  }, []);

  const handleFlipToggle = useCallback(() => {
    // Through clampTransform even though a boolean cannot go out of range:
    // every write to the transform goes through the same validator, so there
    // is no path into the state object that skips it.
    setTransform((previous) =>
      clampTransform({ ...previous, flipX: !previous.flipX }, previous),
    );
  }, []);

  const handleLockToggle = useCallback(() => {
    setLocked((previous) => !previous);
  }, []);

  // A broken link must never be a black screen (SPEC §9). No camera is started
  // here — there is nothing to trace.
  if (load.status === "missing") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg px-8 text-center text-text">
        <p className="font-sans text-base font-medium">
          This reference could not be opened
        </p>
        <p className="max-w-xs font-sans text-sm text-text-muted">
          {load.message}
        </p>
        <Button onClick={() => router.push("/")}>Back to library</Button>
      </main>
    );
  }

  return (
    <main
      data-reference-id={effectiveId}
      // Fixed + overflow-hidden: the trace screen never scrolls, and
      // overscroll-none kills iOS pull-to-refresh mid-drawing (SPEC §7).
      className="fixed inset-0 overflow-hidden overscroll-none bg-bg text-text select-none"
      style={{ WebkitTouchCallout: "none" }}
      // Idle-timer resets, capture phase (SPEC §6.3): a listener here sees
      // every pointer/touch/key event on the screen — the overlay's own
      // gesture handlers, a slider drag, a tap on the collapsed pill — before
      // (or regardless of) anything downstream stopping its propagation.
      // Passive is fine: nothing here ever calls preventDefault.
      onPointerDownCapture={handleIdleReset}
      onPointerMoveCapture={handleIdleReset}
      onTouchStartCapture={handleIdleReset}
      onKeyDownCapture={handleIdleReset}
      onInputCapture={handleIdleReset}
      onChangeCapture={handleIdleReset}
    >
      <CameraFeed />

      {load.status === "ready" ? (
        <>
          <TraceOverlay
            image={load.reference.lineArtImage}
            name={load.reference.name}
            opacity={opacity}
            transform={transform}
            inverted={inverted}
            locked={locked}
            onTransformChange={handleTransformChange}
          />
          <TraceControls
            opacity={opacity}
            onOpacityChange={handleOpacityChange}
            locked={locked}
            onLockToggle={handleLockToggle}
            flipped={transform.flipX}
            onFlipToggle={handleFlipToggle}
            inverted={inverted}
            onInvertToggle={handleInvertToggle}
            collapsed={!chromeExpanded}
          />
        </>
      ) : null}
    </main>
  );
}
