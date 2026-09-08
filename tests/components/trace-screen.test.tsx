import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PERSIST_DEBOUNCE_MS, TraceScreen } from "@/components/TraceScreen";
import {
  IDENTITY_TRANSFORM,
  toCssTransform,
  type OverlayTransform,
} from "@/lib/overlayTransform";
import { getReference, updateReference } from "@/lib/storage";
import type { Reference, StorageResult } from "@/lib/storage";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// The whole storage layer is mocked: this suite is about the screen's state
// and its persistence CALLS, and lib/storage.ts has its own 44-test suite.
vi.mock("@/lib/storage", () => ({
  getReference: vi.fn(),
  updateReference: vi.fn(),
}));

const getReferenceMock = vi.mocked(getReference);
const updateReferenceMock = vi.mocked(updateReference);

// jsdom implements neither half of the object-URL API.
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

const REF_ID = "ref-1";

function makeReference(overrides: Partial<Reference> = {}): Reference {
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
    lastOpacity: 42,
    createdAt: 1,
    ...overrides,
  };
}

/** Lets the load promise and the state updates it triggers settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderScreen(
  result: StorageResult<Reference>,
): Promise<ReturnType<typeof render>> {
  getReferenceMock.mockResolvedValue(result);
  const view = render(<TraceScreen id={REF_ID} />);
  await settle();
  return view;
}

function ready(overrides: Partial<Reference> = {}): StorageResult<Reference> {
  return { ok: true, value: makeReference(overrides) };
}

const NOT_FOUND: StorageResult<Reference> = {
  ok: false,
  error: {
    kind: "not-found",
    message: "That reference isn't in your library any more.",
  },
};

function overlayImage(): HTMLImageElement {
  return screen.getByRole("img") as HTMLImageElement;
}

function overlayContainer(): HTMLElement {
  const node = document.querySelector<HTMLElement>('[data-slot="overlay"]');
  if (node === null) throw new Error("no overlay slot rendered");
  return node;
}

/** Every element on the screen carrying an inline `transform`. */
function elementsWithTransform(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[style]")).filter(
    (element) => element.style.transform !== "",
  );
}

beforeEach(() => {
  getReferenceMock.mockReset();
  updateReferenceMock.mockReset();
  updateReferenceMock.mockResolvedValue(ready());
  createObjectURL.mockReset();
  createObjectURL.mockImplementation(() => "blob:free-trace/line-art");
  revokeObjectURL.mockReset();
  pushMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// (b) load + render
// ---------------------------------------------------------------------------

describe("TraceScreen — loading a reference (criterion 1)", () => {
  it("renders the line art over the video at the reference's stored opacity", async () => {
    await renderScreen(ready({ lastOpacity: 42 }));

    const image = overlayImage();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(image.getAttribute("src")).toBe("blob:free-trace/line-art");
    expect(Number(image.style.opacity)).toBeCloseTo(0.42, 5);
  });

  it("stacks the overlay above the camera feed and leaves it hit-testable for T-10", async () => {
    await renderScreen(ready());

    const container = overlayContainer();
    const video = document.querySelector("video");
    expect(video).not.toBeNull();

    // jsdom has no layout or paint, so "above the video" is asserted the only
    // way it can be: the overlay is a later sibling AND carries z-10, while
    // the camera layer carries no z-index at all.
    expect(container.className).toMatch(/\bz-10\b/);
    expect(container.className).not.toMatch(/pointer-events-none/);
    const cameraLayer = video?.parentElement;
    expect(cameraLayer?.className ?? "").not.toMatch(/\bz-\d/);
    expect(
      cameraLayer?.compareDocumentPosition(container),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("shows the percentage in the monospace readout (criterion 2)", async () => {
    await renderScreen(ready({ lastOpacity: 42 }));

    const readout = screen.getByText("42%");
    expect(readout.className).toMatch(/\bnumeral\b/);
  });

  it("starts the overlay at the identity transform", async () => {
    await renderScreen(ready());

    expect(overlayImage().style.transform).toBe(
      toCssTransform(IDENTITY_TRANSFORM),
    );
  });

  it("does not write anything back just for opening the screen", async () => {
    vi.useFakeTimers();
    await renderScreen(ready());
    act(() => {
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS * 4);
    });

    expect(updateReferenceMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (c) opacity + debounced persistence
// ---------------------------------------------------------------------------

describe("TraceScreen — opacity (criteria 1, 2)", () => {
  it("updates the overlay immediately and persists once, after the debounce", async () => {
    vi.useFakeTimers();
    await renderScreen(ready({ lastOpacity: 20 }));

    const slider = screen.getByLabelText("Opacity");
    fireEvent.change(slider, { target: { value: "55" } });

    // Immediate: the drawing must follow the thumb, not the write.
    expect(Number(overlayImage().style.opacity)).toBeCloseTo(0.55, 5);
    expect(screen.getByText("55%")).toBeTruthy();
    expect(updateReferenceMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
    });

    expect(updateReferenceMock).toHaveBeenCalledTimes(1);
    expect(updateReferenceMock).toHaveBeenCalledWith(REF_ID, {
      lastOpacity: 55,
    });
  });

  it("collapses a whole drag into a single write of the settled value", async () => {
    vi.useFakeTimers();
    await renderScreen(ready({ lastOpacity: 20 }));

    const slider = screen.getByLabelText("Opacity");
    for (const value of ["30", "45", "60", "72"]) {
      fireEvent.change(slider, { target: { value } });
      act(() => {
        vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS / 2);
      });
    }
    expect(updateReferenceMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
    });

    expect(updateReferenceMock).toHaveBeenCalledTimes(1);
    expect(updateReferenceMock).toHaveBeenCalledWith(REF_ID, {
      lastOpacity: 72,
    });
  });

  it("flushes a pending write when the screen unmounts inside the debounce window", async () => {
    vi.useFakeTimers();
    const view = await renderScreen(ready({ lastOpacity: 20 }));

    fireEvent.change(screen.getByLabelText("Opacity"), {
      target: { value: "88" },
    });
    expect(updateReferenceMock).not.toHaveBeenCalled();

    view.unmount();

    expect(updateReferenceMock).toHaveBeenCalledTimes(1);
    expect(updateReferenceMock).toHaveBeenCalledWith(REF_ID, {
      lastOpacity: 88,
    });
  });

  it("keeps a failed write silent for the user but logged for us", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    updateReferenceMock.mockResolvedValue({
      ok: false,
      error: { kind: "quota-exceeded", message: "No space left." },
    });
    await renderScreen(ready());

    fireEvent.change(screen.getByLabelText("Opacity"), {
      target: { value: "10" },
    });
    act(() => {
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(logged).toHaveBeenCalled();
    expect(screen.queryByText("No space left.")).toBeNull();
    // The overlay is untouched — a failed save never interrupts a drawing.
    expect(Number(overlayImage().style.opacity)).toBeCloseTo(0.1, 5);
  });
});

// ---------------------------------------------------------------------------
// (d) invert
// ---------------------------------------------------------------------------

describe("TraceScreen — invert (criterion 4)", () => {
  it("applies the CSS invert filter and persists settings.inverted", async () => {
    vi.useFakeTimers();
    await renderScreen(ready({ lastOpacity: 60 }));

    expect(overlayImage().style.filter).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Invert" }));

    expect(overlayImage().style.filter).toBe("invert(1)");
    expect(
      screen.getByRole("button", { name: "Invert" }).getAttribute("aria-pressed"),
    ).toBe("true");

    act(() => {
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
    });

    expect(updateReferenceMock).toHaveBeenCalledTimes(1);
    expect(updateReferenceMock).toHaveBeenCalledWith(REF_ID, {
      settings: { inverted: true },
    });
  });

  it("starts inverted when the reference was saved that way", async () => {
    await renderScreen(
      ready({
        settings: {
          edgeStrength: 50,
          threshold: 50,
          thickness: 1,
          inverted: true,
        },
      }),
    );

    expect(overlayImage().style.filter).toBe("invert(1)");
  });

  it("toggles back off and persists that too", async () => {
    vi.useFakeTimers();
    await renderScreen(ready());

    const button = screen.getByRole("button", { name: "Invert" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(overlayImage().style.filter).toBe("");

    act(() => {
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
    });

    expect(updateReferenceMock).toHaveBeenCalledTimes(1);
    expect(updateReferenceMock).toHaveBeenCalledWith(REF_ID, {
      settings: { inverted: false },
    });
  });
});

// ---------------------------------------------------------------------------
// (e) flip
// ---------------------------------------------------------------------------

describe("TraceScreen — flip horizontal (criterion 5)", () => {
  it("changes the transform and leaves the rotation term untouched", async () => {
    vi.useFakeTimers();
    await renderScreen(ready());

    const before = overlayImage().style.transform;
    const rotationBefore = /rotate\([^)]*\)/.exec(before)?.[0];

    fireEvent.click(screen.getByRole("button", { name: "Flip horizontal" }));

    const after = overlayImage().style.transform;
    expect(after).not.toBe(before);
    expect(after).toContain("scaleX(-1)");
    expect(/rotate\([^)]*\)/.exec(after)?.[0]).toBe(rotationBefore);

    // Session-only: SPEC §5 gives the reference record no flip field, so a
    // flip must never reach storage.
    act(() => {
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS * 2);
    });
    expect(updateReferenceMock).not.toHaveBeenCalled();
  });

  it("returns to the original transform when flipped twice", async () => {
    await renderScreen(ready());

    const button = screen.getByRole("button", { name: "Flip horizontal" });
    const before = overlayImage().style.transform;

    fireEvent.click(button);
    fireEvent.click(button);

    expect(overlayImage().style.transform).toBe(before);
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// lock (present, inert until T-10)
// ---------------------------------------------------------------------------

describe("TraceScreen — lock", () => {
  it("renders the engaged amber state without touching the transform", async () => {
    await renderScreen(ready());

    const button = screen.getByRole("button", { name: "Lock overlay" });
    const before = overlayImage().style.transform;
    expect(button.className).toMatch(/\bbg-surface\b/);

    fireEvent.click(button);

    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.className).toMatch(/\bbg-accent\b/);
    expect(overlayImage().style.transform).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// (f) not found
// ---------------------------------------------------------------------------

describe("TraceScreen — a reference that is not there (SPEC §9)", () => {
  it("shows the storage layer's message and a way back, never a black screen", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await renderScreen(NOT_FOUND);

    expect(
      screen.getByText("That reference isn't in your library any more."),
    ).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(document.querySelector('[data-slot="overlay"]')).toBeNull();
    expect(logged).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Back to library" }));
    expect(pushMock).toHaveBeenCalledWith("/");
  });
});

// ---------------------------------------------------------------------------
// (g) object URL lifetime
// ---------------------------------------------------------------------------

describe("TraceScreen — object URL lifetime", () => {
  it("revokes the line-art object URL on unmount", async () => {
    const view = await renderScreen(ready());

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    view.unmount();

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:free-trace/line-art");
  });
});

// ---------------------------------------------------------------------------
// (h) one transform, one source (criterion 3, SPEC §11)
// ---------------------------------------------------------------------------

describe("TraceScreen — the transform has exactly one source (criterion 3)", () => {
  // WHAT THIS PROVES: the overlay's placement reaches the DOM through exactly
  // one element and exactly one serialiser, and the string on that element is
  // byte-for-byte `toCssTransform(<the state object>)` — so there is no second
  // channel (a class, a parent transform, a stray inline style) contributing
  // to where the line art sits.
  //
  // WHAT IT CANNOT PROVE: that components/TraceScreen.tsx holds the value in a
  // single `useState`. Two state variables serialised into one string would
  // pass this test. That half is a code-review property, and the state
  // variable is named in the PR body: `transform` in components/TraceScreen.tsx.
  it("renders one transformed element whose style is the serialised state object", async () => {
    await renderScreen(ready());

    const transformed = elementsWithTransform();
    expect(transformed).toHaveLength(1);
    expect(transformed[0]).toBe(overlayImage());

    const state = JSON.parse(
      overlayContainer().dataset.transform ?? "null",
    ) as OverlayTransform;
    expect(state).toEqual(IDENTITY_TRANSFORM);
    expect(transformed[0].style.transform).toBe(toCssTransform(state));
  });

  it("stays a single source after the transform changes", async () => {
    await renderScreen(ready());

    fireEvent.click(screen.getByRole("button", { name: "Flip horizontal" }));

    const transformed = elementsWithTransform();
    expect(transformed).toHaveLength(1);

    const state = JSON.parse(
      overlayContainer().dataset.transform ?? "null",
    ) as OverlayTransform;
    expect(state).toEqual({ ...IDENTITY_TRANSFORM, flipX: true });
    expect(transformed[0].style.transform).toBe(toCssTransform(state));
  });

  it("exposes every field of the transform, so nothing is held off to the side", async () => {
    await renderScreen(ready());

    const state = JSON.parse(
      overlayContainer().dataset.transform ?? "null",
    ) as OverlayTransform;

    expect(Object.keys(state).sort()).toEqual(
      ["flipX", "rotation", "scale", "x", "y"].sort(),
    );
  });
});
