import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TraceScreen } from "@/components/TraceScreen";
import {
  IDENTITY_TRANSFORM,
  MAX_SCALE,
  toCssTransform,
  type OverlayTransform,
} from "@/lib/overlayTransform";
import { getReference, updateReference } from "@/lib/storage";
import type { Reference } from "@/lib/storage";

/**
 * T-10's DOM half: the Pointer Event wiring, the lock, and the listeners that
 * keep Safari's own zoom out of the way. The maths itself is proved with exact
 * numbers in tests/lib/gestures.test.ts — what is checked here is that real
 * events reach it, that the result reaches the transform, and that the lock
 * and the video layer are where they need to be.
 *
 * jsdom has no layout, so `getBoundingClientRect()` on the overlay container
 * is all zeros and its centre — the transform origin — sits at (0, 0). Client
 * coordinates in this file are therefore already origin-relative, which is why
 * a drag from (100,100) to (140,160) reads as exactly (40, 60).
 */

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/storage", () => ({
  getReference: vi.fn(),
  updateReference: vi.fn(),
}));

const getReferenceMock = vi.mocked(getReference);
const updateReferenceMock = vi.mocked(updateReference);

const createObjectURL = vi.fn<(blob: Blob) => string>();
const revokeObjectURL = vi.fn<(url: string) => void>();

Object.defineProperty(URL, "createObjectURL", {
  value: createObjectURL,
  configurable: true,
  writable: true,
});
Object.defineProperty(URL, "revokeObjectURL", {
  value: revokeObjectURL,
  configurable: true,
  writable: true,
});

// jsdom implements Pointer Events but not pointer CAPTURE, so the real method
// is missing and the hook skips it. Standing one in is what lets the capture
// contract (SPEC §10 item 6: the gesture must survive a finger sliding off the
// overlay) be asserted at all.
const setPointerCapture = vi.fn<(pointerId: number) => void>();
Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
  value: setPointerCapture,
  configurable: true,
  writable: true,
});

const REF_ID = "ref-1";

function makeReference(): Reference {
  const png = new Blob(["line-art"], { type: "image/png" });
  return {
    id: REF_ID,
    name: "Sketch",
    originalImage: png,
    lineArtImage: png,
    thumbnail: png,
    settings: {
      edgeStrength: 50,
      threshold: 50,
      thickness: 1,
      inverted: false,
    },
    lastOpacity: 60,
    createdAt: 1,
  };
}

async function renderScreen(): Promise<void> {
  getReferenceMock.mockResolvedValue({ ok: true, value: makeReference() });
  render(<TraceScreen id={REF_ID} />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function overlay(): HTMLElement {
  const node = document.querySelector<HTMLElement>('[data-slot="overlay"]');
  if (node === null) throw new Error("no overlay slot rendered");
  return node;
}

function video(): HTMLElement {
  const node = document.querySelector("video");
  if (node === null) throw new Error("no video rendered");
  return node;
}

function overlayImage(): HTMLImageElement {
  return screen.getByRole("img") as HTMLImageElement;
}

/** The overlay's transform, read back off the contract the harness uses. */
function rendered(): OverlayTransform {
  return JSON.parse(overlay().dataset.transform ?? "null") as OverlayTransform;
}

function lockButton(): HTMLElement {
  return screen.getByRole("button", { name: "Lock overlay" });
}

interface Point {
  id: number;
  x: number;
  y: number;
}

function pointerDown(target: HTMLElement, point: Point): void {
  fireEvent.pointerDown(target, {
    pointerId: point.id,
    clientX: point.x,
    clientY: point.y,
  });
}

function pointerMove(target: HTMLElement, point: Point): void {
  fireEvent.pointerMove(target, {
    pointerId: point.id,
    clientX: point.x,
    clientY: point.y,
  });
}

function pointerUp(target: HTMLElement, id: number): void {
  fireEvent.pointerUp(target, { pointerId: id });
}

/** One finger, down → move → up. */
function drag(target: HTMLElement, from: Point, to: Point): void {
  pointerDown(target, from);
  pointerMove(target, to);
  pointerUp(target, from.id);
}

beforeEach(() => {
  getReferenceMock.mockReset();
  updateReferenceMock.mockReset();
  updateReferenceMock.mockResolvedValue({ ok: true, value: makeReference() });
  createObjectURL.mockReset();
  createObjectURL.mockImplementation(() => "blob:free-trace/line-art");
  revokeObjectURL.mockReset();
  setPointerCapture.mockReset();
  pushMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// drag, pinch, rotate through the DOM
// ---------------------------------------------------------------------------

describe("Trace gestures — pointer events drive the transform (criterion 1)", () => {
  it("drags the overlay with one finger", async () => {
    await renderScreen();
    expect(rendered()).toEqual(IDENTITY_TRANSFORM);

    drag(overlay(), { id: 1, x: 100, y: 100 }, { id: 1, x: 140, y: 160 });

    expect(rendered()).toEqual({ ...IDENTITY_TRANSFORM, x: 40, y: 60 });
  });

  it("keeps the rendered CSS in step with the state object", async () => {
    await renderScreen();

    drag(overlay(), { id: 1, x: 0, y: 0 }, { id: 1, x: -25, y: 75 });

    // SPEC §11's single-source property, now with gestures writing to it.
    expect(overlayImage().style.transform).toBe(toCssTransform(rendered()));
    const transformed = Array.from(
      document.querySelectorAll<HTMLElement>("[style]"),
    ).filter((element) => element.style.transform !== "");
    expect(transformed).toHaveLength(1);
  });

  it("pinch-zooms and rotates from two fingers at once", async () => {
    await renderScreen();
    const container = overlay();

    pointerDown(container, { id: 1, x: -50, y: 0 });
    pointerDown(container, { id: 2, x: 50, y: 0 });
    pointerMove(container, { id: 1, x: 0, y: -100 });
    pointerMove(container, { id: 2, x: 0, y: 100 });

    const state = rendered();
    expect(state.scale).toBeCloseTo(2, 9);
    expect(state.rotation).toBeCloseTo(90, 9);
  });

  it("anchors a two-finger zoom to the midpoint, not the element centre", async () => {
    await renderScreen();
    const container = overlay();

    // Fingers 200px apart around (200, 0), spread to 400px apart around the
    // same point. Centre-anchored zoom would leave x at 0.
    pointerDown(container, { id: 1, x: 100, y: 0 });
    pointerDown(container, { id: 2, x: 300, y: 0 });
    pointerMove(container, { id: 1, x: 0, y: 0 });
    pointerMove(container, { id: 2, x: 400, y: 0 });

    expect(rendered()).toEqual({
      ...IDENTITY_TRANSFORM,
      x: -200,
      y: 0,
      scale: 2,
    });
  });

  it("carries on as a drag when one of two fingers lifts", async () => {
    await renderScreen();
    const container = overlay();

    pointerDown(container, { id: 1, x: -50, y: 0 });
    pointerDown(container, { id: 2, x: 50, y: 0 });
    pointerMove(container, { id: 1, x: -100, y: 0 });
    pointerMove(container, { id: 2, x: 100, y: 0 });
    const pinched = rendered();
    expect(pinched.scale).toBeCloseTo(2, 9);

    pointerUp(container, 2);
    expect(rendered()).toEqual(pinched);

    pointerMove(container, { id: 1, x: -90, y: 10 });
    expect(rendered()).toEqual({ ...pinched, x: 10, y: 10 });
  });

  it("never lets a wild gesture produce NaN or an unbounded scale (criterion 6)", async () => {
    await renderScreen();
    const container = overlay();

    pointerDown(container, { id: 1, x: 0, y: 0 });
    pointerDown(container, { id: 2, x: 1, y: 0 });
    for (let frame = 0; frame < 40; frame += 1) {
      const spread = frame % 2 === 0 ? 0 : 9000;
      pointerMove(container, { id: 1, x: -spread, y: spread });
      pointerMove(container, { id: 2, x: spread, y: -spread });
    }

    const state = rendered();
    expect(Number.isFinite(state.x)).toBe(true);
    expect(Number.isFinite(state.y)).toBe(true);
    expect(Number.isFinite(state.rotation)).toBe(true);
    expect(state.scale).toBeLessThanOrEqual(MAX_SCALE);
    expect(state.scale).toBeGreaterThanOrEqual(0.1);
  });

  it("captures the pointer so a finger sliding off the overlay keeps dragging", async () => {
    await renderScreen();

    pointerDown(overlay(), { id: 7, x: 10, y: 10 });

    expect(setPointerCapture).toHaveBeenCalledWith(7);
  });

  it("still drags when the browser refuses the capture", async () => {
    await renderScreen();
    setPointerCapture.mockImplementationOnce(() => {
      // Safari throws NotFoundError when the pointer is already gone.
      throw new Error("NotFoundError");
    });

    drag(overlay(), { id: 1, x: 0, y: 0 }, { id: 1, x: 30, y: 30 });

    expect(rendered()).toEqual({ ...IDENTITY_TRANSFORM, x: 30, y: 30 });
  });
});

// ---------------------------------------------------------------------------
// the video layer
// ---------------------------------------------------------------------------

describe("Trace gestures — the video is never a gesture surface (criterion 5)", () => {
  it("ignores pointers on the camera feed", async () => {
    await renderScreen();

    drag(video(), { id: 1, x: 0, y: 0 }, { id: 1, x: 200, y: 200 });

    expect(rendered()).toEqual(IDENTITY_TRANSFORM);
    expect(setPointerCapture).not.toHaveBeenCalled();
  });

  it("ignores pointers on the control bar", async () => {
    await renderScreen();
    const controls = document.querySelector<HTMLElement>(
      '[data-slot="controls"]',
    );
    if (controls === null) throw new Error("no control bar rendered");

    drag(controls, { id: 1, x: 0, y: 0 }, { id: 1, x: 200, y: 200 });

    expect(rendered()).toEqual(IDENTITY_TRANSFORM);
  });
});

// ---------------------------------------------------------------------------
// lock
// ---------------------------------------------------------------------------

describe("Trace gestures — lock freezes every transform (criterion 4)", () => {
  it("shows the engaged amber state and marks the container locked", async () => {
    await renderScreen();
    const button = lockButton();

    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(overlay().dataset.locked).toBe("false");
    expect(button.className).toMatch(/\bbg-surface\b/);

    fireEvent.click(button);

    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(overlay().dataset.locked).toBe("true");
    // SPEC §7's accent token — the engaged lock, not a raw hex.
    expect(button.className).toMatch(/\bbg-accent\b/);
  });

  it("ignores drags, pinches and captures while locked", async () => {
    await renderScreen();
    const container = overlay();
    drag(container, { id: 1, x: 0, y: 0 }, { id: 1, x: 40, y: 40 });
    const before = rendered();

    fireEvent.click(lockButton());
    setPointerCapture.mockReset();

    drag(container, { id: 1, x: 0, y: 0 }, { id: 1, x: 500, y: 500 });
    pointerDown(container, { id: 1, x: -50, y: 0 });
    pointerDown(container, { id: 2, x: 50, y: 0 });
    pointerMove(container, { id: 1, x: -300, y: 0 });
    pointerMove(container, { id: 2, x: 300, y: 0 });

    expect(rendered()).toEqual(before);
    expect(setPointerCapture).not.toHaveBeenCalled();
  });

  it("freezes a gesture already in flight, and does not resume it on unlock", async () => {
    await renderScreen();
    const container = overlay();

    pointerDown(container, { id: 1, x: 0, y: 0 });
    pointerMove(container, { id: 1, x: 20, y: 0 });
    expect(rendered().x).toBe(20);

    // Lock with the finger still down.
    fireEvent.click(lockButton());
    pointerMove(container, { id: 1, x: 400, y: 400 });
    expect(rendered().x).toBe(20);

    // Unlocking must not adopt the finger's new position as a delta — the
    // half-finished gesture is gone, and it takes a fresh press to move again.
    fireEvent.click(lockButton());
    pointerMove(container, { id: 1, x: 800, y: 800 });
    expect(rendered()).toEqual({ ...IDENTITY_TRANSFORM, x: 20, y: 0 });
  });

  it("lets gestures through again after unlocking", async () => {
    await renderScreen();
    const button = lockButton();

    fireEvent.click(button);
    fireEvent.click(button);
    expect(overlay().dataset.locked).toBe("false");

    drag(overlay(), { id: 1, x: 0, y: 0 }, { id: 1, x: 15, y: -35 });

    expect(rendered()).toEqual({ ...IDENTITY_TRANSFORM, x: 15, y: -35 });
  });

  it("keeps the lock out of storage — it is session-only", async () => {
    vi.useFakeTimers();
    await renderScreen();

    fireEvent.click(lockButton());
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // SPEC §5's reference record has no lock field; nothing to persist.
    expect(updateReferenceMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Safari's own zoom (criterion 3)
// ---------------------------------------------------------------------------

describe("Trace gestures — Safari's native zoom is suppressed (criterion 3)", () => {
  it("sets touch-action: none on the gesture container", async () => {
    await renderScreen();

    expect(overlay().style.touchAction).toBe("none");
  });

  it("blocks text selection on the container", async () => {
    await renderScreen();

    // SPEC §7 also asks for `-webkit-touch-callout: none`, which is declared
    // alongside this one in TraceOverlay but CANNOT be asserted here: jsdom's
    // CSS engine drops properties it does not know, so it never reaches the
    // CSSOM. Real Safari behaviour for the callout is unverified by this
    // suite — the same limitation the `main` element's copy has lived with
    // since T-09.
    expect(overlay().style.userSelect).toBe("none");
  });

  it("registers the touch and gesture listeners NON-passively", async () => {
    // The whole point of the manual addEventListener: React's synthetic
    // onTouchStart/onTouchMove are attached passively, so preventDefault from
    // one is ignored by the browser.
    const addSpy = vi.spyOn(HTMLElement.prototype, "addEventListener");
    await renderScreen();
    const container = overlay();

    const onContainer = addSpy.mock.calls
      .map((call, index) => ({
        type: call[0],
        options: call[2],
        target: addSpy.mock.contexts[index],
      }))
      .filter((entry) => entry.target === container);

    expect(onContainer.map((entry) => entry.type).sort()).toEqual([
      "gesturechange",
      "gesturestart",
      "touchmove",
      "touchstart",
    ]);
    for (const entry of onContainer) {
      expect(entry.options).toEqual({ passive: false });
    }
  });

  it("actually calls preventDefault on those events", async () => {
    await renderScreen();
    const container = overlay();

    for (const type of [
      "touchstart",
      "touchmove",
      "gesturestart",
      "gesturechange",
    ]) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      container.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
  });

  it("keeps suppressing them while the overlay is locked", async () => {
    // Locking freezes the OVERLAY. Handing the page back to Safari's
    // pinch-zoom mid-drawing would be worse than the gesture it replaces.
    await renderScreen();
    fireEvent.click(lockButton());

    const event = new Event("touchmove", { bubbles: true, cancelable: true });
    overlay().dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("removes the listeners when the screen closes", async () => {
    await renderScreen();
    const container = overlay();
    const removeSpy = vi.spyOn(container, "removeEventListener");

    cleanup();

    expect(removeSpy.mock.calls.map((call) => call[0]).sort()).toEqual([
      "gesturechange",
      "gesturestart",
      "touchmove",
      "touchstart",
    ]);
  });
});
