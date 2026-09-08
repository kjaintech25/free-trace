# Free Trace — Ticket Backlog

Read `SPEC.md` first. Every ticket inherits the Definition of Done in SPEC §12.

**Conventions**
- One ticket → one GitHub issue → one branch → one PR. Never share a branch.
- Branch naming: `t-01-project-scaffold`
- No agent merges to `main`. Ever. Merging is a human action.
- Model column is the **minimum** capable model. An agent may escalate to Opus after two
  failed attempts, and must log the escalation. It may never de-escalate.

**Model routing rationale:** Opus 5 for anything architectural, novel, cross-cutting,
platform-quirky, or where a mistake destroys user data. Sonnet 5 for well-defined work
that follows a pattern already established in the codebase.

---

## Execution lanes

```
        ┌─────────────────────────────────────────┐
        │  T-01 scaffold  →  T-02 design system   │   (serial, blocks everything)
        └─────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
   LANE A (data)      LANE B (line art)    LANE C (camera)
   T-03 storage       T-06 edge engine     T-08 camera feed
   T-04 import        T-07 convert UI      T-09 overlay
   T-05 library                            T-10 gestures
                                           T-11 wake lock + chrome
        └───────────────────┼───────────────────┘
                            │
              T-12 PWA  →  T-13 settings  →  T-14 harness
                            │
                    T-15 human review packet
```

Lanes A, B and C are independent and **should be run in parallel** by separate subagents
once T-02 lands. Within a lane, tickets are strictly serial.

---

## T-01 — Project scaffold, theme, fonts
**Model:** Sonnet 5 · **Depends on:** nothing · **Lane:** root

Initialise Next.js (App Router) + TypeScript strict + Tailwind. Wire Geist and Geist
Mono. Configure the dark-only theme. Set the viewport meta for a full-bleed mobile app
(`viewport-fit=cover`, `user-scalable=no`). Add `npm` scripts: `build`, `typecheck`,
`lint`, `test`. Add Vitest.

**Acceptance criteria**
- [ ] `npm run build`, `typecheck`, `lint`, `test` all exist and exit 0
- [ ] Root page renders on `#0B0B0C` with `#F2F2F0` text in Geist
- [ ] No light-mode styles anywhere in the codebase
- [ ] Safe-area CSS variables are available globally

---

## T-02 — Design tokens and shared UI primitives
**Model:** Sonnet 5 · **Depends on:** T-01 · **Lane:** root

Encode the SPEC §7 palette as Tailwind theme tokens. Build the shared primitives every
later ticket will reuse: `Button`, `IconButton` (circular, 44pt minimum), `Slider`
(amber fill, monospace readout), `Sheet`, `Card`, `ConfirmDialog`.

**Acceptance criteria**
- [ ] Colours are Tailwind tokens (`bg-surface`, `text-muted`, `bg-accent`), never raw hex in components
- [ ] Every interactive primitive has a ≥44×44pt hit area, verified in the component test
- [ ] `Slider` renders its value in Geist Mono and does not reflow as digits change
- [ ] A `/dev/primitives` route renders every primitive in every state for visual review

---

## T-03 — IndexedDB storage layer
**Model:** Opus 5 · **Depends on:** T-02 · **Lane:** A
> Routed to Opus: data layer. A mistake here silently destroys the user's library.

Implement `lib/storage.ts` exactly to the SPEC §5 schema. Typed CRUD for `references`
and `preferences`. Blobs stored natively. Versioned schema with a migration path.

**Acceptance criteria**
- [ ] Full typed API: `saveReference`, `getReference`, `listReferences`, `updateReference`, `deleteReference`, `clearAll`, `getPreference`, `setPreference`
- [ ] Images round-trip as Blobs with no base64 anywhere
- [ ] Quota-exceeded and private-browsing failures surface as typed errors, not throws
- [ ] Unit tests with a fake-indexeddb harness cover every method plus both failure modes
- [ ] No React component imports `idb` directly

---

## T-04 — Photo import and thumbnailing
**Model:** Sonnet 5 · **Depends on:** T-03 · **Lane:** A

System photo picker → read file → correct EXIF orientation → generate a ≤400px
thumbnail → hand off to the convert flow.

**Acceptance criteria**
- [ ] Accepts HEIC, JPEG, PNG from the iOS photo picker
- [ ] Portrait photos shot on an iPhone are not sideways (EXIF handled)
- [ ] Files over ~25MB are downscaled before storage, not rejected
- [ ] Cancelling the picker returns cleanly to the library with no error state

---

## T-05 — Library screen
**Model:** Sonnet 5 · **Depends on:** T-04 · **Lane:** A

The `/` grid per SPEC §6.1.

**Acceptance criteria**
- [ ] 2-column grid, newest first, thumbnails loaded from IndexedDB
- [ ] Empty state with copy and the add action
- [ ] Rename, re-tune, and delete reachable per reference; delete requires confirmation
- [ ] Tapping a card routes to `/trace/[id]`
- [ ] Grid renders 50 references without visible jank

---

## T-06 — Line-art engine
**Model:** Opus 5 · **Depends on:** T-02 · **Lane:** B
> Routed to Opus: the only novel algorithm in the product, and it must be fast, pure,
> and worker-hosted.

Implement `lib/edges.ts` to SPEC §8. Pure function over `ImageData`. Hosted in a Web
Worker. No OpenCV.

**Acceptance criteria**
- [ ] Pure and deterministic: same input plus same settings gives byte-identical output
- [ ] Runs in a Web Worker; the main thread is never blocked more than one frame
- [ ] Under 400ms for a 12MP input on a mid-tier device profile
- [ ] Unit tests: synthetic input produces stable output; extreme slider values do not throw; 1×1 input does not throw
- [ ] Zero new runtime dependencies

---

## T-07 — Convert screen
**Model:** Sonnet 5 · **Depends on:** T-06 · **Lane:** B

The `/convert` UI per SPEC §6.2, driving the T-06 engine.

**Acceptance criteria**
- [ ] Four controls wired: edge strength, threshold, thickness, invert
- [ ] Preview updates within ~150ms of a slider settling
- [ ] Press-and-hold reveals the original photo for comparison
- [ ] Save writes original, line art, thumbnail and settings in one transaction, then routes to `/trace/[id]`
- [ ] Re-opening a saved reference restores its stored slider settings

---

## T-08 — Camera feed
**Model:** Opus 5 · **Depends on:** T-02 · **Lane:** C
> Routed to Opus: first-time platform API with documented iOS landmines (SPEC §10).

Full-bleed live rear camera on `/trace/[id]`.

**Acceptance criteria**
- [ ] `facingMode: { ideal: 'environment' }`, with a handled fallback if the front camera is returned
- [ ] `playsInline`, `muted`, `autoPlay` set; no fullscreen takeover on iOS
- [ ] Permission-denied renders an explanation plus a retry action, never a black screen
- [ ] No-camera-available and stream-ended-unexpectedly are both handled
- [ ] Feed fills the viewport with correct aspect ratio, no letterboxing, no distortion
- [ ] Stream tracks are stopped on unmount — verified by a test

---

## T-09 — Overlay and opacity
**Model:** Opus 5 · **Depends on:** T-08 · **Lane:** C
> Routed to Opus: this is the core rendering architecture the whole app hangs off.

Composite the line art over the feed with a single transform source (per SPEC §11, so a
tracker could later drive it instead of gestures).

**Acceptance criteria**
- [ ] Overlay renders above the video with user-controlled opacity 0–100%
- [ ] Opacity slider shows a monospace percentage and persists to the reference, debounced
- [ ] Overlay transform (x, y, scale, rotation) lives in exactly one state object
- [ ] Invert toggle switches to light lines for dark-room drawing
- [ ] Flip-horizontal toggle works and is independent of rotation
- [ ] Sustains 60fps on a mid-tier device profile with a 4000px source image

---

## T-10 — Gesture layer
**Model:** Opus 5 · **Depends on:** T-09 · **Lane:** C
> Routed to Opus: gesture math is subtly wrong in most implementations, and this is one
> of the three things the human will judge by feel.

Pointer-Events-based drag, pinch-zoom and two-finger rotate on the overlay, plus lock.

**Acceptance criteria**
- [ ] One finger drags; two fingers pinch-zoom and rotate simultaneously
- [ ] Zoom is anchored to the midpoint between the two fingers, not the element centre
- [ ] Safari's native pinch-zoom and double-tap-zoom are suppressed on this screen
- [ ] Lock freezes all transforms; the button shows a clearly engaged amber state
- [ ] Gestures never act on the video layer, only the overlay
- [ ] Rapid gesture input does not produce NaN or unbounded scale; scale is clamped 0.1×–20×

---

## T-11 — Wake lock and control chrome
**Model:** Sonnet 5 · **Depends on:** T-10 · **Lane:** C

Screen Wake Lock plus the collapsing control bar.

**Acceptance criteria**
- [ ] Wake lock acquired on entering Trace, released on leaving
- [ ] Re-acquired on `visibilitychange` after backgrounding
- [ ] Degrades silently where unsupported — no error, no warning toast
- [ ] Control bar collapses to a pill after ~4s idle, restores on tap, with no layout shift

---

## T-12 — PWA manifest, icons, install
**Model:** Opus 5 · **Depends on:** lanes A, B, C complete
> Routed to Opus: deployment configuration with a known iOS trap.

Manifest, icon set, offline service worker.

**Acceptance criteria**
- [ ] Installable to iOS Home Screen with correct name, icon and dark theme colour
- [ ] Service worker caches the app shell; app fully functions offline after first load
- [ ] The service worker never caches IndexedDB or interferes with the camera stream
- [ ] `KNOWN_ISSUES.md` documents the standalone-mode camera fallback (SPEC §10.3) as an
      exact one-line change with a file path and line reference — do not implement it,
      just document it so the human can flip it in ten seconds if needed

---

## T-13 — Settings screen
**Model:** Sonnet 5 · **Depends on:** T-12 · **Lane:** tail

**Acceptance criteria**
- [ ] Default opacity, keep-awake toggle, clear-all-data
- [ ] Clear-all requires a typed or two-step confirmation and actually empties both stores
- [ ] Settings persist to the `preferences` store and are read on app start

---

## T-14 — Headless verification harness
**Model:** Opus 5 · **Depends on:** T-13 · **Lane:** tail
> This ticket is what lets the run verify itself. Prioritise it if time is short.

Playwright driving Chromium with a synthetic camera: launch with
`--use-fake-device-for-media-capture` and `--use-file-for-fake-video-capture` pointed at
a committed test video, so the Trace screen can be exercised without hardware.

**Acceptance criteria**
- [ ] A committed short test video acts as the fake camera feed
- [ ] Automated run loads `/trace/[id]` with a seeded reference and captures screenshots at 0%, 50% and 100% opacity
- [ ] Automated run exercises programmatic drag and pinch and captures before/after screenshots
- [ ] Screenshots are written to `artifacts/` and attached to the PR
- [ ] Harness runs in CI and fails the job if the overlay is absent from the composited frame
- [ ] `README` section explains, in plain English, that this verifies logic only and
      cannot verify iOS Safari behaviour or how the gestures feel

---

## T-15 — Human review packet
**Model:** Orchestrator (Fable) · **Depends on:** everything above

Not a code ticket. The orchestrator compiles the single artifact the human opens.

**Acceptance criteria**
- [ ] `REVIEW.md` at repo root, written in plain English for a non-engineer
- [ ] One Vercel preview URL for the full integrated build
- [ ] The three human gates listed as a numbered checklist with exactly what to do:
      **(1)** open on iPhone, add to Home Screen, confirm the camera appears;
      **(2)** load a reference, pinch/rotate/lock, confirm it feels right;
      **(3)** convert three photos of differing contrast, judge whether the line art is traceable
- [ ] Every deviation from SPEC listed with its rationale, pulled from `DECISIONS.md`
- [ ] Every blocked or descoped ticket listed with the reason
- [ ] Total spend and wall-clock runtime reported
- [ ] Open questions for the human listed as direct questions, not as prose
