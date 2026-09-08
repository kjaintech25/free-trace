import { describe, expect, it } from "vitest";
import {
  clampTransform,
  IDENTITY_TRANSFORM,
  MAX_SCALE,
  MIN_SCALE,
  toCssTransform,
  type OverlayTransform,
} from "@/lib/overlayTransform";

function transform(patch: Partial<OverlayTransform> = {}): OverlayTransform {
  return { ...IDENTITY_TRANSFORM, ...patch };
}

/** The `rotate(...)` term on its own, so flip can be checked against it. */
function rotateTerm(css: string): string {
  const match = /rotate\([^)]*\)/.exec(css);
  if (match === null) throw new Error(`no rotate term in "${css}"`);
  return match[0];
}

describe("toCssTransform — order of operations", () => {
  it("emits translate, then rotate, then scale", () => {
    const css = toCssTransform(
      transform({ x: 10, y: -20, scale: 2, rotation: 45 }),
    );

    expect(css).toBe("translate(10px, -20px) rotate(45deg) scale(2)");
  });

  it("keeps that order for every value, not just the sample above", () => {
    const css = toCssTransform(
      transform({ x: -3.5, y: 0, scale: 0.75, rotation: -90 }),
    );

    expect(css.indexOf("translate(")).toBeLessThan(css.indexOf("rotate("));
    expect(css.indexOf("rotate(")).toBeLessThan(css.indexOf("scale("));
  });

  it("serialises the identity transform without churn", () => {
    expect(toCssTransform(IDENTITY_TRANSFORM)).toBe(
      "translate(0px, 0px) rotate(0deg) scale(1)",
    );
  });

  it("rounds gesture-math noise instead of printing 17 digits", () => {
    // What a pinch actually produces after a few frames of float maths.
    const css = toCssTransform(transform({ scale: 1.0000000000000002 }));

    expect(css).toContain("scale(1)");
  });

  it("never prints a negative zero", () => {
    expect(toCssTransform(transform({ x: -0, rotation: -0 }))).toBe(
      "translate(0px, 0px) rotate(0deg) scale(1)",
    );
  });
});

describe("toCssTransform — flip is independent of rotation", () => {
  it("adds scaleX(-1) and leaves the rotate term identical", () => {
    const unflipped = toCssTransform(transform({ rotation: 30 }));
    const flipped = toCssTransform(transform({ rotation: 30, flipX: true }));

    expect(flipped).toContain("scaleX(-1)");
    expect(unflipped).not.toContain("scaleX(-1)");
    // The whole point: flipping does not negate, offset or otherwise touch the
    // rotation. T-10 can rotate a flipped overlay without special-casing it.
    expect(rotateTerm(flipped)).toBe(rotateTerm(unflipped));
    expect(rotateTerm(flipped)).toBe("rotate(30deg)");
  });

  it("returns to the identical string when flipped twice", () => {
    const start = transform({ x: 4, y: 5, scale: 1.5, rotation: 30 });
    const once = { ...start, flipX: !start.flipX };
    const twice = { ...once, flipX: !once.flipX };

    expect(toCssTransform(twice)).toBe(toCssTransform(start));
    expect(twice.rotation).toBe(start.rotation);
  });

  it("keeps the flip separate from the scale term", () => {
    const css = toCssTransform(transform({ scale: 2, flipX: true }));

    // scale(2) scaleX(-1), not scale(-2). Two concepts, two terms — T-10
    // changes scale without having to know whether a flip is engaged.
    expect(css).toBe("translate(0px, 0px) rotate(0deg) scale(2) scaleX(-1)");
  });
});

describe("clampTransform — scale bounds", () => {
  it("clamps below MIN_SCALE up to MIN_SCALE", () => {
    expect(clampTransform(transform({ scale: 0.0001 })).scale).toBe(MIN_SCALE);
    expect(MIN_SCALE).toBe(0.1);
  });

  it("clamps above MAX_SCALE down to MAX_SCALE", () => {
    expect(clampTransform(transform({ scale: 500 })).scale).toBe(MAX_SCALE);
    expect(MAX_SCALE).toBe(20);
  });

  it("leaves the bounds themselves and anything between them alone", () => {
    expect(clampTransform(transform({ scale: 0.1 })).scale).toBe(0.1);
    expect(clampTransform(transform({ scale: 20 })).scale).toBe(20);
    expect(clampTransform(transform({ scale: 3.25 })).scale).toBe(3.25);
  });

  it("does not clamp x, y or rotation — the overlay may be dragged off screen and spun freely", () => {
    const result = clampTransform(
      transform({ x: -9999, y: 9999, rotation: 3600 }),
    );

    expect(result.x).toBe(-9999);
    expect(result.y).toBe(9999);
    expect(result.rotation).toBe(3600);
  });
});

describe("clampTransform — non-finite input", () => {
  it("falls back to the previous value field by field", () => {
    const previous = transform({ x: 12, y: 34, scale: 2, rotation: 45 });
    const result = clampTransform(
      { x: Number.NaN, y: 50, scale: Number.NaN, rotation: 90, flipX: false },
      previous,
    );

    // One bad axis must not discard the good ones.
    expect(result.x).toBe(12);
    expect(result.y).toBe(50);
    expect(result.scale).toBe(2);
    expect(result.rotation).toBe(90);
  });

  it("falls back to identity when no previous transform is supplied", () => {
    const result = clampTransform({
      x: Number.NaN,
      y: Number.NaN,
      scale: Number.NaN,
      rotation: Number.NaN,
      flipX: false,
    });

    expect(result).toEqual(IDENTITY_TRANSFORM);
  });

  it("rejects Infinity rather than clamping it to MAX_SCALE", () => {
    const previous = transform({ scale: 3 });

    // An infinite scale means the maths upstream went wrong; holding the last
    // good value is less violent mid-drawing than snapping to 20x.
    expect(
      clampTransform(transform({ scale: Number.POSITIVE_INFINITY }), previous)
        .scale,
    ).toBe(3);
    expect(
      clampTransform(transform({ scale: Number.NEGATIVE_INFINITY }), previous)
        .scale,
    ).toBe(3);
  });

  it("never lets a non-finite value reach the CSS string", () => {
    const css = toCssTransform(
      clampTransform({
        x: Number.NaN,
        y: Number.POSITIVE_INFINITY,
        scale: Number.NaN,
        rotation: Number.NaN,
        flipX: false,
      }),
    );

    expect(css).not.toContain("NaN");
    expect(css).not.toContain("Infinity");
  });
});

describe("clampTransform — hygiene", () => {
  it("coerces flipX, so a value round-tripped through JSON cannot smuggle a string in", () => {
    // JSON.parse is typed `any` by the standard library; this is the one cast,
    // and it is exactly the case the coercion exists for (the overlay's
    // data-transform attribute is JSON).
    const fromJson = JSON.parse(
      '{"x":0,"y":0,"scale":1,"rotation":0,"flipX":"yes"}',
    ) as OverlayTransform;

    expect(clampTransform(fromJson).flipX).toBe(false);
    expect(clampTransform(transform({ flipX: true })).flipX).toBe(true);
  });

  it("returns a new object, so React sees a state change", () => {
    const previous = transform({ x: 5 });
    const result = clampTransform(previous, previous);

    expect(result).not.toBe(previous);
    expect(result).toEqual(previous);
  });

  it("keeps IDENTITY_TRANSFORM immutable", () => {
    expect(Object.isFrozen(IDENTITY_TRANSFORM)).toBe(true);
  });
});
