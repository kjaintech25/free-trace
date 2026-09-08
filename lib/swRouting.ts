/**
 * Service-worker request classification (ticket T-12) — the decision half of
 * `public/sw.js`, extracted so it can be unit-tested.
 *
 * ⚠️ `public/sw.js` CANNOT import this file. It is served verbatim from
 * `public/`, outside the bundler, and a classic service worker has no module
 * resolution. The rules below are therefore DUPLICATED as plain functions at
 * the top of `sw.js`, and `tests/sw-source.test.ts` scans that file's source to
 * check the two copies have not drifted. That scan is a source guard, not a
 * behaviour test — see the note in that file.
 *
 * If you change a rule here, change it in `public/sw.js` in the same commit.
 */

/** The parts of a `Request` these rules actually look at. */
export interface SwRequestLike {
  readonly method: string;
  readonly url: string;
  /** `Request.mode` — "navigate" for a document load. */
  readonly mode?: string;
  /** Whether the request carries a `Range` header. */
  readonly hasRangeHeader?: boolean;
}

/** Synthetic cache key holding one rendered `/trace/<id>` document. */
export const TRACE_SHELL_KEY = "/trace/__any";

/**
 * Should the worker intercept this request at all?
 *
 * Returning false means "do not call respondWith" — the request goes to the
 * network exactly as if no worker were installed. Everything the app does that
 * is NOT an ordinary same-origin GET is excluded here:
 *
 * - **non-GET** — nothing in Free Trace posts, but a cache is a GET-only store.
 * - **`Range` requests** — a 206 partial response cannot legally be put in a
 *   Cache, and mishandling one breaks `<video>` seeking.
 * - **`blob:` and `data:`** — every image in this app is an IndexedDB Blob read
 *   through an object URL. Browsers do not dispatch fetch events for these
 *   schemes at all, so this is belt-and-braces, but it is the rule that must
 *   never be relaxed: a worker that answered a `blob:` URL would break both the
 *   line-art overlay and the module worker.
 * - **cross-origin** — the Geist fonts are self-hosted by next/font, so
 *   same-origin covers them; anything else is somebody else's cache to manage.
 * - **`/sw.js`** — never let the worker serve a stale copy of itself.
 * - **`/_next/data` and `/api/`** — data, not shell. Free Trace has no API
 *   routes by design (SPEC §2) and must never start caching one by accident.
 *
 * The camera is not on this list because it cannot be: `getUserMedia` is not a
 * network request and never reaches a service worker.
 */
export function shouldHandle(request: SwRequestLike, origin: string): boolean {
  if (request.method !== "GET") return false;
  if (request.hasRangeHeader) return false;

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.origin !== origin) return false;
  if (url.pathname === "/sw.js") return false;
  if (url.pathname.startsWith("/_next/data")) return false;
  if (url.pathname.startsWith("/api/")) return false;

  return true;
}

export type SwRoute = "navigate" | "static" | "asset";

/**
 * How should a handled request be answered?
 *
 * - `navigate` — a document load. Network-first with a short timeout, so a
 *   deploy is picked up immediately but a dead network falls back fast.
 * - `static` — `/_next/static/**`, content-hashed and immutable. Cache-first.
 *   This is what covers the line-art Web Worker chunk and the font files.
 * - `asset` — every other same-origin GET (icons, the manifest). Also
 *   cache-first: the cache name carries the build id and is dropped on
 *   activate, so a cached copy can only ever be this build's copy.
 */
export function routeFor(request: SwRequestLike): SwRoute {
  if (request.mode === "navigate") return "navigate";
  const url = new URL(request.url);
  if (url.pathname.startsWith("/_next/static/")) return "static";
  return "asset";
}

/**
 * The synthetic shell key for a `/trace/<id>` navigation, or null.
 *
 * `/trace/[id]` is a DYNAMIC route (it builds as ƒ) and the ids are user data,
 * so no precache list can name them. Instead the first `/trace/<id>` document
 * fetched successfully is also stored under {@link TRACE_SHELL_KEY}, and a
 * later navigation to an id that has never been opened offline is answered
 * with it. See the limits documented in `KNOWN_ISSUES.md`.
 */
export function traceShellKey(pathname: string): string | null {
  return /^\/trace\/[^/]+\/?$/.test(pathname) ? TRACE_SHELL_KEY : null;
}
