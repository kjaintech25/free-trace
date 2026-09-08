import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Library } from "@/components/Library";
import {
  deleteReference,
  listReferences,
  updateReference,
  type Reference,
} from "@/lib/storage";

// Same jsdom-Blob trap as tests/storage.test.ts — see that file's harness
// note. Not strictly load-bearing here (these Blobs never round-trip
// through structuredClone), but keeping the global consistent avoids a
// silent mismatch if a future test in this file starts using storage for
// real.
const NativeBlob = NodeBlob as unknown as typeof Blob;

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
    listReferences: vi.fn(),
    updateReference: vi.fn(),
    deleteReference: vi.fn(),
  };
});

const listReferencesMock = vi.mocked(listReferences);
const updateReferenceMock = vi.mocked(updateReference);
const deleteReferenceMock = vi.mocked(deleteReference);

function makeReference(overrides: Partial<Reference> = {}): Reference {
  return {
    id: overrides.id ?? "ref-1",
    name: overrides.name ?? "Untitled",
    originalImage: new NativeBlob(["o"], { type: "image/jpeg" }),
    lineArtImage: new NativeBlob(["l"], { type: "image/png" }),
    thumbnail: new NativeBlob(["t"], { type: "image/jpeg" }),
    settings: { edgeStrength: 50, threshold: 100, thickness: 1, inverted: false },
    lastOpacity: 100,
    createdAt: overrides.createdAt ?? Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  push.mockClear();
  listReferencesMock.mockReset();
  updateReferenceMock.mockReset();
  deleteReferenceMock.mockReset();

  // jsdom has neither of these (see ticket note).
  URL.createObjectURL = vi.fn(() => "blob:mock-url");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Library — loading state", () => {
  it("shows a muted Loading line before the first listReferences resolves, never the empty copy", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof listReferences>>) => void;
    listReferencesMock.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );

    render(<Library />);

    expect(screen.getByText("Loading…")).not.toBeNull();
    expect(
      screen.queryByText("No references yet — add a photo to trace."),
    ).toBeNull();

    resolve({ ok: true, value: [] });
    await screen.findByText("No references yet — add a photo to trace.");
  });
});

describe("Library — empty state", () => {
  it("renders the empty copy and the add-photo button", async () => {
    listReferencesMock.mockResolvedValue({ ok: true, value: [] });

    render(<Library />);

    await screen.findByText("No references yet — add a photo to trace.");
    expect(screen.getByText("+ Add photo")).not.toBeNull();
  });
});

describe("Library — a failed list", () => {
  it("renders the storage error message, never a blank screen", async () => {
    listReferencesMock.mockResolvedValue({
      ok: false,
      error: { kind: "unknown", message: "Something went wrong reading your library. Please try again." },
    });

    render(<Library />);

    await screen.findByText(
      "Something went wrong reading your library. Please try again.",
    );
    expect(
      screen.queryByText("No references yet — add a photo to trace."),
    ).toBeNull();
  });
});

describe("Library — populated grid", () => {
  it("renders one card per reference, newest first as returned by listReferences", async () => {
    const refs = [
      makeReference({ id: "c", name: "Third", createdAt: 3 }),
      makeReference({ id: "b", name: "Second", createdAt: 2 }),
      makeReference({ id: "a", name: "First", createdAt: 1 }),
    ];
    listReferencesMock.mockResolvedValue({ ok: true, value: refs });

    render(<Library />);

    await screen.findByText("Third");
    const names = screen.getAllByText(/^(Third|Second|First)$/).map((el) => el.textContent);
    expect(names).toEqual(["Third", "Second", "First"]);
  });

  it("links each card to /trace/<id>", async () => {
    listReferencesMock.mockResolvedValue({
      ok: true,
      value: [makeReference({ id: "ref-42", name: "My Sketch" })],
    });

    render(<Library />);

    const card = await screen.findByRole("button", { name: "Open My Sketch" });
    fireEvent.click(card);

    expect(push).toHaveBeenCalledWith("/trace/ref-42");
  });

  it("creates and revokes object URLs for thumbnails in one effect (unmount revokes)", async () => {
    listReferencesMock.mockResolvedValue({
      ok: true,
      value: [makeReference({ id: "ref-1" })],
    });

    const { unmount } = render(<Library />);
    await screen.findByRole("button", { name: /Open/ });

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });
});

describe("Library — delete flow", () => {
  it("overflow -> Delete -> ConfirmDialog -> confirm calls deleteReference and removes the card", async () => {
    listReferencesMock
      .mockResolvedValueOnce({
        ok: true,
        value: [makeReference({ id: "ref-1", name: "Goner" })],
      })
      .mockResolvedValueOnce({ ok: true, value: [] });
    deleteReferenceMock.mockResolvedValue({ ok: true, value: undefined });

    render(<Library />);
    await screen.findByText("Goner");

    fireEvent.click(screen.getByRole("button", { name: "Actions for Goner" }));
    fireEvent.click(screen.getByText("Delete"));

    // ConfirmDialog is up; confirm it.
    await screen.findByText("Delete this reference?");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteReferenceMock).toHaveBeenCalledWith("ref-1"));
    await waitFor(() => expect(screen.queryByText("Goner")).toBeNull());
  });

  it("cancel on the confirm dialog does not call deleteReference", async () => {
    listReferencesMock.mockResolvedValue({
      ok: true,
      value: [makeReference({ id: "ref-1", name: "Keeper" })],
    });

    render(<Library />);
    await screen.findByText("Keeper");

    fireEvent.click(screen.getByRole("button", { name: "Actions for Keeper" }));
    fireEvent.click(screen.getByText("Delete"));

    await screen.findByText("Delete this reference?");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(deleteReferenceMock).not.toHaveBeenCalled();
    expect(screen.getByText("Keeper")).not.toBeNull();
  });
});

describe("Library — rename flow", () => {
  it("calls updateReference(id, {name}) with the edited value", async () => {
    listReferencesMock.mockResolvedValue({
      ok: true,
      value: [makeReference({ id: "ref-1", name: "Old Name" })],
    });
    updateReferenceMock.mockResolvedValue({
      ok: true,
      value: makeReference({ id: "ref-1", name: "New Name" }),
    });

    render(<Library />);
    await screen.findByText("Old Name");

    fireEvent.click(screen.getByRole("button", { name: "Actions for Old Name" }));
    fireEvent.click(screen.getByText("Rename"));

    const input = await screen.findByLabelText("Name");
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateReferenceMock).toHaveBeenCalledWith("ref-1", { name: "New Name" }),
    );
  });
});

describe("Library — re-tune routing", () => {
  it("routes to /convert?ref=<id> without building the convert screen", async () => {
    listReferencesMock.mockResolvedValue({
      ok: true,
      value: [makeReference({ id: "ref-9", name: "Tunable" })],
    });

    render(<Library />);
    await screen.findByText("Tunable");

    fireEvent.click(screen.getByRole("button", { name: "Actions for Tunable" }));
    fireEvent.click(screen.getByText("Re-tune"));

    expect(push).toHaveBeenCalledWith("/convert?ref=ref-9");
  });
});

describe("Library — performance smoke test", () => {
  // Renders 50 references and asserts all 50 cards mount. This proves the
  // grid does not crash or drop cards at that scale — it is NOT a timing
  // assertion and says nothing about visible jank on a real device (that
  // requires a browser; see the build report's Unverified section).
  it("renders 50 cards without error", async () => {
    const refs = Array.from({ length: 50 }, (_, i) =>
      makeReference({ id: `ref-${i}`, name: `Ref ${i}`, createdAt: i }),
    );
    listReferencesMock.mockResolvedValue({ ok: true, value: refs });

    render(<Library />);

    await screen.findByText("Ref 0");
    expect(screen.getAllByRole("button", { name: /^Open Ref /}).length).toBe(50);
  });
});
