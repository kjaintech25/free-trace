import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_MS, TraceScreen } from "@/components/TraceScreen";
import { getPreference, getReference, updateReference } from "@/lib/storage";
import type { Reference } from "@/lib/storage";

/**
 * T-11: the collapsing control bar and the wake lock hook, plus the
 * id-neutral client-side load carried from KNOWN_ISSUES.md §3.
 *
 * 🔴 Fake-timer trap (carried from T-13): `vi.useFakeTimers()` is only ever
 * called AFTER the first render has settled with real timers. RTL's
 * `findBy*`/the initial `await act` polling uses real `setTimeout`
 * internally — flipping to fake timers before that settles hangs the test.
 */

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
const useParamsMock = vi.hoisted(() => vi.fn(() => ({}) as Record<string, unknown>));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useParams: useParamsMock,
}));

vi.mock("@/lib/storage", () => ({
  getReference: vi.fn(),
  updateReference: vi.fn(),
  getPreference: vi.fn(),
}));

const getReferenceMock = vi.mocked(getReference);
const updateReferenceMock = vi.mocked(updateReference);
const getPreferenceMock = vi.mocked(getPreference);

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
const OTHER_ID = "ref-2";

function makeReference(id: string, lastOpacity = 60): Reference {
  const png = new Blob(["line-art"], { type: "image/png" });
  return {
    id,
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
    lastOpacity,
    createdAt: 1,
  };
}

async function settle(): Promise<void> {
  // A few extra ticks over trace-screen.test.tsx's settle(): this file's
  // mount effects chain through readPreferences()'s own Promise.all on top
  // of the reference load, so it needs a couple more microtask turns to
  // fully drain before assertions run.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderScreen(id = REF_ID): Promise<void> {
  render(<TraceScreen id={id} />);
  await settle();
}

function chrome(): HTMLElement {
  const node = document.querySelector<HTMLElement>('[data-slot="chrome"]');
  if (node === null) throw new Error("no chrome slot rendered");
  return node;
}

function overlay(): HTMLElement {
  const node = document.querySelector<HTMLElement>('[data-slot="overlay"]');
  if (node === null) throw new Error("no overlay slot rendered");
  return node;
}

beforeEach(() => {
  getReferenceMock.mockReset();
  getReferenceMock.mockResolvedValue({ ok: true, value: makeReference(REF_ID) });
  updateReferenceMock.mockReset();
  updateReferenceMock.mockResolvedValue({ ok: true, value: makeReference(REF_ID) });
  getPreferenceMock.mockReset();
  // Default: no preference row set, so readPreferences() falls through to
  // its defaults (keepAwake: true) — the same default a fresh install has.
  getPreferenceMock.mockResolvedValue({ ok: true, value: undefined });
  createObjectURL.mockReset();
  createObjectURL.mockImplementation(() => "blob:free-trace/line-art");
  revokeObjectURL.mockReset();
  pushMock.mockReset();
  useParamsMock.mockReset();
  useParamsMock.mockReturnValue({});
  window.history.pushState({}, "", "/");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// collapsing control bar
// ---------------------------------------------------------------------------

describe("TraceScreen — collapsing control chrome (SPEC §6.3)", () => {
  it("renders expanded on mount", async () => {
    await renderScreen();

    expect(chrome().dataset.chrome).toBe("expanded");
  });

  it("collapses to a pill after IDLE_MS of no interaction", async () => {
    // Fake timers installed BEFORE render, not after: the idle timer is
    // armed in a mount effect, and a setTimeout created under real timers
    // cannot later be advanced by vi.advanceTimersByTime. settle() below
    // only ever awaits plain microtasks (never RTL's findBy*, which is the
    // one thing that needs real timers), so this ordering is safe.
    vi.useFakeTimers();
    await renderScreen();

    act(() => {
      vi.advanceTimersByTime(IDLE_MS);
    });

    expect(chrome().dataset.chrome).toBe("collapsed");
    const pill = screen.getByRole("button", { name: /show controls/i });
    expect(pill).toBeTruthy();
    expect(pill.textContent).toContain("60%");
  });

  it("does not collapse before IDLE_MS has elapsed", async () => {
    vi.useFakeTimers();
    await renderScreen();

    act(() => {
      vi.advanceTimersByTime(IDLE_MS - 100);
    });

    expect(chrome().dataset.chrome).toBe("expanded");
  });

  it("restores the full bar and restarts the timer on a tap anywhere on the screen", async () => {
    vi.useFakeTimers();
    await renderScreen();

    act(() => {
      vi.advanceTimersByTime(IDLE_MS);
    });
    expect(chrome().dataset.chrome).toBe("collapsed");

    const pill = screen.getByRole("button", { name: /show controls/i });
    fireEvent.pointerDown(pill, { pointerId: 1 });

    expect(chrome().dataset.chrome).toBe("expanded");

    // The timer restarted rather than being left to fire on the old
    // schedule: just short of a fresh IDLE_MS it is still expanded.
    act(() => {
      vi.advanceTimersByTime(IDLE_MS - 100);
    });
    expect(chrome().dataset.chrome).toBe("expanded");

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(chrome().dataset.chrome).toBe("collapsed");
  });

  it("does not collapse mid-gesture: a pointer event on the overlay counts as interaction", async () => {
    vi.useFakeTimers();
    await renderScreen();

    // Most of the idle window elapses, then a gesture starts on the overlay.
    act(() => {
      vi.advanceTimersByTime(IDLE_MS - 200);
    });
    expect(chrome().dataset.chrome).toBe("expanded");

    fireEvent.pointerDown(overlay(), { pointerId: 1, clientX: 10, clientY: 10 });

    // Past the ORIGINAL deadline — the gesture's pointerdown must have reset
    // the timer, or this would already be collapsed.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(chrome().dataset.chrome).toBe("expanded");
  });

  it("counts a slider move as interaction and does not collapse mid-drag", async () => {
    vi.useFakeTimers();
    await renderScreen();

    act(() => {
      vi.advanceTimersByTime(IDLE_MS - 200);
    });

    fireEvent.change(screen.getByLabelText("Opacity"), { target: { value: "80" } });

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(chrome().dataset.chrome).toBe("expanded");
  });
});

// ---------------------------------------------------------------------------
// wake lock
// ---------------------------------------------------------------------------

describe("TraceScreen — wake lock (SPEC §6.3, §10 item 5, carried T-13)", () => {
  const originalWakeLock = (navigator as Navigator & { wakeLock?: WakeLock })
    .wakeLock;

  function installWakeLock() {
    const release = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const request = vi
      .fn()
      .mockResolvedValue({ release, released: false, type: "screen" });
    Object.defineProperty(navigator, "wakeLock", {
      value: { request },
      configurable: true,
      writable: true,
    });
    return { request, release };
  }

  afterEach(() => {
    Object.defineProperty(navigator, "wakeLock", {
      value: originalWakeLock,
      configurable: true,
      writable: true,
    });
  });

  it("acquires the wake lock on mount when keepAwake is true (default)", async () => {
    const { request } = installWakeLock();

    await renderScreen();

    expect(request).toHaveBeenCalledWith("screen");
  });

  it("does not acquire the wake lock when keepAwake is false", async () => {
    const { request } = installWakeLock();
    getPreferenceMock.mockResolvedValue({ ok: true, value: false });

    await renderScreen();

    expect(request).not.toHaveBeenCalled();
  });

  it("releases the wake lock on unmount", async () => {
    const { release } = installWakeLock();
    const view = render(<TraceScreen id={REF_ID} />);
    await settle();

    view.unmount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(release).toHaveBeenCalled();
  });

  it("re-acquires the wake lock on visibilitychange to visible", async () => {
    const { request, release } = installWakeLock();
    await renderScreen();
    expect(request).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    fireEvent(document, new Event("visibilitychange"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(release).toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    fireEvent(document, new Event("visibilitychange"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(request).toHaveBeenCalledTimes(2);
  });

  it("degrades silently when navigator.wakeLock is unsupported — no error, no toast", async () => {
    Object.defineProperty(navigator, "wakeLock", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await renderScreen();

    expect(logged).not.toHaveBeenCalled();
    expect(screen.queryByText(/wake lock/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// effective id (carried KNOWN_ISSUES.md §3)
// ---------------------------------------------------------------------------

describe("TraceScreen — effective id is derived client-side (KNOWN_ISSUES.md §3)", () => {
  it("loads the useParams id over a mismatched prop id", async () => {
    useParamsMock.mockReturnValue({ id: OTHER_ID });
    getReferenceMock.mockResolvedValue({ ok: true, value: makeReference(OTHER_ID) });

    await renderScreen(REF_ID);

    expect(getReferenceMock).toHaveBeenCalledWith(OTHER_ID);
    expect(document.querySelector("main")?.dataset.referenceId).toBe(OTHER_ID);
  });

  it("falls back to window.location.pathname when useParams has nothing", async () => {
    useParamsMock.mockReturnValue({});
    window.history.pushState({}, "", `/trace/${OTHER_ID}`);
    getReferenceMock.mockResolvedValue({ ok: true, value: makeReference(OTHER_ID) });

    await renderScreen(REF_ID);

    expect(getReferenceMock).toHaveBeenCalledWith(OTHER_ID);
    expect(document.querySelector("main")?.dataset.referenceId).toBe(OTHER_ID);
  });

  it("falls back to the server-rendered prop id when neither client source has one", async () => {
    useParamsMock.mockReturnValue({});
    window.history.pushState({}, "", "/");

    await renderScreen(REF_ID);

    expect(getReferenceMock).toHaveBeenCalledWith(REF_ID);
    expect(document.querySelector("main")?.dataset.referenceId).toBe(REF_ID);
  });
});
