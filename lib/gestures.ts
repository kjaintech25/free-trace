/**
 * lib/gestures.ts — the gesture maths for the Trace overlay (SPEC §6.3, T-10).
 *
 * A small, pure state machine over pointer samples. It has no React, no DOM
 * and no knowledge of Pointer Events: `components/useOverlayGestures.ts`
 * translates real events into the `GestureEvent`s below and feeds them in.
 * That split is what makes the awkward half — the anchored pinch — unit
 * testable with exact numbers instead of by feel.
 *
 * Every value it emits leaves through `clampTransform`, so SPEC §11's "one
 * transform, validated in one place" still holds with gestures attached.
 *
 * ---------------------------------------------------------------------------
 * COORDINATE SPACE — read this before using the module
 * ---------------------------------------------------------------------------
 * `PointerSample.x/y` are **relative to the overlay's transform origin**, not
 * to the viewport. The origin is the centre of the `[data-slot="overlay"]`
 * container, which is `absolute inset-0` inside a `fixed inset-0` main, and
 * the <img> it centres carries `transform-origin: center` — so the image's
 * rotate/scale pivot and the container's centre are the same point. The hook
 * subtracts that centre once per gesture; the maths below assumes it is done.
 *
 * Getting this wrong is silent: the anchoring only breaks by an offset, which
 * looks like "the zoom drifts a bit" rather than like a bug.
 *
 * ---------------------------------------------------------------------------
 * THE DERIVATION (why midpoint anchoring is one line of matrix algebra)
 * ---------------------------------------------------------------------------
 * The overlay renders `translate(x,y) rotate(θ) scale(s)` about its centre, so
 * a point `p` in the image's own frame lands at
 *
 *     P = t + R(θ)·s·p                                        (1)
 *
 * with `t = (x, y)` and `R(θ)` the clockwise rotation matrix — clockwise
 * because the y axis points down in CSS, which is also why `Math.atan2(dy,dx)`
 * can be fed straight into a CSS `rotate()` with no sign flip.
 *
 * A pinch must keep the image point that was under the finger midpoint at the
 * START of the gesture under the midpoint NOW. Write `m₀` for the start
 * midpoint, `m` for the current one, and `(t₀, s₀, θ₀)` for the transform when
 * the gesture was anchored. Inverting (1) gives the image point under `m₀`:
 *
 *     p = (R(θ₀)·s₀)⁻¹ · (m₀ − t₀)
 *
 * The new transform is `s = s₀·f` (f = current distance / start distance) and
 * `θ = θ₀ + dθ`. Requiring that same `p` to land on `m` and solving for `t`:
 *
 *     t = m − R(θ₀+dθ)·s₀·f·(R(θ₀)·s₀)⁻¹·(m₀ − t₀)
 *       = m − R(dθ)·f·(m₀ − t₀)                               (2)
 *
 * because rotations compose (`R(θ₀+dθ)·R(−θ₀) = R(dθ)`) and the scalar `s₀`
 * cancels. **The starting scale and rotation drop out entirely.** Only the
 * ratio `f`, the rotation delta, and the vector from the old translation to
 * the old midpoint survive. Three consequences worth stating:
 *
 *  - A one-finger drag is (2) with `f = 1`, `dθ = 0`, giving `t = t₀+(m−m₀)`.
 *    Drag and pinch are therefore the SAME code path here, not two.
 *  - Translation "follows the midpoint" for free: `m` enters (2) linearly.
 *  - `flipX` is an innermost `scaleX(-1)` (see `toCssTransform`), so it sits
 *    inside `p` and cancels along with `s₀`. Mirroring does not change (2).
 *
 * Clamping is the one place this needs care. If `s₀·f` lands outside
 * 0.1×–20× the scale is pinned, and using the requested `f` in (2) would then
 * slide the image out from under the fingers at the limit. So the factor used
 * for the translation is the one that actually happened, `s_clamped / s₀` —
 * which keeps the anchor exact even while the zoom is refusing to go further.
 */

import {
  clampTransform,
  IDENTITY_TRANSFORM,
  MAX_SCALE,
  MIN_SCALE,
  type OverlayTransform,
} from "@/lib/overlayTransform";

/** One pointer, in the overlay's origin-relative space (see the header). */
export interface PointerSample {
  /** `PointerEvent.pointerId`. */
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

/** A pointer event reduced to what the maths needs. */
export type GestureEvent =
  | { readonly type: "down"; readonly pointer: PointerSample }
  | { readonly type: "move"; readonly pointer: PointerSample }
  | { readonly type: "up"; readonly id: number }
  | { readonly type: "cancel"; readonly id: number };

interface Vec {
  readonly x: number;
  readonly y: number;
}

/**
 * The snapshot a gesture is measured against. Re-taken every time the set of
 * pointers changes, which is what makes 2→1 fingers (and 1→2, and a third
 * finger landing) continuous: a fresh anchor describes the CURRENT transform
 * and the CURRENT finger positions, so the very next move computes a delta of
 * zero. There is no code that "handles" the lift; not jumping is structural.
 */
interface GestureAnchor {
  /** The pointers being measured — at most two, in the order they went down. */
  readonly ids: readonly number[];
  /** (t₀, s₀, θ₀). Already through `clampTransform`, so `scale` is finite. */
  readonly transform: OverlayTransform;
  /** m₀ — midpoint of `ids` when the anchor was taken. */
  readonly mid: Vec;
  /** d₀ — distance between the two pointers. 0 for a single pointer. */
  readonly distance: number;
  /**
   * Angle of the start vector in degrees. 0 for a single pointer.
   *
   * Note there is deliberately no accumulated-rotation field here. Tracking
   * how many times a gesture has wound past ±180° would be unobservable: the
   * delta only ever reaches a rotation matrix (periodic in 360°) and
   * `wrapDegrees` (likewise), so every branch of the angle produces the same
   * pixels and the same stored transform. Carrying one would be state that
   * cannot be tested because it cannot be seen.
   */
  readonly angle: number;
}

export interface GestureState {
  /**
   * Every pointer currently down, in the order they arrived. Only the first
   * two drive the transform (extra fingers are ignored, per T-10), but the
   * rest are still tracked so that promoting one — when an earlier finger
   * lifts — starts from its live position rather than a stale one.
   */
  readonly pointers: readonly PointerSample[];
  readonly anchor: GestureAnchor | null;
}

export interface GestureResult {
  readonly state: GestureState;
  /** The transform to render. Identical (by reference) to the input when the
   *  event changed nothing, so callers can skip a re-render with `!==`. */
  readonly transform: OverlayTransform;
}

export const INITIAL_GESTURE_STATE: GestureState = Object.freeze({
  pointers: Object.freeze([]),
  anchor: null,
});

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

/** Normalises to (−180, 180], the range `toCssTransform` prints degrees in. */
export function wrapDegrees(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const wrapped = ((((value + 180) % 360) + 360) % 360) - 180;
  // The modulo above yields [−180, 180); −180 and +180 are the same angle and
  // the spec for this ticket asks for the half-open interval to close on +180.
  return wrapped === -180 ? 180 : wrapped;
}

function isUsable(sample: PointerSample): boolean {
  return (
    Number.isFinite(sample.id) &&
    Number.isFinite(sample.x) &&
    Number.isFinite(sample.y)
  );
}

function clampScale(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function find(
  pointers: readonly PointerSample[],
  id: number,
): PointerSample | undefined {
  return pointers.find((pointer) => pointer.id === id);
}

/**
 * Takes a fresh anchor from the live pointers and the live transform.
 *
 * The transform goes through `clampTransform` against IDENTITY_TRANSFORM
 * rather than against itself: a NaN arriving from somewhere upstream must fall
 * back to a usable number here, and `clampTransform(t, t)` would keep the NaN.
 * The guarantee bought is `anchor.transform.scale ∈ [0.1, 20]`, which is what
 * lets the division in `applyAnchor` be unconditional.
 */
function anchorFrom(
  pointers: readonly PointerSample[],
  transform: OverlayTransform,
): GestureAnchor | null {
  const active = pointers.slice(0, 2);
  if (active.length === 0) return null;

  const base = clampTransform(transform, IDENTITY_TRANSFORM);
  const ids = active.map((pointer) => pointer.id);

  if (active.length === 1) {
    return {
      ids,
      transform: base,
      mid: { x: active[0].x, y: active[0].y },
      distance: 0,
      angle: 0,
    };
  }

  const [a, b] = active;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return {
    ids,
    transform: base,
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    distance: Math.hypot(dx, dy),
    angle: Math.atan2(dy, dx) * DEG,
  };
}

/** Equation (2) from the header, plus the degenerate cases. */
function applyAnchor(
  anchor: GestureAnchor,
  pointers: readonly PointerSample[],
  current: OverlayTransform,
): OverlayTransform | null {
  const a = find(pointers, anchor.ids[0]);
  if (a === undefined) return null;
  const b = anchor.ids.length > 1 ? find(pointers, anchor.ids[1]) : undefined;

  let mid: Vec;
  let factor = 1;
  let rotationDelta = 0;

  if (b === undefined) {
    // One finger: pure translation. Equation (2) with f = 1 and dθ = 0, which
    // still has to run through the same code so that a drag after a pinch
    // keeps the rotation it was given.
    mid = { x: a.x, y: a.y };
  } else {
    mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.hypot(dx, dy);
    // Two fingers landing on the same pixel (or an event stream that repeats
    // one) makes both the ratio and the angle undefined. Falling back to a
    // two-finger DRAG is the only continuous answer: the midpoint is still
    // well defined, so the image tracks the fingers and picks the zoom back up
    // the moment they separate.
    if (distance > 0 && anchor.distance > 0) {
      const ratio = distance / anchor.distance;
      if (Number.isFinite(ratio)) factor = ratio;
      rotationDelta = wrapDegrees(Math.atan2(dy, dx) * DEG - anchor.angle);
    }
  }

  const base = anchor.transform;
  const scale = clampScale(base.scale * factor, base.scale);
  // The factor that ACTUALLY happened, not the one asked for — see the header.
  const effective = scale / base.scale;
  const radians = rotationDelta * RAD;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const ax = anchor.mid.x - base.x;
  const ay = anchor.mid.y - base.y;

  return clampTransform(
    {
      x: mid.x - (cos * ax - sin * ay) * effective,
      y: mid.y - (sin * ax + cos * ay) * effective,
      scale,
      rotation: wrapDegrees(base.rotation + rotationDelta),
      // From the live transform, not the anchor: the flip button can be
      // pressed between two moves, and the gesture must not undo it.
      flipX: current.flipX,
    },
    current,
  );
}

function withPointers(
  pointers: readonly PointerSample[],
  current: OverlayTransform,
): GestureState {
  return { pointers, anchor: anchorFrom(pointers, current) };
}

/**
 * The state machine. Pure: same inputs, same outputs, no mutation of `state`.
 *
 * `current` is the transform as rendered right now. It is used to anchor
 * (down/up/cancel) and as the fallback for `clampTransform`; the value a MOVE
 * produces is derived from the anchor, never from `current`, so a caller whose
 * "current" lags by a frame cannot make the overlay drift.
 */
export function reduceGesture(
  state: GestureState,
  event: GestureEvent,
  current: OverlayTransform,
): GestureResult {
  switch (event.type) {
    case "down": {
      // Garbage in (a synthetic event with no coordinates, a NaN from a broken
      // stylus driver) is dropped rather than tracked: an unusable sample in
      // the list would poison every later midpoint.
      if (!isUsable(event.pointer)) return { state, transform: current };

      const pointers = [
        ...state.pointers.filter((pointer) => pointer.id !== event.pointer.id),
        event.pointer,
      ];
      // Re-anchoring on EVERY down, including a third finger, is deliberate.
      // For the ignored finger the anchor is re-taken from unchanged positions
      // and the unchanged live transform, so it is a no-op by construction —
      // no special case, and nothing moves.
      return { state: withPointers(pointers, current), transform: current };
    }

    case "move": {
      if (!isUsable(event.pointer)) return { state, transform: current };
      if (find(state.pointers, event.pointer.id) === undefined) {
        // A move for a pointer we never saw go down (or one released already).
        return { state, transform: current };
      }

      const pointers = state.pointers.map((pointer) =>
        pointer.id === event.pointer.id ? event.pointer : pointer,
      );
      const anchor = state.anchor;
      if (anchor === null) {
        return { state: { ...state, pointers }, transform: current };
      }

      // Third and later fingers are tracked but never drive the transform.
      if (!anchor.ids.includes(event.pointer.id)) {
        return { state: { ...state, pointers }, transform: current };
      }

      const applied = applyAnchor(anchor, pointers, current);
      if (applied === null) {
        return { state: { ...state, pointers }, transform: current };
      }

      // The anchor is untouched: every move is measured against the SAME
      // snapshot, so float error cannot accumulate across a long drag the way
      // it would if each move re-based on the last one.
      return { state: { pointers, anchor }, transform: applied };
    }

    case "up":
    case "cancel": {
      if (find(state.pointers, event.id) === undefined) {
        return { state, transform: current };
      }
      const pointers = state.pointers.filter(
        (pointer) => pointer.id !== event.id,
      );
      // Lifting never moves the image: the transform passes through untouched
      // and the survivors are re-anchored where they currently are.
      return { state: withPointers(pointers, current), transform: current };
    }
  }
}
