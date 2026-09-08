import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireWakeLock, releaseWakeLock } from "@/lib/wakeLock";

/**
 * lib/wakeLock.ts is deliberately React-free (same shape as lib/camera.ts),
 * so it is exercised directly against a mocked `navigator.wakeLock` here —
 * the hook's lifecycle wiring is covered in trace-chrome.test.tsx.
 */

const originalWakeLock = (
  navigator as Navigator & { wakeLock?: WakeLock }
).wakeLock;

function installWakeLock(request: (type: WakeLockType) => Promise<WakeLockSentinel>) {
  Object.defineProperty(navigator, "wakeLock", {
    value: { request },
    configurable: true,
    writable: true,
  });
}

function removeWakeLock() {
  Object.defineProperty(navigator, "wakeLock", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "wakeLock", {
    value: originalWakeLock,
    configurable: true,
    writable: true,
  });
});

describe("acquireWakeLock", () => {
  it("requests the screen wake lock and returns the sentinel when supported", async () => {
    const release = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const sentinel = { release, released: false, type: "screen" } as unknown as WakeLockSentinel;
    const request = vi.fn().mockResolvedValue(sentinel);
    installWakeLock(request);

    const result = await acquireWakeLock();

    expect(request).toHaveBeenCalledWith("screen");
    expect(result).toBe(sentinel);
  });

  it("returns null silently when navigator.wakeLock is undefined", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    removeWakeLock();

    const result = await acquireWakeLock();

    expect(result).toBeNull();
    expect(logged).not.toHaveBeenCalled();
  });

  it("returns null silently when the request rejects", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    installWakeLock(request);

    const result = await acquireWakeLock();

    expect(result).toBeNull();
    expect(logged).not.toHaveBeenCalled();
  });
});

describe("releaseWakeLock", () => {
  it("calls release() on a sentinel", async () => {
    const release = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const sentinel = { release, released: false, type: "screen" } as unknown as WakeLockSentinel;

    await releaseWakeLock(sentinel);

    expect(release).toHaveBeenCalledTimes(1);
  });

  it("does nothing, and does not throw, when passed null", async () => {
    await expect(releaseWakeLock(null)).resolves.toBeUndefined();
  });

  it("swallows a rejection from release() silently", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const release = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("boom"));
    const sentinel = { release, released: false, type: "screen" } as unknown as WakeLockSentinel;

    await expect(releaseWakeLock(sentinel)).resolves.toBeUndefined();
    expect(logged).not.toHaveBeenCalled();
  });
});
