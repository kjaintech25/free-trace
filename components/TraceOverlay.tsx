"use client";

import { useEffect, useMemo } from "react";
import { useOverlayGestures } from "@/components/useOverlayGestures";
import { toCssTransform, type OverlayTransform } from "@/lib/overlayTransform";

export interface TraceOverlayProps {
  /** The reference's line-art PNG, straight out of IndexedDB. */
  image: Blob;
  /** Reference name, used for the alt text only. */
  name?: string;
  /** 0–100, as stored in `lastOpacity`. */
  opacity: number;
  /** The single placement object (SPEC §11). */
  transform: OverlayTransform;
  /** Render light lines on dark, for drawing in a dark room. */
  inverted: boolean;
  /** Freezes every gesture (SPEC §6.3). Session-only; never persisted. */
  locked: boolean;
  /** The gesture layer's only output — straight into TraceScreen's state. */
  onTransformChange: (next: OverlayTransform) => void;
}

/**
 * The line art, composited over the camera feed (SPEC §6.3).
 *
 * Performance contract (SPEC §6.3 / T-09 criterion 6). The only things that
 * ever change on this element are `transform` and `opacity` — the two
 * properties a browser can animate on the compositor without touching layout
 * or paint. Nothing here sets width, height, top or left, so a 4000px source
 * is uploaded to the GPU once as a texture and every later change is a matrix
 * multiply on that texture.
 *   - `will-change: transform, opacity` asks for that layer up front, so the
 *     first drag does not stutter while the layer is promoted.
 *   - `decoding="async"` keeps the (large) PNG decode off the main thread.
 *   - Deliberately NOT mix-blend-mode: blending against the live video forces
 *     a per-frame composite of two layers and fights the camera's own
 *     exposure. Plain alpha is what the spec asks for.
 *   - Deliberately NOT a canvas. An <img> with a CSS transform is GPU
 *     composited on iOS Safari; a canvas would put the same work back on the
 *     main thread and gain nothing.
 */
export function TraceOverlay({
  image,
  name,
  opacity,
  transform,
  inverted,
  locked,
  onTransformChange,
}: TraceOverlayProps) {
  const { containerRef, handlers } = useOverlayGestures({
    transform,
    locked,
    onTransformChange,
  });

  // Created during render rather than in an effect, on purpose. The effect
  // form has to write the URL into state, and `react-hooks/set-state-in-effect`
  // rejects that (correctly — it cascades a second render, so the first paint
  // of this screen would have an empty <img>).
  //
  // The pairing below is what makes it safe: the cleanup is keyed on `url`, so
  // a new blob (or React discarding the memo and recomputing it) revokes the
  // URL it replaces, and unmounting revokes the last one. Known limit: React
  // StrictMode double-invokes render in development, which strands one blob:
  // URL per mount there. Production renders once.
  const url = useMemo(() => URL.createObjectURL(image), [image]);

  useEffect(() => {
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [url]);

  return (
    <div
      ref={containerRef}
      data-slot="overlay"
      // z-10: above the video, below the camera failure panel and the control
      // bar (both of which must stay tappable).
      //
      // pointer-events stay ON: this container is where T-10's Pointer Event
      // handlers live, and gestures must act on the overlay, never the video.
      className="absolute inset-0 z-10 flex items-center justify-center"
      // The whole state object, serialised. This is a read-only debug/verify
      // surface: the T-14 harness and the structural test both use it to prove
      // the rendered transform derives from exactly one object.
      data-transform={JSON.stringify(transform)}
      // Rendered in both states rather than only when engaged, so a harness or
      // a test can tell "unlocked" from "the attribute was never wired".
      data-locked={locked ? "true" : "false"}
      style={{
        // The one line that stops iOS from panning/zooming the page instead of
        // handing the gesture to us. Inline rather than a Tailwind class
        // because it is load-bearing behaviour, not styling, and it is checked
        // by name in the tests.
        touchAction: "none",
        // SPEC §7: no text selection and no long-press callout on the trace
        // screen. `main` sets both too; repeating them here keeps the
        // container correct if it is ever mounted somewhere else.
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
      }}
      {...handlers}
    >
      {
        /* eslint-disable-next-line @next/next/no-img-element -- next/image
           optimises a URL through the Next image pipeline. This source is a
           blob: URL for a locally generated PNG that must never leave the
           device (SPEC §1), and its intrinsic size is not known at render
           time. A plain <img> is the correct element here. */
        <img
          src={url}
          alt={name ? `Line art overlay: ${name}` : "Line art overlay"}
          data-slot="overlay-image"
          decoding="async"
          // draggable + select-none: without these, a slow drag on iOS/desktop
          // starts a native image drag or a text selection instead of the
          // gesture T-10 is about to attach.
          draggable={false}
          className="max-h-full max-w-full select-none"
          style={{
            opacity: opacity / 100,
            transform: toCssTransform(transform),
            transformOrigin: "center",
            willChange: "transform, opacity",
            // Dark lines become light. The stored PNG is never re-encoded —
            // this is a display-time filter only, so toggling it back is free
            // and the reference on disk is untouched (SPEC §5).
            filter: inverted ? "invert(1)" : undefined,
          }}
        />
      }
    </div>
  );
}
