# Free Trace — Product Specification

**Status:** v1.0 — authoritative
**Owner:** Kush (human)
**Audience:** Orchestrator agent and all implementation subagents

> This file is the single source of truth. Every agent MUST re-read this file at the
> start of every ticket. If a ticket description and this spec disagree, this spec wins.
> If reality forces a deviation, the agent must record it in `DECISIONS.md` with a
> one-line rationale — never silently diverge.

> **Amendments locked by Kush on 2026-09-08 (these win over anything below):**
> 1. Product name is **Free Trace**; IndexedDB database name is `freetrace`.
> 2. Package manager is **npm** (script names unchanged: `build`, `typecheck`, `lint`, `test`).
> 3. Branch model: PRs target the integration branch `v1`; the orchestrator merges into `v1`;
>    `main` is protected and Kush merges `v1 → main` once at the end.
> 4. Spend control is attempts (max 3 per ticket, Sonnet→Opus escalation after 2) plus a token
>    log on the board, not dollar caps.
> 5. T-14 (verification harness) runs inside lane C directly after T-09, so §12 item 7 is
>    satisfiable for T-10 and T-11; T-08/T-09 attach harness screenshots at integration.
> 6. Max 2 concurrent builders. No dev servers on the build machine; verification is
>    `npm run build` + the Vercel preview.

---

## 1. What we are building

Free Trace is a **personal** install-to-homescreen web app that turns an iPhone into a
lightbox for tracing onto real paper.

The user imports a photo, converts it to clean line art on-device using image filters,
then floats that line art at adjustable opacity over the live rear-camera feed. The
phone sits in an overhead stand above a sheet of paper. The user traces what they see.

**Single user.** No accounts, no sharing, no analytics, no ads, no paywalls.
**Fully local.** No photo ever leaves the device. There is no server-side storage.

## 2. Non-goals for v1

Explicitly OUT of scope. Do not build these. Do not "helpfully" add them.

- User accounts, auth, login of any kind
- Any backend, database, or cloud storage (no Supabase, no API routes that persist data)
- Payments, subscriptions, tiers, or usage limits
- Template/stock image library
- Drawing lessons, courses, tutorials, gamification, streaks
- Social features, sharing, export to social
- Cloud/AI image generation or any outbound API call with user images
- Marker-based AR tracking (parked as Phase 2 — see §11)
- Android or desktop optimisation (must not crash there, but is not the target)
- Analytics, telemetry, crash reporting, cookie banners

## 3. Target environment

| Attribute | Value |
|---|---|
| Primary device | iPhone, iOS Safari, portrait orientation |
| Delivery | PWA, added to Home Screen |
| Hosting | Vercel (HTTPS is mandatory — camera APIs refuse insecure origins) |
| Secondary | Must not visibly break in desktop Chrome (used for agent verification) |
| Offline | Must fully function offline after first load |

## 4. Tech stack — fixed

- **Next.js (App Router)** + **TypeScript** (strict mode on)
- **Tailwind CSS**
- **IndexedDB** for all persistence (via a thin typed wrapper; `idb` package permitted)
- **No state management library.** React state and context only.
- **No component library.** Hand-rolled components with Tailwind.
- **No image-processing library for the core path.** The edge detection runs on raw
  canvas pixel data. `opencv.js` is explicitly forbidden for v1 — it is a multi-megabyte
  WebAssembly payload and defeats the offline/instant requirement.

Any additional dependency requires a line in `DECISIONS.md` justifying it.

## 5. Data model

All persistence is IndexedDB. Database name `freetrace`, version 1.

**Object store: `references`** (keyPath: `id`)

| Field | Type | Notes |
|---|---|---|
| `id` | string | crypto.randomUUID() |
| `name` | string | User-editable label, defaults to "Untitled" |
| `originalImage` | Blob | The imported photo, as imported |
| `lineArtImage` | Blob | PNG of the converted line art — this is what gets traced |
| `thumbnail` | Blob | Small JPEG for the library grid (max 400px long edge) |
| `settings` | object | `{ edgeStrength, threshold, thickness, inverted }` — so a reference can be re-tuned later |
| `lastOpacity` | number | 0–100, remembers the trace-screen slider position |
| `createdAt` | number | Date.now() |

**Object store: `preferences`** (keyPath: `key`) — simple key/value for app settings.

Rules:
- Blobs are stored directly. Never base64-encode images into IndexedDB.
- All storage access goes through `lib/storage.ts`. No component touches IndexedDB directly.
- Every read/write must handle quota-exceeded and private-browsing failures gracefully
  with a user-visible message, never a silent failure or an unhandled rejection.

## 6. Screens

### 6.1 Library — `/` (home)
Grid of saved references as thumbnails, 2 columns, newest first.
- Prominent "+ Add photo" action (opens the system photo picker)
- Tap a card → navigate to `/trace/[id]`
- Long-press (or an overflow button) → rename, re-tune, delete
- Empty state: short line of copy plus the add button. No illustration required.

### 6.2 Convert — `/convert`
Reached after picking a photo. Turns that photo into traceable line art.
- Live preview of the line art, large, on the dark background
- A compare affordance (press-and-hold to see the original)
- Four controls: **Edge strength**, **Threshold**, **Line thickness**, **Invert**
- Preview must update within ~150ms of a slider settling on a mid-size image
- "Save to library" → writes the reference and navigates to `/trace/[id]`

### 6.3 Trace — `/trace/[id]` — **the screen that matters**
- Full-bleed live rear-camera feed
- Line art composited over it at user-controlled opacity
- Floating control bar in the bottom third: opacity slider with a monospace % readout,
  plus circular buttons for **lock**, **flip horizontal**, **invert**, **close**
- Gestures on the overlay only: one finger drag, two-finger pinch-zoom and rotate
- **Lock** freezes all overlay transforms so the image cannot be nudged mid-drawing
- Screen wake lock active while this screen is open
- Controls collapse to a single small pill after ~4s of no interaction; tap to restore
- Opacity persists back to the reference record on change (debounced)

### 6.4 Settings — `/settings`
Default opacity, keep-screen-awake toggle, "clear all data" with a confirm step.

## 7. Design system — non-negotiable

**Vibe:** dark, quiet, instrument-like.

| Token | Hex | Usage |
|---|---|---|
| `bg` | `#0B0B0C` | App background. Near-black so screen glare doesn't wash out the paper. |
| `surface` | `#1A1A1D` | Control bars, cards, sheets |
| `accent` | `#E8A33D` | Active slider fill, engaged lock state, primary actions |
| `text` | `#F2F2F0` | Primary text |
| `textMuted` | `#87878C` | Secondary/inactive text |

- **Fonts:** Geist for text, Geist Mono for all numeric readouts (opacity %, zoom %).
  Monospace numerals stop the readout jittering as values change.
- **Dark mode only.** No light theme. A bright UI over paper is physically unpleasant
  and reflects into the drawing. Do not add a theme toggle.
- **Radius:** 12px on cards and sheets; fully rounded on control pills and buttons.
- **iOS:** respect safe-area insets and the Dynamic Island. Disable pull-to-refresh,
  double-tap zoom, text selection, and the long-press callout on the trace screen.
- **One-thumb rule:** every interactive element on the Trace screen must be reachable
  by one thumb and be at least 44×44pt. The user's other hand is holding a pencil.
- The UI must never compete with the reference image: translucent, dark, low-contrast,
  except the single active control.

## 8. The line-art engine

This is the only genuinely novel logic in the app. It lives in `lib/edges.ts` and is a
pure function over pixel data with **no DOM dependency**, so it is unit-testable.

Pipeline: load into an offscreen canvas → downscale if the long edge exceeds 2000px →
greyscale → light blur to suppress sensor noise → Sobel gradient magnitude →
threshold to binary → optional dilation for line thickness → optional inversion →
output PNG blob.

Requirements:
- Pure, deterministic, synchronous over an `ImageData` input
- Runs in a Web Worker so the slider UI never blocks
- Unit tests covering: a known synthetic input produces stable known output; extreme
  slider values do not throw; a 1×1 image does not throw
- Target: under 400ms for a 12MP photo on a modern iPhone

Explicit acknowledgement for agents: this is **classical image processing, not AI.**
Do not substitute a model call. The offline and privacy requirements depend on this.

## 9. Quality bar

- TypeScript strict; no `any` in committed code without an inline justification comment
- No `console.log` in committed code (`console.error` in catch blocks is fine)
- Every async operation that can fail has a user-visible failure path
- Permission denial (camera, storage) shows a clear explanation and a recovery action,
  never a blank screen
- No layout shift when the control bar collapses or expands

## 10. Known platform hazards — read before implementing

1. **Camera requires HTTPS.** Vercel preview URLs satisfy this. `file://` and plain
   `http://` will not work. Do not waste cycles debugging this.
2. **Rear camera:** request `facingMode: { ideal: 'environment' }`. Handle the case
   where the request resolves to the front camera anyway.
3. **iOS standalone-mode camera bug.** Safari has a long history of breaking
   `getUserMedia` specifically when a web app launches from the Home Screen in
   standalone display mode. Mitigation is built into ticket T-12: the manifest work
   must include a documented single-line fallback that makes the app open in Safari
   from the Home Screen icon instead. Do not attempt a clever workaround.
4. **Autoplay:** the video element needs `playsInline`, `muted`, and `autoPlay`, and
   the stream must be attached after a user gesture where possible.
5. **Wake Lock** is supported in recent Safari but must be re-acquired after the tab is
   backgrounded and restored. Implement the `visibilitychange` re-acquire, and degrade
   silently where unsupported.
6. **Gestures:** use Pointer Events, not Touch Events, and call `preventDefault` on the
   overlay container to stop Safari's own pinch-zoom hijacking the gesture.

## 11. Phase 2 — parked, do not build

Marker-based tracking: a printed marker taped beside the paper, detected each camera
frame, so the overlay stays anchored to the paper as the phone moves. Deliberately
deferred until the human has used v1 for a week and confirmed drift is actually a
problem in practice. Architect the overlay so its transform comes from a single source
that could later be driven by a tracker instead of by gestures — but build nothing else
toward it.

## 12. Definition of Done — applies to every ticket

A ticket is only "done" when ALL of the following are machine-verified:

1. `npm run build` exits 0
2. `npm run typecheck` exits 0
3. `npm run lint` exits 0
4. `npm run test` exits 0 (where the ticket specifies tests)
5. A Vercel preview deployment for the PR is in a **Ready** state
6. The ticket's own acceptance criteria are each individually checked off in the PR body
7. For any ticket touching the Trace screen: the headless verification harness (T-14)
   produces a screenshot artifact, and that artifact is attached to the PR

Prose claims of completion are not evidence. If a check cannot be run, the ticket is
**blocked**, not done.
