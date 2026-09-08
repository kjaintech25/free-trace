/**
 * Free Trace — the line-art engine (SPEC §8, ticket T-06).
 *
 * `renderLineArt` is PURE, DETERMINISTIC and SYNCHRONOUS. It has no DOM
 * dependency: it takes and returns a plain `{ width, height, data }` shape
 * rather than the DOM `ImageData` class, so the same code runs unchanged in a
 * Web Worker, in Node under the unit tests, and (if ever needed) on the main
 * thread. Anything that needs a canvas — decoding a Blob, the >2000px
 * downscale — lives in `lib/image.ts` and is deliberately kept out of here.
 *
 * Pipeline (SPEC §8):
 *   greyscale -> light gaussian blur -> Sobel gradient magnitude ->
 *   threshold to binary -> dilation by `thickness` -> optional inversion
 *
 * This is classical image processing, not AI. No dependencies, no WebAssembly.
 */

/**
 * A raw RGBA pixel buffer. Structurally compatible with the DOM `ImageData`
 * (so a real `ImageData` can be passed straight in) without importing it.
 */
export interface PixelBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** The four controls the convert screen (T-07) exposes. */
export interface LineArtSettings {
  /** 0–100. How much fine detail survives. See `EDGE_STRENGTH_RANGE`. */
  edgeStrength: number;
  /** 0–100. How strong a gradient must be to become a line. */
  threshold: number;
  /** 0–4 whole pixels of dilation. 0 = hairline. */
  thickness: number;
  /** false = black lines on white; true = white lines on black. */
  inverted: boolean;
}

/** Slider bounds for one numeric setting. T-07 reads these; do not inline them. */
export interface SettingRange {
  readonly min: number;
  readonly max: number;
  readonly default: number;
  readonly step: number;
}

/**
 * Edge strength = *which* detail survives.
 *
 * It picks the pre-blur kernel (below 50 -> 5x5 gaussian, heavier smoothing,
 * only bold contours survive; 50 and above -> 3x3, finer detail and more
 * sensor noise) and applies a continuous gain of 0.5x–2.0x to the gradient
 * magnitude. The kernel swap at 50 is a deliberate, documented step: it is
 * what keeps this control distinct from `threshold`, which would otherwise be
 * mathematically identical to the gain alone.
 */
export const EDGE_STRENGTH_RANGE: SettingRange = { min: 0, max: 100, default: 50, step: 1 };

/**
 * Threshold = *how strong* an edge must be. Maps linearly onto a gradient
 * cutoff of 2–128 on a 0–255-normalised Sobel magnitude. Low = many lines
 * (and noise), high = only the hardest edges.
 */
export const THRESHOLD_RANGE: SettingRange = { min: 0, max: 100, default: 50, step: 1 };

/** Line thickness in whole pixels of morphological dilation. 0 = no dilation. */
export const THICKNESS_RANGE: SettingRange = { min: 0, max: 4, default: 1, step: 1 };

/** What the convert screen opens with, and what a new reference stores. */
export const DEFAULT_LINE_ART_SETTINGS: LineArtSettings = {
  edgeStrength: EDGE_STRENGTH_RANGE.default,
  threshold: THRESHOLD_RANGE.default,
  thickness: THICKNESS_RANGE.default,
  inverted: false,
};

/** Long-edge cap before conversion (SPEC §8). `lib/image.ts` enforces it. */
export const MAX_LONG_EDGE = 2000;

// Rec. 601 luma weights scaled to 256 so the divide is a shift. 77+150+29=256.
const LUMA_R = 77;
const LUMA_G = 150;
const LUMA_B = 29;

// Largest possible Sobel response on 0–255 input is 1020 per axis, so the
// largest magnitude is 1020*sqrt(2). Dividing by this maps magnitude to 0–255.
const SOBEL_NORM = (1020 * Math.SQRT2) / 255;

const GAUSS_3: readonly number[] = [1, 2, 1];
const GAUSS_3_SHIFT = 2;
const GAUSS_5: readonly number[] = [1, 4, 6, 4, 1];
const GAUSS_5_SHIFT = 4;

function clampNumber(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Clamps every setting into its published range and replaces NaN/Infinity/
 * missing values with the default. Exported so T-07 can normalise a stored or
 * user-entered value with exactly the same rules the engine uses.
 */
export function normaliseLineArtSettings(settings: Partial<LineArtSettings>): LineArtSettings {
  return {
    edgeStrength: clampNumber(
      settings.edgeStrength,
      EDGE_STRENGTH_RANGE.min,
      EDGE_STRENGTH_RANGE.max,
      EDGE_STRENGTH_RANGE.default,
    ),
    threshold: clampNumber(
      settings.threshold,
      THRESHOLD_RANGE.min,
      THRESHOLD_RANGE.max,
      THRESHOLD_RANGE.default,
    ),
    thickness: Math.round(
      clampNumber(
        settings.thickness,
        THICKNESS_RANGE.min,
        THICKNESS_RANGE.max,
        THICKNESS_RANGE.default,
      ),
    ),
    inverted: settings.inverted === true,
  };
}

/** RGBA -> single-channel luma. One pass, no allocations per pixel. */
function toGreyscale(data: Uint8ClampedArray, pixelCount: number): Uint8ClampedArray {
  const grey = new Uint8ClampedArray(pixelCount);
  for (let i = 0, p = 0; i < pixelCount; i++, p += 4) {
    grey[i] = (data[p] * LUMA_R + data[p + 1] * LUMA_G + data[p + 2] * LUMA_B) >> 8;
  }
  return grey;
}

/** One clamped tap of a 1-D kernel along a row. Used only on border columns. */
function tapRow(
  src: Uint8ClampedArray,
  rowOffset: number,
  x: number,
  width: number,
  radius: number,
  weights: readonly number[],
  shift: number,
): number {
  let acc = 0;
  for (let k = -radius; k <= radius; k++) {
    let xx = x + k;
    if (xx < 0) xx = 0;
    else if (xx >= width) xx = width - 1;
    acc += src[rowOffset + xx] * weights[k + radius];
  }
  return acc >> shift;
}

/** Horizontal half of a separable gaussian. Borders clamp to the edge pixel. */
function blurHorizontal(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  weights: readonly number[],
  shift: number,
): void {
  const interiorStart = Math.min(radius, width);
  const interiorEnd = Math.max(width - radius, interiorStart);

  for (let y = 0; y < height; y++) {
    const off = y * width;
    for (let x = 0; x < interiorStart; x++) {
      dst[off + x] = tapRow(src, off, x, width, radius, weights, shift);
    }
    if (radius === 1) {
      for (let x = interiorStart; x < interiorEnd; x++) {
        const i = off + x;
        dst[i] = (src[i - 1] + 2 * src[i] + src[i + 1]) >> 2;
      }
    } else {
      for (let x = interiorStart; x < interiorEnd; x++) {
        const i = off + x;
        dst[i] = (src[i - 2] + 4 * src[i - 1] + 6 * src[i] + 4 * src[i + 1] + src[i + 2]) >> 4;
      }
    }
    for (let x = interiorEnd; x < width; x++) {
      dst[off + x] = tapRow(src, off, x, width, radius, weights, shift);
    }
  }
}

/**
 * Vertical half of a separable gaussian. Iterates row-major over three (or
 * five) neighbouring rows rather than column-major, so it stays cache-friendly
 * on a 12MP buffer.
 */
function blurVertical(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  weights: readonly number[],
  shift: number,
): void {
  const rowOffsets = new Int32Array(radius * 2 + 1);
  for (let y = 0; y < height; y++) {
    const out = y * width;
    if (y >= radius && y < height - radius) {
      if (radius === 1) {
        const r0 = out - width;
        const r2 = out + width;
        for (let x = 0; x < width; x++) {
          dst[out + x] = (src[r0 + x] + 2 * src[out + x] + src[r2 + x]) >> 2;
        }
      } else {
        const r0 = out - 2 * width;
        const r1 = out - width;
        const r3 = out + width;
        const r4 = out + 2 * width;
        for (let x = 0; x < width; x++) {
          dst[out + x] =
            (src[r0 + x] + 4 * src[r1 + x] + 6 * src[out + x] + 4 * src[r3 + x] + src[r4 + x]) >> 4;
        }
      }
    } else {
      for (let k = -radius; k <= radius; k++) {
        let yy = y + k;
        if (yy < 0) yy = 0;
        else if (yy >= height) yy = height - 1;
        rowOffsets[k + radius] = yy * width;
      }
      const taps = rowOffsets.length;
      for (let x = 0; x < width; x++) {
        let acc = 0;
        for (let k = 0; k < taps; k++) acc += src[rowOffsets[k] + x] * weights[k];
        dst[out + x] = acc >> shift;
      }
    }
  }
}

/**
 * Sobel magnitude, thresholded straight to a binary mask.
 *
 * The comparison is done on the SQUARED magnitude against a pre-squared
 * cutoff, which removes 12 million `Math.sqrt` calls from the hot loop for a
 * 12MP image. A sliding 3x3 window means three array reads per pixel instead
 * of nine. Borders clamp to the edge pixel, so the outermost row/column has a
 * one-sided gradient.
 */
function sobelToMask(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  thresholdSquared: number,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const lastX = width - 1;
  const firstRight = width > 1 ? 1 : 0;

  for (let y = 0; y < height; y++) {
    const top = (y > 0 ? y - 1 : 0) * width;
    const mid = y * width;
    const bot = (y + 1 < height ? y + 1 : height - 1) * width;

    // x = 0: the left column clamps onto column 0.
    let tl = src[top];
    let tc = src[top];
    let tr = src[top + firstRight];
    let ml = src[mid];
    let mc = src[mid];
    let mr = src[mid + firstRight];
    let bl = src[bot];
    let bc = src[bot];
    let br = src[bot + firstRight];

    for (let x = 0; x < width; x++) {
      const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
      const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);
      mask[mid + x] = gx * gx + gy * gy >= thresholdSquared ? 1 : 0;

      const next = x + 2 <= lastX ? x + 2 : lastX;
      tl = tc;
      tc = tr;
      tr = src[top + next];
      ml = mc;
      mc = mr;
      mr = src[mid + next];
      bl = bc;
      bc = br;
      br = src[bot + next];
    }
  }
  return mask;
}

/**
 * Binary dilation by `radius` pixels with a square structuring element,
 * done as two separable passes. Each pass is two linear sweeps that track the
 * distance to the nearest set pixel, so cost is O(pixels) and independent of
 * the radius — not O(pixels * radius) as a naive window scan would be.
 */
function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const pixelCount = width * height;
  const horizontal = new Uint8Array(pixelCount);
  const FAR = -(width + radius + 16);

  for (let y = 0; y < height; y++) {
    const off = y * width;
    let last = FAR;
    for (let x = 0; x < width; x++) {
      if (mask[off + x] === 1) last = x;
      horizontal[off + x] = x - last <= radius ? 1 : 0;
    }
    let nextSet = width + radius + 16;
    for (let x = width - 1; x >= 0; x--) {
      if (mask[off + x] === 1) nextSet = x;
      if (nextSet - x <= radius) horizontal[off + x] = 1;
    }
  }

  // Vertical pass as a two-sweep distance transform, kept row-major so a 12MP
  // buffer is walked in memory order instead of column by column. Distances
  // saturate at 255, which is far beyond the maximum radius of 4.
  const dist = new Uint8Array(pixelCount);
  for (let x = 0; x < width; x++) dist[x] = horizontal[x] === 1 ? 0 : 255;
  for (let y = 1; y < height; y++) {
    const off = y * width;
    const above = off - width;
    for (let x = 0; x < width; x++) {
      const i = off + x;
      if (horizontal[i] === 1) {
        dist[i] = 0;
      } else {
        const d = dist[above + x];
        dist[i] = d >= 255 ? 255 : d + 1;
      }
    }
  }

  const result = new Uint8Array(pixelCount);
  const lastRow = (height - 1) * width;
  for (let x = 0; x < width; x++) {
    result[lastRow + x] = dist[lastRow + x] <= radius ? 1 : 0;
  }
  for (let y = height - 2; y >= 0; y--) {
    const off = y * width;
    const below = off + width;
    for (let x = 0; x < width; x++) {
      const i = off + x;
      const fromBelow = dist[below + x];
      const candidate = fromBelow >= 255 ? 255 : fromBelow + 1;
      const d = dist[i] < candidate ? dist[i] : candidate;
      dist[i] = d;
      result[i] = d <= radius ? 1 : 0;
    }
  }
  return result;
}

/**
 * Convert an RGBA pixel buffer into line art.
 *
 * Pure and deterministic: the same `input` and `settings` always produce a
 * byte-identical result, and `input` is never mutated. Never throws on an
 * extreme, out-of-range, NaN or missing setting — those are clamped. A 0x0
 * input returns a 0x0 result; a 1x1 input returns a 1x1 result.
 *
 * The only thing it does throw on is a malformed buffer (a `data` array too
 * short for `width * height * 4`), because that is a caller bug rather than an
 * extreme value, and silently returning a blank image would hide it.
 *
 * @returns a NEW buffer. A LINE pixel is fully opaque — black (0,0,0,255), or
 * white (255,255,255,255) when `inverted`. Every other pixel is fully
 * transparent (0,0,0,0), so the result composites as lines-only over
 * whatever sits behind it (FTA-020) rather than as an opaque sheet.
 */
export function renderLineArt(input: PixelBuffer, settings: LineArtSettings): PixelBuffer {
  const width = Number.isFinite(input.width) ? Math.max(0, Math.floor(input.width)) : 0;
  const height = Number.isFinite(input.height) ? Math.max(0, Math.floor(input.height)) : 0;
  const pixelCount = width * height;

  if (pixelCount === 0) {
    return { width: 0, height: 0, data: new Uint8ClampedArray(0) };
  }
  if (!input.data || input.data.length < pixelCount * 4) {
    throw new RangeError(
      `renderLineArt: data has ${input.data ? input.data.length : 0} bytes, needs ${pixelCount * 4} for ${width}x${height}.`,
    );
  }

  const { edgeStrength, threshold, thickness, inverted } = normaliseLineArtSettings(settings);

  // Edge strength picks the blur kernel and a 0.5x–2.0x gradient gain.
  const useFineKernel = edgeStrength >= 50;
  const radius = useFineKernel ? 1 : 2;
  const weights = useFineKernel ? GAUSS_3 : GAUSS_5;
  const shift = useFineKernel ? GAUSS_3_SHIFT : GAUSS_5_SHIFT;
  const gain = 0.5 + (edgeStrength / 100) * 1.5;

  // Threshold picks a 2–128 cutoff on the 0–255-normalised magnitude. Fold the
  // gain and the normalisation into one pre-squared constant so the inner loop
  // is a single integer compare.
  const cutoff = 2 + (threshold / 100) * 126;
  const rawCutoff = (cutoff * SOBEL_NORM) / gain;
  const thresholdSquared = rawCutoff * rawCutoff;

  const grey = toGreyscale(input.data, pixelCount);
  const scratch = new Uint8ClampedArray(pixelCount);
  const blurred = new Uint8ClampedArray(pixelCount);
  blurHorizontal(grey, scratch, width, height, radius, weights, shift);
  blurVertical(scratch, blurred, width, height, radius, weights, shift);

  let mask = sobelToMask(blurred, width, height, thresholdSquared);
  if (thickness > 0) mask = dilate(mask, width, height, thickness);

  // Black lines by default, white when inverted — and ONLY the line pixels
  // get an alpha value at all. Everything else is fully transparent (all
  // four channels 0), so the sheet this used to be opaque white is gone: a
  // consumer composites just the lines over whatever sits behind them.
  const lineValue = inverted ? 255 : 0;
  const out = new Uint8ClampedArray(pixelCount * 4);
  for (let i = 0, p = 0; i < pixelCount; i++, p += 4) {
    if (mask[i] === 1) {
      out[p] = lineValue;
      out[p + 1] = lineValue;
      out[p + 2] = lineValue;
      out[p + 3] = 255;
    }
    // else: leave at the Uint8ClampedArray's zero-initialised (0,0,0,0).
  }

  return { width, height, data: out };
}
