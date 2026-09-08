import { describe, expect, it } from "vitest";

import {
  TRACE_SHELL_KEY,
  routeFor,
  shouldHandle,
  traceShellKey,
} from "@/lib/swRouting";

const ORIGIN = "https://free-trace.example";

const get = (url: string, extra: Record<string, unknown> = {}) => ({
  method: "GET",
  url,
  ...extra,
});

describe("shouldHandle", () => {
  it("handles ordinary same-origin GETs", () => {
    expect(shouldHandle(get(`${ORIGIN}/`), ORIGIN)).toBe(true);
    expect(shouldHandle(get(`${ORIGIN}/convert`), ORIGIN)).toBe(true);
    expect(shouldHandle(get(`${ORIGIN}/_next/static/chunks/app.js`), ORIGIN)).toBe(true);
  });

  it("never touches blob: or data: URLs", () => {
    // The line-art overlay and every library thumbnail are IndexedDB Blobs read
    // through object URLs. Intercepting one would black out the trace screen.
    expect(shouldHandle(get(`blob:${ORIGIN}/9f0c-4d2a`), ORIGIN)).toBe(false);
    expect(shouldHandle(get("data:image/png;base64,iVBORw0KGgo="), ORIGIN)).toBe(false);
  });

  it("ignores non-GET requests", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"]) {
      expect(shouldHandle({ method, url: `${ORIGIN}/` }, ORIGIN), method).toBe(false);
    }
  });

  it("ignores Range requests", () => {
    // A 206 partial response cannot legally be stored in a Cache.
    expect(shouldHandle(get(`${ORIGIN}/clip.mp4`, { hasRangeHeader: true }), ORIGIN)).toBe(
      false,
    );
  });

  it("ignores cross-origin, /sw.js, /_next/data and /api/", () => {
    expect(shouldHandle(get("https://elsewhere.example/x.js"), ORIGIN)).toBe(false);
    expect(shouldHandle(get(`${ORIGIN}/sw.js`), ORIGIN)).toBe(false);
    expect(shouldHandle(get(`${ORIGIN}/sw.js?v=abc123`), ORIGIN)).toBe(false);
    expect(shouldHandle(get(`${ORIGIN}/_next/data/build/x.json`), ORIGIN)).toBe(false);
    expect(shouldHandle(get(`${ORIGIN}/api/anything`), ORIGIN)).toBe(false);
  });

  it("does not throw on an unparseable URL", () => {
    expect(shouldHandle(get("not a url"), ORIGIN)).toBe(false);
  });
});

describe("routeFor", () => {
  it("classifies document loads as navigations", () => {
    expect(routeFor(get(`${ORIGIN}/trace/abc`, { mode: "navigate" }))).toBe("navigate");
  });

  it("classifies hashed build output as static", () => {
    // This is the rule that keeps the line-art Web Worker chunk available
    // offline (lib/edgesClient.ts spawns it from /_next/static).
    expect(routeFor(get(`${ORIGIN}/_next/static/chunks/worker.js`))).toBe("static");
  });

  it("classifies everything else same-origin as an asset", () => {
    expect(routeFor(get(`${ORIGIN}/icons/icon-192.png`))).toBe("asset");
    expect(routeFor(get(`${ORIGIN}/manifest.webmanifest`))).toBe("asset");
  });
});

describe("traceShellKey", () => {
  it("maps any single /trace/<id> path to the one synthetic key", () => {
    expect(traceShellKey("/trace/abc")).toBe(TRACE_SHELL_KEY);
    expect(traceShellKey("/trace/2f1b8c44-0e6d-4a71-9f3e-1b2c3d4e5f60")).toBe(
      TRACE_SHELL_KEY,
    );
    expect(traceShellKey("/trace/abc/")).toBe(TRACE_SHELL_KEY);
  });

  it("does not claim other routes", () => {
    // A generic app-shell fallback would render the library at /convert and
    // make every route but "/" unreachable. The reuse is bounded to /trace/.
    expect(traceShellKey("/")).toBeNull();
    expect(traceShellKey("/convert")).toBeNull();
    expect(traceShellKey("/settings")).toBeNull();
    expect(traceShellKey("/trace")).toBeNull();
    expect(traceShellKey("/trace/abc/extra")).toBeNull();
  });
});
