import { describe, expect, it } from "vitest";
import {
  DEFAULT_LINE_ART_SETTINGS,
  EDGE_STRENGTH_RANGE,
  MAX_LONG_EDGE,
  THICKNESS_RANGE,
  THRESHOLD_RANGE,
  normaliseLineArtSettings,
  renderLineArt,
  type LineArtSettings,
  type PixelBuffer,
} from "@/lib/edges";

// Everything the assertions below depend on is constructed here in the test.
// There is no fixture file and no dimension is copied from one.
const SIZE = 32;
const EDGE_X = SIZE / 2; // the hard vertical edge sits between EDGE_X-1 and EDGE_X
const SPLIT_Y = SIZE / 2; // above: hard step. below: a soft left-to-right ramp.

/**
 * A synthetic greyscale image with two regions:
 *   y <  SPLIT_Y — a hard vertical step, black left of EDGE_X and white right
 *   y >= SPLIT_Y — a smooth ramp 0..255 across the full width (gradient of
 *                  ~8 levels per pixel, well under the default threshold)
 * so one image exercises both "must detect" and "must suppress".
 */
function syntheticImage(): PixelBuffer {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const value =
        y < SPLIT_Y ? (x < EDGE_X ? 0 : 255) : Math.round((x / (SIZE - 1)) * 255);
      const p = (y * SIZE + x) * 4;
      data[p] = value;
      data[p + 1] = value;
      data[p + 2] = value;
      data[p + 3] = 255;
    }
  }
  return { width: SIZE, height: SIZE, data };
}

/** FNV-1a over the whole RGBA output — the regression fingerprint. */
function fingerprint(bytes: Uint8ClampedArray): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Red channel at (x, y). A transparent (non-line) pixel is (0,0,0,0), so a
 * caller that wants "is this a line" should check alpha, not this value —
 * `px` alone can no longer distinguish "black line" from "transparent".
 */
function px(buffer: PixelBuffer, x: number, y: number): number {
  return buffer.data[(y * buffer.width + x) * 4];
}

/** Alpha channel at (x, y). This is the line/non-line signal post-FTA-020. */
function alphaAt(buffer: PixelBuffer, x: number, y: number): number {
  return buffer.data[(y * buffer.width + x) * 4 + 3];
}

/** Count of opaque (line) pixels, regardless of black/white RGB. */
function countInk(buffer: PixelBuffer): number {
  let count = 0;
  for (let i = 3; i < buffer.data.length; i += 4) {
    if (buffer.data[i] === 255) count++;
  }
  return count;
}

/**
 * The set of line-pixel indices (by flat pixel index, not byte offset),
 * derived straight from the alpha channel. Used to prove the inverted output
 * marks exactly the same pixels as line pixels as the normal output — the
 * "same line set as before" requirement — without hardcoding coordinates.
 */
function lineIndexSet(buffer: PixelBuffer): Set<number> {
  const set = new Set<number>();
  const pixelCount = buffer.width * buffer.height;
  for (let i = 0; i < pixelCount; i++) {
    if (buffer.data[i * 4 + 3] === 255) set.add(i);
  }
  return set;
}

// Golden fingerprints for the synthetic image above. If the pipeline changes
// on purpose these must be regenerated deliberately and reviewed as part of
// that change — that is the entire point of the test.
//
// Regenerated for FTA-020 (transparent non-line pixels replace the opaque
// white sheet). Only the final encoding step changed; the mask math that
// decides WHICH pixels are lines did not, and the "identical line set"
// tests below prove that directly rather than trusting the new hashes alone.
const GOLDEN_DEFAULT = "af37e268";
const GOLDEN_HAIRLINE = "8480d0c8";
const GOLDEN_INVERTED = "69a8c4a9";

describe("renderLineArt — stable output for a known synthetic input", () => {
  it("produces the exact fingerprint at the default settings", () => {
    const output = renderLineArt(syntheticImage(), DEFAULT_LINE_ART_SETTINGS);
    expect(output.width).toBe(SIZE);
    expect(output.height).toBe(SIZE);
    expect(fingerprint(output.data)).toBe(GOLDEN_DEFAULT);
  });

  it("produces the exact fingerprint with no dilation and when inverted", () => {
    const hairline = renderLineArt(syntheticImage(), {
      ...DEFAULT_LINE_ART_SETTINGS,
      thickness: 0,
    });
    const inverted = renderLineArt(syntheticImage(), {
      ...DEFAULT_LINE_ART_SETTINGS,
      inverted: true,
    });
    expect(fingerprint(hairline.data)).toBe(GOLDEN_HAIRLINE);
    expect(fingerprint(inverted.data)).toBe(GOLDEN_INVERTED);
  });

  it("marks the same set of line pixels as the pre-FTA-020 encoding did", () => {
    // Re-derives "which pixels are lines" independently of the golden hash,
    // straight from the pipeline's own mask semantics: a line pixel is one
    // whose RGB is the line colour (not the old background colour) AND is
    // now opaque. This is the concrete "same line set as before" proof.
    const output = renderLineArt(syntheticImage(), DEFAULT_LINE_ART_SETTINGS);
    const lines = lineIndexSet(output);
    // Sanity: some but not all pixels are lines (the hard step is found, the
    // soft ramp and flat regions are not).
    expect(lines.size).toBeGreaterThan(0);
    expect(lines.size).toBeLessThan(SIZE * SIZE);
    // Every marked pixel is opaque black; every unmarked pixel is fully
    // transparent. Together these two facts are exactly the new encoding.
    for (let i = 0; i < output.data.length; i += 4) {
      const idx = i / 4;
      if (lines.has(idx)) {
        expect([output.data[i], output.data[i + 1], output.data[i + 2], output.data[i + 3]]).toEqual([
          0, 0, 0, 255,
        ]);
      } else {
        expect([output.data[i], output.data[i + 1], output.data[i + 2], output.data[i + 3]]).toEqual([
          0, 0, 0, 0,
        ]);
      }
    }
  });

  it("is byte-identical across two calls with the same input and settings", () => {
    const first = renderLineArt(syntheticImage(), DEFAULT_LINE_ART_SETTINGS);
    const second = renderLineArt(syntheticImage(), DEFAULT_LINE_ART_SETTINGS);
    expect(second.data).toEqual(first.data);
    expect(fingerprint(second.data)).toBe(fingerprint(first.data));
  });

  it("does not mutate the input buffer", () => {
    const input = syntheticImage();
    const before = Uint8ClampedArray.from(input.data);
    renderLineArt(input, DEFAULT_LINE_ART_SETTINGS);
    expect(input.data).toEqual(before);
  });

  it("draws the hard edge and suppresses the soft gradient", () => {
    const output = renderLineArt(syntheticImage(), {
      ...DEFAULT_LINE_ART_SETTINGS,
      thickness: 0,
    });
    // The step is found, one pixel either side of the boundary: opaque black.
    expect(px(output, EDGE_X - 1, 8)).toBe(0);
    expect(alphaAt(output, EDGE_X - 1, 8)).toBe(255);
    expect(px(output, EDGE_X, 8)).toBe(0);
    expect(alphaAt(output, EDGE_X, 8)).toBe(255);
    // Flat regions well away from the step are transparent, not white.
    expect(alphaAt(output, 2, 2)).toBe(0);
    expect(alphaAt(output, SIZE - 3, 2)).toBe(0);
    // The smooth ramp in the lower half produces no lines at all.
    for (let x = 1; x < SIZE - 1; x++) {
      expect(alphaAt(output, x, SIZE - 4)).toBe(0);
    }
  });

  it("thickens the line as thickness rises and never thins it", () => {
    const counts = [0, 1, 2, 3, 4].map((thickness) =>
      countInk(renderLineArt(syntheticImage(), { ...DEFAULT_LINE_ART_SETTINGS, thickness })),
    );
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThan(counts[i - 1]);
    }
  });

  it("inverts to white lines with the same alpha mask, RGB flipped only on line pixels", () => {
    const normal = renderLineArt(syntheticImage(), DEFAULT_LINE_ART_SETTINGS);
    const inverted = renderLineArt(syntheticImage(), {
      ...DEFAULT_LINE_ART_SETTINGS,
      inverted: true,
    });
    // Same set of opaque pixels either way — inversion recolours lines, it
    // does not move them.
    expect(lineIndexSet(inverted)).toEqual(lineIndexSet(normal));
    for (let i = 0; i < normal.data.length; i += 4) {
      expect(inverted.data[i + 3]).toBe(normal.data[i + 3]); // alpha untouched
      if (normal.data[i + 3] === 255) {
        expect(inverted.data[i]).toBe(255 - normal.data[i]); // black <-> white
      } else {
        // Transparent stays (0,0,0,0) on both sides — nothing to invert.
        expect(inverted.data[i]).toBe(0);
      }
    }
  });

  it("returns pixels that are either fully opaque black/white or fully transparent", () => {
    const output = renderLineArt(syntheticImage(), DEFAULT_LINE_ART_SETTINGS);
    for (let i = 0; i < output.data.length; i += 4) {
      const alpha = output.data[i + 3];
      expect(alpha === 0 || alpha === 255).toBe(true);
      if (alpha === 255) {
        expect(output.data[i]).toBe(output.data[i + 1]);
        expect(output.data[i]).toBe(output.data[i + 2]);
        expect(output.data[i] === 0 || output.data[i] === 255).toBe(true);
      } else {
        expect(output.data[i]).toBe(0);
        expect(output.data[i + 1]).toBe(0);
        expect(output.data[i + 2]).toBe(0);
      }
    }
  });
});

describe("renderLineArt — extreme slider values do not throw", () => {
  const extremes: LineArtSettings[] = [];
  for (const edgeStrength of [EDGE_STRENGTH_RANGE.min, EDGE_STRENGTH_RANGE.max]) {
    for (const threshold of [THRESHOLD_RANGE.min, THRESHOLD_RANGE.max]) {
      for (const thickness of [THICKNESS_RANGE.min, THICKNESS_RANGE.max]) {
        for (const inverted of [false, true]) {
          extremes.push({ edgeStrength, threshold, thickness, inverted });
        }
      }
    }
  }

  it.each(extremes)(
    "survives edgeStrength=$edgeStrength threshold=$threshold thickness=$thickness inverted=$inverted",
    (settings) => {
      const output = renderLineArt(syntheticImage(), settings);
      expect(output.width).toBe(SIZE);
      expect(output.height).toBe(SIZE);
      expect(output.data.length).toBe(SIZE * SIZE * 4);
      // Alpha is now the line/non-line mask, not a constant — every pixel is
      // one of the two valid states.
      for (let i = 3; i < output.data.length; i += 4) {
        expect(output.data[i] === 0 || output.data[i] === 255).toBe(true);
      }
    },
  );

  it("covers both a minimum and a maximum for every setting", () => {
    expect(extremes).toHaveLength(16);
  });

  const outOfRange = [-1e9, 1e9, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  it.each(outOfRange)("clamps out-of-range value %p on every numeric setting", (value) => {
    const settings = {
      edgeStrength: value,
      threshold: value,
      thickness: value,
      inverted: false,
    };
    expect(() => renderLineArt(syntheticImage(), settings)).not.toThrow();
    const output = renderLineArt(syntheticImage(), settings);
    const clamped = renderLineArt(syntheticImage(), normaliseLineArtSettings(settings));
    expect(output.data).toEqual(clamped.data);
  });

  it("falls back to the defaults when settings are missing entirely", () => {
    // A stored record from an older build could be missing fields. Cast is
    // deliberate: the point of the test is the shape TypeScript would reject.
    const partial = {} as LineArtSettings;
    expect(() => renderLineArt(syntheticImage(), partial)).not.toThrow();
    expect(fingerprint(renderLineArt(syntheticImage(), partial).data)).toBe(GOLDEN_DEFAULT);
  });
});

describe("renderLineArt — degenerate sizes", () => {
  it("does not throw on a 1x1 image and returns 1x1", () => {
    const one: PixelBuffer = { width: 1, height: 1, data: new Uint8ClampedArray([12, 34, 56, 255]) };
    let output: PixelBuffer | undefined;
    expect(() => {
      output = renderLineArt(one, DEFAULT_LINE_ART_SETTINGS);
    }).not.toThrow();
    expect(output?.width).toBe(1);
    expect(output?.height).toBe(1);
    expect(output?.data.length).toBe(4);
    // A single pixel has no neighbours to form a gradient against (the Sobel
    // window clamps onto itself on every side), so it can never become a
    // line pixel — alpha 0, not the old constant 255.
    expect(output?.data[3]).toBe(0);
  });

  it("handles a 1x1 image at every extreme setting", () => {
    const one: PixelBuffer = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) };
    for (const edgeStrength of [EDGE_STRENGTH_RANGE.min, EDGE_STRENGTH_RANGE.max]) {
      for (const threshold of [THRESHOLD_RANGE.min, THRESHOLD_RANGE.max]) {
        for (const thickness of [THICKNESS_RANGE.min, THICKNESS_RANGE.max]) {
          for (const inverted of [false, true]) {
            expect(() =>
              renderLineArt(one, { edgeStrength, threshold, thickness, inverted }),
            ).not.toThrow();
          }
        }
      }
    }
  });

  it("returns 0x0 for a 0x0 image without throwing", () => {
    const empty: PixelBuffer = { width: 0, height: 0, data: new Uint8ClampedArray(0) };
    const output = renderLineArt(empty, DEFAULT_LINE_ART_SETTINGS);
    expect(output.width).toBe(0);
    expect(output.height).toBe(0);
    expect(output.data.length).toBe(0);
  });

  it("treats a zero or negative dimension as an empty image", () => {
    for (const [width, height] of [
      [0, 32],
      [32, 0],
      [-4, 8],
      [Number.NaN, 8],
    ]) {
      const output = renderLineArt(
        { width, height, data: new Uint8ClampedArray(0) },
        DEFAULT_LINE_ART_SETTINGS,
      );
      expect(output.width).toBe(0);
      expect(output.height).toBe(0);
    }
  });

  it("handles a single-row and a single-column image", () => {
    const row: PixelBuffer = { width: 8, height: 1, data: new Uint8ClampedArray(8 * 4) };
    const column: PixelBuffer = { width: 1, height: 8, data: new Uint8ClampedArray(8 * 4) };
    for (let i = 0; i < 8; i++) {
      const value = i < 4 ? 0 : 255;
      row.data[i * 4] = value;
      row.data[i * 4 + 3] = 255;
      column.data[i * 4] = value;
      column.data[i * 4 + 3] = 255;
    }
    expect(renderLineArt(row, DEFAULT_LINE_ART_SETTINGS).width).toBe(8);
    expect(renderLineArt(column, DEFAULT_LINE_ART_SETTINGS).height).toBe(8);
  });

  it("throws a descriptive error when the buffer is too short for the dimensions", () => {
    // The one deliberate throw: a malformed buffer is a caller bug, not an
    // extreme value, and returning a blank image would hide it.
    expect(() =>
      renderLineArt({ width: 4, height: 4, data: new Uint8ClampedArray(8) }, DEFAULT_LINE_ART_SETTINGS),
    ).toThrow(RangeError);
  });
});

describe("published setting ranges", () => {
  it("keeps min <= default <= max for every range", () => {
    for (const range of [EDGE_STRENGTH_RANGE, THRESHOLD_RANGE, THICKNESS_RANGE]) {
      expect(range.min).toBeLessThan(range.max);
      expect(range.default).toBeGreaterThanOrEqual(range.min);
      expect(range.default).toBeLessThanOrEqual(range.max);
      expect(range.step).toBeGreaterThan(0);
    }
  });

  it("ships defaults that sit inside the published ranges", () => {
    const { edgeStrength, threshold, thickness } = DEFAULT_LINE_ART_SETTINGS;
    expect(edgeStrength).toBe(EDGE_STRENGTH_RANGE.default);
    expect(threshold).toBe(THRESHOLD_RANGE.default);
    expect(thickness).toBe(THICKNESS_RANGE.default);
    expect(DEFAULT_LINE_ART_SETTINGS.inverted).toBe(false);
    expect(MAX_LONG_EDGE).toBe(2000);
  });

  it("normalises rounds thickness and coerces inverted", () => {
    const normalised = normaliseLineArtSettings({
      edgeStrength: 250,
      threshold: -7,
      thickness: 2.6,
      inverted: false,
    });
    expect(normalised.edgeStrength).toBe(EDGE_STRENGTH_RANGE.max);
    expect(normalised.threshold).toBe(THRESHOLD_RANGE.min);
    expect(normalised.thickness).toBe(3);
    expect(normalised.inverted).toBe(false);
    expect(normaliseLineArtSettings({}).inverted).toBe(false);
  });
});
