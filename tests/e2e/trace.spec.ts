/**
 * tests/e2e/trace.spec.ts — the headless verification harness (ticket T-14).
 *
 * Drives the real Trace screen in a real browser against a synthetic camera
 * and a seeded reference, and writes screenshots to artifacts/.
 *
 * The load-bearing check here is the OVERLAY GATE (see `assertOverlayComposited`
 * below): proof that the line art actually reached the pixels on screen, not
 * merely that an <img> element exists in the DOM. Every other assertion in this
 * file is about state; that one is about the composited frame, and it is the
 * one the CI job must fail on.
 *
 * README.md ("What the test rig proves, and what it cannot") is the plain
 * English version of this file's limits. Keep the two honest with each other.
 */

import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FAKE_CAMERA_LABEL, installFakeCamera } from "./fakeCamera";

/** Named screenshots land here. `artifacts/` is gitignored; CI uploads it. */
const SHOTS = path.resolve(__dirname, "..", "..", "artifacts");

/** Fixed, not random: a stable id keeps a failure reproducible from the log. */
const REFERENCE_ID = "11111111-2222-4333-8444-555555555555";
const REFERENCE_NAME = "Harness cross";

/**
 * A pixel counts as "dark" below this luma (0–255, BT.601).
 *
 * Chosen against the two things on screen: the fake camera feed is a mid-grey
 * gradient held in [96, 176] by scripts/make-fake-camera.mjs, and the line art
 * is pure black on white. 64 sits in the gap, so the count is a measure of the
 * overlay's ink and nothing else. The dark control bar is present in every
 * screenshot equally and cancels in the DIFFERENCE the gate takes.
 */
const DARK_LUMA = 64;

/**
 * How many more dark pixels the 100%-opacity frame must have than the
 * 0%-opacity one before the overlay counts as composited.
 *
 * Calibrated from measurement, not guessed: the seeded cross covers ~29,000
 * CSS pixels at the rendered size, and the observed delta is printed by every
 * run. 8,000 is a wide margin below that — comfortably above anti-aliasing
 * noise, comfortably below a real overlay — so the gate discriminates without
 * being brittle. The negative-control test below proves it discriminates.
 */
const OVERLAY_GATE_MIN_DELTA = 8_000;

/**
 * THE GATE. Throws — loudly, with the numbers — when the line art is not in
 * the composited frame.
 *
 * Deliberately a plain function rather than an inline `expect`: the
 * negative-control test needs to run the EXACT same rule against a frame with
 * the overlay hidden and show it rejecting. A gate that has only ever been
 * seen to pass is not evidence that it can fail.
 */
function assertOverlayComposited(dark0: number, dark100: number): void {
  const delta = dark100 - dark0;
  if (delta <= OVERLAY_GATE_MIN_DELTA) {
    throw new Error(
      "Overlay gate FAILED — the line art is absent from the composited frame. " +
        `Dark pixels (luma < ${DARK_LUMA}): ${dark0} at 0% opacity, ${dark100} at 100%. ` +
        `Delta ${delta}, required > ${OVERLAY_GATE_MIN_DELTA}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * Writes one reference straight into IndexedDB, in the exact shape
 * lib/storage.ts defines (SPEC §5), and arms the camera autostart flag.
 *
 * The stores are created here rather than letting the app do it, so the schema
 * the harness depends on is written down in the harness. The app then opens
 * the same version 1 and finds everything already in place.
 *
 * Blobs are built in the browser with a canvas: the images have to be real
 * decodable bitmaps for `naturalWidth` and the compositor to behave, and
 * generating them here keeps binary fixtures out of the repo.
 */
async function seedReference(page: Page): Promise<void> {
  await page.evaluate(
    async ({ id, name }) => {
      const paint = (
        size: number,
        draw: (ctx: CanvasRenderingContext2D, size: number) => void,
        type: string,
        quality?: number,
      ): Promise<Blob> => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("seed: no 2d context");
        draw(ctx, size);
        return new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error("seed: toBlob returned null"))),
            type,
            quality,
          );
        });
      };

      // The line art: a thick black diagonal cross on white. Chosen for the
      // gate — it is a large, unambiguous block of near-black ink that no
      // camera frame can imitate, and its diagonals make a rotation or a flip
      // visible to a human reading the screenshots.
      const lineArtImage = await paint(
        400,
        (ctx, size) => {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, size, size);
          ctx.strokeStyle = "#000000";
          ctx.lineWidth = 28;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(size, size);
          ctx.moveTo(size, 0);
          ctx.lineTo(0, size);
          ctx.stroke();
        },
        "image/png",
      );

      // The "photo" and its thumbnail are never rendered on the Trace screen;
      // they only have to be present and be real JPEGs.
      const flatGrey = (ctx: CanvasRenderingContext2D, size: number) => {
        ctx.fillStyle = "#8a8a8a";
        ctx.fillRect(0, 0, size, size);
      };
      const originalImage = await paint(400, flatGrey, "image/jpeg", 0.8);
      const thumbnail = await paint(200, flatGrey, "image/jpeg", 0.7);

      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("freetrace", 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("references")) {
            const store = database.createObjectStore("references", { keyPath: "id" });
            store.createIndex("createdAt", "createdAt");
          }
          if (!database.objectStoreNames.contains("preferences")) {
            database.createObjectStore("preferences", { keyPath: "key" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("references", "readwrite");
        tx.objectStore("references").put({
          id,
          name,
          originalImage,
          lineArtImage,
          thumbnail,
          settings: { edgeStrength: 50, threshold: 50, thickness: 2, inverted: false },
          lastOpacity: 100,
          createdAt: Date.now(),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();

      // lib/camera.ts AUTOSTART_KEY: skips the "Start camera" tap, which
      // exists to give iOS a user gesture and has nothing to prove here.
      sessionStorage.setItem("freetrace:camera-autostart", "1");
    },
    { id: REFERENCE_ID, name: REFERENCE_NAME },
  );
}

/**
 * Waits until the screen is genuinely ready to photograph: the feed is live
 * AND decoding frames, and the overlay bitmap has decoded.
 *
 * Also asserts the feed is the FAKE one. That check is not ceremony — on macOS
 * Chromium ignores its own fake-device switch and hands back the machine's
 * real webcam (see tests/e2e/fakeCamera.ts). Without this line the whole suite
 * would silently photograph whatever room the machine is in, and the gate
 * would be measuring the lighting.
 */
async function waitForTraceReady(page: Page): Promise<void> {
  await expect(page.locator('video[data-slot="camera"]')).toHaveAttribute("data-status", "live");

  await page.waitForFunction(() => {
    const video = document.querySelector<HTMLVideoElement>('video[data-slot="camera"]');
    const image = document.querySelector<HTMLImageElement>('[data-slot="overlay"] img');
    return (
      video !== null && video.readyState >= 2 && image !== null && image.naturalWidth > 0
    );
  });

  const label = await page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>('video[data-slot="camera"]');
    // srcObject is typed MediaProvider|null; components/CameraFeed.tsx only
    // ever assigns a MediaStream to it.
    const stream = video?.srcObject as MediaStream | null;
    return stream?.getVideoTracks()[0]?.label ?? null;
  });
  expect(label, "the feed must be the committed fixture, not real hardware").toBe(
    FAKE_CAMERA_LABEL,
  );
}

// ---------------------------------------------------------------------------
// Driving the screen
// ---------------------------------------------------------------------------

/**
 * Moves the opacity slider.
 *
 * React owns the input's value, so assigning `input.value` is swallowed on the
 * next render. Going through the prototype's native setter is what makes
 * React's own value tracker notice the change and let the synthetic `input`
 * event through to the handler.
 */
async function setOpacity(page: Page, value: number): Promise<void> {
  await page.evaluate((next) => {
    const input = document.querySelector<HTMLInputElement>(
      '[data-slot="controls"] input[type="range"]',
    );
    if (!input) throw new Error("opacity slider not found");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("no native value setter on HTMLInputElement");
    setter.call(input, String(next));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);

  await expect(page.locator('[data-slot="controls"] input[type="range"] + span')).toHaveText(
    `${value}%`,
  );
}

/**
 * Restarts the control bar's 4s idle timer without touching the pointer.
 *
 * A key event, not a click: TraceScreen resets the timer on
 * `onPointerMoveCapture` too, so moving the mouse to click something is itself
 * an interaction. Dispatching a keydown leaves the pointer where it is, which
 * matters for the collapse test.
 */
async function wakeChrome(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelector("main")?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
  });
  await expect(page.locator('[data-slot="chrome"]')).toHaveAttribute("data-chrome", "expanded");
}

interface Transform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flipX: boolean;
}

async function readTransform(page: Page): Promise<Transform> {
  const raw = await page.locator('[data-slot="overlay"]').getAttribute("data-transform");
  if (raw === null) throw new Error("overlay has no data-transform attribute");
  return JSON.parse(raw) as Transform;
}

/**
 * Counts near-black pixels in a PNG.
 *
 * Decoded by handing the bytes back to the browser as a data: URL and drawing
 * them into a canvas — the page already has a PNG decoder and a pixel buffer,
 * so there is no reason to add a Node-side image dependency to the project for
 * this. data: URLs do not taint a canvas, so getImageData is allowed.
 */
async function countDarkPixels(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(
    async ({ base64, threshold }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();

      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("gate: no 2d context");
      ctx.drawImage(image, 0, 0);

      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let dark = 0;
      for (let i = 0; i < data.length; i += 4) {
        const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (luma < threshold) dark += 1;
      }
      return dark;
    },
    { base64: png.toString("base64"), threshold: DARK_LUMA },
  );
}

async function shoot(page: Page, name: string): Promise<Buffer> {
  return page.screenshot({ path: path.join(SHOTS, name) });
}

/**
 * The 0 / 50 / 100 opacity sweep, returning the dark-pixel counts at the two
 * ends. Shared by the gate test and its negative control so both walk exactly
 * the same path — the only difference being whether the overlay is visible.
 */
async function sweepOpacity(
  page: Page,
  prefix: string,
): Promise<{ dark0: number; dark100: number }> {
  const image = page.locator('[data-slot="overlay"] img');

  await setOpacity(page, 0);
  await expect(image).toHaveCSS("opacity", "0");
  const dark0 = await countDarkPixels(page, await shoot(page, `${prefix}opacity-000.png`));

  await setOpacity(page, 50);
  await expect(image).toHaveCSS("opacity", "0.5");
  await shoot(page, `${prefix}opacity-050.png`);

  await setOpacity(page, 100);
  await expect(image).toHaveCSS("opacity", "1");
  const dark100 = await countDarkPixels(page, await shoot(page, `${prefix}opacity-100.png`));

  return { dark0, dark100 };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await installFakeCamera(page);
  // Seeding needs a same-origin document before IndexedDB is reachable.
  await page.goto("/");
  await seedReference(page);
  await page.goto(`/trace/${REFERENCE_ID}`);
  await waitForTraceReady(page);
});

test("opacity 0 / 50 / 100, and the overlay reaches the composited frame", async ({ page }) => {
  const { dark0, dark100 } = await sweepOpacity(page, "");

  console.log(
    `[gate] overlay VISIBLE — dark pixels: 0%=${dark0}, 100%=${dark100}, ` +
      `delta=${dark100 - dark0} (threshold > ${OVERLAY_GATE_MIN_DELTA})`,
  );

  assertOverlayComposited(dark0, dark100);
});

test("gate validation: the same gate REJECTS a frame with the overlay hidden", async ({
  page,
}) => {
  // The negative control. Everything is identical to the test above except
  // that the overlay is removed from the render, so the opacity slider has
  // nothing to reveal and the two frames must come out the same.
  await page.addStyleTag({ content: '[data-slot="overlay"]{display:none}' });
  await expect(page.locator('[data-slot="overlay"]')).toBeHidden();

  const { dark0, dark100 } = await sweepOpacity(page, "gate-hidden-");

  console.log(
    `[gate] overlay HIDDEN — dark pixels: 0%=${dark0}, 100%=${dark100}, ` +
      `delta=${dark100 - dark0} (threshold > ${OVERLAY_GATE_MIN_DELTA})`,
  );

  let thrown: Error | null = null;
  try {
    assertOverlayComposited(dark0, dark100);
  } catch (error) {
    thrown = error as Error;
  }

  console.log(`[gate] rejection message: ${thrown?.message ?? "(the gate did NOT reject)"}`);
  expect(thrown, "the gate must reject a frame with no overlay in it").not.toBeNull();
  expect(thrown?.message).toContain("Overlay gate FAILED");
});

test("one-finger drag moves the overlay", async ({ page }) => {
  const before = await readTransform(page);
  await shoot(page, "drag-before.png");

  // Well clear of the control bar, which owns the bottom ~110px at z-30.
  await page.mouse.move(195, 350);
  await page.mouse.down();
  await page.mouse.move(255, 410, { steps: 8 });
  await page.mouse.up();

  const after = await readTransform(page);
  await shoot(page, "drag-after.png");
  console.log(`[drag] before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);

  // A drag is a pure translation of exactly the pointer delta (lib/gestures.ts
  // equation (2) with f=1, dθ=0), so this is an exact expectation, not a
  // "something moved" one.
  expect(after.x - before.x).toBeCloseTo(60, 0);
  expect(after.y - before.y).toBeCloseTo(60, 0);
  expect(after.scale).toBeCloseTo(before.scale, 5);
  expect(after.rotation).toBeCloseTo(before.rotation, 5);
});

test("two-finger pinch scales and rotates the overlay", async ({ page }) => {
  const before = await readTransform(page);
  await shoot(page, "pinch-before.png");

  // Synthetic PointerEvents rather than page.mouse: a mouse is one pointer.
  // Order is down1, down2, move1, move2, up1, up2 — the anchor is re-taken on
  // the second down, so the pinch is measured from both fingers being present.
  await page.evaluate(() => {
    const node = document.querySelector('[data-slot="overlay"]');
    if (!node) throw new Error("overlay container not found");

    const fire = (type: string, pointerId: number, clientX: number, clientY: number) => {
      node.dispatchEvent(
        new PointerEvent(type, {
          pointerId,
          clientX,
          clientY,
          pointerType: "touch",
          isPrimary: pointerId === 1,
          bubbles: true,
          cancelable: true,
        }),
      );
    };

    fire("pointerdown", 1, 150, 400);
    fire("pointerdown", 2, 240, 400);
    // Both fingers move outward AND the pair tilts, so scale and rotation
    // change together: distance 90 -> ~214.7, angle 0deg -> ~27.8deg.
    fire("pointermove", 1, 100, 350);
    fire("pointermove", 2, 290, 450);
    fire("pointerup", 1, 100, 350);
    fire("pointerup", 2, 290, 450);
  });

  const after = await readTransform(page);
  await shoot(page, "pinch-after.png");
  console.log(`[pinch] before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);

  expect(after.scale).toBeGreaterThan(before.scale);
  expect(after.scale).toBeCloseTo(2.3857, 1);
  expect(after.rotation).not.toBeCloseTo(before.rotation, 1);
  expect(after.rotation).toBeCloseTo(27.758, 0);
});

test("lock freezes the overlay", async ({ page }) => {
  const overlay = page.locator('[data-slot="overlay"]');
  await expect(overlay).toHaveAttribute("data-locked", "false");

  await wakeChrome(page);
  await page.getByRole("button", { name: "Lock overlay" }).click();
  await expect(overlay).toHaveAttribute("data-locked", "true");

  const before = await readTransform(page);
  await page.mouse.move(195, 350);
  await page.mouse.down();
  await page.mouse.move(255, 410, { steps: 8 });
  await page.mouse.up();
  const after = await readTransform(page);

  console.log(`[lock] before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  expect(after).toEqual(before);
});

test("flip toggles flipX and invert filters the line art", async ({ page }) => {
  const overlay = page.locator('[data-slot="overlay"]');
  const image = page.locator('[data-slot="overlay"] img');

  expect((await readTransform(page)).flipX).toBe(false);
  await wakeChrome(page);
  await page.getByRole("button", { name: "Flip horizontal" }).click();
  await expect(overlay).toHaveAttribute("data-transform", /"flipX":true/);
  expect((await readTransform(page)).flipX).toBe(true);
  await shoot(page, "flip-on.png");

  await expect(image).toHaveCSS("filter", "none");
  await wakeChrome(page);
  await page.getByRole("button", { name: "Invert" }).click();
  await expect(image).toHaveCSS("filter", "invert(1)");
  await shoot(page, "invert-on.png");
});

test("the control bar collapses to a pill after ~4s idle and restores on tap", async ({
  page,
}) => {
  const chrome = page.locator('[data-slot="chrome"]');

  // Resets the idle timer without moving the pointer — from here on, nothing
  // in this test may touch the mouse until the collapse has been observed.
  await wakeChrome(page);
  await expect(chrome).toHaveAttribute("data-chrome", "expanded");
  await shoot(page, "chrome-expanded.png");

  // IDLE_MS is 4000 in components/TraceScreen.tsx.
  await page.waitForTimeout(4_200);

  await expect(chrome).toHaveAttribute("data-chrome", "collapsed");
  const pill = page.getByRole("button", { name: /^Show controls — opacity/ });
  await expect(pill).toBeVisible();
  await shoot(page, "chrome-collapsed.png");

  await pill.click();
  await expect(chrome).toHaveAttribute("data-chrome", "expanded");
});
