# KNOWN_ISSUES.md

Platform behaviour Free Trace lives with on purpose, and the exact edit that changes
each one. Written for a reader who is holding a misbehaving iPhone, not for an engineer
reading at leisure.

---

## 1. iOS standalone-mode camera (SPEC §10.3)

**Symptom.** You tap "Add to Home Screen", open Free Trace from the icon, and the trace
screen is **black where the camera feed should be** — no permission prompt, or a prompt
you accept and nothing happens. The same URL opened in Safari works perfectly.

**Cause.** Safari has a long history of breaking `getUserMedia` specifically for web apps
launched from the Home Screen in standalone display mode. It is an iOS bug, it comes and
goes between iOS releases, and there is no reliable workaround from inside the page.
Per SPEC §10.3 we do not attempt one.

### The fix — one line, about ten seconds

**File:** `app/manifest.ts` · **line 25**

```ts
    display: "standalone",   // ← change to:  display: "browser",
```

Change that single word, commit, and let Vercel deploy. **Delete the Home Screen icon and
re-add it** — iOS caches the manifest at install time and will not re-read it otherwise.

**What you get.** The Home Screen icon now opens Free Trace in Safari instead of as a
standalone app. The camera works. The cost is the Safari chrome: an address bar at the
top and a toolbar at the bottom, so the trace screen is no longer edge-to-edge. Nothing
else changes — the service worker, offline mode, IndexedDB and every saved reference are
untouched, because none of them depend on the display mode.

### If the flip does not take (older iPhones only)

`app/layout.tsx` **line 50** also declares standalone, for iOS older than about 11.3:

```ts
    "apple-mobile-web-app-capable": "yes",
```

Since 2018 iOS lets the manifest's `display` **override** that meta, so on any current
iPhone line 25 alone is enough and this line is inert. Only if you are on genuinely old
iOS, delete line 50 as well and re-add the icon.

---

## 2. The service worker serves the previous build once after a deploy

**This is expected. Do not "fix" it.** Inherited, deliberately, from the same design in
`standing-pot`.

**Symptom.** You ship a change, open the app on your phone, and see the *old* version.
Close it and open it again and the new version is there.

**Why.** `components/RegisterSW.tsx` registers the worker as `/sw.js?v=<build id>`. On a
deploy that is a new script URL, so the browser installs a **new** worker — but the page
you are looking at was already being served by the **old** one, which cannot be swapped
out mid-navigation. `skipWaiting()` + `clients.claim()` in `public/sw.js` make the new
worker take over as soon as that first load finishes, so the *next* launch is current.

The alternative is reloading the page under the user's hands, which on the trace screen
could happen mid-drawing. One stale launch is the cheaper failure.

**To check which build you are on** — Safari/Chrome DevTools → Console:

```js
caches.keys().then(console.log)     // e.g. ["free-trace-9f2c1ab44e10"]
```

One entry means the old cache was dropped correctly on activate. If you see two, the new
worker has installed but not yet activated: close every tab of the app and reopen.
The suffix is the git commit sha (`VERCEL_GIT_COMMIT_SHA`, first 12 chars) — compare it
with the deployment in the Vercel dashboard.

**To wipe the slate entirely** — DevTools → Application → Service Workers → *Unregister*,
then Application → Storage → *Clear site data*. This does **not** touch your library:
saved references live in IndexedDB, which the service worker never reads or writes.

---

## 3. A reference opened for the very first time while offline shows the wrong image

**Narrow, and only offline.** `/trace/[id]` is a dynamic route — the ids are your own
photos, so no precache list can name them in advance.

**What we do.** Every `/trace/<id>` you open while online is cached under its own URL, so
reopening *that* reference offline is exact and correct. In addition, the first trace
screen to load successfully is also stored under one synthetic key, `/trace/__any`
(`lib/swRouting.ts`), and that copy is used as a last resort for an id that has never
been opened on this device.

**The limit.** That fallback restores the *app*, not the *reference*. The document it
serves was server-rendered for whichever reference was cached first, so its route
parameter belongs to that one — an id you have never opened offline can paint the wrong
reference until you reload it once with a connection. The alternative was a browser error
page, which is strictly worse.

**Practical consequence:** open a reference once while online. After that it is exact
offline, forever. In normal use you convert a photo and go straight to tracing it, which
is already an online visit.

> **For T-09/T-10 (overlay + gestures):** read the reference id from
> `window.location.pathname` on the client rather than from the server `params`, and this
> limitation disappears entirely — the served shell becomes id-neutral and any reference
> opens correctly offline. It is a small change while that code is being written and an
> awkward one afterwards.

---

## 4. What the service worker deliberately does not do

Listed because each one looks like an omission and is a decision.

- **It never caches your library.** Photos, line art and settings are IndexedDB records.
  IndexedDB is not a URL and issues no HTTP request, so no service worker can observe it,
  let alone cache or corrupt it. Clearing the cache never costs you a reference.
- **It never touches the camera.** `getUserMedia` is a device API, not a fetch.
- **It never intercepts `blob:` URLs**, which is how every image reaches the screen from
  IndexedDB. This is the exclusion that would black out the trace screen if removed.
- **It never intercepts `Range` requests or anything that is not a GET.**
- **It ignores `/api/`** — Free Trace has no API routes by design (SPEC §2), and the rule
  is there so it never quietly starts caching one.
