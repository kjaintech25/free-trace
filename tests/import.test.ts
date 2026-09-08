import { describe, expect, it } from "vitest";
import { fitWithin, needsDownscale, MAX_LONG_EDGE, MAX_BYTES } from "@/lib/import";

// jsdom has no canvas and no createImageBitmap, so `importPhoto` itself can't
// be exercised end-to-end here. What CAN be unit-tested without a browser is
// the pure decision logic it relies on: does a given source need
// downscaling, and what size does it fit to. AddPhotoButton's tests (in
// tests/components/add-photo-button.test.tsx) cover importPhoto's callers
// with the module mocked.

describe("needsDownscale", () => {
  it("is false for a mid-size photo well under both limits", () => {
    expect(
      needsDownscale({ width: 3000, height: 2000, bytes: 5 * 1024 * 1024 }),
    ).toBe(false);
  });

  it("is true when the long edge exceeds 4096px (landscape)", () => {
    expect(
      needsDownscale({ width: 5000, height: 3000, bytes: 1024 }),
    ).toBe(true);
  });

  it("is true when the long edge exceeds 4096px (portrait)", () => {
    expect(
      needsDownscale({ width: 3000, height: 5000, bytes: 1024 }),
    ).toBe(true);
  });

  it("is false exactly at the 4096px long-edge boundary", () => {
    expect(
      needsDownscale({ width: MAX_LONG_EDGE, height: 2000, bytes: 1024 }),
    ).toBe(false);
  });

  it("is true for a file over ~25MB even at small pixel dimensions", () => {
    expect(
      needsDownscale({ width: 800, height: 600, bytes: MAX_BYTES + 1 }),
    ).toBe(true);
  });

  it("is false exactly at the 25MB boundary", () => {
    expect(
      needsDownscale({ width: 800, height: 600, bytes: MAX_BYTES }),
    ).toBe(false);
  });
});

describe("fitWithin", () => {
  it("leaves a source already within the limit unchanged (no upscaling)", () => {
    expect(fitWithin({ width: 200, height: 100 }, 400)).toEqual({
      width: 200,
      height: 100,
    });
  });

  it("scales a landscape image down to the long edge, preserving aspect ratio", () => {
    expect(fitWithin({ width: 8000, height: 4000 }, 4096)).toEqual({
      width: 4096,
      height: 2048,
    });
  });

  it("scales a portrait image down to the long edge, preserving aspect ratio", () => {
    expect(fitWithin({ width: 4000, height: 8000 }, 4096)).toEqual({
      width: 2048,
      height: 4096,
    });
  });

  it("scales a square image down to a square", () => {
    expect(fitWithin({ width: 5000, height: 5000 }, 400)).toEqual({
      width: 400,
      height: 400,
    });
  });

  it("never produces a zero dimension for a tiny source needing thumbnailing", () => {
    // A 1px-tall sliver scaled to a 400px long edge should still round to at
    // least 1px on the short edge, never 0 (which would break canvas draws).
    const result = fitWithin({ width: 10000, height: 1 }, 400);
    expect(result.width).toBe(400);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });
});
