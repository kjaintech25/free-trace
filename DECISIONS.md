# DECISIONS.md — every deviation from docs/SPEC.md, one line each, with rationale

| # | Date | Ticket | Spec said | We did | Why |
|---|---|---|---|---|---|
| 1 | 2026-09-08 | setup | Product "TracePaper", DB `tracepaper` | "Free Trace", DB `freetrace` | Kush's ruling; matches the folder and the request. Nothing to migrate in v1. |
| 2 | 2026-09-08 | setup | `pnpm` | `npm` | pnpm is not installed on the build machine; every other repo uses npm. Script names unchanged. |
| 3 | 2026-09-08 | setup | Agents never merge; human merges every PR | Agents PR into `v1`; orchestrator merges into `v1`; Kush merges `v1 → main` once | Kush's ruling: he wants to see the final product, not 14 PRs. `main` stays protected. |
| 4 | 2026-09-08 | setup | Dollar caps per ticket/run | Max 3 attempts per ticket + token log on the board | Subagent spend is not metered per call in this harness. |
| 5 | 2026-09-08 | setup | T-14 after T-13 | T-14 inside lane C after T-09 | §12 item 7 needs the harness for T-10/T-11; as written it could not be satisfied. |
| 6 | 2026-09-08 | setup | 3–4 concurrent subagents | Max 2, each in its own worktree | 8 GB build machine; three `next build`s at once has frozen it before. |
| 7 | 2026-09-08 | T-03 | `idb` package permitted (§4) | Added `idb` ^8.0.3 as a runtime dependency | Raw IndexedDB is callback-and-event based; `idb` is a ~1.5KB promise wrapper with real generic types, so `lib/storage.ts` can be typed end to end instead of casting every request. Nothing else in the app imports it. |
| 8 | 2026-09-08 | T-03 | Silent on a test harness for IndexedDB | Added `fake-indexeddb` ^6.2.5 as a devDependency | §12.4 requires the storage tests to pass and jsdom ships no IndexedDB at all, so there is nothing to test against without it. devDependency only — never in the shipped bundle. |
| 9 | 2026-09-08 | T-06 | §8 pipeline ends "output PNG blob" | `renderLineArt` returns RGBA pixels; PNG encoding happens where the reference is saved (T-07) | Keeps the engine pure and DOM-free (canvas is needed to encode PNG); the worker transfers raw buffers. Recorded by the orchestrator on the builder's flag. |
| 10 | 2026-09-08 | T-12 | (unspecified) SW cache versioning | Cache name and `sw.js?v=<id>` keyed on NEXT_PUBLIC_BUILD_ID = VERCEL_GIT_COMMIT_SHA (12 chars) or a local timestamp, inlined by next.config.ts | A hand-bumped constant is forgotten; a build id changes on every deploy by construction. Old caches dropped on activate; skipWaiting + clients.claim. |
| 11 | 2026-09-08 | T-12 | §3 "fully function offline" for the dynamic /trace/[id] | Navigation fallback: every /trace/<id> opened online is cached under its own URL; a never-opened id falls back to `/trace/__any` (the first cached trace HTML) | The route is server-rendered per id, so a first-ever-offline open of a NEW id can paint the wrong reference id until the client reads the id from location (KNOWN_ISSUES §3; fix scheduled with T-11). Every previously opened reference works offline. |
