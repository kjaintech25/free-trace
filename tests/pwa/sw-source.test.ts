import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ⚠️ THIS IS A SOURCE-SCAN GUARD, NOT A BEHAVIOUR TEST.
 *
 * `public/sw.js` is served verbatim from public/, outside the bundler, and a
 * classic service worker cannot import an ES module. Its routing rules are
 * therefore a hand-copy of `lib/swRouting.ts`, which is where the real
 * behavioural coverage lives (tests/pwa/swRouting.test.ts).
 *
 * These assertions only prove the RULES ARE STILL WRITTEN DOWN in sw.js. They
 * execute none of it, and they cannot prove the worker behaves correctly — a
 * service worker needs a real ServiceWorkerGlobalScope, which jsdom does not
 * have. Actual offline behaviour is verified by hand: scripts/offline-check.md.
 *
 * What this DOES catch is the realistic failure: someone edits the tested
 * module, the tests stay green, and the untested duplicate silently rots.
 */
const SW_PATH = join(process.cwd(), "public", "sw.js");
const source = readFileSync(SW_PATH, "utf8");

describe("public/sw.js source guard", () => {
  it("only ever intercepts GET", () => {
    expect(source).toMatch(/request\.method\s*!==\s*"GET"/);
  });

  it("excludes Range requests", () => {
    expect(source).toMatch(/request\.headers\.has\("range"\)/);
  });

  it("excludes every non-http scheme, which is what protects blob: URLs", () => {
    expect(source).toMatch(/url\.protocol\s*!==\s*"http:"/);
    expect(source).toMatch(/url\.protocol\s*!==\s*"https:"/);
    // And the reason is stated in the file, so the next reader does not
    // "simplify" the guard away.
    expect(source).toMatch(/blob:/);
  });

  it("excludes cross-origin, itself, /_next/data and /api/", () => {
    expect(source).toMatch(/url\.origin\s*!==\s*self\.location\.origin/);
    expect(source).toMatch(/url\.pathname\s*===\s*"\/sw\.js"/);
    expect(source).toMatch(/url\.pathname\.startsWith\("\/_next\/data"\)/);
    expect(source).toMatch(/url\.pathname\.startsWith\("\/api\/"\)/);
  });

  it("keeps the cache name keyed to the build id from the ?v= query string", () => {
    expect(source).toMatch(/searchParams\.get\("v"\)/);
    expect(source).toMatch(/free-trace-/);
  });

  it("drops older caches on activate and claims open clients", () => {
    expect(source).toMatch(/caches\.keys\(\)/);
    expect(source).toMatch(/caches\.delete\(/);
    expect(source).toMatch(/skipWaiting\(\)/);
    expect(source).toMatch(/clients\.claim\(\)/);
  });

  it("precaches the shell routes and the icons", () => {
    for (const url of [
      "/",
      "/convert",
      "/settings",
      "/manifest.webmanifest",
      "/apple-touch-icon.png",
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/icon-512-maskable.png",
    ]) {
      expect(source, url).toContain(`"${url}"`);
    }
  });

  it("uses the same synthetic trace key as lib/swRouting.ts", () => {
    expect(source).toContain('"/trace/__any"');
  });

  it("stays silent — no console output from a worker that runs on every load", () => {
    expect(source).not.toMatch(/console\./);
  });
});
