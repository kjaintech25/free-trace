# Offline check — how to prove the PWA actually works with the radio off

**Why this file exists.** T-12 was built without a browser: no dev server, no device.
Everything about the manifest, the routing rules and the icon bytes is covered by the
test suite, but **"the app fully functions offline" cannot be verified by a test suite.**
A service worker needs a real browser to install into. So that acceptance criterion is
**UNVERIFIED** until somebody runs the steps below. Ten minutes, no tooling.

Run this against a **deployed HTTPS URL** (the Vercel preview for the PR, or production).
It will not work on `localhost` over plain http, and the service worker is deliberately
disabled outside a production build anyway — see `components/RegisterSW.tsx`.

---

## A. Desktop Chrome — the fast check (≈5 minutes)

### 1. Confirm the worker installed

1. Open the preview URL.
2. **DevTools → Application → Service Workers.**
3. Expect one entry, source `sw.js?v=<something>`, status **activated and is running**.

If nothing is listed: you are on a preview that did not build, or on `localhost`.

### 2. Confirm the shell was precached

**Application → Cache Storage** → open `free-trace-<build id>`. Expect to see, at minimum:

```
/                      /convert                /settings
/manifest.webmanifest  /__offline              /apple-touch-icon.png
/icons/icon-192.png    /icons/icon-512.png     /icons/icon-512-maskable.png
```

…plus a number of `/_next/static/...` entries. **Those matter most** — they are the
JavaScript, the fonts and the line-art Web Worker. Without them the app would paint
offline and then not respond to a single tap.

> ⚠️ **`/settings` will be missing on the T-12 branch preview.** That screen is built in
> another lane (T-13) and does not exist here yet. The precache deliberately tolerates a
> 404 per URL rather than failing the whole install, so its absence is expected until
> T-13 is merged — every other entry above should be present.

### 3. Go offline and use the app

1. Still in **Application → Service Workers**, tick **Offline**.
   (Use this, not the Network tab's throttling dropdown — it is the one that makes
   navigations fail the way a real dead connection does.)
2. **Hard-reload the page.** Expect: the library screen paints normally, dark, with your
   references and their thumbnails. Thumbnails come from IndexedDB and are unaffected by
   the network.
3. Navigate to **Convert** and to **Settings**. Expect both to render.
4. Open a reference you have opened before. Expect the trace screen, its controls, and a
   camera-permission state — the camera itself needs no network.
5. **Import a photo and convert it while still offline.** This is the real test: the
   conversion runs in a Web Worker loaded from `/_next/static`. If that chunk was not
   cached, the sliders will do nothing. It should work exactly as it does online.
6. Untick **Offline** and reload once, to leave the browser in a clean state.

### 4. Confirm the manifest is being served

**Application → Manifest.** Expect name **Free Trace**, theme and background `#0B0B0C`,
display **standalone**, orientation **portrait**, and three icons that render as artwork
(a thin amber square with a diagonal stroke) rather than as broken-image boxes.

---

## B. iPhone — the only check that counts (≈5 minutes)

Chrome cannot tell you anything about iOS Safari. **Sections 1–3 below are the three
things that have historically broken, and only hardware can answer them.**

### 1. Install it

1. Open the preview URL in **Safari** (not Chrome — iOS only installs from Safari).
2. **Share → Add to Home Screen.**
3. Before confirming, check the sheet shows the name **Free Trace** and the amber-square
   icon on a near-black tile. A generic grey page-screenshot icon means the
   `apple-touch-icon` is not being served.

### 2. 🔴 Open it from the icon and look at the camera

Tap the Home Screen icon and open any reference.

- **Camera feed appears** → the standalone bug is not present on your iOS. Done.
- **Camera is black** → this is SPEC §10.3, it is expected to be possible, and the fix is
  one word. Go to **`KNOWN_ISSUES.md` §1** and change `app/manifest.ts` line 25 from
  `"standalone"` to `"browser"`. Delete and re-add the Home Screen icon afterwards —
  iOS caches the manifest at install time.

Also confirm the status bar sits **transparently over** the camera feed rather than as a
black strip, and that the app fills the screen under the Dynamic Island.

### 3. Now put the phone in Airplane Mode

With the app installed and having been opened at least once:

1. Turn on **Airplane Mode**.
2. Force-quit Free Trace (swipe up from the app switcher).
3. Open it from the Home Screen icon again.

Expect: the library, your saved references, convert, and tracing — all working, with no
error and no browser "you are offline" page. Import and convert a photo to be sure.

Turn Airplane Mode back off when you are done.

---

## What a failure looks like, and what it means

| What you see | What it means |
|---|---|
| Dark "Offline" page with *"This screen has not been opened on this device yet"* | The worker is alive and doing its job; that specific route was never cached. Open it once online. |
| Browser's own "No internet" error page | The worker is **not** installed or not controlling the page. Re-check step A1. |
| App paints but nothing responds to taps | The `/_next/static` chunks were not cached. Check A2 for those entries. |
| A reference opens showing the **wrong** image, offline only | Known and documented — `KNOWN_ISSUES.md` §3. Open that reference once online. |
| You changed something and still see the old version | Expected once after a deploy — `KNOWN_ISSUES.md` §2. Open it a second time. |
