import { describe, expect, it } from "vitest";
import { DEFAULT_LINE_ART_SETTINGS, renderLineArt, type PixelBuffer } from "@/lib/edges";

/**
 * Opt-in performance probe for the line-art engine (T-06 acceptance criterion
 * "under 400ms for a 12MP input"). Skipped by default so `npm test` stays fast
 * and does not allocate ~200MB on the build machine.
 *
 *   FT_BENCH=1 npm test
 *
 * The number it prints is a Node-on-a-Mac ESTIMATE, not an iPhone measurement.
 * Nothing here can measure a phone; treat it as an upper-bound sanity check.
 */
const RUNS = 3;

/**
 * 12MP is the acceptance-criterion worst case: a raw iPhone photo that somehow
 * reached the engine un-downscaled. 2000x1500 is what the app ACTUALLY feeds
 * it, because `downscaleToMax` caps the long edge at 2000px first (SPEC §8).
 */
const CASES: ReadonlyArray<readonly [label: string, width: number, height: number]> = [
  ["12MP worst case", 4000, 3000],
  ["after the 2000px downscale", 2000, 1500],
];

function syntheticPhoto(width: number, height: number): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Ramps, a hard step and a fine checker so blur, Sobel and the threshold
      // all do real work rather than running over a flat field.
      const ramp = ((x * 255) / width + (y * 255) / height) / 2;
      const step = x > width / 2 ? 60 : 0;
      const checker = ((x >> 2) + (y >> 2)) % 2 === 0 ? 18 : 0;
      const p = (y * width + x) * 4;
      const value = ramp + step + checker;
      data[p] = value;
      data[p + 1] = value;
      data[p + 2] = value;
      data[p + 3] = 255;
    }
  }
  return { width, height, data };
}

describe.runIf(process.env.FT_BENCH === "1")("renderLineArt performance", () => {
  for (const [label, width, height] of CASES) {
    it(
      `converts ${label} (${width}x${height})`,
      async ({ annotate }) => {
        const input = syntheticPhoto(width, height);
        const timings: number[] = [];
        for (let run = 0; run < RUNS; run++) {
          const started = performance.now();
          const output = renderLineArt(input, DEFAULT_LINE_ART_SETTINGS);
          timings.push(performance.now() - started);
          expect(output.width).toBe(width);
          expect(output.height).toBe(height);
        }
        const sorted = [...timings].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        // Reported through the test-annotation channel rather than a
        // console.log, which SPEC §9 bans. Use `--reporter=verbose` to see it.
        await annotate(
          `${label} ${width}x${height}, ${RUNS} runs — best ${sorted[0].toFixed(1)}ms, ` +
            `median ${median.toFixed(1)}ms, worst ${sorted[sorted.length - 1].toFixed(1)}ms. ` +
            `ESTIMATE (Node on the build Mac, not an iPhone).`,
          "notice",
        );
        // The phone target is 400ms (SPEC §8). This ceiling is the Node budget
        // T-06 was told to stay under; blowing it means a real regression.
        expect(median).toBeLessThan(800);
      },
      120_000,
    );
  }
});
