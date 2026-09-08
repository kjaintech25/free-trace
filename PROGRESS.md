# PROGRESS.md — per-ticket state, updated by the orchestrator on every change

Board of record: void-tickets project `free-trace` (FTA-xxx). This file mirrors it for a
resumable run. Format per ticket:

```
## T-NN — title
State: TODO | IN PROGRESS | BLOCKED | DONE
Board: FTA-xxx · Model: · Branch: · PR: · Attempts:
Checks: build · typecheck · lint · test · preview
Notes:
```

## Run log
- 2026-09-08 08:26 ET — plan approved by Kush; Batch 0 started.
- 2026-09-08 11:5x ET — T-11 merged into v1 (PR #14). ALL code tickets merged except T-14 (held for memory).
- 2026-09-08 11:4x ET — T-10 merged into v1 (PR #13). T-11 dispatched alone (memory).
- 2026-09-08 11:3x ET — T-12 merged into v1 (PR #12). T-14 builder STOPPED before its browser step on the low-RAM notice (swap 4.4→4.8 GB of 5); FTA-011 BLOCKED on memory clearing; re-run alone later.
- 2026-09-08 11:1x ET — T-09 merged into v1 (PR #11). T-14 + T-10 dispatched in parallel.
- 2026-09-08 10:5x ET — FTA-017 polish (default opacity wired into convert save) merged, PR #10.
- 2026-09-08 10:5x ET — T-13 merged into v1 (PR #9).
- 2026-09-08 10:4x ET — T-07 merged into v1 (PR #8); lane B complete. T-12 pulled forward into the freed slot.
- 2026-09-08 10:3x ET — T-05 merged into v1 (PR #7); lane A complete. T-13 pulled forward into the freed slot.
- 2026-09-08 10:2x ET — T-08 merged into v1 (PR #6).
- 2026-09-08 10:1x ET — T-06 merged into v1 (PR #4).
- 2026-09-08 10:0x ET — T-04 merged into v1 (PR #5).
- 2026-09-08 09:5x ET — T-03 merged into v1 (PR #3). Repo made public + main ruleset; preview auth wall off (Kush's rulings). Third builder (T-08) running.
- 2026-09-08 08:51 ET — T-02 merged into v1 (PR #2). Lanes A and B dispatched in worktrees.
- 2026-09-08 08:41 ET — T-01 merged into v1 (PR #1). Vercel preset fixed (vercel.json). Preview URLs still behind Vercel Authentication — Kush to disable in the dashboard (or allow the orchestrator to).

## T-01 — Project scaffold, theme, fonts
State: DONE
Board: FTA-002 · Model: Sonnet · Branch: t-01-project-scaffold · PR: #1 · Attempts: 1
Checks: build ✅ typecheck ✅ lint ✅ test ✅ preview ✅ (CI green, preview Ready)
Notes: fonts via next/font/google (no new runtime deps); vitest added. Orchestrator added vercel.json.

## T-02 — Design tokens and shared UI primitives
State: DONE
Board: FTA-003 · Model: Sonnet · Branch: t-02-design-primitives · PR: #2 · Attempts: 1
Checks: build ✅ typecheck ✅ lint ✅ test ✅ (9 tests) preview ✅
Notes: components/ui/{Button,IconButton,Slider,Sheet,Card,ConfirmDialog}; /dev/primitives route; jsdom + testing-library as devDeps; vitest.config.ts carries the @/ alias (tsconfig paths are NOT read by vitest).

## T-03 — IndexedDB storage layer
State: DONE
Board: FTA-004 · Model: Opus · Branch: t-03-storage · PR: #3 · Attempts: 1
Checks: build ✅ typecheck ✅ lint ✅ test ✅ (44 tests) preview ✅
Notes: lib/storage.ts, DB `freetrace` v1, StorageResult discriminated union; idb + fake-indexeddb (DECISIONS 7, 8). TRAP: fake-indexeddb silently destroys jsdom Blobs — tests must install Node's Blob as global.

## T-04 — Photo import and thumbnailing
State: DONE
Board: FTA-005 · Model: Sonnet · Branch: t-04-photo-import · PR: #5 · Attempts: 1
Checks: build ✅ typecheck ✅ lint ✅ test ✅ (64 tests) preview ✅
Notes: lib/import.ts (createImageBitmap from-image, 4096px/25MB downscale, 400px thumb), lib/pendingImport.ts hand-off to /convert, components/AddPhotoButton.tsx on /. HEIC + EXIF are iPhone-only evidence.

## T-05 — Library screen
State: DONE
Board: FTA-006 · Model: Sonnet · Branch: t-05-library · PR: #7 · Attempts: 1
Checks: build ✅ typecheck ✅ lint ✅ test ✅ (75 on branch) preview ✅
Notes: components/Library.tsx — 2-col grid, sticky "+ Add photo" bar, ⋯ Sheet with Rename/Re-tune/Delete(ConfirmDialog). Object URLs via useMemo + one cleanup effect. Lane A COMPLETE.

## T-13 — Settings screen (pulled forward from the tail)
State: DONE
Board: FTA-015 · Model: Sonnet · Branch: t-13-settings · PR: #9 · Attempts: 1
Checks: build ✅ typecheck ✅ lint ✅ test ✅ (150 on branch) preview ✅
Notes: lib/preferences.ts (PREF_DEFAULT_OPACITY, PREF_KEEP_AWAKE, readPreferences/writePreference), components/Settings.tsx at /settings, gear on the Library. ⚠️ T-11 must read PREF_KEEP_AWAKE; T-09/T-07 should read PREF_DEFAULT_OPACITY for a NEW reference's initial opacity — carried to those briefs / integration.
## T-06 — Line-art engine
State: DONE
Board: FTA-007 · Model: Opus · Branch: t-06-edge-engine · PR: #4 · Attempts: 1
Checks: build ✅ typecheck ✅ lint ✅ test ✅ (49 + 2 opt-in perf) preview ✅
Notes: lib/edges.ts pure pipeline + ranges; lib/edges.worker.ts + lib/edgesClient.ts (transfers buffers — INPUT IS DETACHED, keep a pristine copy); lib/image.ts downscale (untested, no canvas). 12MP median 239ms in Node (ESTIMATE). DECISIONS row 9.

## T-07 — Convert screen
State: DONE
Board: FTA-008 · Model: Sonnet · Branch: t-07-convert-screen · PR: #8 · Attempts: 1
Checks: build ✅ typecheck ✅ lint ✅ test ✅ (111 on branch) preview ✅
Notes: app/convert/page.tsx — pending-import + ?ref re-tune paths, 4 controls, 120ms debounce, press-and-hold compare (touch-action none), PNG via canvas.toBlob, save → /trace/[id]. Worker chunk confirmed emitted (turbopack-worker-*.js). Lane B COMPLETE.

## T-12 — PWA manifest, icons, offline service worker (pulled forward)
State: DONE
Board: FTA-014 · Model: Opus · Branch: t-12-pwa · PR: #12 · Attempts: 1
Checks: typecheck ✅ lint ✅ test ✅ (182) build ✅ (CI) preview ✅ · offline behaviour UNVERIFIED (no browser) — scripts/offline-check.md
Notes: app/manifest.ts, icons via scripts/make-icons.mjs (no alpha — iOS black-box trap), public/sw.js + RegisterSW, lib/swRouting.ts + source guard, KNOWN_ISSUES.md §1 standalone fallback (manifest.ts:25 display → "browser"). DECISIONS 10, 11. ⚠️ T-11 must make TraceScreen read the id from location.pathname (KNOWN_ISSUES §3).
## T-08 — Camera feed
State: DONE
Board: FTA-009 · Model: Opus · Branch: t-08-camera-feed · PR: #6 · Attempts: 1
Checks: build ✅ typecheck ✅ lint ✅ test ✅ (24 new) preview ✅ · harness screenshot: pending T-14
Notes: lib/camera.ts (ideal→exact fallback, typed failures), components/CameraFeed.tsx (6 states, Start-camera tap, sessionStorage auto-start, stop on unmount/pagehide), app/trace/[id]/page.tsx with <div data-slot="overlay"> at z-10; failure panel + close at z-20. ⚠️ /trace/[id] builds as a DYNAMIC route (ƒ) — T-12's service worker needs a navigation fallback so it works offline.

## T-09 — Overlay and opacity
State: DONE
Board: FTA-010 · Model: Opus · Branch: t-09-overlay · PR: #11 · Attempts: 1
Checks: build ✅ typecheck ✅ lint ✅ test ✅ (167 on branch) preview ✅ · harness screenshot: pending T-14
Notes: lib/overlayTransform.ts (single transform state; clampTransform 0.1–20, ±Infinity → previous), components/TraceOverlay.tsx (img, z-10, invert via CSS filter, data-transform attr), TraceControls.tsx (z-30 pill: opacity slider + lock/flip/invert/close), TraceScreen.tsx (400ms persist debounce). Close button moved from top-right into the bar per §6.3. backdrop-blur-md on the bar is the first thing to drop if the preview stutters.

## T-10 — Gesture layer
State: DONE
Board: FTA-012 · Model: Opus · Branch: t-10-gestures · PR: #13 · Attempts: 1
Checks: typecheck ✅ lint ✅ test ✅ (262) build ✅ (builder + CI) preview ✅ · harness screenshots: pending T-14
Notes: lib/gestures.ts (pure state machine; midpoint-anchored pinch+rotate derived: t = m − R(dθ)·f·(m₀ − t₀); every output via clampTransform), components/useOverlayGestures.ts (pointer capture; touchstart/touchmove/gesturestart/gesturechange non-passive preventDefault), data-locked on the container. Mutation-tested (centre-anchoring fails 8/44). Control bar must stay a SIBLING of the overlay container (z-30).

## T-14 — Verification harness
State: BLOCKED (memory) — attempt 1 stopped before its browser step; re-run ALONE when Kush clears memory
Board: FTA-011 · Model: Opus · Branch: t-14-verification-harness · PR: · Attempts: 0 counted

## T-11 — Wake lock and collapsing chrome (+ keepAwake wiring + KNOWN_ISSUES §3 id-from-location fix)
State: DONE
Board: FTA-013 · Model: Sonnet · Branch: t-11-wake-lock-chrome · PR: #14 · Attempts: 1
Checks: typecheck ✅ lint ✅ test ✅ (318) build ✅ (builder + CI) preview ✅ · harness screenshots: pending T-14
Notes: lib/wakeLock.ts + components/useWakeLock.ts (silent degrade; re-acquire on visibilitychange/pageshow); IDLE_MS 4000 collapse to pill, data-chrome attr, transform/opacity-only 150ms, motion-reduce; keepAwake from readPreferences(); effective id from useParams → location.pathname → prop.
## Tail — T-15 review packet (FTA-016) — TODO

