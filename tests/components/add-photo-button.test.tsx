import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddPhotoButton } from "@/components/AddPhotoButton";
import { importPhoto } from "@/lib/import";
import { peekPendingImport, takePendingImport } from "@/lib/pendingImport";

const NativeBlob = NodeBlob as unknown as typeof Blob;

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/import", () => ({
  importPhoto: vi.fn(),
}));

const importPhotoMock = vi.mocked(importPhoto);

function pickFile(input: HTMLInputElement, file: File | undefined) {
  Object.defineProperty(input, "files", {
    value: file ? [file] : [],
    configurable: true,
  });
  fireEvent.change(input);
}

function makeFile(): File {
  return new File(["data"], "photo.heic", { type: "image/heic" });
}

beforeEach(() => {
  push.mockClear();
  importPhotoMock.mockReset();
  takePendingImport(); // drain any leftover pending value between tests
});

afterEach(() => {
  cleanup();
});

describe("AddPhotoButton — successful import", () => {
  it("stores the decoded image via setPendingImport and navigates to /convert", async () => {
    importPhotoMock.mockResolvedValue({
      ok: true,
      value: {
        original: new NativeBlob(["o"], { type: "image/jpeg" }),
        width: 100,
        height: 200,
        thumbnail: new NativeBlob(["t"], { type: "image/jpeg" }),
      },
    });

    render(<AddPhotoButton />);
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    pickFile(input, makeFile());

    await waitFor(() => expect(push).toHaveBeenCalledWith("/convert"));
    expect(peekPendingImport()).not.toBeNull();
    expect(peekPendingImport()?.width).toBe(100);
  });
});

describe("AddPhotoButton — import error", () => {
  it("renders the error message inline and does not navigate", async () => {
    importPhotoMock.mockResolvedValue({
      ok: false,
      error: {
        kind: "decode-failed",
        message: "This photo's format isn't supported on this device.",
      },
    });

    render(<AddPhotoButton />);
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    pickFile(input, makeFile());

    await screen.findByText(
      "This photo's format isn't supported on this device.",
    );
    expect(push).not.toHaveBeenCalled();
    expect(peekPendingImport()).toBeNull();
  });
});

describe("AddPhotoButton — cancelling the picker", () => {
  it("leaves no error state and does not navigate when no file is chosen", async () => {
    render(<AddPhotoButton />);
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    pickFile(input, undefined);

    // Give any microtasks a chance to run, then assert nothing happened.
    await Promise.resolve();
    expect(importPhotoMock).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByText(/./, { selector: "p" })).toBeNull();
  });

  it("resets the input value after a pick so re-picking the same file fires change again", async () => {
    importPhotoMock.mockResolvedValue({
      ok: false,
      error: { kind: "unknown", message: "Something went wrong." },
    });

    render(<AddPhotoButton />);
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    pickFile(input, makeFile());
    await screen.findByText("Something went wrong.");

    expect(input.value).toBe("");
  });
});
