/**
 * Free Trace — icon generator (ticket T-12).
 *
 * Writes every PNG the manifest and iOS need, with ZERO dependencies: Node's
 * own `zlib` plus a ~60-line PNG encoder below. Adding `sharp` or `canvas` for
 * four flat two-colour images would cost a native build on every install and a
 * DECISIONS row, for artwork that is two signed-distance fields.
 *
 * Run:  node scripts/make-icons.mjs
 * It is idempotent — same bytes every run — so the test suite runs it and then
 * asserts the PNG headers of what it wrote.
 *
 * The mark: a rounded square outline (the sheet of paper / the lightbox) with a
 * single diagonal stroke inside it (the pencil line). Amber #E8A33D on the app's
 * near-black #0B0B0C ground (SPEC §7). No text — text is unreadable at 60px on a
 * Home Screen and iOS already draws the app name underneath.
 */

import zlib from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const BG = [0x0b, 0x0b, 0x0c]; // --bg
const AMBER = [0xe8, 0xa3, 0x3d]; // --accent

/* ------------------------------------------------------------------ *
 * Minimal PNG encoder: 8-bit truecolour (no alpha), single IDAT.
 * Colour type 2 rather than 6 on purpose — a Home Screen icon must be
 * opaque, and an alpha channel is the classic way iOS ends up drawing a
 * black box where the artwork should be.
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgb) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = truecolour RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Raw scanlines, each prefixed with filter byte 0 (None). The artwork is a
  // smooth gradient of two colours; filter 0 plus deflate is already tiny.
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ *
 * Drawing: signed distance fields, so the edges are antialiased without
 * any supersampling loop.
 * ------------------------------------------------------------------ */

/** Signed distance from `p` to a rounded box centred on the origin. */
function sdRoundedBox(px, py, halfX, halfY, radius) {
  const qx = Math.abs(px) - halfX + radius;
  const qy = Math.abs(py) - halfY + radius;
  return (
    Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius
  );
}

/** Unsigned distance from `p` to the segment a→b. */
function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h);
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * @param size    square edge in pixels
 * @param markScale  the mark's width as a fraction of the canvas. Smaller for
 *   the maskable variant, whose art must sit inside the 80%-diameter safe
 *   circle that Android is allowed to crop to.
 */
function renderIcon(size, markScale) {
  const rgb = Buffer.alloc(size * size * 3);

  const centre = size / 2;
  const half = (size * markScale) / 2;
  const strokeHalf = (size * 0.055) / 2;
  const radius = half * 0.28;
  // The diagonal stops short of the frame so the two shapes stay legible as
  // separate strokes at 60px.
  const reach = half * 0.62;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5 - centre;
      const py = y + 0.5 - centre;

      // abs() turns the filled rounded box into its outline.
      const frame = Math.abs(sdRoundedBox(px, py, half, half, radius)) - strokeHalf;
      const pencil = sdSegment(px, py, -reach, reach, reach, -reach) - strokeHalf;
      const coverage = clamp01(0.5 - Math.min(frame, pencil));

      const offset = (y * size + x) * 3;
      for (let c = 0; c < 3; c += 1) {
        rgb[offset + c] = Math.round(BG[c] + (AMBER[c] - BG[c]) * coverage);
      }
    }
  }

  return encodePng(size, size, rgb);
}

const OUTPUTS = [
  { path: "public/icons/icon-192.png", size: 192, markScale: 0.62 },
  { path: "public/icons/icon-512.png", size: 512, markScale: 0.62 },
  // Maskable: the mark's corners must stay inside a circle of diameter 0.8×size.
  // half·√2 ≤ 0.4·size ⇒ markScale ≤ 0.566. 0.52 leaves real margin.
  { path: "public/icons/icon-512-maskable.png", size: 512, markScale: 0.52 },
  // iOS applies its own squircle mask and ignores the manifest icons entirely.
  { path: "public/apple-touch-icon.png", size: 180, markScale: 0.62 },
];

for (const output of OUTPUTS) {
  const file = join(ROOT, output.path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, renderIcon(output.size, output.markScale));
}

// The one intentional stdout line: this is a CLI, not app code, and a build
// script that writes four files silently is worse than one that says so.
process.stdout.write(`make-icons: wrote ${OUTPUTS.length} PNGs\n`);
