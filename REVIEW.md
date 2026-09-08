# Free Trace — review packet for Kush

**Status: FINAL (2026-09-08, 11:50 ET).** All 15 tickets plus your two review requests are
merged into `v1`. Your phone review at ~12:30 passed all three gates (camera, gestures,
import → convert → save). The two things you asked for after it are in: **back / start-over at
every step** and **flip camera**. The automated test rig also ran green on every pull request
since.

## 1. What you have to do (about 20 minutes)

**Open this on your iPhone, in Safari:**
https://free-trace-git-v1-kush-jains-projects-6ce34c15.vercel.app

Put the phone in the overhead stand above a sheet of paper.

1. **Install and camera.** Share → *Add to Home Screen*. Open it from the icon. Tap
   *Start camera*, allow the permission. You should see the live rear camera.
   → If the screen is black or the camera never appears from the Home Screen icon, that is
   the known iPhone standalone bug. The ten-second fix is in `KNOWN_ISSUES.md` §1:
   change `display: "standalone"` to `display: "browser"` on line 25 of `app/manifest.ts`.
   Tell me and I'll flip it.
2. **Gestures.** Tap *+ Add photo*, pick any photo, tap *Save to library*. On the trace
   screen: one finger drags the line art, two fingers pinch and rotate, the lock button
   freezes it. Wait four seconds without touching: the controls shrink to a pill; tap it to
   bring them back. Does it feel right? Does the paper stay put under your pencil?
3. **Is the line art traceable?** Convert three photos of different character: a building,
   a face, something soft (a pet, a plant). Use the four controls and the press-and-hold
   compare. Would you actually trace these?

You already did these three once. What is NEW since then, worth a two-minute re-check:
- **Back** (top-left) on the convert screen; **Choose a different photo** there swaps the
  photo in place; a **Re-tune** button in the trace bar goes back one step.
- **Flip camera** in the trace bar. Front view is mirrored; your choice is remembered.

**Merge link (v1 → main):** https://github.com/kjaintech25/free-trace/pull/15 — one click
makes this the production build.

## 2. What is verified, and what only you can verify

Every ticket passed the four automated checks (build, types, lint, tests) on the builder's
machine, on my machine, and in GitHub's CI, and produced a working Vercel preview.
340 automated tests pass on the merged branch, plus 7 browser tests in the rig that prove the
line art really is drawn over the camera feed (and that the check fails when it is hidden),
and exercise drag, pinch, lock, flip, invert and the collapsing controls. Screenshots are in
`artifacts-t14/` next to the repo and on every CI run.

**Verified by you on the iPhone (12:30):** camera appears, overlay + gestures work, opacity
and flip work, import → convert → save works.

Still unverified (new since your check, or never checkable here):
- The two new features on the phone (back/start-over, camera flip and its mirror).
- Standalone (Home Screen icon) mode specifically, if you tested in the Safari tab.
- HEIC photos and portrait orientation on more than one photo.
- Whether the screen actually stays awake for a long session.
- Offline after first load (steps in `scripts/offline-check.md`).
- How the line art looks on real photos. Conversion speed on the phone (on the Mac a
  12-megapixel photo converts in about a quarter of a second, ESTIMATE only).
- The icon at Home Screen size (amber outline square with a diagonal stroke on near-black).

## 3. Where we deviated from the spec (all recorded in DECISIONS.md)

| # | What the spec said | What we did | Why |
|---|---|---|---|
| 1 | Name "TracePaper" | "Free Trace" | Your ruling |
| 2 | pnpm | npm | pnpm is not installed; every other repo uses npm |
| 3 | You merge every PR | Agents PR into `v1`, I merge; you merge once | Your ruling |
| 4 | Dollar caps | Attempt caps + token log on the board | Not enforceable per call |
| 5 | Test rig last | Test rig inside the camera lane | The spec's own finish rule needed it earlier |
| 6 | 3–4 agents at once | Max 2, later 3 on your ask, then 1 when memory ran low | 8 GB Mac |
| 7 | `idb` permitted | Added `idb` (tiny promise wrapper) | Typed storage end to end |
| 8 | (none) | `fake-indexeddb` for tests only | jsdom has no IndexedDB |
| 9 | Engine outputs PNG | Engine outputs pixels; PNG made at save time | Keeps the engine pure and worker-friendly |
| 10 | (unspecified) | Service-worker cache keyed on the deploy's commit id | Never needs a manual bump |
| 11 | Fully offline | Any reference you've opened online works offline; a never-opened one falls back to a generic trace shell | The trace page is rendered per id on the server |

Smaller calls builders made and I accepted: the close button lives in the bottom control bar
(spec §6.3 lists it there); the confirm dialog's destructive button uses the accent colour
because the palette has no red; new references start at your Settings default opacity.

## 4. Blocked or descoped

- Nothing blocked. Nothing descoped. Marker tracking (Phase 2) was never in scope.
- Two extra decisions the rig forced: `@playwright/test` as a test-only dependency (row 12),
  and the fake camera is fed by a small shim because Chrome on the Mac ignored its own
  fake-camera switch and would have used your real webcam (row 13).

## 5. Runtime and cost

- Wall clock: plan approved 08:26 ET, last feature merged 11:49 ET (3 h 23 min), including
  your phone review in the middle.
- 18 builder runs across 17 tickets: all first attempt, zero escalations, one reviewer-
  requested second round (the swapped-photo save case). One run was stopped early for
  memory and re-run later.
- Builder tokens logged on the board: ~2.56M combined (subagents only; my own orchestration
  is not in that figure). Per-run rows are on each FTA ticket.

## 6. Questions for you

1. **White background.** The line art is black lines on a white sheet, so at 100% opacity it
   hides the paper and at 50% you see both half-strength. Would you prefer only the black
   lines floating over the paper (white made transparent)? Small engine change if yes.
2. Camera flip: does the phone hand over the camera you expect by default, and does the
   mirrored front view feel right?
3. Line art: of the photos you converted, which was worst, and what was wrong (noise, missing
   edges, too thick)?
4. Is the amber-outline icon fine, or do you want a different mark?
5. After a week of tracing: does the overlay drifting when the phone moves actually bother
   you? (That is the only question that decides whether Phase 2 marker tracking is worth it.)
