"use client";

import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import {
  INITIAL_GESTURE_STATE,
  reduceGesture,
  type GestureEvent,
  type GestureState,
  type PointerSample,
} from "@/lib/gestures";
import type { OverlayTransform } from "@/lib/overlayTransform";

export interface UseOverlayGesturesOptions {
  /** The transform as currently rendered — the single source, SPEC §11. */
  transform: OverlayTransform;
  /** When true every pointer sample is dropped: lock freezes all transforms. */
  locked: boolean;
  /** Called only when a gesture actually changed the transform. */
  onTransformChange: (next: OverlayTransform) => void;
}

export interface OverlayGestureBinding {
  containerRef: RefObject<HTMLDivElement | null>;
  handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onLostPointerCapture: (event: ReactPointerEvent<HTMLDivElement>) => void;
  };
}

/**
 * Events whose default action is Safari's own gesture handling. They are
 * registered directly on the container with `{ passive: false }` because
 * **React's synthetic `onTouchStart`/`onTouchMove` are attached passively** at
 * the root — a `preventDefault()` from a synthetic touch handler is ignored by
 * the browser and, in Chrome, logged as an error. There is no React prop that
 * can do this job; it has to be a manual `addEventListener`.
 *
 *  - `touchstart` / `touchmove`: kills double-tap-to-zoom and the two-finger
 *    page pinch that would otherwise scale the whole document instead of the
 *    overlay (SPEC §10 item 6, §7 "disable double-tap zoom").
 *  - `gesturestart` / `gesturechange`: Safari's proprietary pinch events,
 *    which fire *in addition to* the touch events and drive the same native
 *    zoom. Not in the DOM lib's event map, hence the plain-string listeners.
 *
 * `touch-action: none` on the container covers most of this in modern Safari
 * on its own; both are kept because the CSS property has historically been
 * partial on iOS and the failure mode — the page zooming mid-drawing — is one
 * of the worst on this screen.
 */
const NATIVE_ZOOM_EVENTS = [
  "touchstart",
  "touchmove",
  "gesturestart",
  "gesturechange",
];

function sameTransform(a: OverlayTransform, b: OverlayTransform): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.scale === b.scale &&
    a.rotation === b.rotation &&
    a.flipX === b.flipX
  );
}

/**
 * Pointer Events (SPEC §10 item 6: Pointer Events, never Touch Events) wired
 * to the overlay container, turning them into `lib/gestures.ts` samples.
 *
 * The video layer is deliberately untouched: these handlers are spread onto
 * `[data-slot="overlay"]` and nothing else, so a pointer that lands on the
 * camera feed does nothing at all.
 */
export function useOverlayGestures({
  transform,
  locked,
  onTransformChange,
}: UseOverlayGesturesOptions): OverlayGestureBinding {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<GestureState>(INITIAL_GESTURE_STATE);

  // The live transform, kept in a ref rather than read from the closure. A
  // gesture writes it the instant it produces a value, so two pointer events
  // arriving inside one React render still compose correctly; the effect below
  // catches changes from everywhere else (the flip button, a future tracker).
  const transformRef = useRef(transform);
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  // Centre of the container in client coordinates = the overlay's
  // transform-origin (the <img> is flex-centred in it and pivots on its own
  // centre). Read once per gesture rather than per move: the container is
  // `fixed inset-0`, so it cannot move while fingers are down, and
  // getBoundingClientRect() on every pointermove would force layout.
  const originRef = useRef({ x: 0, y: 0 });

  // Locking mid-gesture must not leave a half-finished anchor behind, or the
  // first move after unlocking would resume from stale finger positions.
  useEffect(() => {
    if (locked) stateRef.current = INITIAL_GESTURE_STATE;
  }, [locked]);

  const dispatch = useCallback(
    (event: GestureEvent) => {
      const result = reduceGesture(
        stateRef.current,
        event,
        transformRef.current,
      );
      stateRef.current = result.state;
      if (sameTransform(result.transform, transformRef.current)) return;
      transformRef.current = result.transform;
      onTransformChange(result.transform);
    },
    [onTransformChange],
  );

  const sample = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): PointerSample => ({
      id: event.pointerId,
      x: event.clientX - originRef.current.x,
      y: event.clientY - originRef.current.y,
    }),
    [],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (locked) return;

      const node = event.currentTarget;
      if (stateRef.current.pointers.length === 0) {
        const rect = node.getBoundingClientRect();
        originRef.current = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      }

      // Capture so a finger that slides off the overlay — over the control
      // bar, or off the screen edge — keeps delivering moves here instead of
      // silently stranding the gesture mid-drag.
      if (typeof node.setPointerCapture === "function") {
        try {
          node.setPointerCapture(event.pointerId);
        } catch {
          // Safari throws NotFoundError if the pointer is already gone, and
          // jsdom has no pointer capture at all. Neither is worth failing a
          // gesture over: without capture the drag still works inside bounds.
        }
      }

      dispatch({ type: "down", pointer: sample(event) });
    },
    [dispatch, locked, sample],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (locked) return;
      dispatch({ type: "move", pointer: sample(event) });
    },
    [dispatch, locked, sample],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (locked) return;
      dispatch({ type: "up", id: event.pointerId });
    },
    [dispatch, locked],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (locked) return;
      dispatch({ type: "cancel", id: event.pointerId });
    },
    [dispatch, locked],
  );

  // Fires when the pointer leaves the window, when the OS steals it, and
  // (harmlessly, after the fact) on every normal release. Releasing a pointer
  // the state machine has already dropped is a no-op, so this needs no guard.
  const onLostPointerCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      dispatch({ type: "cancel", id: event.pointerId });
    },
    [dispatch],
  );

  useEffect(() => {
    const node = containerRef.current;
    if (node === null) return;

    const suppress = (event: Event) => {
      if (event.cancelable) event.preventDefault();
    };
    for (const name of NATIVE_ZOOM_EVENTS) {
      node.addEventListener(name, suppress, { passive: false });
    }
    return () => {
      for (const name of NATIVE_ZOOM_EVENTS) {
        node.removeEventListener(name, suppress);
      }
    };
    // Registered once for the life of the container and kept even while
    // locked: locking freezes the OVERLAY, it must not hand the page back to
    // Safari's pinch-zoom.
  }, []);

  return {
    containerRef,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture,
    },
  };
}
