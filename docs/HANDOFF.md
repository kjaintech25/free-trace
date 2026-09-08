# Free Trace — Handoff Notes (for Kush)

Four files. Give the orchestrator all four; it reads them cold.

| File | What it is |
|---|---|
| `SPEC.md` | The product. Source of truth every agent re-reads each ticket. |
| `TICKETS.md` | 15 tickets with acceptance criteria, model routing, dependency lanes. |
| `ORCHESTRATOR.md` | The orchestrator's operating rules, guardrails, spend caps, stop conditions. |
| `HANDOFF.md` | This file — yours, not theirs. |

---

## Before you start the run

1. **Create the GitHub repo.** Empty is fine. Give the agent push access and permission
   to open issues and PRs.
2. **Create the Vercel project and link it to the repo.** Turn preview deployments on.
   This matters more than it sounds: every PR gets its own live HTTPS address, and
   HTTPS is the only way the camera will work on your phone. Those preview URLs are
   your entire review surface at the end.
3. **Protect `main`.** Require a PR, block direct pushes. This is the safety rail that
   makes it genuinely safe to walk away — the worst an agent can do is open a bad PR.
4. **Set the spend caps** in `ORCHESTRATOR.md`. The defaults are a guess. Pick numbers
   you'd be relaxed about losing.
5. **Buy an overhead phone stand** if you haven't. About $20. The app is only as good
   as the thing holding the phone still, and you'll need it to review properly.

---

## What to expect

Twelve of the fifteen tickets should complete without you. The three that can't aren't
code problems — they're that nobody can hold your iPhone over a sheet of paper except
you.

When you come back, you open `REVIEW.md`. It should tell you three things to do, in
order, with one preview URL:

1. Open it on your iPhone, add to Home Screen, confirm the camera comes up.
   → If it's black, `KNOWN_ISSUES.md` has the exact one-line fix. Ten seconds.
2. Load a reference, pinch it, rotate it, lock it. Does it feel right?
3. Convert three photos of very different contrast — a building, a portrait, something
   soft and fluffy. Is the line art traceable?

Then you merge, or you file follow-ups.

---

## Realistic expectations

- **Assume one failed run.** Long unattended orchestration is still flaky. The
  guardrails in `ORCHESTRATOR.md` (write state to disk, block on subagents, halt at 80%
  spend) exist so a failure costs you a restart rather than the whole budget.
- **Read `DECISIONS.md` before `REVIEW.md`.** That's where the agent recorded where it
  deviated from spec. It's the highest-value five minutes of your review.
- **Blocked tickets are a good sign, not a bad one.** The orchestrator is instructed to
  stop rather than guess. A run reporting "T-10 blocked, couldn't verify" is more
  useful than one claiming everything passed.
- **Resist scope creep on the way back in.** SPEC §2 lists what we're deliberately not
  building. Marker tracking is parked until you've drawn with v1 for a week and can say
  whether drift actually bothers you in practice.

---

## If you want to keep it smaller

If the run feels too big to leave alone the first time, cut it in half: run T-01 through
T-05 only. That gets you a working library and storage layer with no camera code, which
is the safest possible test of whether your orchestrator setup actually holds together
overnight. Then hand it lanes B and C on a second run once you trust it.
