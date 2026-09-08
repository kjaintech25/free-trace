import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * Runs scripts/make-icons.mjs for real and inspects the bytes it wrote.
 *
 * The script hand-rolls a PNG encoder (zlib + raw scanlines, zero deps), so
 * "does it produce a valid PNG" is a genuine risk and not a formality: a wrong
 * CRC or a bad IHDR yields a file that every tool refuses, and on iOS that is a
 * blank Home Screen icon with no error anywhere.
 */
const ROOT = process.cwd();

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const EXPECTED = [
  { path: "public/icons/icon-192.png", size: 192 },
  { path: "public/icons/icon-512.png", size: 512 },
  { path: "public/icons/icon-512-maskable.png", size: 512 },
  { path: "public/apple-touch-icon.png", size: 180 },
];

beforeAll(() => {
  // process.execPath, not "node": the PATH inside a test runner is not the
  // shell's, and this must fail loudly rather than silently skip.
  execFileSync(process.execPath, [join(ROOT, "scripts", "make-icons.mjs")], {
    cwd: ROOT,
    stdio: "pipe",
  });
});

describe("scripts/make-icons.mjs", () => {
  it.each(EXPECTED)("writes $path as a valid $size×$size PNG", ({ path, size }) => {
    const bytes = readFileSync(join(ROOT, path));

    expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);

    // The IHDR chunk is fixed-position: 8 signature bytes, then a 4-byte
    // length, then the type, then the header fields.
    expect(bytes.subarray(12, 16).toString("latin1")).toBe("IHDR");
    expect(bytes.readUInt32BE(16)).toBe(size);
    expect(bytes.readUInt32BE(20)).toBe(size);
    expect(bytes[24]).toBe(8); // 8 bits per channel
    // Colour type 2 = truecolour, NO alpha. An alpha channel is the classic
    // way an iOS Home Screen icon ends up drawn as a black box.
    expect(bytes[25]).toBe(2);

    expect(bytes.subarray(bytes.length - 8).toString("latin1")).toContain("IEND");
  });

  it("is deterministic, so a rebuild is never a spurious diff", () => {
    const before = EXPECTED.map(({ path }) => readFileSync(join(ROOT, path)));
    execFileSync(process.execPath, [join(ROOT, "scripts", "make-icons.mjs")], {
      cwd: ROOT,
      stdio: "pipe",
    });
    EXPECTED.forEach(({ path }, index) => {
      expect(readFileSync(join(ROOT, path)).equals(before[index]), path).toBe(true);
    });
  });
});
