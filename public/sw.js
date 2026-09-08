/* Free Trace — app-shell service worker (ticket T-12).
 *
 * Free Trace makes ZERO network calls after load. Every photo, every line-art
 * PNG and every setting is a Blob or a record in IndexedDB on the device
 * (SPEC §1, §5). So there is nothing in here about data caching, write queues
 * or background sync. The only job is to make the shell boot with the radio
 * off, and then get out of the way.
 *
 * ── IndexedDB is not cached here, and cannot be ────────────────────────────
 * The acceptance criterion "the service worker never caches IndexedDB" is
 * satisfied BY CONSTRUCTION, not by a rule below. IndexedDB is a storage API
 * reached through `indexedDB.open()` — it is not a URL, it issues no HTTP
 * request, and no fetch event is ever dispatched for it. A service worker has
 * no way to observe it, let alone cache it. The same is true of the camera:
 * `getUserMedia` is a device API, not a fetch. Neither can be broken from here.
 *
 * What CAN be broken from here is the layer just above them, which is why the
 * exclusion list in shouldHandle() is not decorative:
 *   · the line-art overlay reads IndexedDB Blobs through `blob:` object URLs
 *   · lib/edgesClient.ts spawns a module Worker from /_next/static/
 * A fetch handler that answered those wrongly would black out the trace screen
 * with the camera working perfectly. blob: is excluded; /_next/static is
 * cache-first over content-hashed URLs, which can only ever be the right bytes.
 *
 * ── This file is a DUPLICATE of lib/swRouting.ts ───────────────────────────
 * It is served verbatim from public/, outside the bundler, so it cannot import
 * anything. shouldHandle/routeFor/traceShellKey below are hand-copies of the
 * tested originals in lib/swRouting.ts. tests/sw-source.test.ts scans this file
 * to catch drift. Change one, change both, in the same commit.
 *
 * ── Cache versioning ───────────────────────────────────────────────────────
 * components/RegisterSW.tsx registers this script as `/sw.js?v=<build id>`,
 * where the build id is NEXT_PUBLIC_BUILD_ID, inlined at build time by
 * next.config.ts (the Vercel commit sha, or a local timestamp). A new deploy is
 * therefore a NEW SCRIPT URL, which forces a byte-comparison miss, a fresh
 * install into a fresh cache, and a drop of every older cache on activate.
 * That is the mechanism in use — there is no constant to bump by hand.
 *
 * No console output anywhere in this file, deliberately: a service worker logs
 * into the page's console on every navigation and it becomes noise fast.
 */

const BUILD = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE_PREFIX = "free-trace-";
const CACHE = `${CACHE_PREFIX}${BUILD}`;

/** Cache key for the offline shell document. */
const OFFLINE_KEY = "/__offline";

/** Synthetic key holding one rendered /trace/<id> document. */
const TRACE_SHELL_KEY = "/trace/__any";

/** How long a navigation waits for the network before falling back. */
const NAVIGATION_TIMEOUT_MS = 2500;

/* Everything needed for a cold, offline first paint. The JS, CSS and font
   chunks under /_next/static are content-hashed and unknowable here, so they
   are warmed from the installed documents below and then picked up by the
   fetch handler. /settings is built in another lane and may 404 on a branch
   that predates it — the install tolerates that per-URL rather than failing. */
const SHELL = [
  "/",
  "/convert",
  "/settings",
  "/manifest.webmanifest",
  "/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
];

/* The offline document, as a constant rather than a file. It is part of the
   worker script, which the browser stores as the registered script, so it is
   precached in the strongest sense available: it cannot go missing while the
   worker exists. A copy is also written into the cache under OFFLINE_KEY on
   install so it is visible to a reviewer poking at Application → Cache Storage. */
const OFFLINE_HTML = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Offline — Free Trace</title>
<style>html{background:#0B0B0C;color:#F2F2F0;font:16px/1.5 system-ui,sans-serif}
body{margin:0;display:grid;place-items:center;min-height:100vh;padding:2rem;text-align:center}
h1{font-weight:600;font-size:1.25rem;margin:0 0 .5rem}
p{color:#87878C;max-width:24rem;margin:0}</style>
<body><div><h1>Offline</h1><p>This screen has not been opened on this device yet,
so there is no saved copy to show. Reconnect and open it once.</p></div>`;

function offlineResponse(status) {
  return new Response(OFFLINE_HTML, {
    status: status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/* ── Classification (duplicated from lib/swRouting.ts) ───────────────────── */

function shouldHandle(request) {
  if (request.method !== "GET") return false;
  if (request.headers.has("range")) return false;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }

  // blob: and data: — object URLs for IndexedDB images. Never intercept.
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.origin !== self.location.origin) return false;
  if (url.pathname === "/sw.js") return false;
  if (url.pathname.startsWith("/_next/data")) return false;
  if (url.pathname.startsWith("/api/")) return false;

  return true;
}

function routeFor(request) {
  if (request.mode === "navigate") return "navigate";
  const url = new URL(request.url);
  if (url.pathname.startsWith("/_next/static/")) return "static";
  return "asset";
}

function traceShellKey(pathname) {
  return /^\/trace\/[^/]+\/?$/.test(pathname) ? TRACE_SHELL_KEY : null;
}

/* ── Install ─────────────────────────────────────────────────────────────── */

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.put(new Request(OFFLINE_KEY), offlineResponse(200));

      // One at a time, not addAll: addAll rejects the whole install on a single
      // 404, which would leave the app with no worker at all.
      const documents = [];
      await Promise.all(
        SHELL.map(async (url) => {
          try {
            const response = await fetch(url, { cache: "reload" });
            if (!response.ok) return;
            const type = response.headers.get("content-type") || "";
            if (type.includes("text/html")) {
              documents.push(await response.clone().text());
            }
            await cache.put(url, response);
          } catch {
            /* Offline during install. The fetch handler fills these in later. */
          }
        }),
      );

      // Warm this build's own hashed chunks by reading them out of the
      // documents we just cached. Without this the first offline launch paints
      // the server HTML and then never hydrates, so no button would work.
      const assets = new Set();
      for (const html of documents) {
        for (const match of html.matchAll(/(?:src|href)="(\/_next\/[^"]+)"/g)) {
          assets.add(match[1].replace(/&amp;/g, "&"));
        }
      }
      await Promise.all(
        [...assets].map(async (url) => {
          try {
            const response = await fetch(url);
            if (response.ok) await cache.put(url, response);
          } catch {
            /* Best effort — the fetch handler will cache it on first use. */
          }
        }),
      );

      // Take over without waiting for every tab to close. Paired with
      // clients.claim() below; the consequence is documented in KNOWN_ISSUES.md.
      await self.skipWaiting();
    })(),
  );
});

/* ── Activate ────────────────────────────────────────────────────────────── */

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/* ── Fetch ───────────────────────────────────────────────────────────────── */

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Not calling respondWith is not the same as returning an empty response:
  // the request proceeds to the network exactly as if no worker existed.
  if (!shouldHandle(request)) return;

  if (routeFor(request) === "navigate") {
    event.respondWith(handleNavigation(event, request));
  } else {
    event.respondWith(handleAsset(event, request));
  }
});

/** fetch() that resolves to null instead of hanging past `ms`. */
function fetchWithTimeout(request, ms) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), ms);
    fetch(request).then(finish, () => finish(null));
  });
}

/**
 * Navigations: network-first with a short timeout, then the cached copy of that
 * exact route, then the synthetic /trace shell, then the offline document.
 *
 * There is deliberately no GENERIC app-shell fallback. Answering /convert with
 * the cached "/" document would render the library at the /convert URL and make
 * every route but "/" unreachable once the worker is installed. The only
 * cross-URL reuse here is inside /trace/, and it is bounded to /trace/.
 */
async function handleNavigation(event, request) {
  const cache = await caches.open(CACHE);
  const pathname = new URL(request.url).pathname;
  const shellKey = traceShellKey(pathname);

  const response = await fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS);
  if (response && response.ok) {
    event.waitUntil(cache.put(request, response.clone()));
    if (shellKey) {
      // Keep one rendered trace document as the fallback for ids that have
      // never been opened on this device. Limits: KNOWN_ISSUES.md.
      event.waitUntil(cache.put(shellKey, response.clone()));
    }
    return response;
  }

  const exact = await cache.match(request, { ignoreSearch: true });
  if (exact) return exact;

  if (shellKey) {
    const shell = await cache.match(shellKey);
    if (shell) return shell;
  }

  // The server answered, just not with a 200. That is a real 404 or a real
  // error and the user should see it — replacing it with our own "you are
  // offline" page would be a lie about a working connection.
  if (response) return response;

  const offline = await cache.match(OFFLINE_KEY);
  return offline || offlineResponse(503);
}

/**
 * Assets: cache-first. Under /_next/static every URL is content-hashed, so a
 * hit is always the right bytes for this build. The unhashed shell files
 * (icons, manifest) are safe cache-first too, because the cache name carries
 * the build id and every older cache is deleted on activate.
 */
async function handleAsset(event, request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // `basic` excludes opaque cross-origin responses, which cannot be validated
    // and would poison the cache with unreadable entries.
    if (response && response.ok && response.type === "basic") {
      event.waitUntil(cache.put(request, response.clone()));
    }
    return response;
  } catch {
    return new Response("", { status: 504, statusText: "Offline" });
  }
}
