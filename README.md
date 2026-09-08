# Free Trace

Personal iPhone web app: import a photo, convert it to line art on-device, float it over the
live camera at adjustable opacity, trace onto real paper. No accounts, no server, nothing leaves
the phone.

- `docs/SPEC.md` — the product, source of truth (re-read before every ticket)
- `docs/TICKETS.md` — backlog with acceptance criteria and lanes
- `docs/ORCHESTRATOR.md` — how the build run is supervised
- `DECISIONS.md` — every deviation from the spec · `KNOWN_ISSUES.md` · `PROGRESS.md`

## What the test rig proves, and what it cannot

`npm run test:e2e` drives the real Trace screen in a real browser and takes
screenshots of it. It is the closest thing this project has to an automated
pair of eyes, and it is genuinely useful — but it is a desktop browser wearing
a phone-sized window, and it is important to know what that does not cover.

**What it actually does.** It builds the app for production, serves it, writes
one fake reference (a black cross on white) straight into the browser's
database, opens `/trace/<that id>`, and plays a small committed video file into
the page as if it were the camera. Then it works the screen: it moves the
opacity slider to 0%, 50% and 100%, drags the overlay, pinches it to zoom and
rotate, locks it, flips it, inverts it, and waits for the control bar to
collapse. Screenshots of each step land in `artifacts/`.

**The one check that really matters.** It counts the dark pixels in the
100%-opacity screenshot and in the 0% one. If the line art is genuinely being
painted over the camera, the 100% picture has tens of thousands more dark
pixels than the 0% one. If it doesn't, the run fails and so does CI. This is
deliberately a check on the finished picture rather than on the code, because
the failure everyone fears here — "the overlay is in the page but you can't see
it" — is invisible to any test that only asks whether the element exists. The
suite also contains the opposite experiment: it hides the overlay on purpose
and confirms the check *rejects* that frame, so the check is known to be able
to fail and not just to pass.

**What it cannot tell you.** These three are the human's job, and no amount of
green here substitutes for them:

1. **Whether the camera works on your actual iPhone.** The rig runs desktop
   Chromium on a build machine, and the "camera" is a video file, not a lens.
   Everything specific to iOS Safari — being asked for camera permission, the
   app behaving once it's added to the Home Screen, the video staying inline
   instead of going fullscreen — is untested here. It has to be opened on a
   real phone.
2. **Whether the gestures feel right.** The rig can prove that dragging by 60
   pixels moves the image by exactly 60 pixels, and that a pinch scales it by
   the right amount. It cannot tell you whether that feels natural under your
   fingers, whether the image drifts annoyingly when you pinch near the edge,
   or whether the lock button is where your thumb expects it.
3. **Whether the line art is good enough to trace.** The test image is a
   cartoon cross drawn by the test itself, chosen because it is easy to count.
   Whether a real photo of a real subject converts into lines you can actually
   follow with a pencil is a judgement about the picture, and only a person
   looking at it can make it.

One more caveat worth knowing: the fake camera is fed to the page by the test
harness rather than by the browser's own camera plumbing, because Chrome on
macOS ignores the command-line switch that is supposed to do this and hands
back the machine's real webcam instead. So the permission prompt and the
browser's capture pipeline are not exercised end to end by this rig either.
The logic underneath them — asking for the rear camera, retrying, and handling
a refusal — is covered by the unit tests in `npm test` instead.
