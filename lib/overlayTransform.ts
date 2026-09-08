/**
 * lib/overlayTransform.ts — the ONE place the trace overlay's placement is
 * described (SPEC §11).
 *
 * SPEC §11 parks marker-based tracking but requires that "the overlay's
 * transform comes from a single source that could later be driven by a tracker
 * instead of by gestures". That is this module: a plain, serialisable value
 * plus the two pure functions that validate it and turn it into CSS.
 *
 * Consequences, deliberately:
 *  - Nothing here imports React, touches the DOM, or knows what a pointer is.
 *    T-10 will compute new `OverlayTransform` values from gestures; a Phase 2
 *    tracker would compute them from camera frames. Neither is visible here,
 *    and nothing tracker-specific is exposed.
 *  - The component renders `toCssTransform(transform)` and nothing else. If a
 *    second source of placement ever appears (a stray `translate` class, a
 *    parent transform), the single-source property is gone — that is what the
 *    structural test in tests/components/trace-screen.test.tsx watches for.
 */

/** Overlay placement. Angles are degrees; x/y are CSS pixels. */
export interface OverlayTransform {
  /** Horizontal offset in CSS pixels, applied before rotation. */
  x: number;
  /** Vertical offset in CSS pixels, applied before rotation. */
  y: number;
  /** Uniform scale. 1 = the image's natural fitted size. */
  scale: number;
  /** Rotation in degrees, clockwise. */
  rotation: number;
  /** Mirror horizontally. Independent of `rotation` — see toCssTransform. */
  flipX: boolean;
}

/** Where the overlay starts, and the fallback when a value is unusable. */
export const IDENTITY_TRANSFORM: OverlayTransform = Object.freeze({
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  flipX: false,
});

/** T-10 acceptance criterion: scale is clamped 0.1x–20x. */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 20;

/**
 * Rounds to 4dp and prints the shortest form. Gesture math produces values
 * like 1.0000000000000002; without this the CSS string churns on every frame
 * and a "did the transform change?" comparison is meaningless. `Object.is`
 * catches -0, which would otherwise render as "-0px".
 */
function num(value: number): string {
  const rounded = Math.round(value * 1e4) / 1e4;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/**
 * Serialises to a CSS `transform` value.
 *
 * Order is translate → rotate → scale, read left to right as the browser
 * applies it: move the element, then spin it about its own centre, then size
 * it about that same centre. `transform-origin: center` is set by the
 * component; without it the rotate and scale would pivot on the top-left.
 *
 * The flip is a separate, innermost `scaleX(-1)`. Mirroring the artwork in its
 * OWN frame — before any rotation is applied to it — is what makes flipping
 * independent of rotation: `rotation` is never negated, never adjusted, and
 * flipping twice returns the identical string. Folding the flip into the
 * `scale()` term (i.e. `scale(-s, s)`) would work visually but would put two
 * different concepts in one number, and T-10 has to be able to change scale
 * without thinking about flip.
 */
export function toCssTransform(t: OverlayTransform): string {
  const parts = [
    `translate(${num(t.x)}px, ${num(t.y)}px)`,
    `rotate(${num(t.rotation)}deg)`,
    `scale(${num(t.scale)})`,
  ];
  if (t.flipX) parts.push("scaleX(-1)");
  return parts.join(" ");
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Validates a candidate transform.
 *
 * - Non-finite numbers (NaN, ±Infinity) fall back to `previous` field by
 *   field, so one bad axis out of a gesture cannot discard the other three.
 *   With no `previous` supplied the fallback is IDENTITY_TRANSFORM.
 *   Note that ±Infinity is REJECTED rather than clamped to MAX_SCALE: an
 *   infinite scale means the maths went wrong upstream, and holding the last
 *   good value is less surprising mid-drawing than snapping to 20x.
 * - `scale` is then clamped to MIN_SCALE–MAX_SCALE.
 * - `flipX` is coerced, so a value arriving from JSON or a data attribute
 *   cannot smuggle a non-boolean into the state object.
 *
 * Always returns a fresh object — callers store the result in React state, and
 * mutating a previous transform in place would not re-render.
 */
export function clampTransform(
  next: OverlayTransform,
  previous: OverlayTransform = IDENTITY_TRANSFORM,
): OverlayTransform {
  const scale = finiteOr(next.scale, previous.scale);
  return {
    x: finiteOr(next.x, previous.x),
    y: finiteOr(next.y, previous.y),
    scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)),
    rotation: finiteOr(next.rotation, previous.rotation),
    flipX: next.flipX === true,
  };
}
