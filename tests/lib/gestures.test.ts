import { describe, expect, it } from "vitest";
import {
  INITIAL_GESTURE_STATE,
  reduceGesture,
  wrapDegrees,
  type GestureEvent,
  type GestureState,
} from "@/lib/gestures";
import {
  IDENTITY_TRANSFORM,
  MAX_SCALE,
  MIN_SCALE,
  type OverlayTransform,
} from "@/lib/overlayTransform";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface Vec {
  x: number;
  y: number;
}

const down = (id: number, x: number, y: number): GestureEvent => ({
  type: "down",
  pointer: { id, x, y },
});
const move = (id: number, x: number, y: number): GestureEvent => ({
  type: "move",
  pointer: { id, x, y },
});
const up = (id: number): GestureEvent => ({ type: "up", id });
const cancel = (id: number): GestureEvent => ({ type: "cancel", id });

function transform(patch: Partial<OverlayTransform> = {}): OverlayTransform {
  return { ...IDENTITY_TRANSFORM, ...patch };
}

interface Run {
  state: GestureState;
  transform: OverlayTransform;
}

/** Feeds a whole gesture through the reducer the way the hook does. */
function drive(
  events: readonly GestureEvent[],
  start: OverlayTransform = IDENTITY_TRANSFORM,
  from: Run = { state: INITIAL_GESTURE_STATE, transform: start },
): Run {
  let run = from;
  for (const event of events) {
    const result = reduceGesture(run.state, event, run.transform);
    run = { state: result.state, transform: result.transform };
  }
  return run;
}

/**
 * Where an image-space point lands on screen — the same `translate → rotate →
 * scale` the CSS applies, written out independently of lib/gestures.ts so the
 * anchoring tests below are checked against the RENDERING contract rather than
 * against the implementation's own arithmetic.
 *
 * `flipX` is ignored: it is an innermost `scaleX(-1)`, so it cancels out of the
 * anchoring identity (see the derivation in lib/gestures.ts), and every case
 * here leaves it false anyway.
 */
function project(t: OverlayTransform, p: Vec): Vec {
  const radians = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: t.x + (cos * p.x - sin * p.y) * t.scale,
    y: t.y + (sin * p.x + cos * p.y) * t.scale,
  };
}

/** The inverse of `project` — which image point is under a screen point. */
function unproject(t: OverlayTransform, s: Vec): Vec {
  const radians = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = (s.x - t.x) / t.scale;
  const dy = (s.y - t.y) / t.scale;
  return { x: cos * dx + sin * dy, y: -sin * dx + cos * dy };
}

function midpoint(a: Vec, b: Vec): Vec {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function expectFinite(t: OverlayTransform): void {
  expect(Number.isFinite(t.x)).toBe(true);
  expect(Number.isFinite(t.y)).toBe(true);
  expect(Number.isFinite(t.scale)).toBe(true);
  expect(Number.isFinite(t.rotation)).toBe(true);
  expect(t.scale).toBeGreaterThanOrEqual(MIN_SCALE);
  expect(t.scale).toBeLessThanOrEqual(MAX_SCALE);
}

/**
 * The property the whole ticket turns on: the image point that was under the
 * finger midpoint when the pinch started is still under it now.
 */
function expectAnchored(
  start: OverlayTransform,
  a0: Vec,
  b0: Vec,
  a1: Vec,
  b1: Vec,
): OverlayTransform {
  const result = drive(
    [
      down(1, a0.x, a0.y),
      down(2, b0.x, b0.y),
      move(1, a1.x, a1.y),
      move(2, b1.x, b1.y),
    ],
    start,
  ).transform;

  const grabbed = unproject(start, midpoint(a0, b0));
  const landed = project(result, grabbed);
  const target = midpoint(a1, b1);

  expect(landed.x).toBeCloseTo(target.x, 9);
  expect(landed.y).toBeCloseTo(target.y, 9);
  return result;
}

// ---------------------------------------------------------------------------
// one finger — drag
// ---------------------------------------------------------------------------

describe("reduceGesture — one finger drags (criterion 1)", () => {
  it("translates by the pointer delta and nothing else", () => {
    const result = drive([down(1, 10, 10), move(1, 40, 55)]).transform;

    expect(result).toEqual(transform({ x: 30, y: 45 }));
  });

  it("drags by the same pixels whatever the current zoom and rotation", () => {
    // The image moves with the FINGER, not with the image's own axes: a user
    // dragging 30px right expects 30px right, not 30px along a rotated axis.
    const start = transform({ x: 5, y: -5, scale: 3.5, rotation: 40 });
    const result = drive([down(1, 0, 0), move(1, 30, -12)], start).transform;

    expect(result).toEqual({ ...start, x: 35, y: -17 });
  });

  it("accumulates across a stream of moves without drifting", () => {
    const events: GestureEvent[] = [down(1, 0, 0)];
    for (let step = 1; step <= 100; step += 1) events.push(move(1, step, -step));

    // Measured against the anchor rather than the previous frame, so 100
    // moves land exactly where one move of the same size would.
    expect(drive(events).transform).toEqual(transform({ x: 100, y: -100 }));
  });

  it("does nothing for a move with no matching down", () => {
    const result = drive([move(1, 40, 55)]).transform;

    expect(result).toBe(IDENTITY_TRANSFORM);
  });

  it("does nothing on the down itself", () => {
    const result = drive([down(1, 10, 10)]).transform;

    expect(result).toBe(IDENTITY_TRANSFORM);
  });

  it("stops following a finger that has lifted", () => {
    const after = drive([down(1, 10, 10), move(1, 20, 20), up(1)]);
    const later = drive([move(1, 900, 900)], IDENTITY_TRANSFORM, after);

    expect(later.transform).toEqual(transform({ x: 10, y: 10 }));
  });

  it("treats a cancelled pointer the same as a lifted one", () => {
    const after = drive([down(1, 10, 10), move(1, 20, 20), cancel(1)]);
    const later = drive([move(1, 900, 900)], IDENTITY_TRANSFORM, after);

    expect(later.transform).toEqual(transform({ x: 10, y: 10 }));
  });
});

// ---------------------------------------------------------------------------
// two fingers — pinch and rotate
// ---------------------------------------------------------------------------

describe("reduceGesture — two fingers pinch and rotate (criterion 1)", () => {
  it("scales by the ratio of the finger distances", () => {
    // 100px apart, then 200px apart, centred on the origin so the anchoring
    // term is zero and the scale can be read on its own.
    const result = drive([
      down(1, -50, 0),
      down(2, 50, 0),
      move(1, -100, 0),
      move(2, 100, 0),
    ]).transform;

    expect(result).toEqual(transform({ scale: 2 }));
  });

  it("shrinks on a ratio below 1", () => {
    const result = drive([
      down(1, -50, 0),
      down(2, 50, 0),
      move(1, -12.5, 0),
      move(2, 12.5, 0),
    ]).transform;

    expect(result).toEqual(transform({ scale: 0.25 }));
  });

  it("rotates by the change in the angle between the fingers", () => {
    const result = drive([
      down(1, -50, 0),
      down(2, 50, 0),
      move(1, 0, -50),
      move(2, 0, 50),
    ]).transform;

    expect(result.rotation).toBeCloseTo(90, 12);
    expect(result.scale).toBeCloseTo(1, 12);
  });

  it("rotates the other way for the other direction", () => {
    const result = drive([
      down(1, -50, 0),
      down(2, 50, 0),
      move(1, 0, 50),
      move(2, 0, -50),
    ]).transform;

    expect(result.rotation).toBeCloseTo(-90, 12);
  });

  it("pinches and rotates in the same gesture, not one after the other", () => {
    // 100px apart horizontally -> 200px apart vertically: 2x zoom AND a
    // quarter turn, from a single pair of moves.
    const result = drive([
      down(1, -50, 0),
      down(2, 50, 0),
      move(1, 0, -100),
      move(2, 0, 100),
    ]).transform;

    expect(result.scale).toBeCloseTo(2, 12);
    expect(result.rotation).toBeCloseTo(90, 12);
    expect(result.x).toBeCloseTo(0, 12);
    expect(result.y).toBeCloseTo(0, 12);
  });

  it("keeps the rotation it was given when the fingers only translate", () => {
    const result = drive([
      down(1, -50, 0),
      down(2, 50, 0),
      move(1, 50, 200),
      move(2, 150, 200),
    ]).transform;

    expect(result).toEqual(transform({ x: 100, y: 200 }));
  });
});

// ---------------------------------------------------------------------------
// midpoint anchoring — the criterion this ticket exists for
// ---------------------------------------------------------------------------

describe("reduceGesture — zoom is anchored to the midpoint (criterion 2)", () => {
  it("leaves the point under the midpoint under the midpoint", () => {
    // Fingers 200px apart around (200, 0), pinched to 400px apart around the
    // same place. Element-centre zoom would leave x at 0; midpoint zoom has to
    // pull the image left by exactly one extra midpoint's worth.
    const result = drive([
      down(1, 100, 0),
      down(2, 300, 0),
      move(1, 0, 0),
      move(2, 400, 0),
    ]).transform;

    expect(result).toEqual(transform({ x: -200, y: 0, scale: 2 }));
    // Independently: the image point at (200,0) started under the midpoint...
    expect(project(IDENTITY_TRANSFORM, { x: 200, y: 0 })).toEqual({
      x: 200,
      y: 0,
    });
    // ...and is still there afterwards.
    expect(project(result, { x: 200, y: 0 })).toEqual({ x: 200, y: 0 });
  });

  it("moves x and y by the exact amount an off-centre pinch requires", () => {
    // Same 2x, midpoint at (300, -150). Anchoring means t = m − f·(m − t₀),
    // so x = 300 − 2·300 = −300 and y = −150 − 2·(−150) = 150.
    const result = drive([
      down(1, 200, -150),
      down(2, 400, -150),
      move(1, 100, -150),
      move(2, 500, -150),
    ]).transform;

    expect(result).toEqual(transform({ x: -300, y: 150, scale: 2 }));
  });

  it("rotates about the midpoint too, not about the element centre", () => {
    // Fingers on (0,0)-(100,0), midpoint (50,0), turned a quarter clockwise
    // about that midpoint. A centre-anchored rotation would leave x,y at 0.
    const result = drive([
      down(1, 0, 0),
      down(2, 100, 0),
      move(1, 50, -50),
      move(2, 50, 50),
    ]).transform;

    expect(result.x).toBeCloseTo(50, 12);
    expect(result.y).toBeCloseTo(-50, 12);
    expect(result.rotation).toBeCloseTo(90, 12);
    expect(result.scale).toBeCloseTo(1, 12);
  });

  it("holds the anchor for a simultaneous pinch, rotate and pan from a rotated, zoomed start", () => {
    // Nothing round: a start transform already translated, scaled and rotated,
    // fingers that move asymmetrically, and a midpoint that travels.
    const result = expectAnchored(
      transform({ x: 30, y: -20, scale: 1.5, rotation: 25 }),
      { x: 80, y: 40 },
      { x: 180, y: 140 },
      { x: 61, y: 17 },
      { x: 259, y: 223 },
    );

    expectFinite(result);
    expect(result.scale).toBeGreaterThan(1.5);
  });

  it("holds the anchor when the pinch is a shrink and the fingers swap sides", () => {
    const result = expectAnchored(
      transform({ x: -140, y: 60, scale: 8, rotation: -110 }),
      { x: -200, y: -90 },
      { x: 40, y: 130 },
      { x: 10, y: 100 },
      { x: -30, y: 60 },
    );

    expectFinite(result);
    expect(result.scale).toBeLessThan(8);
  });

  it("holds the anchor while the image is flipped", () => {
    // flipX is an innermost scaleX(-1), so it must fall out of the anchoring
    // maths entirely — the same fingers must produce the same numbers.
    const plain = expectAnchored(
      transform({ x: 12, y: 34, scale: 2, rotation: 15 }),
      { x: -60, y: 20 },
      { x: 90, y: 140 },
      { x: -90, y: 0 },
      { x: 150, y: 200 },
    );
    const flipped = expectAnchored(
      transform({ x: 12, y: 34, scale: 2, rotation: 15, flipX: true }),
      { x: -60, y: 20 },
      { x: 90, y: 140 },
      { x: -90, y: 0 },
      { x: 150, y: 200 },
    );

    expect(flipped).toEqual({ ...plain, flipX: true });
  });

  it("keeps the flip the live transform has, not the one the gesture started with", () => {
    const started = drive([down(1, 0, 0), down(2, 100, 0), move(1, -50, 0)]);
    // The flip button is pressed mid-gesture; the next move must not undo it.
    const flipped = { ...started.transform, flipX: true };
    const after = drive([move(2, 150, 0)], flipped, {
      state: started.state,
      transform: flipped,
    });

    expect(after.transform.flipX).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extra fingers, and losing one
// ---------------------------------------------------------------------------

describe("reduceGesture — more than two fingers", () => {
  it("ignores a third pointer landing and moving", () => {
    const twoFingers = drive([
      down(1, -50, 0),
      down(2, 50, 0),
      move(1, -100, 0),
      move(2, 100, 0),
    ]);
    expect(twoFingers.transform).toEqual(transform({ scale: 2 }));

    const withThird = drive(
      [down(3, 400, 400), move(3, -900, 900), move(3, 0, 0)],
      IDENTITY_TRANSFORM,
      twoFingers,
    );

    expect(withThird.transform).toBe(twoFingers.transform);
  });

  it("still tracks the two original fingers while a third is down", () => {
    const run = drive([
      down(1, -50, 0),
      down(2, 50, 0),
      down(3, 400, 400),
      move(1, -100, 0),
      move(2, 100, 0),
    ]);

    expect(run.transform).toEqual(transform({ scale: 2 }));
  });

  it("promotes the third finger — from where it actually is — when the first lifts", () => {
    const run = drive([
      down(1, 0, 0),
      down(2, 100, 0),
      down(3, 200, 0),
      move(3, 300, 0),
      up(1),
    ]);
    // Fingers 2 and 3 now drive it, anchored where they are (100 and 300).
    // A stale position for finger 3 would show up as an immediate jump here.
    expect(run.transform).toEqual(IDENTITY_TRANSFORM);

    const after = drive([move(2, 0, 0), move(3, 400, 0)], IDENTITY_TRANSFORM, run);
    // 200px apart -> 400px apart about the midpoint (200 -> 200): 2x, x = -200.
    expect(after.transform).toEqual(transform({ x: -200, y: 0, scale: 2 }));
  });
});

describe("reduceGesture — two fingers down to one (criterion 1)", () => {
  it("does not move the image on the lift itself", () => {
    const pinched = drive([
      down(1, -50, 0),
      down(2, 50, 0),
      move(1, -100, 0),
      move(2, 100, 0),
    ]);
    const lifted = drive([up(2)], IDENTITY_TRANSFORM, pinched);

    expect(lifted.transform).toBe(pinched.transform);
  });

  it("carries on as a drag from the remaining finger, with no jump", () => {
    const pinched = drive([
      down(1, -50, 0),
      down(2, 50, 0),
      move(1, -100, 0),
      move(2, 100, 0),
    ]);
    const dragged = drive(
      [up(2), move(1, -90, 10)],
      IDENTITY_TRANSFORM,
      pinched,
    );

    // Exactly the 10px the finger moved — not a re-derivation from the old
    // two-finger anchor, which would have thrown the image across the screen.
    expect(dragged.transform).toEqual(transform({ x: 10, y: 10, scale: 2 }));
  });

  it("re-anchors when a second finger joins a drag in progress", () => {
    const dragged = drive([down(1, 0, 0), move(1, 40, 0)]);
    expect(dragged.transform).toEqual(transform({ x: 40, y: 0 }));

    const joined = drive([down(2, 240, 0)], IDENTITY_TRANSFORM, dragged);
    expect(joined.transform).toBe(dragged.transform);

    // 200px apart about (140, 0) -> 400px apart about the same midpoint.
    const pinched = drive(
      [move(1, -60, 0), move(2, 340, 0)],
      IDENTITY_TRANSFORM,
      joined,
    );
    // t = m − f·(m − t₀) = 140 − 2·(140 − 40) = −60.
    expect(pinched.transform).toEqual(transform({ x: -60, y: 0, scale: 2 }));
  });
});

// ---------------------------------------------------------------------------
// clamping and garbage input (criterion 6)
// ---------------------------------------------------------------------------

describe("reduceGesture — scale stays inside 0.1x-20x (criterion 6)", () => {
  it("pins a 100x pinch at 20x", () => {
    const result = drive([
      down(1, 100, 0),
      down(2, 300, 0),
      move(2, 20100, 0),
    ]).transform;

    expect(result.scale).toBe(MAX_SCALE);
    expect(result.x).toBe(6100);
    // Anchoring survives the clamp: the translation uses the zoom that
    // actually happened (20x), not the 100x that was asked for.
    expect(project(result, { x: 200, y: 0 })).toEqual({ x: 10100, y: 0 });
  });

  it("pins a 1/2000th pinch at 0.1x", () => {
    const result = drive([
      down(1, -100, 0),
      down(2, 100, 0),
      move(1, -0.05, 0),
      move(2, 0.05, 0),
    ]).transform;

    expect(result.scale).toBe(MIN_SCALE);
    expectFinite(result);
  });

  it("comes back down from the ceiling when the fingers close again", () => {
    const run = drive([
      down(1, -50, 0),
      down(2, 50, 0),
      move(1, -50000, 0),
      move(2, 50000, 0),
    ]);
    expect(run.transform.scale).toBe(MAX_SCALE);

    // Measured from the anchor, so reversing the pinch reverses the zoom
    // instead of staying stuck at the limit.
    const back = drive([move(1, -75, 0), move(2, 75, 0)], IDENTITY_TRANSFORM, run);
    expect(back.transform.scale).toBeCloseTo(1.5, 12);
  });

  it("clamps a transform that arrives already out of range", () => {
    const result = drive(
      [down(1, 0, 0), move(1, 10, 10)],
      transform({ scale: 0.004 }),
    ).transform;

    expect(result.scale).toBe(MIN_SCALE);
  });

  it("survives 400 alternating pinch frames without drifting out of range", () => {
    const events: GestureEvent[] = [down(1, -50, 0), down(2, 50, 0)];
    for (let frame = 0; frame < 200; frame += 1) {
      const spread = frame % 2 === 0 ? 0.001 : 4000;
      events.push(move(1, -spread, 0), move(2, spread, 0));
    }

    expectFinite(drive(events).transform);
  });
});

describe("reduceGesture — garbage input never reaches the transform (criterion 6)", () => {
  it("ignores a move with NaN coordinates", () => {
    const dragged = drive([down(1, 0, 0), move(1, 25, 25)]);
    const after = drive(
      [move(1, Number.NaN, 25), move(1, 25, Number.NaN)],
      IDENTITY_TRANSFORM,
      dragged,
    );

    expect(after.transform).toBe(dragged.transform);
  });

  it("ignores a move with infinite coordinates", () => {
    const dragged = drive([down(1, 0, 0), move(1, 25, 25)]);
    const after = drive(
      [move(1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY)],
      IDENTITY_TRANSFORM,
      dragged,
    );

    expect(after.transform).toBe(dragged.transform);
  });

  it("never tracks a pointer whose down was unusable", () => {
    const after = drive([down(1, Number.NaN, 0), move(1, 500, 500)]);

    expect(after.transform).toBe(IDENTITY_TRANSFORM);
    expect(after.state.pointers).toHaveLength(0);
  });

  it("treats two fingers on the same pixel as a drag rather than dividing by zero", () => {
    const result = drive([
      down(1, 50, 50),
      down(2, 50, 50),
      move(2, 60, 60),
    ]).transform;

    // Midpoint moved (50,50) -> (55,55); the undefined ratio and angle are not
    // applied at all, so this is a plain 5px drag.
    expect(result).toEqual(transform({ x: 5, y: 5 }));
    expectFinite(result);
  });

  it("survives the fingers collapsing onto each other mid-pinch", () => {
    const result = drive([
      down(1, -50, 0),
      down(2, 50, 0),
      move(1, 0, 0),
      move(2, 0, 0),
    ]).transform;

    expectFinite(result);
  });

  it("recovers from a transform that is already NaN", () => {
    const poisoned: OverlayTransform = {
      x: Number.NaN,
      y: 0,
      scale: Number.POSITIVE_INFINITY,
      rotation: Number.NaN,
      flipX: false,
    };
    const result = drive([down(1, 10, 10), move(1, 20, 20)], poisoned).transform;

    // Anchored against the identity where a field was unusable, so a single
    // bad frame upstream cannot strand the overlay.
    expect(result).toEqual(transform({ x: 10, y: 10 }));
  });

  it("ignores an up for a pointer that was never down", () => {
    const dragged = drive([down(1, 0, 0), move(1, 25, 25)]);
    const after = drive([up(9), cancel(9)], IDENTITY_TRANSFORM, dragged);

    expect(after.transform).toBe(dragged.transform);
    expect(after.state).toBe(dragged.state);
  });
});

// ---------------------------------------------------------------------------
// rotation range
// ---------------------------------------------------------------------------

describe("wrapDegrees — rotation stays in (-180, 180]", () => {
  it("leaves an in-range angle alone", () => {
    expect(wrapDegrees(0)).toBe(0);
    expect(wrapDegrees(90)).toBe(90);
    expect(wrapDegrees(-179.5)).toBe(-179.5);
  });

  it("closes the interval on +180 rather than -180", () => {
    expect(wrapDegrees(180)).toBe(180);
    expect(wrapDegrees(-180)).toBe(180);
    expect(wrapDegrees(540)).toBe(180);
  });

  it("wraps past the seam in both directions", () => {
    expect(wrapDegrees(190)).toBe(-170);
    expect(wrapDegrees(-190)).toBe(170);
    expect(wrapDegrees(360)).toBe(0);
    expect(wrapDegrees(-720)).toBe(0);
    expect(wrapDegrees(1000)).toBeCloseTo(-80, 12);
  });

  it("returns 0 rather than NaN for unusable input", () => {
    expect(wrapDegrees(Number.NaN)).toBe(0);
    expect(wrapDegrees(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("reduceGesture — rotation is stored wrapped, in degrees", () => {
  it("wraps a rotation that runs past 180", () => {
    // Starting at 170 and turning another 30 clockwise = 200, i.e. -160.
    const start = transform({ rotation: 170 });
    const half = Math.sqrt(3) / 2;
    const result = drive(
      [
        down(1, -50, 0),
        down(2, 50, 0),
        move(1, -50 * half, -25),
        move(2, 50 * half, 25),
      ],
      start,
    ).transform;

    expect(result.rotation).toBeCloseTo(-160, 9);
    expect(result.rotation).toBeGreaterThan(-180);
    expect(result.rotation).toBeLessThanOrEqual(180);
  });

  it("keeps every frame of a full turn inside the range", () => {
    let run = drive([down(1, -50, 0), down(2, 50, 0)]);

    for (let degrees = 0; degrees <= 360; degrees += 7) {
      const radians = (degrees * Math.PI) / 180;
      const dx = 50 * Math.cos(radians);
      const dy = 50 * Math.sin(radians);
      run = drive(
        [move(1, -dx, -dy), move(2, dx, dy)],
        IDENTITY_TRANSFORM,
        run,
      );

      expect(run.transform.rotation).toBeGreaterThan(-180);
      expect(run.transform.rotation).toBeLessThanOrEqual(180);
      expect(run.transform.scale).toBeCloseTo(1, 9);
    }
  });
});
