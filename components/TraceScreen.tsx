"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CameraFeed } from "@/components/CameraFeed";
import { TraceControls } from "@/components/TraceControls";
import { TraceOverlay } from "@/components/TraceOverlay";
import { Button } from "@/components/ui";
import {
  clampTransform,
  IDENTITY_TRANSFORM,
  type OverlayTransform,
} from "@/lib/overlayTransform";
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
 */
export function TraceScreen({ id }: { id: string }) {
  const router = useRouter();
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
    void updateReference(id, patch)
      .then((result) => {
        if (!result.ok) {
          console.error("Free Trace: could not save trace settings", result.error);
        }
      })
      .catch((error: unknown) => {
        console.error("Free Trace: could not save trace settings", error);
      });
  }, [id]);

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
      const result = await getReference(id);
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
  }, [id]);

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
      data-reference-id={id}
      // Fixed + overflow-hidden: the trace screen never scrolls, and
      // overscroll-none kills iOS pull-to-refresh mid-drawing (SPEC §7).
      className="fixed inset-0 overflow-hidden overscroll-none bg-bg text-text select-none"
      style={{ WebkitTouchCallout: "none" }}
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
          />
        </>
      ) : null}
    </main>
  );
}
