import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConvertPage from "@/app/convert/page";
import type { LineArtSettings, PixelBuffer } from "@/lib/edges";
import { renderLineArtAsync, terminateLineArtWorker } from "@/lib/edgesClient";
import { downscaleToMax } from "@/lib/image";
import { importPhoto } from "@/lib/import";
import { takePendingImport } from "@/lib/pendingImport";
import { readPreferences } from "@/lib/preferences";
import { getReference, saveReference, updateReference } from "@/lib/storage";

const NativeBlob = NodeBlob as unknown as typeof Blob;

// ---------------------------------------------------------------------------
// Mocks — this screen has no browser canvas/worker in jsdom, so every
// canvas-dependent and worker-dependent module is replaced (per the ticket's
// own instructions).
// ---------------------------------------------------------------------------

const push = vi.fn();
let currentRef: string | null = null;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => ({
    get: (key: string) => (key === "ref" ? currentRef : null),
  }),
}));

vi.mock("@/lib/edgesClient", () => ({
  renderLineArtAsync: vi.fn(),
  terminateLineArtWorker: vi.fn(),
}));

vi.mock("@/lib/image", () => ({
  downscaleToMax: vi.fn(),
}));

vi.mock("@/lib/import", () => ({
  importPhoto: vi.fn(),
}));

vi.mock("@/lib/pendingImport", () => ({
  takePendingImport: vi.fn(),
}));

vi.mock("@/lib/preferences", () => ({
  readPreferences: vi.fn(),
}));

vi.mock("@/lib/storage", () => ({
  getReference: vi.fn(),
  saveReference: vi.fn(),
  updateReference: vi.fn(),
}));

const renderLineArtAsyncMock = vi.mocked(renderLineArtAsync);
const downscaleToMaxMock = vi.mocked(downscaleToMax);
const importPhotoMock = vi.mocked(importPhoto);
const takePendingImportMock = vi.mocked(takePendingImport);
const readPreferencesMock = vi.mocked(readPreferences);
const getReferenceMock = vi.mocked(getReference);
const saveReferenceMock = vi.mocked(saveReference);
const updateReferenceMock = vi.mocked(updateReference);
const terminateLineArtWorkerMock = vi.mocked(terminateLineArtWorker);

// ---------------------------------------------------------------------------
// Canvas — jsdom has no real 2D context. Minimal mock on the prototype, per
// the ticket's instruction.
// ---------------------------------------------------------------------------

const putImageData = vi.fn();
let toBlobResult: Blob | null = new NativeBlob(["png"], { type: "image/png" });

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    putImageData,
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toBlob = vi.fn(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
  ) {
    callback(toBlobResult);
  }) as unknown as typeof HTMLCanvasElement.prototype.toBlob;

  // jsdom does not implement these; the compare overlay and the encode step
  // both need them.
  URL.createObjectURL = vi.fn(() => "blob:mock-url");
  URL.revokeObjectURL = vi.fn();
});

function makeSourcePixels(width = 4, height = 4): PixelBuffer {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(200) };
}

function makeLineArt(width = 4, height = 4): PixelBuffer {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(0) };
}

function makeOriginalBlob(): Blob {
  return new NativeBlob(["orig"], { type: "image/jpeg" });
}

function makeThumbnailBlob(): Blob {
  return new NativeBlob(["thumb"], { type: "image/jpeg" });
}

beforeEach(() => {
  vi.useFakeTimers();
  push.mockClear();
  currentRef = null;
  putImageData.mockClear();
  toBlobResult = new NativeBlob(["png"], { type: "image/png" });

  renderLineArtAsyncMock.mockReset();
  renderLineArtAsyncMock.mockResolvedValue(makeLineArt());
  downscaleToMaxMock.mockReset();
  downscaleToMaxMock.mockResolvedValue(makeSourcePixels());
  importPhotoMock.mockReset();
  takePendingImportMock.mockReset();
  takePendingImportMock.mockReturnValue(null);
  readPreferencesMock.mockReset();
  readPreferencesMock.mockResolvedValue({ defaultOpacity: 50, keepAwake: true, cameraFacing: "environment" });
  getReferenceMock.mockReset();
  saveReferenceMock.mockReset();
  updateReferenceMock.mockReset();
  terminateLineArtWorkerMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function settle() {
  // Flush the microtask queue produced by the entry-load promise chain
  // before advancing the debounce timer.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advanceDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(120);
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ---------------------------------------------------------------------------
// (a) Pending import — four controls render at engine defaults, one
// conversion is requested.
// ---------------------------------------------------------------------------

describe("ConvertPage — pending import", () => {
  it("renders the four controls at engine defaults and requests one conversion", async () => {
    takePendingImportMock.mockReturnValue({
      original: makeOriginalBlob(),
      width: 100,
      height: 100,
      thumbnail: makeThumbnailBlob(),
    });

    render(<ConvertPage />);
    await settle();

    expect((screen.getByLabelText("Edge strength") as HTMLInputElement).value).toBe("50");
    expect((screen.getByLabelText("Threshold") as HTMLInputElement).value).toBe("50");
    expect((screen.getByLabelText("Line thickness") as HTMLInputElement).value).toBe("1");
    expect(
      screen.getByRole("button", { name: "Invert" }).getAttribute("aria-pressed"),
    ).toBe("false");

    await advanceDebounce();
    expect(renderLineArtAsyncMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// (b) ?ref= path — getReference is called and controls initialise from the
// stored settings.
// ---------------------------------------------------------------------------

describe("ConvertPage — re-tune via ?ref=", () => {
  it("loads the reference and restores its stored settings", async () => {
    currentRef = "ref-123";
    const storedSettings: LineArtSettings = {
      edgeStrength: 80,
      threshold: 30,
      thickness: 3,
      inverted: true,
    };
    getReferenceMock.mockResolvedValue({
      ok: true,
      value: {
        id: "ref-123",
        name: "My reference",
        originalImage: makeOriginalBlob(),
        lineArtImage: makeOriginalBlob(),
        thumbnail: makeThumbnailBlob(),
        settings: storedSettings,
        lastOpacity: 50,
        createdAt: 1,
      },
    });

    render(<ConvertPage />);
    await settle();

    expect(getReferenceMock).toHaveBeenCalledWith("ref-123");
    expect((screen.getByLabelText("Edge strength") as HTMLInputElement).value).toBe("80");
    expect((screen.getByLabelText("Threshold") as HTMLInputElement).value).toBe("30");
    expect((screen.getByLabelText("Line thickness") as HTMLInputElement).value).toBe("3");
    expect(
      screen.getByRole("button", { name: "Invert" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// (c) Slider change — a new conversion is requested with the updated
// setting, and the pristine source array is never handed over directly.
// ---------------------------------------------------------------------------

describe("ConvertPage — slider change", () => {
  it("requests a new conversion with a copy of the pristine source, not the same instance", async () => {
    takePendingImportMock.mockReturnValue({
      original: makeOriginalBlob(),
      width: 100,
      height: 100,
      thumbnail: makeThumbnailBlob(),
    });
    const source = makeSourcePixels();
    downscaleToMaxMock.mockResolvedValue(source);

    render(<ConvertPage />);
    await settle();
    await advanceDebounce();
    expect(renderLineArtAsyncMock).toHaveBeenCalledTimes(1);

    const firstCallData = renderLineArtAsyncMock.mock.calls[0][0].data;
    expect(firstCallData).not.toBe(source.data);
    expect(firstCallData).toEqual(source.data);

    fireEvent.change(screen.getByLabelText("Edge strength"), { target: { value: "75" } });
    await advanceDebounce();

    expect(renderLineArtAsyncMock).toHaveBeenCalledTimes(2);
    const secondCall = renderLineArtAsyncMock.mock.calls[1];
    expect(secondCall[1].edgeStrength).toBe(75);
    expect(secondCall[0].data).not.toBe(source.data);
    expect(secondCall[0].data).not.toBe(firstCallData);
  });
});

// ---------------------------------------------------------------------------
// (d) Save on a new import.
// ---------------------------------------------------------------------------

describe("ConvertPage — save (new import)", () => {
  it("calls saveReference with a PNG blob and settings, then navigates to /trace/<id>", async () => {
    takePendingImportMock.mockReturnValue({
      original: makeOriginalBlob(),
      width: 100,
      height: 100,
      thumbnail: makeThumbnailBlob(),
    });
    saveReferenceMock.mockResolvedValue({
      ok: true,
      value: {
        id: "new-id",
        name: "Untitled",
        originalImage: makeOriginalBlob(),
        lineArtImage: makeOriginalBlob(),
        thumbnail: makeThumbnailBlob(),
        settings: {
          edgeStrength: 50,
          threshold: 50,
          thickness: 1,
          inverted: false,
        },
        lastOpacity: 50,
        createdAt: 1,
      },
    });

    render(<ConvertPage />);
    await settle();
    await advanceDebounce();

    fireEvent.click(screen.getByRole("button", { name: "Save to library" }));
    await settle();

    expect(saveReferenceMock).toHaveBeenCalledTimes(1);
    const call = saveReferenceMock.mock.calls[0][0];
    expect(call.lineArtImage.type).toBe("image/png");
    expect(call.settings).toEqual({
      edgeStrength: 50,
      threshold: 50,
      thickness: 1,
      inverted: false,
    });
    expect(push).toHaveBeenCalledWith("/trace/new-id");
  });
});

// ---------------------------------------------------------------------------
// (d2) Save on a new import uses the Settings default opacity, not a
// hardcoded value.
// ---------------------------------------------------------------------------

describe("ConvertPage — save uses the Settings default opacity", () => {
  it("passes the stored default opacity as lastOpacity on a new import", async () => {
    takePendingImportMock.mockReturnValue({
      original: makeOriginalBlob(),
      width: 100,
      height: 100,
      thumbnail: makeThumbnailBlob(),
    });
    readPreferencesMock.mockResolvedValue({ defaultOpacity: 30, keepAwake: true, cameraFacing: "environment" });
    saveReferenceMock.mockResolvedValue({
      ok: true,
      value: {
        id: "new-id",
        name: "Untitled",
        originalImage: makeOriginalBlob(),
        lineArtImage: makeOriginalBlob(),
        thumbnail: makeThumbnailBlob(),
        settings: {
          edgeStrength: 50,
          threshold: 50,
          thickness: 1,
          inverted: false,
        },
        lastOpacity: 30,
        createdAt: 1,
      },
    });

    render(<ConvertPage />);
    await settle();
    await advanceDebounce();

    fireEvent.click(screen.getByRole("button", { name: "Save to library" }));
    await settle();

    expect(saveReferenceMock).toHaveBeenCalledTimes(1);
    const call = saveReferenceMock.mock.calls[0][0];
    expect(call.lastOpacity).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// (e) Save failure.
// ---------------------------------------------------------------------------

describe("ConvertPage — save failure", () => {
  it("shows the inline error and does not navigate", async () => {
    takePendingImportMock.mockReturnValue({
      original: makeOriginalBlob(),
      width: 100,
      height: 100,
      thumbnail: makeThumbnailBlob(),
    });
    saveReferenceMock.mockResolvedValue({
      ok: false,
      error: { kind: "quota-exceeded", message: "There isn't enough space left." },
    });

    render(<ConvertPage />);
    await settle();
    await advanceDebounce();

    fireEvent.click(screen.getByRole("button", { name: "Save to library" }));
    await settle();

    screen.getByText("There isn't enough space left.");
    expect(push).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "Save to library" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (f) Nothing pending and no ref.
// ---------------------------------------------------------------------------

describe("ConvertPage — nothing to convert", () => {
  it("shows a short message and a way back to the library", async () => {
    render(<ConvertPage />);
    await settle();

    screen.getByText("Nothing to convert. Pick a photo from the library first.");

    fireEvent.click(screen.getByRole("button", { name: "Back to library" }));
    expect(push).toHaveBeenCalledWith("/");
  });
});

// ---------------------------------------------------------------------------
// (g) Back (FTA-018).
// ---------------------------------------------------------------------------

function pickFile(input: HTMLInputElement, file: File | undefined) {
  Object.defineProperty(input, "files", {
    value: file ? [file] : [],
    configurable: true,
  });
  fireEvent.change(input);
}

function makeFile(): File {
  return new File(["data"], "photo.jpg", { type: "image/jpeg" });
}

// The photo-picker's onPicked callback chains an extra promise (importPhoto
// resolving, then downscaleToMax resolving inside it) beyond what settle()'s
// two ticks drain — same reasoning as trace-chrome.test.tsx's extra-tick
// settle() for its own deeper effect chain.
async function settlePhotoPick() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ConvertPage — Back on a new import", () => {
  it("returns to the library and saves nothing", async () => {
    takePendingImportMock.mockReturnValue({
      original: makeOriginalBlob(),
      width: 100,
      height: 100,
      thumbnail: makeThumbnailBlob(),
    });

    render(<ConvertPage />);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(push).toHaveBeenCalledWith("/");
    expect(saveReferenceMock).not.toHaveBeenCalled();
  });
});

describe("ConvertPage — Back on a re-tune (?ref=)", () => {
  it("returns to that trace screen and updates nothing", async () => {
    currentRef = "ref-123";
    getReferenceMock.mockResolvedValue({
      ok: true,
      value: {
        id: "ref-123",
        name: "My reference",
        originalImage: makeOriginalBlob(),
        lineArtImage: makeOriginalBlob(),
        thumbnail: makeThumbnailBlob(),
        settings: { edgeStrength: 50, threshold: 50, thickness: 1, inverted: false },
        lastOpacity: 50,
        createdAt: 1,
      },
    });

    render(<ConvertPage />);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(push).toHaveBeenCalledWith("/trace/ref-123");
    expect(updateReferenceMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (h) "Choose a different photo" (FTA-018).
// ---------------------------------------------------------------------------

describe('ConvertPage — "Choose a different photo"', () => {
  it("swaps the source, resets the controls to defaults, and requests a new conversion in place", async () => {
    takePendingImportMock.mockReturnValue({
      original: makeOriginalBlob(),
      width: 100,
      height: 100,
      thumbnail: makeThumbnailBlob(),
    });

    render(<ConvertPage />);
    await settle();
    await advanceDebounce();
    expect(renderLineArtAsyncMock).toHaveBeenCalledTimes(1);

    // Move a slider off its default first, so the reset below is observable.
    fireEvent.change(screen.getByLabelText("Edge strength"), { target: { value: "75" } });
    await advanceDebounce();
    expect(renderLineArtAsyncMock).toHaveBeenCalledTimes(2);

    const newSource = makeSourcePixels(8, 8);
    downscaleToMaxMock.mockResolvedValue(newSource);
    const file = makeFile();
    importPhotoMock.mockResolvedValue({
      ok: true,
      value: {
        original: makeOriginalBlob(),
        width: 50,
        height: 50,
        thumbnail: makeThumbnailBlob(),
      },
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    pickFile(input, file);
    await settlePhotoPick();

    expect(importPhotoMock).toHaveBeenCalledWith(file);
    // Controls back at engine defaults.
    expect((screen.getByLabelText("Edge strength") as HTMLInputElement).value).toBe("50");
    expect((screen.getByLabelText("Threshold") as HTMLInputElement).value).toBe("50");
    expect((screen.getByLabelText("Line thickness") as HTMLInputElement).value).toBe("1");
    // No navigation — the swap happens in place.
    expect(push).not.toHaveBeenCalled();

    await advanceDebounce();
    expect(renderLineArtAsyncMock).toHaveBeenCalledTimes(3);
    expect(renderLineArtAsyncMock.mock.calls[2][0].data).toEqual(newSource.data);
  });

  it("leaves the current photo untouched when the picker is cancelled", async () => {
    takePendingImportMock.mockReturnValue({
      original: makeOriginalBlob(),
      width: 100,
      height: 100,
      thumbnail: makeThumbnailBlob(),
    });

    render(<ConvertPage />);
    await settle();
    await advanceDebounce();
    expect(renderLineArtAsyncMock).toHaveBeenCalledTimes(1);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    pickFile(input, undefined);
    await settlePhotoPick();

    expect(importPhotoMock).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Edge strength") as HTMLInputElement).value).toBe("50");
    expect(renderLineArtAsyncMock).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (i) Save after a source swap on a re-tune entry (FTA-018 round 2). A swap
// makes the stored reference's originalImage/thumbnail stale, so Save must
// persist the new ones alongside the re-converted line art; a save with no
// swap must keep the original patch shape exactly (settings/line-art only).
// ---------------------------------------------------------------------------

describe("ConvertPage — Save after a photo swap on a re-tune entry", () => {
  it("persists the new originalImage and thumbnail alongside the re-converted line art", async () => {
    currentRef = "ref-123";
    getReferenceMock.mockResolvedValue({
      ok: true,
      value: {
        id: "ref-123",
        name: "My reference",
        originalImage: makeOriginalBlob(),
        lineArtImage: makeOriginalBlob(),
        thumbnail: makeThumbnailBlob(),
        settings: { edgeStrength: 50, threshold: 50, thickness: 1, inverted: false },
        lastOpacity: 50,
        createdAt: 1,
      },
    });
    updateReferenceMock.mockResolvedValue({
      ok: true,
      value: {
        id: "ref-123",
        name: "My reference",
        originalImage: makeOriginalBlob(),
        lineArtImage: makeOriginalBlob(),
        thumbnail: makeThumbnailBlob(),
        settings: { edgeStrength: 50, threshold: 50, thickness: 1, inverted: false },
        lastOpacity: 50,
        createdAt: 1,
      },
    });

    render(<ConvertPage />);
    await settle();
    await advanceDebounce();

    const newOriginal = makeOriginalBlob();
    const newThumbnail = makeThumbnailBlob();
    importPhotoMock.mockResolvedValue({
      ok: true,
      value: { original: newOriginal, width: 50, height: 50, thumbnail: newThumbnail },
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    pickFile(input, makeFile());
    await settlePhotoPick();
    await advanceDebounce();

    fireEvent.click(screen.getByRole("button", { name: "Save to library" }));
    await settle();

    expect(updateReferenceMock).toHaveBeenCalledTimes(1);
    const patch = updateReferenceMock.mock.calls[0][1];
    expect(patch.originalImage).toBe(newOriginal);
    expect(patch.thumbnail).toBe(newThumbnail);
    expect(push).toHaveBeenCalledWith("/trace/ref-123");
  });

  it("omits originalImage and thumbnail when the photo was never swapped", async () => {
    currentRef = "ref-123";
    getReferenceMock.mockResolvedValue({
      ok: true,
      value: {
        id: "ref-123",
        name: "My reference",
        originalImage: makeOriginalBlob(),
        lineArtImage: makeOriginalBlob(),
        thumbnail: makeThumbnailBlob(),
        settings: { edgeStrength: 50, threshold: 50, thickness: 1, inverted: false },
        lastOpacity: 50,
        createdAt: 1,
      },
    });
    updateReferenceMock.mockResolvedValue({
      ok: true,
      value: {
        id: "ref-123",
        name: "My reference",
        originalImage: makeOriginalBlob(),
        lineArtImage: makeOriginalBlob(),
        thumbnail: makeThumbnailBlob(),
        settings: { edgeStrength: 50, threshold: 50, thickness: 1, inverted: false },
        lastOpacity: 50,
        createdAt: 1,
      },
    });

    render(<ConvertPage />);
    await settle();
    await advanceDebounce();

    // No photo swap this time — just move a slider, same as any ordinary re-tune.
    fireEvent.change(screen.getByLabelText("Edge strength"), { target: { value: "60" } });
    await advanceDebounce();

    fireEvent.click(screen.getByRole("button", { name: "Save to library" }));
    await settle();

    expect(updateReferenceMock).toHaveBeenCalledTimes(1);
    const patch = updateReferenceMock.mock.calls[0][1];
    expect(patch).toEqual({
      lineArtImage: expect.any(Object),
      settings: { edgeStrength: 60, threshold: 50, thickness: 1, inverted: false },
    });
    expect("originalImage" in patch).toBe(false);
    expect("thumbnail" in patch).toBe(false);
    expect(push).toHaveBeenCalledWith("/trace/ref-123");
  });
});

// ---------------------------------------------------------------------------
// Unmount — terminates the worker.
// ---------------------------------------------------------------------------

describe("ConvertPage — unmount", () => {
  it("terminates the line-art worker", async () => {
    const { unmount } = render(<ConvertPage />);
    await settle();
    unmount();
    expect(terminateLineArtWorkerMock).toHaveBeenCalledTimes(1);
  });
});
