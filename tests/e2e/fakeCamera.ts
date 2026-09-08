/**
 * tests/e2e/fakeCamera.ts — makes the committed test video the camera feed.
 *
 * ── Why this file exists instead of just the Chromium flags ────────────────
 * playwright.config.ts launches with the three switches the ticket asks for:
 *   --use-fake-device-for-media-capture
 *   --use-fake-ui-for-media-capture
 *   --use-file-for-fake-video-capture=<fixtures/fake-camera.y4m>
 *
 * MEASURED on this machine, 2026-09-08, Playwright 1.63 / Chrome for Testing
 * 1243, macOS 15 arm64 — all three switches are present on the browser's own
 * command line (read back from chrome://version) and Chrome IGNORES the fake
 * device entirely. `getUserMedia` and `enumerateDevices` both return the real
 * hardware, "FaceTime HD Camera (C4E1:9BFB)". That held with the switches
 * alone, with --disable-features=MojoVideoCapture, and in every combination
 * tried. Playwright's DEFAULT browser (chromium_headless_shell) is worse
 * still: it has no media capture stack at all and rejects getUserMedia with
 * NotSupportedError.
 *
 * Two consequences made shimming the right call rather than a shortcut:
 *
 *  1. **Correctness of the gate.** The overlay gate in trace.spec.ts counts
 *     near-black pixels in a screenshot. A real webcam pointed at a room is
 *     dark and never twice the same, so the 0%-opacity baseline would be both
 *     large and non-deterministic — the gate would be measuring the room.
 *  2. **The screenshots get attached to a PR.** Frames from the real camera
 *     are a photo of wherever the machine is sitting. That must not be
 *     committed or uploaded, ever.
 *
 * So the switches stay in the config (they are correct, they cost nothing, and
 * on a Linux CI runner they are what stops any permission UI appearing), and
 * the frames themselves come from here — decoded from the SAME committed .y4m
 * the switches point at, so there is exactly one fixture and it is the feed.
 *
 * What this trades away, stated plainly: the browser's real capture pipeline
 * and its permission prompt are not exercised. `lib/camera.ts` already covers
 * that half — constraint fallback, facingMode retry and every getUserMedia
 * rejection are unit-tested against a mocked mediaDevices in jsdom. What the
 * harness needs from a camera, and gets here, is a live <video> with real
 * moving frames underneath the overlay so the composite can be screenshotted.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

/** The committed fixture, also handed to Chromium's own fake-device switch. */
export const FAKE_CAMERA_PATH = path.resolve(__dirname, "fixtures/fake-camera.y4m");

/** Label the shimmed device reports, so a test can prove the feed is the fake. */
export const FAKE_CAMERA_LABEL = "Free Trace fake camera (fake-camera.y4m)";

/**
 * Installs the shim for every document in `page`.
 *
 * Runs before any app script, so `navigator.mediaDevices.getUserMedia` is
 * already replaced by the time components/CameraFeed.tsx calls it. Decoding is
 * deferred until the first getUserMedia call — the library screen never asks
 * for a camera, and parsing ~1.1MB of YUV on a page that will not use it is
 * pure waste.
 */
export async function installFakeCamera(page: Page): Promise<void> {
  const y4m = readFileSync(FAKE_CAMERA_PATH).toString("base64");

  await page.addInitScript(
    ({ data, label }: { data: string; label: string }) => {
      // ---- y4m decode ----------------------------------------------------
      // The container is a text header, then "FRAME\n" + raw YUV420p planes,
      // repeated. No lengths are stored: the header's dimensions are what say
      // where each frame ends, which is why they are parsed first.
      function decode(bytes: Uint8Array) {
        let cursor = bytes.indexOf(0x0a); // end of the header line
        const header = new TextDecoder().decode(bytes.subarray(0, cursor));
        cursor += 1;

        let width = 0;
        let height = 0;
        let fps = 10;
        for (const token of header.split(" ")) {
          if (token[0] === "W") width = Number(token.slice(1));
          else if (token[0] === "H") height = Number(token.slice(1));
          else if (token[0] === "F") {
            const [num, den] = token.slice(1).split(":").map(Number);
            if (num > 0 && den > 0) fps = num / den;
          }
        }

        const ySize = width * height;
        const cSize = (width / 2) * (height / 2);
        const frames: ImageData[] = [];

        while (cursor < bytes.length) {
          const nl = bytes.indexOf(0x0a, cursor); // end of "FRAME[ params]"
          if (nl < 0) break;
          cursor = nl + 1;
          if (cursor + ySize + cSize * 2 > bytes.length) break;

          const y = bytes.subarray(cursor, cursor + ySize);
          const u = bytes.subarray(cursor + ySize, cursor + ySize + cSize);
          const v = bytes.subarray(cursor + ySize + cSize, cursor + ySize + cSize * 2);
          cursor += ySize + cSize * 2;

          const rgba = new Uint8ClampedArray(ySize * 4);
          for (let row = 0; row < height; row += 1) {
            for (let col = 0; col < width; col += 1) {
              const i = row * width + col;
              // 4:2:0 — one chroma sample per 2x2 block of luma.
              const ci = (row >> 1) * (width >> 1) + (col >> 1);
              const Y = y[i];
              const U = u[ci] - 128;
              const V = v[ci] - 128;
              const o = i * 4;
              // BT.601, the colour space y4m's C420jpeg header declares.
              rgba[o] = Y + 1.402 * V;
              rgba[o + 1] = Y - 0.344136 * U - 0.714136 * V;
              rgba[o + 2] = Y + 1.772 * U;
              rgba[o + 3] = 255;
            }
          }
          frames.push(new ImageData(rgba, width, height));
        }

        return { width, height, fps, frames };
      }

      let stream: MediaStream | null = null;

      /**
       * Stamps the fixture's name onto a stream's video tracks.
       *
       * Must be applied to the stream that is HANDED OUT, not once at build
       * time: MediaStream.clone() mints brand new MediaStreamTrack objects, so
       * a label defined on the original does not travel to the clone — it
       * comes back as the browser's own opaque track id instead.
       */
      function labelTracks(target: MediaStream): MediaStream {
        for (const track of target.getVideoTracks()) {
          Object.defineProperty(track, "label", { value: label, configurable: true });
        }
        return target;
      }

      function build(): MediaStream {
        if (stream) return stream;

        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

        const { width, height, fps, frames } = decode(bytes);
        if (frames.length === 0) throw new Error("fake camera: no frames decoded");

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("fake camera: no 2d context");

        let index = 0;
        const paint = () => {
          ctx.putImageData(frames[index % frames.length], 0, 0);
          index += 1;
        };
        paint(); // captureStream needs a painted canvas to emit a first frame
        // setInterval rather than rAF: rAF is throttled in a backgrounded or
        // headless tab, and a stalled feed would look like a broken camera.
        setInterval(paint, 1000 / fps);

        stream = canvas.captureStream(fps);
        return stream;
      }

      const devices = navigator.mediaDevices;
      if (!devices) return;

      Object.defineProperty(devices, "getUserMedia", {
        configurable: true,
        // Takes no parameters on purpose — the caller's constraints are
        // ignored. There is one device here, and lib/camera.ts's facingMode
        // negotiation is unit tested in jsdom where the constraint objects can
        // be asserted on exactly. Returning a CLONE means the app stopping its
        // tracks (which it does on pagehide and unmount) cannot kill the
        // shared canvas stream for a later call in the same document.
        value: async () => labelTracks(build().clone()),
      });

      Object.defineProperty(devices, "enumerateDevices", {
        configurable: true,
        value: async () => [
          {
            deviceId: "free-trace-fake-camera",
            kind: "videoinput" as MediaDeviceKind,
            label,
            groupId: "free-trace-fake",
            toJSON() {
              return this;
            },
          },
        ],
      });
    },
    { data: y4m, label: FAKE_CAMERA_LABEL },
  );
}
