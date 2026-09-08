# Free Trace — review packet for Kush

**Status: DRAFT (2026-09-08, ~12:00 ET).** Every screen is built and merged into `v1`. One
ticket is still outstanding: the automated test rig (T-14), held because the Mac was low on
memory. It does not change what you review; it adds screenshots and a CI job. This file is
updated when it lands.

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

Then either merge the pull request below, or tell me what to fix.

**Merge link (v1 → main):** see the PR named "Free Trace v1" in the repo. Merging it makes
this the production build at the project's Vercel domain.

## 2. What is verified, and what only you can verify

Every ticket passed the four automated checks (build, types, lint, tests) on the builder's
machine, on my machine, and in GitHub's CI, and produced a working Vercel preview.
318 automated tests pass on the merged branch.

Nobody has seen the app on a real iPhone. Specifically unverified until you try it:
- Camera on iOS Safari, permission prompt, standalone (Home Screen) mode.
- HEIC photos from the camera roll and portrait-photo orientation.
- How gestures feel, and whether Safari's own pinch-zoom stays out of the way.
- Whether the screen actually stays awake.
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

- **T-14 test rig** — held on memory (swap was near full). It re-runs alone when you say
  memory is fine. Nothing else waits on it.
- Nothing was descoped. Marker tracking (Phase 2) was never in scope.

## 5. Runtime and cost

- Wall clock: plan approved 08:26 ET, last code ticket merged 11:55 ET (about 3.5 hours).
- 14 builder runs, all first attempt, zero escalations, zero review bounces.
- Builder tokens logged on the board: ~1.85M combined (input+output, subagents only;
  my own orchestration is not in that figure). Per-run rows are on each FTA ticket.

## 6. Questions for you

1. Camera from the Home Screen icon: does it appear, or is it black?
2. Gestures: does anything drift, jump, or fight the phone's own zoom?
3. Line art: which of the three photos was worst, and what was wrong with it (too much
   noise, missing edges, too thick)?
4. Is the amber-outline icon fine, or do you want a different mark?
5. After a week of tracing: does the overlay drifting when the phone moves actually bother
   you? (That is the only question that decides whether Phase 2 marker tracking is worth it.)
