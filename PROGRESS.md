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

## Lane A — T-05 library (FTA-006) IN PROGRESS
## Lane B — T-06 edge engine (FTA-007) · T-07 convert (FTA-008) — TODO
## Lane C — T-08 camera (FTA-009) · T-09 overlay (FTA-010) · T-14 harness (FTA-011) · T-10 gestures (FTA-012) · T-11 wake lock (FTA-013) — TODO
## Tail — T-12 PWA (FTA-014) · T-13 settings (FTA-015) · T-15 review packet (FTA-016) — TODO

