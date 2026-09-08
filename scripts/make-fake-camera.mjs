/**
 * scripts/make-fake-camera.mjs — generates the synthetic camera feed the
 * headless verification harness (ticket T-14) plays instead of real hardware.
 *
 * Zero dependencies on purpose. Chromium's `--use-file-for-fake-video-capture`
 * takes an uncompressed YUV4MPEG2 (.y4m) file, which is a plain text header
 * followed by raw planar frames — so a few lines of Buffer writing replace a
 * whole encoder toolchain, and the committed fixture is reproducible byte for
 * byte from this script.
 *
 * Run:  node scripts/make-fake-camera.mjs
 * Out:  tests/e2e/fixtures/fake-camera.y4m   (committed)
 *
 * ── What the frames contain, and why ──────────────────────────────────────
 * A mid-grey vertical gradient that slides sideways one band per frame. Two
 * properties matter and both are load-bearing for the overlay gate:
 *
 *  1. **Frames differ.** A still image would let `video.readyState` and the
 *     "is the feed live" checks pass against a frozen first frame. A moving
 *     gradient means a stalled feed looks different from a running one.
 *  2. **Nothing in it is DARK.** The gate in tests/e2e/trace.spec.ts proves the
 *     line art reached the composited frame by counting near-black pixels in a
 *     screenshot. If the camera feed itself contained blacks, the count at 0%
 *     opacity would not be a clean baseline. Luma is held inside
 *     [LUMA_MIN, LUMA_MAX] below — comfortably above the gate's threshold — so
 *     every dark pixel the gate sees can only have come from the overlay.
 *
 * Chroma is fixed at 128/128 (neutral grey) so the feed is greyscale: colour
 * would add nothing and a colour cast could only muddy the luma reasoning.
 *
 * ── Size ──────────────────────────────────────────────────────────────────
 * Uncompressed 320x240 YUV420p is 115,200 bytes per frame, so duration is the
 * only lever on file size. Chromium LOOPS the file when it reaches the end, so
 * a short clip is a continuous feed — see FRAME_COUNT.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WIDTH = 320;
const HEIGHT = 240;
const FPS = 10;

/**
 * 10 frames = 1.0s = ~1.1MB. NOT the 2 seconds the ticket sketched: at
 * 115,200 bytes per frame, 2s would be 2.3MB — over the 2MB ceiling the same
 * sentence set. Chromium's FileVideoCaptureDevice restarts the file from the
 * top on reaching the end, so the harness still sees an endless moving feed;
 * the only thing lost is the length of the cycle before it repeats, which no
 * check depends on.
 */
const FRAME_COUNT = 10;

/** Mid-grey band, kept well clear of the gate's near-black threshold. */
const LUMA_MIN = 96;
const LUMA_MAX = 176;

const Y_SIZE = WIDTH * HEIGHT;
const C_WIDTH = WIDTH / 2;
const C_HEIGHT = HEIGHT / 2;
const C_SIZE = C_WIDTH * C_HEIGHT;

/**
 * Luma for one pixel: a horizontal sawtooth gradient, phase-shifted by the
 * frame index so the bands travel left to right over the clip.
 */
function luma(x, y, frame) {
  const phase = (x / WIDTH + frame / FRAME_COUNT) % 1;
  // Triangle wave: ramps up over the first half of the cycle and back down
  // over the second, so the loop point is seamless rather than a hard edge.
  const ramp = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  // A gentle vertical tilt as well, so a frame is not made of identical rows
  // and an accidentally-cropped screenshot still shows structure.
  const tilt = (y / HEIGHT) * 0.15;
  const value = LUMA_MIN + (LUMA_MAX - LUMA_MIN) * Math.min(1, ramp + tilt);
  return Math.max(LUMA_MIN, Math.min(LUMA_MAX, Math.round(value)));
}

function buildFrame(frame) {
  // "FRAME\n" is the per-frame magic the y4m container requires; the planes
  // follow it with no length prefix, which is why the header's dimensions are
  // the only thing telling a decoder where the next frame starts.
  const buffer = Buffer.alloc(6 + Y_SIZE + C_SIZE * 2);
  buffer.write("FRAME\n", 0, "ascii");

  let offset = 6;
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      buffer[offset] = luma(x, y, frame);
      offset += 1;
    }
  }

  // U then V, both neutral: a greyscale image in YUV420p.
  buffer.fill(128, offset, offset + C_SIZE * 2);
  return buffer;
}

function build() {
  // C420jpeg is the chroma siting Chromium's fake device expects; A1:1 is
  // square pixels; Ip is progressive. F10:1 is the frame rate as a ratio.
  const header = `YUV4MPEG2 W${WIDTH} H${HEIGHT} F${FPS}:1 Ip A1:1 C420jpeg\n`;
  const parts = [Buffer.from(header, "ascii")];
  for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
    parts.push(buildFrame(frame));
  }
  return Buffer.concat(parts);
}

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "..", "tests", "e2e", "fixtures", "fake-camera.y4m");
mkdirSync(dirname(target), { recursive: true });

const output = build();
writeFileSync(target, output);

// This script is a build tool, not app code — stdout is its whole interface.
process.stdout.write(
  `fake-camera.y4m: ${WIDTH}x${HEIGHT}, ${FRAME_COUNT} frames @ ${FPS}fps, ` +
    `${output.length} bytes -> ${target}\n`,
);
