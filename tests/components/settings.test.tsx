import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Settings } from "@/components/Settings";
import { getPreference, setPreference, clearAll } from "@/lib/storage";
import { PREF_DEFAULT_OPACITY, PREF_KEEP_AWAKE } from "@/lib/preferences";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>(
    "@/lib/storage",
  );
  return {
    ...actual,
    getPreference: vi.fn(),
    setPreference: vi.fn(),
    clearAll: vi.fn(),
  };
});

const getPreferenceMock = vi.mocked(getPreference);
const setPreferenceMock = vi.mocked(setPreference);
const clearAllMock = vi.mocked(clearAll);

function mockPrefs(opacity: number, keepAwake: boolean) {
  getPreferenceMock.mockImplementation(async (key: string) => {
    if (key === PREF_DEFAULT_OPACITY) return { ok: true, value: opacity };
    if (key === PREF_KEEP_AWAKE) return { ok: true, value: keepAwake };
    throw new Error(`unexpected key ${key}`);
  });
}

beforeEach(() => {
  push.mockClear();
  getPreferenceMock.mockReset();
  setPreferenceMock.mockReset();
  clearAllMock.mockReset();
  setPreferenceMock.mockResolvedValue({ ok: true, value: undefined });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Settings — renders stored values", () => {
  it("shows the mocked opacity and keep-awake state from getPreference", async () => {
    mockPrefs(30, false);

    render(<Settings />);

    const slider = await screen.findByLabelText("Default opacity");
    expect((slider as HTMLInputElement).value).toBe("30");

    const toggle = screen.getByRole("switch", { name: "Keep screen awake" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });
});

describe("Settings — opacity slider", () => {
  it("saves after the debounce, not immediately", async () => {
    mockPrefs(50, true);

    render(<Settings />);
    const slider = await screen.findByLabelText("Default opacity");

    // Fake timers only go on AFTER the initial load resolves — testing
    // library's `findBy*` helpers poll via a real setTimeout internally, and
    // faking the clock before that resolves hangs the test for real.
    vi.useFakeTimers();
    fireEvent.change(slider, { target: { value: "70" } });

    expect(setPreferenceMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);

    expect(setPreferenceMock).toHaveBeenCalledWith(PREF_DEFAULT_OPACITY, 70);
  });
});

describe("Settings — keep-awake toggle", () => {
  it("saves immediately and flips aria-checked", async () => {
    mockPrefs(50, true);

    render(<Settings />);
    const toggle = await screen.findByRole("switch", {
      name: "Keep screen awake",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(setPreferenceMock).toHaveBeenCalledWith(PREF_KEEP_AWAKE, false),
    );
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });
});

describe("Settings — clear all data", () => {
  it("keeps confirm disabled until DELETE is typed, then clears and navigates home", async () => {
    mockPrefs(50, true);
    clearAllMock.mockResolvedValue({ ok: true, value: undefined });

    render(<Settings />);
    await screen.findByRole("button", { name: "Clear all data" });

    fireEvent.click(screen.getByRole("button", { name: "Clear all data" }));

    // Disambiguate: after opening, there are two "Clear all data" buttons —
    // the card trigger and the dialog confirm. Grab the dialog's.
    const dialogConfirm = screen.getAllByRole("button", {
      name: "Clear all data",
    })[1];
    expect(dialogConfirm.hasAttribute("disabled")).toBe(true);

    const input = screen.getByLabelText(`Type DELETE to confirm`);
    fireEvent.change(input, { target: { value: "wrong" } });
    expect(dialogConfirm.hasAttribute("disabled")).toBe(true);

    fireEvent.change(input, { target: { value: "DELETE" } });
    expect(dialogConfirm.hasAttribute("disabled")).toBe(false);

    fireEvent.click(dialogConfirm);

    await waitFor(() => expect(clearAllMock).toHaveBeenCalled());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("typing the wrong word keeps confirm disabled and never calls clearAll", async () => {
    mockPrefs(50, true);

    render(<Settings />);
    await screen.findByRole("button", { name: "Clear all data" });

    fireEvent.click(screen.getByRole("button", { name: "Clear all data" }));
    const input = await screen.findByLabelText("Type DELETE to confirm");
    fireEvent.change(input, { target: { value: "delete" } });

    const dialogConfirm = screen.getAllByRole("button", {
      name: "Clear all data",
    })[1];
    expect(dialogConfirm.hasAttribute("disabled")).toBe(true);

    fireEvent.click(dialogConfirm);
    expect(clearAllMock).not.toHaveBeenCalled();
  });

  it("cancel never calls clearAll", async () => {
    mockPrefs(50, true);

    render(<Settings />);
    await screen.findByRole("button", { name: "Clear all data" });

    fireEvent.click(screen.getByRole("button", { name: "Clear all data" }));
    await screen.findByLabelText("Type DELETE to confirm");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(clearAllMock).not.toHaveBeenCalled();
  });

  it("a clearAll failure renders an inline message and does not navigate", async () => {
    mockPrefs(50, true);
    clearAllMock.mockResolvedValue({
      ok: false,
      error: { kind: "unknown", message: "Something went wrong." },
    });

    render(<Settings />);
    await screen.findByRole("button", { name: "Clear all data" });

    fireEvent.click(screen.getByRole("button", { name: "Clear all data" }));
    const input = await screen.findByLabelText("Type DELETE to confirm");
    fireEvent.change(input, { target: { value: "DELETE" } });

    const dialogConfirm = screen.getAllByRole("button", {
      name: "Clear all data",
    })[1];
    fireEvent.click(dialogConfirm);

    await screen.findByText("Something went wrong.");
    expect(push).not.toHaveBeenCalledWith("/");
  });
});
