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
- 2026-09-08 08:41 ET — T-01 merged into v1 (PR #1). Vercel preset fixed (vercel.json). Preview URLs still behind Vercel Authentication — Kush to disable in the dashboard (or allow the orchestrator to).

## T-01 — Project scaffold, theme, fonts
State: DONE
Board: FTA-002 · Model: Sonnet · Branch: t-01-project-scaffold · PR: #1 · Attempts: 1
Checks: build ✅ typecheck ✅ lint ✅ test ✅ preview ✅ (CI green, preview Ready)
Notes: fonts via next/font/google (no new runtime deps); vitest added. Orchestrator added vercel.json.

## T-02 — Design tokens and shared UI primitives
State: TODO
Board: FTA-003 · Model: Sonnet · Branch: t-02-design-primitives · PR: · Attempts: 0

## Lane A — T-03 storage (FTA-004) · T-04 import (FTA-005) · T-05 library (FTA-006) — TODO
## Lane B — T-06 edge engine (FTA-007) · T-07 convert (FTA-008) — TODO
## Lane C — T-08 camera (FTA-009) · T-09 overlay (FTA-010) · T-14 harness (FTA-011) · T-10 gestures (FTA-012) · T-11 wake lock (FTA-013) — TODO
## Tail — T-12 PWA (FTA-014) · T-13 settings (FTA-015) · T-15 review packet (FTA-016) — TODO

